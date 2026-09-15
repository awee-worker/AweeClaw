#!/usr/bin/env python3
"""
MOSS TTS 引擎（离线语音合成）

通过 stdin/stdout 与 Node.js 通信，支持以下命令：
- initialize: 初始化引擎
- synthesize: 合成语音
- dispose: 停止引擎

通信协议：
- 输入：JSON 行，每行一个命令
- 输出：JSON 行，每行一个响应（音频数据为 base64 编码）
"""

import os
import sys
import json
import asyncio
import threading
import wave
import io
import base64
from pathlib import Path
from typing import Optional, Dict, Any

# 全局变量
_moss_runtime = None
_runtime_lock = threading.Lock()

# 匹配我们在管理器中定义的根目录
MOSS_DIR_NAME = "MOSS-TTS"


def get_moss_runtime(model_dir: str = None, thread_count: int = 4):
    """彻底的懒加载：在第一次请求生成时，才会导入重型的 numpy/scipy/onnxruntime"""
    global _moss_runtime
    
    with _runtime_lock:
        # 双重检查，避免多个线程同时加载
        if _moss_runtime is not None:
            return _moss_runtime

        try:
            import numpy as np
            import scipy.signal
            from py.moss.tts_runtime import TTSRuntime
        except ImportError as e:
            print(f"MOSS TTS 依赖缺失，请确认 numpy/scipy/onnxruntime/sentencepiece/soundfile 已安装: {e}", file=sys.stderr)
            return None

        if model_dir is None:
            # 默认模型目录
            model_dir = Path.home() / ".aweeclaw" / "local-voice" / "models" / "sherpa-tts" / MOSS_DIR_NAME
        else:
            model_dir = Path(model_dir)
        
        if not (model_dir / "MOSS-TTS-Nano-100M-ONNX").exists():
            print(f"MOSS TTS 模型未找到，请先通过 SDK 接口下载。路径: {model_dir}", file=sys.stderr)
            return None

        print(f"正在加载 MOSS TTS 模型 [{model_dir}]...", file=sys.stderr)
        try:
            _moss_runtime = TTSRuntime(
                model_dir=str(model_dir),
                thread_count=thread_count,
            )
            # 预热模型，避免第一次推理时卡顿
            print("正在进行模型预热...", file=sys.stderr)
            _moss_runtime.warmup()
            print("MOSS TTS 模型加载完成", file=sys.stderr)
            return _moss_runtime
        except Exception as e:
            print(f"加载 MOSS TTS 失败: {e}", file=sys.stderr)
            return None


def validate_audio_quality(waveform, min_energy=0.0001, max_peak=1.0):
    """
    检查生成的音频质量
    
    参数:
        waveform: numpy数组，形状为(samples, channels)或(samples,)
        min_energy: 最小平均能量，低于此值认为是静音
        max_peak: 最大峰值，超过此值认为是削波
    
    返回:
        bool: 音频是否通过质量检查
        str: 未通过的原因（如果通过则为空字符串）
    """
    import numpy as np
    
    if waveform is None:
        return False, "Waveform is None"
    
    if waveform.size == 0:
        return False, "Waveform is empty"
    
    # 检查是否全为NaN或Inf
    if np.any(np.isnan(waveform)) or np.any(np.isinf(waveform)):
        return False, "Waveform contains NaN or Inf"
    
    # 计算平均能量
    energy = np.mean(np.abs(waveform))
    if energy < min_energy:
        return False, f"Audio too quiet (energy={energy:.6f} < {min_energy})"
    
    # 检查峰值
    peak = np.max(np.abs(waveform))
    if peak > max_peak:
        return False, f"Audio clipping detected (peak={peak:.3f} > {max_peak})"
    
    return True, ""


def validate_generated_frames(frames, codebook_size):
    """
    验证生成的音频帧质量
    """
    if not frames:
        return False, "No frames generated"
    
    # 检查帧数是否合理
    if len(frames) < 10:
        return False, f"Too few frames: {len(frames)}"
    
    # 检查是否有重复模式（可能是模型卡住）
    if len(frames) > 100:
        last_50 = frames[-50:]
        if len(set(last_50)) < 5:
            return False, "Repetitive pattern detected in last 50 frames"
    
    return True, ""


def process_tts_sync(text: str, voice: str = "Junhao", speed: float = 1.0, 
                    prompt_audio_path: str = "", model_dir: str = None,
                    thread_count: int = 4) -> bytes:
    """
    同步执行的 CPU 密集型任务：文本转语音
    """
    global _moss_runtime
    
    runtime = get_moss_runtime(model_dir, thread_count)
    if not runtime:
        raise RuntimeError("MOSS TTS 模型未就绪（未下载或加载失败）")
    
    # 每次推理前重置流式解码器状态，避免状态污染
    if hasattr(runtime, 'codec_streaming_session'):
        runtime.codec_streaming_session.reset()
    
    # 清除编码缓存（可选，确保每次都是新鲜的编码）
    if hasattr(runtime, '_audio_codes_cache') and not prompt_audio_path:
        # 使用内置声音时不清理缓存，提升性能
        pass
    elif hasattr(runtime, '_audio_codes_cache'):
        # 使用自定义参考音频时，可以在这里清理
        pass

    # MOSS TTS_runtime 代码默认会在磁盘写一个 wav，为了不残留垃圾文件，我们将路径指定到工具临时目录并及时删除
    import uuid
    import tempfile
    temp_wav_path = Path(tempfile.gettempdir()) / f"moss_temp_{uuid.uuid4().hex}.wav"

    try:
        # 执行推理
        result = runtime.synthesize(
            text=text,
            voice=voice,
            prompt_audio_path=prompt_audio_path if prompt_audio_path else None,
            output_audio_path=str(temp_wav_path),
            sample_mode="fixed", 
            do_sample=True,
        )
        
        original_sr = result["sample_rate"]
        waveform = result["waveform"]

        import numpy as np
        import scipy.signal

        max_val = np.max(np.abs(waveform))
        if max_val > 1.0:
            # 这里的 0.95 是为了留出一点余量（Headroom），防止后续处理再次溢出
            waveform = (waveform / max_val) * 0.95
            print(f"Audio peak {max_val:.3f} normalized to 0.95 to avoid clipping.", file=sys.stderr)

        # 验证音频质量
        is_valid, quality_msg = validate_audio_quality(waveform)
        if not is_valid:
            print(f"Generated audio quality issue: {quality_msg}", file=sys.stderr)
            # 不直接抛出异常，让客户端自己决定是否接受
        
        # 验证帧质量
        if "audio_token_ids" in result:
            audio_codebook_size = int(runtime.tts_meta["model_config"]["audio_codebook_sizes"][0])
            frames_valid, frames_msg = validate_generated_frames(
                result["audio_token_ids"].tolist() if hasattr(result["audio_token_ids"], 'tolist') else result["audio_token_ids"],
                audio_codebook_size
            )
            if not frames_valid:
                print(f"Generated frames quality issue: {frames_msg}", file=sys.stderr)

        # 调整语速逻辑
        if abs(speed - 1.0) >= 0.01:
            try:
                if waveform.ndim == 2:
                    adjusted = []
                    for channel in waveform.T:
                        channel_adjusted = scipy.signal.resample(channel, int(len(channel) / speed))
                        adjusted.append(channel_adjusted)
                    waveform = np.stack(adjusted, axis=1).astype(np.float32)
                else:
                    waveform = scipy.signal.resample(waveform, int(len(waveform) / speed)).astype(np.float32)
                sample_rate = int(original_sr * speed)
            except Exception as e:
                print(f"Speed adjustment failed: {e}, using original speed", file=sys.stderr)
                sample_rate = original_sr
        else:
            sample_rate = original_sr

        # 转换为 WAV 的二进制 Bytes
        audio = np.asarray(waveform, dtype=np.float32)
        if audio.ndim == 1:
            audio = audio.reshape(-1, 1)

        clipped = np.clip(audio, -1.0, 1.0)
        pcm16 = np.round(clipped * 32767.0).astype(np.int16)

        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wav_file:
            wav_file.setnchannels(int(pcm16.shape[1]))
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm16.tobytes())

        return wav_io.getvalue()
        
    except Exception as e:
        # 发生异常时，确保清理状态
        if hasattr(runtime, 'codec_streaming_session'):
            runtime.codec_streaming_session.reset()
        print(f"TTS generation failed: {e}", file=sys.stderr)
        raise RuntimeError(f"语音生成失败: {str(e)}")
        
    finally:
        # 执行完毕后，立刻删掉刚才被写入的临时 wav，实现伪纯内存效果
        if temp_wav_path.exists():
            try:
                temp_wav_path.unlink(missing_ok=True)
            except Exception as e:
                print(f"Failed to delete temp file {temp_wav_path}: {e}", file=sys.stderr)


def handle_initialize(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理初始化命令"""
    try:
        model_dir = params.get("modelDir")
        thread_count = params.get("threadCount", 4)
        
        runtime = get_moss_runtime(model_dir, thread_count)
        if runtime is None:
            return {
                "type": "error",
                "message": "模型加载失败",
            }
        
        return {
            "type": "initialized",
            "modelDir": model_dir,
        }
    except Exception as e:
        return {
            "type": "error",
            "message": f"初始化失败: {str(e)}",
        }


def handle_synthesize(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理合成命令"""
    global _moss_runtime
    
    if _moss_runtime is None:
        return {
            "type": "error",
            "message": "引擎未初始化",
        }
    
    try:
        request_id = params.get("requestId", "")
        text = params.get("text", "")
        voice = params.get("voice", "Junhao")
        speed = params.get("speed", 1.0)
        prompt_audio_path = params.get("promptAudioPath", "")
        model_dir = params.get("modelDir")
        thread_count = params.get("threadCount", 4)
        
        if not text or not text.strip():
            return {
                "type": "error",
                "requestId": request_id,
                "message": "文本内容不能为空",
            }
        
        # 执行合成
        wav_bytes = process_tts_sync(
            text=text,
            voice=voice,
            speed=speed,
            prompt_audio_path=prompt_audio_path,
            model_dir=model_dir,
            thread_count=thread_count,
        )
        
        if not wav_bytes:
            return {
                "type": "error",
                "requestId": request_id,
                "message": "生成的音频为空",
            }
        
        # 编码为 base64
        audio_base64 = base64.b64encode(wav_bytes).decode('utf-8')
        
        return {
            "type": "result",
            "requestId": request_id,
            "audioData": audio_base64,
            "format": "wav",
            "sampleRate": 24000,  # MOSS TTS 默认采样率
            "durationMs": len(wav_bytes) / (24000 * 2) * 1000,  # 估算时长
        }
    except Exception as e:
        return {
            "type": "error",
            "requestId": params.get("requestId", ""),
            "message": f"合成失败: {str(e)}",
        }


def handle_dispose(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理停止命令"""
    global _moss_runtime
    
    with _runtime_lock:
        _moss_runtime = None
    
    return {
        "type": "disposed",
    }


def process_command(command: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """处理单个命令"""
    if command == "initialize":
        return handle_initialize(params)
    elif command == "synthesize":
        return handle_synthesize(params)
    elif command == "dispose":
        return handle_dispose(params)
    else:
        return {
            "type": "error",
            "message": f"未知命令: {command}",
        }


def main():
    """主循环：从 stdin 读取命令，处理并输出结果"""
    print("MOSS TTS Python 进程已启动", file=sys.stderr)
    
    # 发送就绪消息
    print(json.dumps({"type": "ready"}))
    sys.stdout.flush()
    
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
                command = data.get("command", "")
                params = data.get("params", {})
                
                result = process_command(command, params)
                
                # 输出结果
                print(f"JSON:{json.dumps(result)}")
                sys.stdout.flush()
                
            except json.JSONDecodeError as e:
                print(f"JSON 解析错误: {e}", file=sys.stderr)
            except Exception as e:
                print(f"处理命令时出错: {e}", file=sys.stderr)
                
    except KeyboardInterrupt:
        print("收到中断信号，正在退出...", file=sys.stderr)
    finally:
        # 清理资源
        global _moss_runtime
        _moss_runtime = None
        print("MOSS TTS Python 进程已退出", file=sys.stderr)


if __name__ == "__main__":
    main()
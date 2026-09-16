#!/usr/bin/env python3
"""
Sherpa-ONNX ASR 引擎（离线语音识别）

通过 stdin/stdout 与 Node.js 通信，支持以下命令：
- initialize: 初始化引擎
- recognize: 识别音频
- dispose: 停止引擎

通信协议：
- 输入：JSON 行，每行一个命令
- 输出：JSON 行，每行一个响应
"""

import os
import sys
import json
import asyncio
import threading
from pathlib import Path
from io import BytesIO
from typing import Optional, Dict, Any

# 全局变量
_recognizer = None
_last_model_name = None
# 最近一次初始化失败的**真实**原因（依赖缺失 / 模型文件缺失 ...）
# 用于替代笼统的「模型加载失败」，让 Node 侧能透出可诊断的错误
_last_init_error = None
_lock = threading.Lock()


def detect_device() -> str:
    """强制使用 CPU，避免 GPU 版本未安装的警告"""
    return 'cpu'


def get_recognizer(model_name: str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue", 
                   model_dir: str = None, num_threads: int = 4,
                   language: str = "auto", use_itn: bool = True):
    """初始化/获取识别器（包含重型库的懒加载）"""
    global _recognizer, _last_model_name, _last_init_error
    
    with _lock:
        # 如果已经加载且模型没变，直接返回
        if _recognizer is not None and model_name == _last_model_name:
            return _recognizer

        # --- 延迟导入重型依赖 ---
        try:
            import sherpa_onnx
        except ImportError as e:
            _last_init_error = (
                f"当前 Python 解释器缺少 sherpa_onnx 依赖（解释器：{sys.executable}）：{e}"
            )
            print(_last_init_error, file=sys.stderr)
            return None
        
        if model_dir is None:
            # 默认模型目录
            model_dir = Path.home() / ".aweeclaw" / "local-voice" / "models" / "sherpa-asr" / model_name
        else:
            model_dir = Path(model_dir)
        
        model_path = model_dir / "model.int8.onnx"
        tokens_path = model_dir / "tokens.txt"

        # 检查文件是否存在
        if not model_path.is_file() or not tokens_path.is_file():
            # global 已在函数首部声明，此处直接赋值即可
            _last_init_error = f"模型文件不存在: {model_dir}"
            print(_last_init_error, file=sys.stderr)
            return None

        device = detect_device()
        print(f"正在加载 Sherpa-ONNX 模型 [{model_name}] 使用设备 [{device}]...", file=sys.stderr)

        try:
            recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(model_path),
                tokens=str(tokens_path),
                num_threads=num_threads,
                provider=device,
                use_itn=use_itn,
                debug=False,
            )
            _recognizer = recognizer
            _last_model_name = model_name
            return _recognizer
        except Exception as e:
            _last_init_error = f"加载 Sherpa-ONNX 模型失败（{model_name}）：{e}"
            print(_last_init_error, file=sys.stderr)
            return None


def process_audio_sync(recognizer, audio_bytes: bytes, sample_rate: int = 16000) -> Dict[str, Any]:
    """
    同步执行的 CPU 密集型任务：解码音频 + 神经网络推理
    """
    import soundfile as sf
    import numpy as np
    import time

    start_time = time.time()

    try:
        with BytesIO(audio_bytes) as audio_file:
            audio, file_sample_rate = sf.read(audio_file, dtype="float32", always_2d=True)
            
            # 如果是立体声，转换为单声道
            if audio.shape[1] > 1:
                audio = audio[:, 0]
            
            # 重采样到目标采样率（如果需要）
            if file_sample_rate != sample_rate:
                from scipy import signal
                num_samples = int(len(audio) * sample_rate / file_sample_rate)
                audio = signal.resample(audio, num_samples).astype(np.float32)
            
            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate, audio)
            recognizer.decode_stream(stream)
            
            result = stream.result
            text = result.text.strip()
            
            # 计算处理时长
            duration_ms = int((time.time() - start_time) * 1000)
            
            return {
                "text": text,
                "language": "auto",  # SenseVoice 会自动检测语言
                "confidence": 1.0,   # sherpa-onnx 不返回置信度
                "durationMs": duration_ms,
            }
    except Exception as e:
        raise RuntimeError(f"音频处理失败: {str(e)}")


def handle_initialize(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理初始化命令"""
    try:
        model_dir = params.get("modelDir")
        model_name = params.get("modelName", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue")
        num_threads = params.get("numThreads", 4)
        language = params.get("language", "auto")
        use_itn = params.get("useItn", True)
        
        recognizer = get_recognizer(
            model_name=model_name,
            model_dir=model_dir,
            num_threads=num_threads,
            language=language,
            use_itn=use_itn,
        )
        
        if recognizer is None:
            return {
                "type": "error",
                # 优先透出真实原因（缺依赖 / 缺模型文件），避免只报「模型加载失败」
                "message": _last_init_error or "模型加载失败",
            }
        
        return {
            "type": "initialized",
            "modelName": model_name,
            "modelDir": model_dir,
        }
    except Exception as e:
        return {
            "type": "error",
            "message": f"初始化失败: {str(e)}",
        }


def handle_recognize(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理识别命令"""
    global _recognizer
    
    if _recognizer is None:
        return {
            "type": "error",
            "message": "引擎未初始化",
        }
    
    try:
        request_id = params.get("requestId", "")
        audio_data = params.get("audioData", "")
        sample_rate = params.get("sampleRate", 16000)
        
        # 解码 base64 音频数据
        import base64
        audio_bytes = base64.b64decode(audio_data)
        
        # 执行识别
        result = process_audio_sync(_recognizer, audio_bytes, sample_rate)
        
        return {
            "type": "result",
            "requestId": request_id,
            **result,
        }
    except Exception as e:
        return {
            "type": "error",
            "requestId": params.get("requestId", ""),
            "message": f"识别失败: {str(e)}",
        }


def handle_dispose(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理停止命令"""
    global _recognizer, _last_model_name
    
    with _lock:
        _recognizer = None
        _last_model_name = None
    
    return {
        "type": "disposed",
    }


def process_command(command: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """处理单个命令"""
    if command == "initialize":
        return handle_initialize(params)
    elif command == "recognize":
        return handle_recognize(params)
    elif command == "dispose":
        return handle_dispose(params)
    else:
        return {
            "type": "error",
            "message": f"未知命令: {command}",
        }


def emit(message: Dict[str, Any]) -> None:
    """输出单条协议消息（Node 侧按 "JSON:" 前缀解析）"""
    print(f"JSON:{json.dumps(message, ensure_ascii=False)}")
    sys.stdout.flush()


def main():
    """主循环：从 stdin 读取命令，处理并输出结果"""
    print("Sherpa ASR Python 进程已启动", file=sys.stderr)

    # 就绪握手：Node 侧以此判定进程可用，取代过去的固定 sleep
    emit({"type": "ready"})

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            data: Any = None
            try:
                data = json.loads(line)
                command = data.get("command", "")
                params = data.get("params", {}) or {}
                request_id = data.get("requestId", "")
                # 外层 requestId 是权威值：强制回显并覆盖 handle_* 内部的占位值，
                # 否则 Node 侧按 requestId 分发时会匹配不到（命令永远超时）
                result = dict(process_command(command, params))
                result["requestId"] = request_id
                emit(result)

            except json.JSONDecodeError as e:
                print(f"JSON 解析错误: {e}", file=sys.stderr)
                emit({"type": "error", "requestId": "", "message": f"命令不是合法 JSON: {e}"})
            except Exception as e:
                print(f"处理命令时出错: {e}", file=sys.stderr)
                echoed = data.get("requestId", "") if isinstance(data, dict) else ""
                emit({"type": "error", "requestId": echoed, "message": f"处理命令时出错: {e}"})

    except KeyboardInterrupt:
        print("收到中断信号，正在退出...", file=sys.stderr)
    finally:
        # 清理资源
        global _recognizer, _last_model_name
        _recognizer = None
        _last_model_name = None
        print("Sherpa ASR Python 进程已退出", file=sys.stderr)



if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
VITS 离线语音合成引擎

通过 stdin/stdout 与 Node.js 通信，命令集与 moss_tts.py 保持一致：
- initialize: 加载模型
- synthesize: 合成语音
- dispose:    释放引擎

通信协议：
- 输入：JSON 行，每行一个命令
- 输出：JSON 行，每行一个响应（音频数据为 base64 编码）

与 MOSS 实现的差异：
1. 推理走 sherpa-onnx 的 `OfflineTts`，权重、词表与分词词典由模型仓库直接提供；
2. 音色是整数 speaker id（sid），不是音色名；
3. 权重文件名各仓库不统一，按扩展名探测而非硬编码。
"""

import os
import sys
import json
import time
import wave
import io
import base64
import threading
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List

# 与 moss_tts.py 保持一致：脚本位于 <模块目录>/py/，把其父目录加入 sys.path
_PKG_ROOT = Path(__file__).resolve().parent.parent
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

# 全局引擎实例与最近一次初始化失败的真实原因
_tts = None
_last_init_error: Optional[str] = None
_lock = threading.Lock()

# 默认模型根目录（Node 侧正常都会显式传入完整模型目录）
_DEFAULT_TTS_ROOT = Path.home() / ".aweeclaw" / "local-voice" / "models" / "sherpa-tts"


def _find_model_file(model_dir: Path) -> Optional[Path]:
    """
    定位 ONNX 权重文件

    各仓库的权重命名并不统一（theresa.onnx / vits-zh-hf-fanchen-C.onnx /
    model.int8.onnx），按扩展名探测可避免为每个模型维护文件名表。
    目录内出现多个候选时优先 int8 量化版，其体积与推理耗时都更低。
    """
    candidates = sorted(model_dir.glob("*.onnx"))
    if not candidates:
        return None

    for path in candidates:
        if "int8" in path.name:
            return path
    return candidates[0]


def _build_rule_fsts(model_dir: Path) -> str:
    """拼接 fst 规则文件（数字、日期、电话的正则化），只收集真实存在的文件"""
    names = ["date.fst", "number.fst", "phone.fst"]
    paths = [str(model_dir / name) for name in names if (model_dir / name).is_file()]
    return ",".join(paths)


def get_tts(model_dir: str = None, thread_count: int = 4):
    """懒加载引擎：首次请求时才导入 sherpa_onnx 与 numpy"""
    global _tts, _last_init_error

    with _lock:
        if _tts is not None:
            return _tts

        try:
            import sherpa_onnx
        except ImportError as e:
            _last_init_error = (
                f"当前 Python 解释器缺少 sherpa_onnx 依赖（解释器：{sys.executable}）：{e}"
            )
            print(_last_init_error, file=sys.stderr)
            return None

        root = Path(model_dir).expanduser() if model_dir else _DEFAULT_TTS_ROOT

        if not root.is_dir():
            _last_init_error = f"模型目录不存在: {root}"
            print(_last_init_error, file=sys.stderr)
            return None

        model_path = _find_model_file(root)
        tokens_path = root / "tokens.txt"
        lexicon_path = root / "lexicon.txt"
        dict_dir = root / "dict"
        heteronym_fst = root / "new_heteronym.fst"

        if model_path is None:
            _last_init_error = f"模型目录中未找到 ONNX 权重: {root}"
            print(_last_init_error, file=sys.stderr)
            return None

        if not tokens_path.is_file():
            _last_init_error = f"模型缺少 tokens.txt: {root}"
            print(_last_init_error, file=sys.stderr)
            return None

        print(
            f"正在加载 VITS 模型 [{model_path.name}]，词典目录 "
            f"[{'已就绪' if dict_dir.is_dir() else '缺失'}]...",
            file=sys.stderr,
        )

        try:
            vits_kwargs: Dict[str, Any] = {
                "model": str(model_path),
                "tokens": str(tokens_path),
            }
            # 中文模型靠 lexicon 或 jieba 词典分词，两者都在时一并交给 sherpa-onnx 自行取舍
            if lexicon_path.is_file():
                vits_kwargs["lexicon"] = str(lexicon_path)
            if dict_dir.is_dir():
                vits_kwargs["dict_dir"] = str(dict_dir)

            config_kwargs: Dict[str, Any] = {
                "model": sherpa_onnx.OfflineTtsModelConfig(
                    vits=sherpa_onnx.OfflineTtsVitsModelConfig(**vits_kwargs),
                    num_threads=int(thread_count),
                    provider="cpu",
                    debug=False,
                ),
                # 单句合成可避免长文本被切分后拼接产生异常停顿
                "max_num_sentences": 1,
            }

            rule_fsts = _build_rule_fsts(root)
            if rule_fsts:
                config_kwargs["rule_fsts"] = rule_fsts
            if heteronym_fst.is_file():
                config_kwargs["rule_fars"] = str(heteronym_fst)

            engine = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(**config_kwargs))

            _tts = engine
            print(
                f"VITS 模型加载完成（采样率 {getattr(engine, 'sample_rate', '?')}Hz，"
                f"音色数 {getattr(engine, 'num_speakers', '?')}）",
                file=sys.stderr,
            )
            return _tts
        except Exception as e:
            _last_init_error = f"加载 VITS 模型失败（{root}）：{e}"
            print(_last_init_error, file=sys.stderr)
            return None


def process_tts_sync(
    text: str,
    voice: str,
    speed: float,
    model_dir: str,
    thread_count: int = 4,
) -> Tuple[bytes, int]:
    """同步合成，返回 (WAV 字节, 采样率)"""
    engine = get_tts(model_dir, thread_count)
    if engine is None:
        raise RuntimeError(_last_init_error or "模型加载失败")

    num_speakers = int(getattr(engine, "num_speakers", 1) or 1)

    # sid 越界直接回退到首个音色：Node 侧已做白名单校验，
    # 这里再兜一层，避免手工改配置后合成整体失败
    try:
        sid = int(str(voice).strip())
    except (TypeError, ValueError):
        sid = 0
    if sid < 0 or sid >= num_speakers:
        print(f"sid {sid} 超出范围（音色数 {num_speakers}），已回退到 0", file=sys.stderr)
        sid = 0

    audio = engine.generate(text, sid=sid, speed=float(speed))

    import numpy as np

    samples = np.asarray(audio.samples, dtype=np.float32)
    sample_rate = int(audio.sample_rate)

    # 转 16bit PCM 单声道 WAV；先裁剪再量化，避免溢出翻转成爆音
    clipped = np.clip(samples, -1.0, 1.0)
    pcm16 = np.round(clipped * 32767.0).astype(np.int16)

    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())

    return wav_io.getvalue(), sample_rate


def handle_initialize(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理初始化命令"""
    try:
        model_dir = params.get("modelDir")
        thread_count = params.get("threadCount", 4)

        engine = get_tts(model_dir, thread_count)
        if engine is None:
            # 优先透出真实原因（缺依赖 / 缺模型文件），避免只报「模型加载失败」
            return {
                "type": "error",
                "message": _last_init_error or "模型加载失败",
            }

        return {
            "type": "initialized",
            "modelDir": model_dir,
            "sampleRate": int(getattr(engine, "sample_rate", 0) or 0),
            "numSpeakers": int(getattr(engine, "num_speakers", 0) or 0),
        }
    except Exception as e:
        return {
            "type": "error",
            "message": f"初始化失败: {str(e)}",
        }


def handle_synthesize(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理合成命令"""
    if _tts is None:
        return {
            "type": "error",
            "requestId": params.get("requestId", ""),
            "message": _last_init_error or "引擎未初始化",
        }

    try:
        request_id = params.get("requestId", "")
        text = str(params.get("text", "")).strip()
        voice = str(params.get("voice", "0"))
        speed = float(params.get("speed", 1.0))
        model_dir = params.get("modelDir")
        thread_count = params.get("threadCount", 4)

        if not text:
            return {
                "type": "error",
                "requestId": request_id,
                "message": "文本内容不能为空",
            }

        start_time = time.time()
        wav_bytes, sample_rate = process_tts_sync(
            text=text,
            voice=voice,
            speed=speed,
            model_dir=model_dir,
            thread_count=thread_count,
        )
        duration_ms = int((time.time() - start_time) * 1000)

        return {
            "type": "result",
            "requestId": request_id,
            "audioData": base64.b64encode(wav_bytes).decode("ascii"),
            "sampleRate": sample_rate,
            "format": "wav",
            "durationMs": duration_ms,
        }
    except Exception as e:
        return {
            "type": "error",
            "requestId": params.get("requestId", ""),
            "message": f"合成失败: {str(e)}",
        }


def handle_dispose(params: Dict[str, Any]) -> Dict[str, Any]:
    """处理停止命令"""
    global _tts

    with _lock:
        _tts = None

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


def emit(message: Dict[str, Any]) -> None:
    """输出单条协议消息（Node 侧按 "JSON:" 前缀解析）"""
    print(f"JSON:{json.dumps(message, ensure_ascii=False)}")
    sys.stdout.flush()


def main():
    """主循环：从 stdin 读取命令，处理并输出结果"""
    print("VITS TTS Python 进程已启动", file=sys.stderr)

    # 就绪握手：Node 侧以此判定进程可用
    emit({"type": "ready"})

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            data: Any = None
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                emit({"type": "error", "message": f"JSON 解析失败: {str(e)}"})
                continue

            if not isinstance(data, dict):
                emit({"type": "error", "message": "协议消息必须是 JSON 对象"})
                continue

            command = str(data.get("command", ""))
            params = data.get("params") or {}
            request_id = data.get("requestId", "")

            response = process_command(command, params)
            response["requestId"] = request_id
            emit(response)
    except KeyboardInterrupt:
        print("收到中断信号，退出", file=sys.stderr)
    finally:
        print("VITS TTS Python 进程已退出", file=sys.stderr)


if __name__ == "__main__":
    main()

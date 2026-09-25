#!/usr/bin/env python3
"""
Sherpa-ONNX 离线语音合成引擎

支持四种模型架构，由模型目录内的文件特征自动识别，无需 Node 侧告知类型：
- vits     单一 ONNX 权重 + tokens，中文可带 lexicon 与 jieba 词典
- matcha   声学模型 model-steps-*.onnx + 外置声码器 vocos-22khz-univ.onnx
- kokoro   model.onnx + voices.bin + espeak-ng 音素库，中英混读多音色
- zipvoice encoder + decoder + 声码器，零样本克隆，合成时需参考音频与参考文本

通过 stdin/stdout 与 Node.js 通信，命令集与 moss_tts.py 保持一致：
- initialize: 加载模型
- synthesize: 合成语音
- dispose:    释放引擎

通信协议：
- 输入：JSON 行，每行一个命令
- 输出：JSON 行，每行一个响应（音频数据为 base64 编码）

与 MOSS 实现的差异：
1. 推理走 sherpa-onnx 的 `OfflineTts`，权重、词表与分词词典由模型仓库直接提供；
2. 多说话人模型的音色是整数 speaker id（sid），不是音色名；
3. 权重文件名各仓库不统一，按扩展名与文件名前缀探测而非硬编码。
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

# 全局引擎实例、模型架构与最近一次初始化失败的真实原因
_tts = None
_model_type: str = ""

_last_init_error: Optional[str] = None
_lock = threading.Lock()

# 默认模型根目录（Node 侧正常都会显式传入完整模型目录）
_DEFAULT_TTS_ROOT = Path.home() / ".aweeclaw" / "local-voice" / "models" / "sherpa-tts"

# 模型架构标识
_MODEL_VITS = "vits"
_MODEL_MATCHA = "matcha"
_MODEL_KOKORO = "kokoro"
_MODEL_ZIPVOICE = "zipvoice"

# 声码器文件名。Matcha 与 ZipVoice 的声码器由 Node 侧下载到模型目录内，
# 属于辅助权重：既不能当作主体权重识别，也不能被按扩展名探测选中。
_MATCHA_VOCODERS: Tuple[str, ...] = ("vocos-22khz-univ.onnx",)
_ZIPVOICE_VOCODERS: Tuple[str, ...] = ("vocos_24khz.onnx",)
_VOCODER_NAMES = frozenset(_MATCHA_VOCODERS + _ZIPVOICE_VOCODERS + ("vocos-16khz-univ.onnx",))


def _find_model_file(model_dir: Path) -> Optional[Path]:
    """
    定位主体 ONNX 权重（VITS / Kokoro）

    各仓库的权重命名并不统一（theresa.onnx / vits-zh-hf-fanchen-C.onnx /
    model.int8.onnx），按扩展名探测可避免为每个模型维护文件名表。
    目录内出现多个候选时优先 int8 量化版，其体积与推理耗时都更低。
    声码器是外挂权重，必须排除，否则会被误选为声学模型。
    """
    candidates = [p for p in sorted(model_dir.glob("*.onnx")) if p.name not in _VOCODER_NAMES]
    if not candidates:
        return None

    for path in candidates:
        if "int8" in path.name:
            return path
    return candidates[0]


def _find_onnx_by_stem(model_dir: Path, stem: str) -> Optional[Path]:
    """按文件名前缀定位 ONNX 权重（如 encoder / decoder / model-steps），优先 int8"""
    candidates = [
        p for p in sorted(model_dir.glob(f"{stem}*.onnx")) if p.name not in _VOCODER_NAMES
    ]
    if not candidates:
        return None

    for path in candidates:
        if "int8" in path.name:
            return path
    return candidates[0]


def _find_named_file(model_dir: Path, names: Tuple[str, ...]) -> Optional[Path]:
    """按候选文件名依次查找，返回首个存在的文件"""
    for name in names:
        path = model_dir / name
        if path.is_file():
            return path
    return None


def _detect_model_type(model_dir: Path) -> str:
    """
    按目录内的文件特征识别模型架构

    不依赖 Node 侧传参：所有模型都落在同一个根目录下，磁盘上有哪套权重就按哪套加载，
    新增模型时只需把权重放全，不必同步维护两侧的模型类型表。
    判定顺序有讲究——先认特征最明确的（voices.bin / model-steps），
    否则 ZipVoice 的 encoder/decoder 会与通用权重探测互相误判。
    """
    if (model_dir / "voices.bin").is_file():
        return _MODEL_KOKORO

    if any(model_dir.glob("model-steps-*.onnx")):
        return _MODEL_MATCHA

    if _find_onnx_by_stem(model_dir, "encoder") and _find_onnx_by_stem(model_dir, "decoder"):
        return _MODEL_ZIPVOICE

    return _MODEL_VITS


def _build_rule_fsts(model_dir: Path) -> str:
    """
    拼接 fst 规则文件（数字、日期、电话的正则化），只收集真实存在的文件

    VITS / Matcha 用无语言后缀的命名（date.fst），Kokoro 用带后缀的（date-zh.fst），
    两种命名都收集，缺哪套就跳哪套；一个都没收集到时上层不会设置该项。
    """
    names = [
        "date.fst",
        "number.fst",
        "phone.fst",
        "date-zh.fst",
        "number-zh.fst",
        "phone-zh.fst",
    ]
    paths = [str(model_dir / name) for name in names if (model_dir / name).is_file()]
    return ",".join(paths)


def _build_model_config(sherpa_onnx, kind: str, model_dir: Path):
    """
    按架构构造 sherpa-onnx 的模型配置

    文件缺失时不抛异常，而是把原因写进 _last_init_error 并返回 None——
    上层据此给出可诊断的报错，而不是笼统的「模型加载失败」。
    """
    global _last_init_error

    tokens_path = model_dir / "tokens.txt"
    lexicon_path = model_dir / "lexicon.txt"
    dict_dir = model_dir / "dict"
    data_dir = model_dir / "espeak-ng-data"

    if kind == _MODEL_MATCHA:
        acoustic = _find_onnx_by_stem(model_dir, "model-steps")
        vocoder = _find_named_file(model_dir, _MATCHA_VOCODERS)
        if acoustic is None:
            _last_init_error = f"Matcha 模型缺少声学权重（model-steps-*.onnx）: {model_dir}"
            print(_last_init_error, file=sys.stderr)
            return None
        if vocoder is None:
            _last_init_error = (
                f"Matcha 模型缺少声码器（{' / '.join(_MATCHA_VOCODERS)}）: {model_dir}"
            )
            print(_last_init_error, file=sys.stderr)
            return None

        matcha_kwargs: Dict[str, Any] = {
            "acoustic_model": str(acoustic),
            "vocoder": str(vocoder),
            "tokens": str(tokens_path),
        }
        if lexicon_path.is_file():
            matcha_kwargs["lexicon"] = str(lexicon_path)
        if dict_dir.is_dir():
            matcha_kwargs["dict_dir"] = str(dict_dir)
        return sherpa_onnx.OfflineTtsMatchaModelConfig(**matcha_kwargs)

    if kind == _MODEL_KOKORO:
        model_path = _find_model_file(model_dir)
        voices_path = model_dir / "voices.bin"
        if model_path is None or not voices_path.is_file():
            _last_init_error = (
                f"Kokoro 模型缺少权重或音色库（model.onnx / voices.bin）: {model_dir}"
            )
            print(_last_init_error, file=sys.stderr)
            return None

        kokoro_kwargs: Dict[str, Any] = {
            "model": str(model_path),
            "voices": str(voices_path),
            "tokens": str(tokens_path),
        }
        if data_dir.is_dir():
            kokoro_kwargs["data_dir"] = str(data_dir)
        # 中英混读需要两套词表，缺一个就会出现整段中文或英文读不出
        lexicons = [
            str(p)
            for p in (model_dir / "lexicon-us-en.txt", model_dir / "lexicon-zh.txt")
            if p.is_file()
        ]
        if lexicons:
            kokoro_kwargs["lexicon"] = ",".join(lexicons)
        return sherpa_onnx.OfflineTtsKokoroModelConfig(**kokoro_kwargs)

    if kind == _MODEL_ZIPVOICE:
        encoder = _find_onnx_by_stem(model_dir, "encoder")
        decoder = _find_onnx_by_stem(model_dir, "decoder")
        vocoder = _find_named_file(model_dir, _ZIPVOICE_VOCODERS)
        if encoder is None or decoder is None or vocoder is None:
            _last_init_error = (
                f"ZipVoice 模型缺少权重（encoder / decoder / "
                f"{' / '.join(_ZIPVOICE_VOCODERS)}）: {model_dir}"
            )
            print(_last_init_error, file=sys.stderr)
            return None

        zip_kwargs: Dict[str, Any] = {
            "tokens": str(tokens_path),
            "encoder": str(encoder),
            "decoder": str(decoder),
            "vocoder": str(vocoder),
        }
        if lexicon_path.is_file():
            zip_kwargs["lexicon"] = str(lexicon_path)
        if data_dir.is_dir():
            zip_kwargs["data_dir"] = str(data_dir)
        return sherpa_onnx.OfflineTtsZipvoiceModelConfig(**zip_kwargs)

    # 默认按 VITS 处理
    model_path = _find_model_file(model_dir)
    if model_path is None:
        _last_init_error = f"模型目录中未找到 ONNX 权重: {model_dir}"
        print(_last_init_error, file=sys.stderr)
        return None

    vits_kwargs: Dict[str, Any] = {
        "model": str(model_path),
        "tokens": str(tokens_path),
    }
    # 中文模型靠 lexicon 或 jieba 词典分词，两者都在时一并交给 sherpa-onnx 自行取舍
    if lexicon_path.is_file():
        vits_kwargs["lexicon"] = str(lexicon_path)
    if dict_dir.is_dir():
        vits_kwargs["dict_dir"] = str(dict_dir)
    return sherpa_onnx.OfflineTtsVitsModelConfig(**vits_kwargs)


def get_tts(model_dir: str = None, thread_count: int = 4):
    """懒加载引擎：首次请求时才导入 sherpa_onnx 与 numpy"""
    global _tts, _model_type, _last_init_error

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

        tokens_path = root / "tokens.txt"
        if not tokens_path.is_file():
            _last_init_error = f"模型缺少 tokens.txt: {root}"
            print(_last_init_error, file=sys.stderr)
            return None

        kind = _detect_model_type(root)
        dict_dir = root / "dict"
        heteronym_fst = root / "new_heteronym.fst"
        print(
            f"识别到模型架构 [{kind}]，词典目录 "
            f"[{'已就绪' if dict_dir.is_dir() else '缺失'}]，目录 {root}",
            file=sys.stderr,
        )

        try:
            model_config = _build_model_config(sherpa_onnx, kind, root)
            if model_config is None:
                return None

            # 只填当前架构对应的子配置，其余保持构造函数的默认空值：
            # sherpa-onnx 依据已设置的字段选择实现，填错会得到「配置与权重不匹配」的加载失败
            model_kwargs: Dict[str, Any] = {
                "num_threads": int(thread_count),
                "provider": "cpu",
                "debug": False,
            }
            if kind == _MODEL_VITS:
                model_kwargs["vits"] = model_config
            elif kind == _MODEL_MATCHA:
                model_kwargs["matcha"] = model_config
            elif kind == _MODEL_KOKORO:
                model_kwargs["kokoro"] = model_config
            elif kind == _MODEL_ZIPVOICE:
                model_kwargs["zipvoice"] = model_config

            config_kwargs: Dict[str, Any] = {
                "model": sherpa_onnx.OfflineTtsModelConfig(**model_kwargs),
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
            _model_type = kind
            print(
                f"模型加载完成（架构 {kind}，采样率 {getattr(engine, 'sample_rate', '?')}Hz，"
                f"音色数 {getattr(engine, 'num_speakers', '?')}）",
                file=sys.stderr,
            )
            return _tts
        except Exception as e:
            _last_init_error = f"加载 {kind} 模型失败（{root}）：{e}"
            print(_last_init_error, file=sys.stderr)
            return None


def _resolve_sid(engine, voice: str) -> int:
    """
    把音色参数解析为合法的 speaker id

    Node 侧已做白名单校验，这里再兜一层：手工改配置、或模型音色数与配置不一致时，
    宁可回退到首个音色，也不要让整句合成失败。
    """
    num_speakers = int(getattr(engine, "num_speakers", 1) or 1)
    try:
        sid = int(str(voice).strip())
    except (TypeError, ValueError):
        sid = 0
    if sid < 0 or sid >= num_speakers:
        print(f"sid {sid} 超出范围（音色数 {num_speakers}），已回退到 0", file=sys.stderr)
        sid = 0
    return sid


def _generate_zipvoice(engine, text: str, speed: float, reference_audio: str, reference_text: str):
    """
    ZipVoice 零样本克隆合成

    与多说话人模型的区别：音色由参考音频决定，sid 无意义。
    sherpa-onnx 要求参考文本与参考音频严格对应，对不上会明显劣化音质，
    因此参考文本缺失时明确告警，而不是静默合成出一段不像的音频。
    """
    if not reference_audio:
        raise RuntimeError("ZipVoice 需要参考音频：请在「设置 → 本地语音」中指定参考音频文件")

    reference_path = Path(reference_audio).expanduser()
    if not reference_path.is_file():
        raise RuntimeError(f"参考音频不存在: {reference_path}")

    if not str(reference_text or "").strip():
        print("参考文本为空，ZipVoice 的克隆质量会明显下降", file=sys.stderr)

    import numpy as np
    import soundfile as sf
    import sherpa_onnx

    samples, sample_rate = sf.read(str(reference_path), dtype="float32")
    samples = np.asarray(samples, dtype=np.float32)
    # 只取第一个声道：模型按单声道参考音频训练，立体声直接送入会报维度错误
    if samples.ndim > 1:
        samples = samples[:, 0]

    gen_config = sherpa_onnx.GenerationConfig()
    gen_config.reference_audio = samples
    gen_config.reference_sample_rate = int(sample_rate)
    gen_config.reference_text = str(reference_text or "")
    gen_config.speed = float(speed)

    # 以下字段随 sherpa-onnx 版本增减，缺失时保持默认值即可，不能因此让合成失败
    if hasattr(gen_config, "num_steps"):
        gen_config.num_steps = 4
    extra = getattr(gen_config, "extra", None)
    if isinstance(extra, dict):
        extra["min_char_in_sentence"] = "30"

    return engine.generate(text, gen_config)


def _audio_to_wav(audio) -> Tuple[bytes, int]:
    """把 sherpa-onnx 的音频结果转成 16bit PCM 单声道 WAV"""
    import numpy as np

    samples = np.asarray(audio.samples, dtype=np.float32)
    sample_rate = int(audio.sample_rate)

    # 先裁剪再量化，避免溢出翻转成爆音
    clipped = np.clip(samples, -1.0, 1.0)
    pcm16 = np.round(clipped * 32767.0).astype(np.int16)

    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())

    return wav_io.getvalue(), sample_rate


def process_tts_sync(
    text: str,
    voice: str,
    speed: float,
    model_dir: str,
    thread_count: int = 4,
    reference_audio: str = "",
    reference_text: str = "",
) -> Tuple[bytes, int]:
    """同步合成，返回 (WAV 字节, 采样率)"""
    engine = get_tts(model_dir, thread_count)
    if engine is None:
        raise RuntimeError(_last_init_error or "模型加载失败")

    if _model_type == _MODEL_ZIPVOICE:
        audio = _generate_zipvoice(engine, text, speed, reference_audio, reference_text)
    else:
        audio = engine.generate(text, sid=_resolve_sid(engine, voice), speed=float(speed))

    return _audio_to_wav(audio)


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
            "modelType": _model_type,
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
        # 参考音频与参考文本仅供 ZipVoice 使用，其他架构忽略
        reference_audio = str(params.get("referenceAudio", "") or "")
        reference_text = str(params.get("referenceText", "") or "")

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
            reference_audio=reference_audio,
            reference_text=reference_text,
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
    global _tts, _model_type

    with _lock:
        _tts = None
        _model_type = ""

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
    print("离线语音合成 Python 进程已启动", file=sys.stderr)

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
        print("离线语音合成 Python 进程已退出", file=sys.stderr)


if __name__ == "__main__":
    main()

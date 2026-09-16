from __future__ import annotations

import logging
import time
import wave
from pathlib import Path
from typing import Any, Callable

import numpy as np
import onnxruntime as ort
import sentencepiece as spm
import soundfile as sf

from py.moss.ort_cpu_runtime import (
    OrtCpuRuntime,
    _normalize_sample_mode,
    _resolve_stream_decode_frame_budget,
    SAMPLE_MODE_FIXED,
    SAMPLE_MODE_GREEDY,
)


APP_DIR = Path(__file__).resolve().parent
REPO_ROOT = APP_DIR

DEFAULT_MODEL_DIR = REPO_ROOT / "models"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "generated_audio"
DEFAULT_OUTPUT_PATH = DEFAULT_OUTPUT_DIR / "infer_output.wav"
DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_SHORT_SECONDS = 0.40
DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_LONG_SECONDS = 0.24
SENTENCE_END_PUNCTUATION = set(".!?。！？；;")
CLAUSE_SPLIT_PUNCTUATION = set(",，、；;：:")
CLOSING_PUNCTUATION = set('"\'”’)]}）】》」』')

from py.moss.tts_robust_normalizer_single_script import normalize_tts_text
from py.moss._compat import zip_strict


def _contains_cjk(text: str) -> bool:
    for character in str(text or ""):
        if (
            "\u4e00" <= character <= "\u9fff"
            or "\u3400" <= character <= "\u4dbf"
            or "\u3040" <= character <= "\u30ff"
            or "\uac00" <= character <= "\ud7af"
        ):
            return True
    return False


def _prepare_text_for_sentence_chunking(text: str) -> str:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        raise ValueError("Text prompt cannot be empty.")
    normalized_text = normalized_text.replace("\r", " ").replace("\n", " ")
    while "  " in normalized_text:
        normalized_text = normalized_text.replace("  ", " ")
    if _contains_cjk(normalized_text):
        if normalized_text[-1] not in SENTENCE_END_PUNCTUATION:
            normalized_text += "。"
        return normalized_text
    if normalized_text[:1].islower():
        normalized_text = normalized_text[:1].upper() + normalized_text[1:]
    if normalized_text[-1].isalnum():
        normalized_text += "."
    if len([item for item in normalized_text.split() if item]) < 5:
        normalized_text = f"        {normalized_text}"
    return normalized_text


def _split_text_by_punctuation(text: str, punctuation: set[str]) -> list[str]:
    sentences: list[str] = []
    current_chars: list[str] = []
    index = 0
    normalized_text = str(text or "")
    while index < len(normalized_text):
        character = normalized_text[index]
        current_chars.append(character)
        if character in punctuation:
            lookahead = index + 1
            while lookahead < len(normalized_text) and normalized_text[lookahead] in CLOSING_PUNCTUATION:
                current_chars.append(normalized_text[lookahead])
                lookahead += 1
            sentence = "".join(current_chars).strip()
            if sentence:
                sentences.append(sentence)
            current_chars.clear()
            while lookahead < len(normalized_text) and normalized_text[lookahead].isspace():
                lookahead += 1
            index = lookahead
            continue
        index += 1
    tail = "".join(current_chars).strip()
    if tail:
        sentences.append(tail)
    return sentences


def _join_sentence_parts(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    if _contains_cjk(left) or _contains_cjk(right):
        return left + right
    return f"{left} {right}"


def _merge_audio_channels(channel_arrays: list[np.ndarray]) -> np.ndarray:
    if not channel_arrays:
        return np.zeros((0, 1), dtype=np.float32)
    if len(channel_arrays) == 1:
        return np.asarray(channel_arrays[0], dtype=np.float32).reshape(-1, 1)
    min_length = min(int(channel.shape[0]) for channel in channel_arrays)
    trimmed = [np.asarray(channel[:min_length], dtype=np.float32) for channel in channel_arrays]
    return np.stack(trimmed, axis=1)


def _concat_waveforms(waveforms: list[np.ndarray]) -> np.ndarray:
    if not waveforms:
        return np.zeros((0, 1), dtype=np.float32)
    non_empty = [waveform for waveform in waveforms if waveform.size > 0]
    if not non_empty:
        channel_count = int(waveforms[0].shape[1]) if waveforms[0].ndim == 2 and waveforms[0].shape[1] > 0 else 1
        return np.zeros((0, channel_count), dtype=np.float32)
    return np.concatenate(non_empty, axis=0)


def _write_waveform_to_wav(path: str | Path, waveform: np.ndarray, sample_rate: int) -> Path:
    output_path = Path(path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    audio = np.asarray(waveform, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio.reshape(-1, 1)
    clipped = np.clip(audio, -1.0, 1.0)
    pcm16 = np.round(clipped * 32767.0).astype(np.int16)
    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(int(pcm16.shape[1]))
        wav_file.setsampwidth(2)
        wav_file.setframerate(int(sample_rate))
        wav_file.writeframes(pcm16.tobytes())
    return output_path


class TTSRuntime(OrtCpuRuntime):
    def __init__(
        self,
        model_dir: str | Path | None = None,
        *,
        thread_count: int = 4,
        max_new_frames: int | None = None,
        do_sample: bool | None = None,
        sample_mode: str | None = None,
        output_dir: str | Path = DEFAULT_OUTPUT_DIR,
    ) -> None:
        if model_dir is None:
            model_dir = DEFAULT_MODEL_DIR
        super().__init__(
            model_dir=model_dir,
            thread_count=thread_count,
            max_new_frames=max_new_frames,
            do_sample=do_sample,
            sample_mode=sample_mode,
        )
        self.output_dir = Path(output_dir).expanduser().resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        tokenizer_relative_path = str(self.manifest["model_files"].get("tokenizer_model", "tokenizer.model"))
        tokenizer_path = self.resolve_manifest_relative_path(tokenizer_relative_path)
        self.sp_model = spm.SentencePieceProcessor(model_file=str(tokenizer_path))

    def encode_text(self, text: str) -> list[int]:
        return [int(token_id) for token_id in self.sp_model.encode(str(text or ""), out_type=int)]

    def count_text_tokens(self, text: str) -> int:
        return len(self.encode_text(text))

    def prepare_synthesis_text(self, *, text: str, voice: str = "") -> dict[str, Any]:
        raw_text = str(text or "")
        final_text = normalize_tts_text(raw_text)
        return {
            "text": final_text,
            "normalized_text": final_text,
            "normalization_method": "robust",
            "text_normalization_enabled": True,
        }

    def split_text_by_token_budget(self, text: str, max_tokens: int) -> list[str]:
        remaining_text = str(text or "").strip()
        if not remaining_text:
            return []
        pieces: list[str] = []
        preferred_boundary_chars = set(CLAUSE_SPLIT_PUNCTUATION) | set(SENTENCE_END_PUNCTUATION) | {" "}
        while remaining_text:
            if self.count_text_tokens(remaining_text) <= max_tokens:
                pieces.append(remaining_text)
                break
            low = 1
            high = len(remaining_text)
            best_prefix_length = 1
            while low <= high:
                middle = (low + high) // 2
                candidate = remaining_text[:middle].strip()
                if not candidate:
                    low = middle + 1
                    continue
                if self.count_text_tokens(candidate) <= max_tokens:
                    best_prefix_length = middle
                    low = middle + 1
                else:
                    high = middle - 1
            cut_index = best_prefix_length
            prefix = remaining_text[:best_prefix_length]
            preferred_index = -1
            scan_min = max(-1, len(prefix) - 25)
            for scan_index in range(len(prefix) - 1, scan_min, -1):
                if prefix[scan_index] in preferred_boundary_chars:
                    preferred_index = scan_index + 1
                    break
            if preferred_index > 0:
                cut_index = preferred_index
            piece = remaining_text[:cut_index].strip()
            if not piece:
                piece = remaining_text[:best_prefix_length].strip()
                cut_index = best_prefix_length
            pieces.append(piece)
            remaining_text = remaining_text[cut_index:].strip()
        return pieces

    def split_voice_clone_text(self, text: str, max_tokens: int = 75) -> list[str]:
        normalized_text = str(text or "").strip()
        if not normalized_text:
            return []
        safe_max_tokens = max(1, int(max_tokens))
        prepared_text = _prepare_text_for_sentence_chunking(normalized_text)
        sentence_candidates = _split_text_by_punctuation(prepared_text, SENTENCE_END_PUNCTUATION) or [prepared_text.strip()]
        sentence_slices: list[tuple[int, str]] = []
        for sentence_text in sentence_candidates:
            normalized_sentence = sentence_text.strip()
            if not normalized_sentence:
                continue
            sentence_token_count = self.count_text_tokens(normalized_sentence)
            if sentence_token_count <= safe_max_tokens:
                sentence_slices.append((sentence_token_count, normalized_sentence))
                continue
            clause_candidates = _split_text_by_punctuation(normalized_sentence, CLAUSE_SPLIT_PUNCTUATION)
            if len(clause_candidates) <= 1:
                clause_candidates = [normalized_sentence]
            for clause_text in clause_candidates:
                normalized_clause = clause_text.strip()
                if not normalized_clause:
                    continue
                clause_token_count = self.count_text_tokens(normalized_clause)
                if clause_token_count <= safe_max_tokens:
                    sentence_slices.append((clause_token_count, normalized_clause))
                    continue
                for piece in self.split_text_by_token_budget(normalized_clause, safe_max_tokens):
                    normalized_piece = piece.strip()
                    if normalized_piece:
                        sentence_slices.append((self.count_text_tokens(normalized_piece), normalized_piece))
        chunks: list[str] = []
        current_chunk = ""
        current_chunk_token_count = 0
        for sentence_token_count, sentence_text in sentence_slices:
            if not current_chunk:
                current_chunk = sentence_text
                current_chunk_token_count = sentence_token_count
                continue
            if current_chunk_token_count + sentence_token_count > safe_max_tokens:
                chunks.append(current_chunk.strip())
                current_chunk = sentence_text
                current_chunk_token_count = sentence_token_count
            else:
                current_chunk = _join_sentence_parts(current_chunk, sentence_text)
                current_chunk_token_count = self.count_text_tokens(current_chunk)
        if current_chunk:
            chunks.append(current_chunk.strip())
        return chunks if len(chunks) > 1 else [normalized_text]

    def estimate_voice_clone_inter_chunk_pause_seconds(self, text_chunk: str) -> float:
        word_count = len([item for item in str(text_chunk or "").strip().split() if item])
        return (
            DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_SHORT_SECONDS
            if word_count <= 4
            else DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_LONG_SECONDS
        )

    def _load_reference_audio(self, reference_audio_path: str | Path) -> np.ndarray:
        """
        加载参考音频并进行预处理：
        1. 自动切除首尾静音 2. 响度归一化 3. 智能截断 4. 重采样与声道转换
        """
        import numpy as np
        from pathlib import Path
        import soundfile as sf
        import logging

        # 1. 读取音频文件
        abs_path = str(Path(reference_audio_path).expanduser().resolve())
        
        if not Path(abs_path).exists():
            raise FileNotFoundError(f"参考音频文件不存在: {abs_path}")
        
        try:
            waveform, sample_rate = sf.read(abs_path, always_2d=True)
        except Exception as e:
            raise ValueError(f"无法读取音频文件 {abs_path}: {e}")
        
        waveform = waveform.astype(np.float32)
        
        # 检查音频是否有效
        if waveform.size == 0:
            raise ValueError(f"音频文件为空: {abs_path}")
        
        # 2. 改进的静音裁剪 (防止开头结尾的噪音/空白干扰模型)
        def trim_silence(wav, threshold_percentile=5, min_duration_seconds=0.1):
            """
            使用百分位数阈值裁剪静音，比固定阈值更鲁棒
            
            参数:
                wav: shape (samples, channels)
                threshold_percentile: 能量低于此百分位的帧被视为静音
                min_duration_seconds: 最小音频长度
            """
            if wav.shape[0] == 0:
                return wav
            
            # 计算每一帧的平均能量
            energy = np.mean(np.abs(wav), axis=1)
            
            # 使用百分位数作为动态阈值
            threshold = np.percentile(energy[energy > 0] if np.any(energy > 0) else energy, threshold_percentile)
            threshold = max(threshold, 0.001)  # 绝对最小值
            
            # 找到能量高于阈值的区域
            mask = energy > threshold
            
            if not np.any(mask):
                # 所有帧都是静音，返回原音频
                logging.warning("整个音频被判定为静音，保留原始音频")
                return wav
            
            # 找到起始和结束位置
            start_idx = np.where(mask)[0][0]
            end_idx = np.where(mask)[0][-1] + 1
            
            # 确保最小长度
            min_samples = int(sample_rate * min_duration_seconds)
            if end_idx - start_idx < min_samples:
                center = (start_idx + end_idx) // 2
                half_min = min_samples // 2
                start_idx = max(0, center - half_min)
                end_idx = min(wav.shape[0], center + half_min)
            
            # 添加小的缓冲区域（10ms）避免切掉有用信号
            buffer_samples = int(sample_rate * 0.01)
            start_idx = max(0, start_idx - buffer_samples)
            end_idx = min(wav.shape[0], end_idx + buffer_samples)
            
            return wav[start_idx:end_idx, :]

        waveform = trim_silence(waveform)

        # 3. 响度归一化 (Peak Normalization)
        # 确保参考音频音量标准，避免因为声音太小导致模型产生幻觉
        peak = np.max(np.abs(waveform))
        if peak < 1e-5:
            logging.warning("参考音频能量极低，可能影响音色提取质量")
            # 不进行归一化，避免放大噪声
        else:
            waveform = (waveform / peak) * 0.9

        # 4. 核心优化：智能截断参考音频
        # MOSS 提取音色通常只需 3~5 秒。过长会导致 GPT 上下文压力过大出现胡言乱语。
        max_duration = 5.0
        max_samples = int(sample_rate * max_duration)
        
        if waveform.shape[0] > max_samples:
            # 在截断点附近寻找低能量区作为自然断点
            search_window = int(sample_rate * 0.5)  # 0.5秒搜索窗口
            search_start = max_samples - search_window
            search_end = min(max_samples + search_window, waveform.shape[0])
            
            # 在搜索窗口内寻找能量最小的帧
            search_energy = np.mean(np.abs(waveform[search_start:search_end, :]), axis=1)
            if len(search_energy) > 0:
                # 使用滑动窗口平滑能量
                smooth_size = int(sample_rate * 0.05)  # 50ms平滑窗口
                if smooth_size > 1 and len(search_energy) > smooth_size:
                    kernel = np.ones(smooth_size) / smooth_size
                    search_energy = np.convolve(search_energy, kernel, mode='same')
                
                # 找到能量最小的位置作为截断点
                min_energy_idx = search_start + np.argmin(search_energy)
                
                # 但如果最小能量位置离目标太远（>1秒），就使用硬截断
                if abs(min_energy_idx - max_samples) < sample_rate:
                    waveform = waveform[:min_energy_idx, :]
                else:
                    waveform = waveform[:max_samples, :]
            else:
                waveform = waveform[:max_samples, :]

        # 转置为 (channels, samples)
        waveform = waveform.T

        # 5. 重采样逻辑
        target_sample_rate = int(self.codec_meta["codec_config"]["sample_rate"])
        target_channels = int(self.codec_meta["codec_config"]["channels"])
        
        if sample_rate != target_sample_rate:
            try:
                from scipy import signal
                num_samples = int(waveform.shape[1] * target_sample_rate / sample_rate)
                
                # 检查重采样比例是否合理
                ratio = target_sample_rate / sample_rate
                if ratio < 0.5 or ratio > 2.0:
                    logging.warning(f"重采样比例过大: {ratio:.2f}，可能导致音质下降")
                
                resampled = []
                for channel in waveform:
                    # 使用 scipy 进行高质量重采样
                    resampled_channel = signal.resample(channel, num_samples)
                    resampled.append(resampled_channel)
                waveform = np.array(resampled, dtype=np.float32)
                
            except ImportError:
                logging.error("scipy not available, skipping resampling. This may cause pitch issues.")
                # 如果scipy不可用，使用numpy的简单插值作为后备
                try:
                    num_samples = int(waveform.shape[1] * target_sample_rate / sample_rate)
                    resampled = []
                    for channel in waveform:
                        x_old = np.linspace(0, 1, waveform.shape[1])
                        x_new = np.linspace(0, 1, num_samples)
                        resampled_channel = np.interp(x_new, x_old, channel)
                        resampled.append(resampled_channel)
                    waveform = np.array(resampled, dtype=np.float32)
                except Exception as e:
                    logging.error(f"后备重采样也失败: {e}")
                    # 最后手段：不重采样，让后续处理可能出错
            except Exception as e:
                logging.error(f"重采样失败: {e}")
                raise RuntimeError(f"音频重采样失败: {e}")
        
        # 6. 声道转换
        current_channels = waveform.shape[0]
        if current_channels == target_channels:
            pass
        elif current_channels == 1 and target_channels > 1:
            # 单声道转多声道
            waveform = np.tile(waveform, (target_channels, 1))
        elif current_channels > 1 and target_channels == 1:
            # 多声道转单声道（取平均值）
            waveform = np.mean(waveform, axis=0, keepdims=True)
        else:
            raise ValueError(f"Unsupported channel conversion: {current_channels} -> {target_channels}")
        
        # 最终检查
        if waveform.size == 0:
            raise RuntimeError("预处理后音频为空")
        
        if np.any(np.isnan(waveform)) or np.any(np.isinf(waveform)):
            raise RuntimeError("预处理后音频包含异常值")
        
        # 返回符合 ONNX 要求的形状 [1, channels, samples]
        return waveform[np.newaxis, ...].astype(np.float32)

    def encode_reference_audio(self, reference_audio_path: str | Path) -> list[list[int]]:
        abs_path = str(Path(reference_audio_path).expanduser().resolve())
        
        # ================== 核心优化 2：内存缓存层 ==================
        # 如果之前已经编码过这段音频，直接返回结果，跳过所有计算！
        if not hasattr(self, '_audio_codes_cache'):
            self._audio_codes_cache = {}
        
        # 使用文件路径和修改时间作为缓存键，确保文件更新后重新编码
        cache_key = abs_path
        try:
            file_mtime = Path(abs_path).stat().st_mtime
            cache_key = f"{abs_path}_{file_mtime}"
        except Exception:
            pass
            
        if cache_key in self._audio_codes_cache:
            return self._audio_codes_cache[cache_key]
        # ============================================================

        try:
            waveform = self._load_reference_audio(reference_audio_path)
        except Exception as e:
            raise RuntimeError(f"加载参考音频失败: {e}")
        
        waveform_length = int(waveform.shape[-1])
        
        if waveform_length == 0:
            raise RuntimeError("预处理后的音频长度为0")
        
        try:
            outputs = self.sessions["codec_encode"].run(
                None,
                {
                    "waveform": waveform,
                    "input_lengths": np.asarray([waveform_length], dtype=np.int32),
                },
            )
        except Exception as e:
            raise RuntimeError(f"音频编码失败: {e}")
        
        output_names = [output.name for output in self.sessions["codec_encode"].get_outputs()]
        named_outputs = dict(zip_strict(output_names, outputs))
        audio_codes = np.asarray(named_outputs["audio_codes"], dtype=np.int32)
        audio_code_lengths = np.asarray(named_outputs["audio_code_lengths"], dtype=np.int32)
        code_length = int(audio_code_lengths.reshape(-1)[0])
        
        if code_length == 0:
            raise RuntimeError("编码产生的帧数为0")
        
        num_quantizers = int(self.codec_meta["codec_config"]["num_quantizers"])
        
        prompt_audio_codes: list[list[int]] = []
        for frame_index in range(code_length):
            frame_tokens = []
            for quantizer_index in range(num_quantizers):
                token = int(audio_codes[0, frame_index, quantizer_index])
                frame_tokens.append(token)
            prompt_audio_codes.append(frame_tokens)
        
        # 验证编码结果
        audio_codebook_size = int(self.tts_meta["model_config"]["audio_codebook_sizes"][0])
        for frame_idx, frame in enumerate(prompt_audio_codes):
            for token_idx, token in enumerate(frame):
                if token < 0 or token >= audio_codebook_size:
                    raise RuntimeError(f"编码产生的token不合法: frame={frame_idx}, token={token_idx}, value={token}")
        
        # ================== 保存到缓存 ==================
        # 限制缓存大小，避免内存泄漏
        max_cache_size = 10
        if len(self._audio_codes_cache) >= max_cache_size:
            # 删除最早的缓存项
            oldest_key = next(iter(self._audio_codes_cache))
            del self._audio_codes_cache[oldest_key]
        
        self._audio_codes_cache[cache_key] = prompt_audio_codes
        
        return prompt_audio_codes

    def resolve_prompt_audio_codes(
        self,
        *,
        voice: str | None,
        prompt_audio_path: str | Path | None,
    ) -> list[list[int]]:
        if prompt_audio_path:
            return self.encode_reference_audio(prompt_audio_path)
        resolved_voice = str(voice or self.list_builtin_voices()[0]["voice"])
        voice_row = next((item for item in self.list_builtin_voices() if item["voice"] == resolved_voice), None)
        if voice_row is None:
            raise ValueError(f"Built-in voice not found: {resolved_voice}")
        return list(voice_row["prompt_audio_codes"])

    def decode_full_audio_safe(self, generated_frames: list[list[int]]) -> np.ndarray:
        if not generated_frames:
            raise ValueError("No frames to decode")
        
        # 验证帧的合法性
        audio_codebook_size = int(self.tts_meta["model_config"]["audio_codebook_sizes"][0])
        num_quantizers = int(self.codec_meta["codec_config"]["num_quantizers"])
        
        for frame_idx, frame in enumerate(generated_frames):
            if len(frame) != num_quantizers:
                raise ValueError(f"Frame {frame_idx} has wrong number of tokens: {len(frame)} != {num_quantizers}")
            for token_idx, token in enumerate(frame):
                if token < 0 or token >= audio_codebook_size:
                    raise ValueError(f"Invalid token {token} at frame {frame_idx}, position {token_idx}")
        
        # 尝试正常解码
        try:
            channel_arrays, _audio_length = self.decode_full_audio(generated_frames)
            
            if not channel_arrays or all(arr.size == 0 for arr in channel_arrays):
                raise ValueError("Full decode produced empty audio")
            
            waveform = _merge_audio_channels(channel_arrays)
            
            # 质量检查
            if np.any(np.isnan(waveform)) or np.any(np.isinf(waveform)):
                raise ValueError("Full decode produced invalid values")
            
            return waveform
            
        except Exception as exc:
            logging.warning("full codec decode failed, falling back to incremental decode: %s", exc)
            
            # 重置流式解码器状态
            self.codec_streaming_session.reset()
            
            merged_by_channel: list[list[np.ndarray]] = [
                [] for _ in range(int(self.codec_meta["codec_config"]["channels"]))
            ]
            
            try:
                # 增量解码，每次处理8帧
                chunk_size = 8
                for start_index in range(0, len(generated_frames), chunk_size):
                    frame_chunk = generated_frames[start_index : start_index + chunk_size]
                    
                    try:
                        decoded = self.codec_streaming_session.run_frames(frame_chunk)
                    except Exception as chunk_exc:
                        logging.error(f"Incremental decode failed at chunk {start_index}: {chunk_exc}")
                        # 尝试重置并继续
                        self.codec_streaming_session.reset()
                        continue
                    
                    if decoded is None:
                        continue
                    
                    audio, audio_length = decoded
                    
                    if audio_length <= 0:
                        continue
                    
                    # 验证解码结果
                    if np.any(np.isnan(audio)) or np.any(np.isinf(audio)):
                        logging.warning(f"Chunk {start_index} produced invalid values, skipping")
                        continue
                    
                    for channel_index, channel in enumerate(audio[0, :, :audio_length]):
                        channel_data = np.asarray(channel, dtype=np.float32)
                        merged_by_channel[channel_index].append(channel_data)
                
                # 合并所有通道
                channel_arrays = [
                    np.concatenate(chunks) if chunks else np.zeros((0,), dtype=np.float32) 
                    for chunks in merged_by_channel
                ]
                
                waveform = _merge_audio_channels(channel_arrays)
                
                if waveform.size == 0:
                    raise RuntimeError("Incremental decode produced empty audio")
                
                # 记录fallback信息
                logging.info(f"Incremental decode succeeded with {len(waveform)} samples")
                
                return waveform
                
            except Exception as fallback_exc:
                logging.error(f"Incremental decode also failed: {fallback_exc}")
                raise RuntimeError(f"Both full and incremental decode failed: {exc} | {fallback_exc}")
                
            finally:
                # 确保重置解码器状态
                self.codec_streaming_session.reset()

    def synthesize_single_chunk(
        self,
        *,
        text: str,
        prompt_audio_codes: list[list[int]],
        streaming: bool,
    ) -> dict[str, Any]:
        text_token_ids = self.encode_text(text)
        request_rows = self.build_voice_clone_request_rows(prompt_audio_codes, text_token_ids)
        if not streaming:
            generated_frames = self.generate_audio_frames(request_rows)
            waveform = self.decode_full_audio_safe(generated_frames)
            return {
                "text": text,
                "text_token_ids": text_token_ids,
                "generated_frames": generated_frames,
                "waveform": waveform,
            }

        pending_decode_frames: list[list[int]] = []
        emitted_chunks: list[np.ndarray] = []
        emitted_samples_total = 0
        first_audio_emitted_at_perf: float | None = None
        self.codec_streaming_session.reset()

        def decode_pending_frames(force: bool) -> None:
            nonlocal emitted_samples_total, first_audio_emitted_at_perf
            pending_count = len(pending_decode_frames)
            if pending_count <= 0:
                return
            sample_rate = int(self.codec_meta["codec_config"]["sample_rate"])
            decode_budget = _resolve_stream_decode_frame_budget(
                emitted_samples_total,
                sample_rate,
                first_audio_emitted_at_perf,
            )
            if not force and pending_count < max(1, decode_budget):
                return
            frame_budget = pending_count if force else min(pending_count, max(1, decode_budget))
            frame_chunk = pending_decode_frames[:frame_budget]
            del pending_decode_frames[:frame_budget]
            decoded = self.codec_streaming_session.run_frames(frame_chunk)
            if decoded is None:
                return
            audio, audio_length = decoded
            if audio_length <= 0:
                return
            if first_audio_emitted_at_perf is None:
                first_audio_emitted_at_perf = time.perf_counter()
            emitted_samples_total += audio_length
            emitted_chunks.append(_merge_audio_channels([audio[0, channel_index, :audio_length] for channel_index in range(audio.shape[1])]))

        def on_frame(_generated_frames: list[list[int]], _step_index: int, frame: list[int]) -> None:
            pending_decode_frames.append(list(frame))
            decode_pending_frames(False)

        try:
            generated_frames = self.generate_audio_frames(request_rows, on_frame=on_frame)
            decode_pending_frames(True)
        finally:
            self.codec_streaming_session.reset()
        waveform = _concat_waveforms(emitted_chunks)
        return {
            "text": text,
            "text_token_ids": text_token_ids,
            "generated_frames": generated_frames,
            "waveform": waveform,
        }

    def synthesize(
        self,
        *,
        text: str,
        voice: str | None = None,
        prompt_audio_path: str | Path | None = None,
        output_audio_path: str | Path | None = None,
        sample_mode: str | None = None,
        do_sample: bool = True,
        streaming: bool = False,
        max_new_frames: int | None = None,
        voice_clone_max_text_tokens: int = 75,
        seed: int | None = None,
    ) -> dict[str, Any]:
        if max_new_frames is not None:
            self.manifest["generation_defaults"]["max_new_frames"] = int(max_new_frames)
        normalized_sample_mode = _normalize_sample_mode(sample_mode, do_sample)
        self.manifest["generation_defaults"]["sample_mode"] = normalized_sample_mode
        self.manifest["generation_defaults"]["do_sample"] = normalized_sample_mode != SAMPLE_MODE_GREEDY
        if seed is not None:
            self.rng = np.random.default_rng(int(seed))
        prepared_texts = self.prepare_synthesis_text(text=text, voice=str(voice or ""))
        prepared_text = str(prepared_texts["text"])
        prompt_audio_codes = self.resolve_prompt_audio_codes(voice=voice, prompt_audio_path=prompt_audio_path)
        text_chunks = self.split_voice_clone_text(prepared_text, max_tokens=int(voice_clone_max_text_tokens))
        all_waveforms: list[np.ndarray] = []
        all_generated_frames: list[list[int]] = []
        sample_rate = int(self.codec_meta["codec_config"]["sample_rate"])
        channels = int(self.codec_meta["codec_config"]["channels"])
        chunk_results: list[dict[str, Any]] = []
        for chunk_index, chunk_text in enumerate(text_chunks):
            chunk_result = self.synthesize_single_chunk(
                text=chunk_text,
                prompt_audio_codes=prompt_audio_codes,
                streaming=bool(streaming),
            )
            chunk_results.append(chunk_result)
            all_waveforms.append(np.asarray(chunk_result["waveform"], dtype=np.float32))
            all_generated_frames.extend(chunk_result["generated_frames"])
            if chunk_index < len(text_chunks) - 1:
                pause_seconds = self.estimate_voice_clone_inter_chunk_pause_seconds(chunk_text)
                pause_samples = max(0, int(round(sample_rate * pause_seconds)))
                if pause_samples > 0:
                    all_waveforms.append(np.zeros((pause_samples, channels), dtype=np.float32))
        waveform = _concat_waveforms(all_waveforms)
        resolved_output_audio_path = (
            Path(output_audio_path).expanduser().resolve()
            if output_audio_path
            else (self.output_dir / DEFAULT_OUTPUT_PATH.name).resolve()
        )
        audio_path = _write_waveform_to_wav(resolved_output_audio_path, waveform, sample_rate)
        return {
            "audio_path": str(audio_path),
            "waveform": waveform,
            "sample_rate": sample_rate,
            "audio_token_ids": np.asarray(all_generated_frames, dtype=np.int32),
            "text_chunks": text_chunks,
            "prepared_texts": prepared_texts,
            "sample_mode": normalized_sample_mode,
            "do_sample": normalized_sample_mode != SAMPLE_MODE_GREEDY,
            "streaming": bool(streaming),
            "chunk_results": chunk_results,
        }

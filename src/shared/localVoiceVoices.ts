/**
 * MOSS TTS（离线语音合成）内置音色清单
 *
 * 为什么需要这份清单（历史故障）：
 * Python 侧对未知音色会直接 `raise ValueError("Built-in voice not found: xxx")`，
 * 合成整体失败。而音色参数有三个来源，语义并不一致：
 *   1. 主进程配置 `tts.defaultVoice`（设置 → 本地语音）
 *   2. 渲染层 `voiceApi.textToSpeech({ voice })` 传入的 **Provider 音色**
 *      （如 `alloy` / `Xiaoxiao`，属于云端/直连语义）
 *   3. 语音对话/场景模式解析出的 Provider 音色
 * 一旦非内置音色进入离线引擎，且优先级为「仅本地」（不回退云端），
 * 结果就是「点击播报毫无反应」——错误被上层静默吞掉。
 *
 * 因此本文件作为**唯一事实来源**同时被两端使用：
 *   - 主进程 `SherpaTtsEngine`：合成前校验，非法音色自动回退（保证一定出声）
 *   - 主进程 `LocalVoiceManager`：配置规范化，纠正历史遗留的非法 `defaultVoice`
 *   - 渲染层设置面板：音色下拉的真实选项（替代过去写死的 Junhao/Xiaoxiao）
 *
 * 清单与模型 manifest（`browser_poc_manifest.json` 的 `builtin_voices`）保持一致。
 *
 * @module shared/localVoiceVoices
 */

/** 单个内置音色 */
export interface BuiltinVoice {
  /** 传给 Python 侧的音色 ID（权威值） */
  voice: string
  /** 界面展示名 */
  displayName: string
  /** 分组（用于设置面板 optgroup） */
  group: string
}

/** 内置音色清单（与模型 manifest 对齐，共 18 个） */
export const MOSS_BUILTIN_VOICES: readonly BuiltinVoice[] = [
  { voice: 'Junhao', displayName: 'Junhao · 中文男声（通用）', group: '中文 · 男声' },
  { voice: 'Zhiming', displayName: 'Zhiming · 中文男声（京味闲聊）', group: '中文 · 男声' },
  { voice: 'Weiguo', displayName: 'Weiguo · 中文男声（说书）', group: '中文 · 男声' },
  { voice: 'Xiaoyu', displayName: 'Xiaoyu · 中文女声（明星）', group: '中文 · 女声' },
  { voice: 'Yuewen', displayName: 'Yuewen · 中文女声（机车）', group: '中文 · 女声' },
  { voice: 'Lingyu', displayName: 'Lingyu · 中文女声（深夜电台）', group: '中文 · 女声' },
  { voice: 'Adam', displayName: 'Adam · 英文男声（新闻播报）', group: '英文 · 男声' },
  { voice: 'Nathan', displayName: 'Nathan · 英文男声（平静叙述）', group: '英文 · 男声' },
  { voice: 'Trump', displayName: 'Trump · 英文男声', group: '英文 · 男声' },
  { voice: 'Ava', displayName: 'Ava · 英文女声（The Bitter Lesson）', group: '英文 · 女声' },
  { voice: 'Bella', displayName: 'Bella · 英文女声（A Gentle Reminder）', group: '英文 · 女声' },
  { voice: 'Soyo', displayName: 'Soyo · 日文女声', group: '日文 · 女声' },
  { voice: 'Saki', displayName: 'Saki · 日文女声', group: '日文 · 女声' },
  { voice: 'Mortis', displayName: 'Mortis · 日文女声', group: '日文 · 女声' },
  { voice: 'Umiri', displayName: 'Umiri · 日文女声', group: '日文 · 女声' },
  { voice: 'Mei', displayName: 'Mei · 日文女声（Togawa）', group: '日文 · 女声' },
  { voice: 'Anon', displayName: 'Anon · 日文女声', group: '日文 · 女声' },
  { voice: 'Arisa', displayName: 'Arisa · 日文女声', group: '日文 · 女声' },
] as const

/** 兜底音色：白名单首位，非法音色最终都会落到它 */
export const DEFAULT_BUILTIN_VOICE = MOSS_BUILTIN_VOICES[0].voice

/** 判断是否为内置音色 */
export function isBuiltinVoice(voice: string | undefined | null): boolean {
  if (!voice) return false
  return MOSS_BUILTIN_VOICES.some((item) => item.voice === voice)
}

/**
 * 把任意来源的候选音色解析为可用的内置音色。
 *
 * 顺序：候选值 → 兜底值（配置里的 defaultVoice）→ 白名单首位。
 * 返回 `substituted` 便于调用方记录「音色被替换」的日志，
 * 避免用户以为播报用的是自己选的音色。
 */
export function resolveBuiltinVoice(
  candidate?: string | null,
  fallback?: string | null,
): { voice: string; substituted: boolean; requested: string } {
  const requested = String(candidate || '').trim()

  if (isBuiltinVoice(requested)) {
    return { voice: requested, substituted: false, requested }
  }

  const fallbackVoice = String(fallback || '').trim()
  if (isBuiltinVoice(fallbackVoice)) {
    return { voice: fallbackVoice, substituted: true, requested }
  }

  return { voice: DEFAULT_BUILTIN_VOICE, substituted: true, requested }
}

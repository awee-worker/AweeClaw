/**
 * 离线语音合成（TTS）内置音色清单
 *
 * 为什么需要这份清单（历史故障）：
 * Python 侧对未知音色会直接报错，合成整体失败。而音色参数有三个来源，
 * 语义并不一致：
 *   1. 主进程配置 `tts.defaultVoice`（设置 → 本地语音）
 *   2. 渲染层 `voiceApi.textToSpeech({ voice })` 传入的 **Provider 音色**
 *      （如 `alloy` / `Xiaoxiao`，属于云端/直连语义）
 *   3. 语音对话/场景模式解析出的 Provider 音色
 * 一旦非内置音色进入离线引擎，且优先级为「仅本地」（不回退云端），
 * 结果就是「点击播报毫无反应」——错误被上层静默吞掉。
 *
 * 因此本文件作为**唯一事实来源**同时被两端使用：
 *   - 主进程 TTS 引擎：合成前校验，非法音色自动回退（保证一定出声）
 *   - 主进程 `LocalVoiceManager`：配置规范化，纠正历史遗留的非法 `defaultVoice`
 *   - 渲染层设置面板：音色下拉的真实选项
 *
 * 音色与模型绑定：不同模型的音色集合完全不同，ID 语义也不同 ——
 * MOSS 用字符串音色名（如 `Junhao`），VITS 用整数 speaker id（如 `12`）。
 * 因此清单按模型 ID 组织，取音色必须带模型 ID，不可跨模型混用。
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

/** MOSS 内置音色清单（与模型 manifest 对齐，共 18 个） */
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

// ============================================
// 模型维度
// ============================================

/** MOSS TTS 模型 ID（与 ModelDownloader 中的模型 id 一致） */
export const MOSS_MODEL_ID = 'moss-tts-nano'

/** VITS 模型 ID */
export const VITS_MODEL_IDS = {
  /** 中文 804 音色，22050Hz */
  THERESA: 'sherpa-tts-vits-zh-theresa',
  /** 中文 187 音色，16000Hz */
  FANCHEN_C: 'sherpa-tts-vits-zh-fanchen-c',
  /** 中英单音色，44100Hz */
  MELO_ZH_EN: 'sherpa-tts-vits-melo-zh-en',
} as const

/**
 * 历史模型名 → 模型 ID
 *
 * `tts.modelName` 早期直接存 MOSS 的模型目录名，为兼容已落盘的配置保留映射。
 */
const MODEL_ID_ALIASES: Record<string, string> = {
  'MOSS-TTS-Nano-100M-ONNX': MOSS_MODEL_ID,
}

/** 归一化模型 ID（仅做别名映射与去空白，不校验模型是否存在） */
export function normalizeTtsModelId(modelId: string | null | undefined): string {
  const raw = String(modelId || '').trim()
  return MODEL_ID_ALIASES[raw] || raw
}

/**
 * 由 speaker id 列表构造 VITS 音色选项
 *
 * VITS 多说话人模型只用整数 sid 区分音色，模型本身不含语义化名称
 * （已核对仓库内的 speaker 配置，其条目即字符串形式的数字），
 * 因此展示名按编号生成，不编造风格描述。
 */
function buildVitsVoices(groupLabel: string, speakerIds: readonly number[]): BuiltinVoice[] {
  return speakerIds.map((sid) => ({
    voice: String(sid),
    displayName: `音色 #${String(sid).padStart(3, '0')}`,
    group: groupLabel,
  }))
}

/**
 * VITS 模型音色清单
 *
 * 多说话人模型的音色数量远大于 UI 可承载的范围（theresa 有 804 个），
 * 这里按 sid 均匀抽取代表性音色作为选项；其余 sid 仍可手工填入配置使用。
 */
export const VITS_MODEL_VOICES: Record<string, readonly BuiltinVoice[]> = {
  [VITS_MODEL_IDS.THERESA]: buildVitsVoices('中文 · 音色', [
    0, 35, 70, 105, 140, 175, 209, 244, 279, 314, 349, 384,
    419, 454, 489, 524, 559, 594, 628, 663, 698, 733, 768, 803,
  ]),
  [VITS_MODEL_IDS.FANCHEN_C]: buildVitsVoices('中文 · 音色', [
    0, 8, 16, 24, 32, 40, 49, 57, 65, 73, 81, 89,
    97, 105, 113, 121, 129, 137, 146, 154, 162, 170, 178, 186,
  ]),
  [VITS_MODEL_IDS.MELO_ZH_EN]: [
    { voice: '0', displayName: '默认音色（中英混读）', group: '中英 · 单音色' },
  ],
}

/** 模型 ID → 音色清单（含 MOSS） */
export const MODEL_VOICE_CATALOG: Record<string, readonly BuiltinVoice[]> = {
  [MOSS_MODEL_ID]: MOSS_BUILTIN_VOICES,
  ...VITS_MODEL_VOICES,
}

/**
 * 取指定模型的音色清单
 *
 * 未知模型回退到 MOSS 清单：调用方可能尚未拿到模型列表就渲染 UI，
 * 回退到唯一自带语义化音色的模型可避免下拉为空。
 */
export function getBuiltinVoicesForModel(
  modelId: string | null | undefined,
): readonly BuiltinVoice[] {
  const voices = MODEL_VOICE_CATALOG[normalizeTtsModelId(modelId)]
  return voices && voices.length > 0 ? voices : MOSS_BUILTIN_VOICES
}

/** 判断音色是否属于指定模型（跨模型音色一律视为非法） */
export function isVoiceValidForModel(
  modelId: string | null | undefined,
  voice: string | null | undefined,
): boolean {
  if (!voice) return false
  return getBuiltinVoicesForModel(modelId).some((item) => item.voice === voice)
}

/**
 * 把任意来源的候选音色解析为指定模型的合法音色
 *
 * 顺序：候选值 → 兜底值（配置里的 defaultVoice）→ 清单首位。
 * 返回 `substituted` 便于调用方记录「音色被替换」的日志，
 * 避免用户以为播报用的是自己选的音色。
 */
export function resolveVoiceForModel(
  modelId: string | null | undefined,
  candidate?: string | null,
  fallback?: string | null,
): { voice: string; substituted: boolean; requested: string } {
  const requested = String(candidate || '').trim()
  const voices = getBuiltinVoicesForModel(modelId)

  if (voices.some((item) => item.voice === requested)) {
    return { voice: requested, substituted: false, requested }
  }

  const fallbackVoice = String(fallback || '').trim()
  if (voices.some((item) => item.voice === fallbackVoice)) {
    return { voice: fallbackVoice, substituted: true, requested }
  }

  return { voice: voices[0].voice, substituted: true, requested }
}

/** 判断是否为内置音色 */
export function isBuiltinVoice(voice: string | undefined | null): boolean {
  if (!voice) return false
  return MOSS_BUILTIN_VOICES.some((item) => item.voice === voice)
}

/**
 * 把任意来源的候选音色解析为可用的 MOSS 内置音色
 *
 * 保留此函数的目的是兼容既有调用点（默认模型即 MOSS）。
 * 指定其他模型时请直接使用 `resolveVoiceForModel`，避免跨模型音色混用。
 */
export function resolveBuiltinVoice(
  candidate?: string | null,
  fallback?: string | null,
): { voice: string; substituted: boolean; requested: string } {
  return resolveVoiceForModel(MOSS_MODEL_ID, candidate, fallback)
}

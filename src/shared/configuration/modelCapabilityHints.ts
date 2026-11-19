/**
 * 模型能力线索提取
 *
 * `/models` 接口的返回格式各家都不一样：OpenRouter 给 `architecture.input_modalities`
 * 与 `supported_parameters`，Google 给 `supportedGenerationMethods`，部分网关给
 * `capabilities` / `tags` / `type`，多数只给一个 id。这里把能拿到的字段统一收敛成
 * 一组能力线索，交由设置页推断标签，而不是只按模型名猜。
 *
 * 原则：
 * - 只做「有据可依」的映射，字段里没写的绝不凭空补；
 * - 单项字段解析失败不影响整份结果，最差退化为空线索（等价于纯名称推断）；
 * - 输出是纯 JSON，可直接跨进程传给渲染层。
 */

/** 能力标签，与渲染层 ModelCapability 取值一致 */
export type ModelCapabilityHint =
  | 'llm'
  | 'embedding'
  | 'vision'
  | 'tool-calling'
  | 'reasoning'
  | 'image-gen'
  | 'video-gen'
  | 'code'
  | 'audio'
  | 'asr'
  | 'tts'
  | '3d-gen'
  | 'world-model'

/** 单个模型的能力线索 */
export interface ModelCapabilityHintPayload {
  /** 由元数据直接读出的标签 */
  capabilities: ModelCapabilityHint[]
  /**
   * 工具调用支持情况：
   * - true：服务商明确声明了工具/函数调用；
   * - false：服务商给出了参数清单（supported_parameters 等）且其中没有工具项；
   * - 缺省：没有足够信息，交由名称推断决定。
   */
  supportsTools?: boolean
}

/** 逐 token 匹配的字段名：值是字符串或字符串数组 */
const AGGREGATE_FIELDS = [
  'capabilities',
  'features',
  'tags',
  'type',
  'model_type',
  'modelType',
  'task',
  'tasks',
  'pipeline_tag',
  'category',
  'mode',
  'object',
  'supported_parameters',
  'supportedParameters',
  'supported_generation_methods',
  'supportedGenerationMethods',
] as const

/** 输入模态字段：值可能是数组，也可能是 `{ input: [], output: [] }` */
const INPUT_MODALITY_FIELDS = ['input_modalities', 'inputModalities', 'inputModality'] as const
/** 输出模态字段 */
const OUTPUT_MODALITY_FIELDS = ['output_modalities', 'outputModalities', 'outputModality'] as const

/** 声明了「参数清单」语义的字段：存在即可判定不支持的工具能力 */
const PARAMETER_DECLARING_FIELDS = ['supported_parameters', 'supportedParameters'] as const

const TOOL_TOKENS = new Set([
  'tool',
  'tools',
  'tool_calling',
  'tool_choice',
  'function',
  'functions',
  'function_calling',
  'parallel_tool_calls',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * token 归一化：小写、驼峰拆词、空格与连字符统一成下划线。
 *
 * 服务商字段值既有 `text_to_image`、`text-to-image`，也有 `generateContent`、
 * `embedContent` 这类驼峰写法，不拆词就会漏匹配。
 */
function normalizeToken(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/** 把任意形态的字段值摊平成字符串列表（数组 / 嵌套对象 / 标量） */
function flattenStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, out)
    return out
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) flattenStrings(item, out)
  }
  return out
}

/** 单 token → 标签（不含 image/video/audio，这三者要按输入/输出区分） */
function mapTokenToHint(token: string): ModelCapabilityHint[] {
  const hints: ModelCapabilityHint[] = []
  if (token.includes('embed')) hints.push('embedding')
  // rerank 目前没有对应标签，也不属于对话模型，这里不产出标签
  if (TOOL_TOKENS.has(token)) hints.push('tool-calling')
  if (token.includes('reason') || token === 'think' || token === 'thinking') hints.push('reasoning')
  if (token.includes('vision')) hints.push('vision')
  if (token === '3d' || token.includes('3d_')) hints.push('3d-gen')
  if (token.includes('world_model')) hints.push('world-model')
  if (token === 'tts' || token === 'text_to_speech' || token === 'speech_synthesis') hints.push('tts')
  if (token === 'asr' || token === 'stt' || token === 'transcription' || token === 'speech_to_text') {
    hints.push('asr')
  }
  if (token === 'code' || token === 'code_interpreter') hints.push('code')
  if (token === 'image_generation' || token === 'image_gen' || token === 'text_to_image') {
    hints.push('image-gen')
  }
  if (token === 'video_generation' || token === 'video_gen' || token === 'text_to_video') {
    hints.push('video-gen')
  }
  if (
    token === 'chat' ||
    token === 'completion' ||
    token === 'text_generation' ||
    token === 'generate_content'
  ) {
    hints.push('llm')
  }
  return hints
}

/**
 * 模态 token → 标签。
 * 同一个 `image` 出现在输入侧是视觉理解，出现在输出侧是图片生成，不能混为一谈。
 */
function mapModalityToken(token: string, side: 'input' | 'output'): ModelCapabilityHint[] {
  const normalized = normalizeToken(token)
  if (!normalized) return []
  switch (normalized) {
    case 'text':
      return side === 'output' ? ['llm'] : []
    case 'image':
    case 'images':
      return [side === 'output' ? 'image-gen' : 'vision']
    case 'video':
      return [side === 'output' ? 'video-gen' : 'vision']
    case 'audio':
    case 'speech':
    case 'voice':
      return [side === 'output' ? 'tts' : 'asr']
    default:
      return mapTokenToHint(normalized)
  }
}

/** 处理 `text+image->image` 这类带箭头的模态描述 */
function applyModalityExpression(
  raw: string,
  hints: Set<ModelCapabilityHint>,
): boolean {
  const match = raw.match(/^(.+?)\s*(?:->|=>|→)\s*(.+)$/)
  if (!match) return false
  for (const token of match[1].split('+')) {
    if (token.trim()) for (const hint of mapModalityToken(token, 'input')) hints.add(hint)
  }
  for (const token of match[2].split('+')) {
    if (token.trim()) for (const hint of mapModalityToken(token, 'output')) hints.add(hint)
  }
  return true
}

/** 收集某侧模态（数组 / `{ input, output }` 对象 / 带箭头的字符串） */
function collectModalities(
  value: unknown,
  side: 'input' | 'output',
  hints: Set<ModelCapabilityHint>,
): void {
  if (typeof value === 'string') {
    if (applyModalityExpression(value, hints)) return
    for (const hint of mapModalityToken(value, side)) hints.add(hint)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && !applyModalityExpression(item, hints)) {
        for (const hint of mapModalityToken(item, side)) hints.add(hint)
      }
    }
    return
  }
  if (isRecord(value)) {
    // `{ input: [...], output: [...] }` 形态：按各自的键取
    const inputValue = value.input ?? value.inputs
    const outputValue = value.output ?? value.outputs
    if (inputValue !== undefined) collectModalities(inputValue, 'input', hints)
    if (outputValue !== undefined) collectModalities(outputValue, 'output', hints)
  }
}

/**
 * 从一个模型条目里提取能力线索。
 *
 * 任何字段缺失都只是少一条线索，不会抛错。
 */
export function extractCapabilityHintFromEntry(
  entry: unknown,
): ModelCapabilityHintPayload | undefined {
  if (!isRecord(entry)) return undefined

  const hints = new Set<ModelCapabilityHint>()
  let declaresParameters = false
  let declaresTools = false

  // 1. 聚合型字段：逐个 token 归一化后匹配
  for (const field of AGGREGATE_FIELDS) {
    if (!(field in entry)) continue
    const tokens = flattenStrings(entry[field])
    for (const token of tokens) {
      const normalized = normalizeToken(token)
      if (!normalized) continue
      if (TOOL_TOKENS.has(normalized)) declaresTools = true
      for (const hint of mapTokenToHint(normalized)) hints.add(hint)
    }
    if ((PARAMETER_DECLARING_FIELDS as readonly string[]).includes(field) && tokens.length > 0) {
      declaresParameters = true
    }
  }

  // 2. 显式的输入 / 输出模态字段
  for (const field of INPUT_MODALITY_FIELDS) {
    if (field in entry) collectModalities(entry[field], 'input', hints)
  }
  for (const field of OUTPUT_MODALITY_FIELDS) {
    if (field in entry) collectModalities(entry[field], 'output', hints)
  }

  // 3. OpenRouter 风格的 architecture 子对象
  const architecture = entry.architecture
  if (isRecord(architecture)) {
    collectModalities(architecture.input_modalities ?? architecture.inputModality, 'input', hints)
    collectModalities(architecture.output_modalities ?? architecture.outputModality, 'output', hints)
    collectModalities(architecture.modality, 'input', hints)
  }

  const payload: ModelCapabilityHintPayload = { capabilities: [...hints] }
  if (declaresTools) {
    payload.supportsTools = true
  } else if (declaresParameters) {
    // 参数清单里没有工具项：这是「明确不支持」而不仅是「没声明」
    payload.supportsTools = false
  }
  return payload
}

/** 从条目里取模型 id（OpenAI `id` / Google `name`，剥掉 `models/` 前缀） */
function readEntryId(entry: Record<string, unknown>): string | undefined {
  const rawId = typeof entry.id === 'string' ? entry.id : undefined
  if (rawId) return rawId
  const rawName = typeof entry.name === 'string' ? entry.name : undefined
  if (rawName) return rawName.replace(/^models\//, '')
  return undefined
}

/** 摊平响应里的模型条目数组（兼容数组 / `{data}` / `{models}`） */
function listEntries(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.data)) return payload.data.filter(isRecord)
  if (Array.isArray(payload.models)) return payload.models.filter(isRecord)
  return []
}

/**
 * 从整份 `/models` 响应里提取「模型 id → 能力线索」。
 *
 * 只返回能提取到有效线索的条目：没有线索的模型不必出现在结果里，
 * 调用方按「查不到就当未声明」处理即可。
 */
export function extractModelCapabilityHints(
  payload: unknown,
): Record<string, ModelCapabilityHintPayload> {
  const result: Record<string, ModelCapabilityHintPayload> = {}

  for (const entry of listEntries(payload)) {
    const id = readEntryId(entry)
    if (!id) continue
    const hint = extractCapabilityHintFromEntry(entry)
    if (!hint) continue
    if (hint.capabilities.length === 0 && hint.supportsTools === undefined) continue
    result[id] = hint
  }

  return result
}

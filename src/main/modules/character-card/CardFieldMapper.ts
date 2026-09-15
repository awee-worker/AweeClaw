/**
 * 角色卡字段映射器
 *
 * 负责酒馆角色卡字段与 AweeClaw 角色字段之间的映射。
 *
 * 设计要点：
 * 1. 酒馆字段映射到 AweeClaw 角色字段
 * 2. 处理字段缺失和默认值
 * 3. 支持自定义映射规则
 * 4. 验证映射结果
 *
 * @module character-card/CardFieldMapper
 */

import type {
  SillyTavernCardV2,
  SillyTavernCardV3,
  AweeClawCharacterCard,
  CharacterBook,
} from './types'

// ============================================
// 映射规则
// ============================================

/** 字段映射配置 */
export interface FieldMappingConfig {
  /** 是否使用 description + personality 拼装 system_prompt */
  useDescriptionAsSystemPrompt: boolean
  /** 是否合并 personality 到 description */
  mergePersonalityToDescription: boolean
  /** 是否使用 scenario 作为场景背景 */
  useScenarioAsBackground: boolean
  /** 是否导入 character_book */
  importCharacterBook: boolean
  /** character_book 最大条目数 */
  maxCharacterBookEntries: number
  /** 是否导入 mes_example */
  importMessageExample: boolean
  /** 默认创建者 */
  defaultCreator: string
  /** 默认版本 */
  defaultVersion: string
}

/** 默认映射配置 */
export const DEFAULT_MAPPING_CONFIG: FieldMappingConfig = {
  useDescriptionAsSystemPrompt: true,
  mergePersonalityToDescription: true,
  useScenarioAsBackground: true,
  importCharacterBook: true,
  maxCharacterBookEntries: 100,
  importMessageExample: false, // 默认不导入，因为会占用 token
  defaultCreator: '未知',
  defaultVersion: '1.0',
}

// ============================================
// 字段映射
// ============================================

/** 映射系统提示词 */
function mapSystemPrompt(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): string {
  // 优先使用 system_prompt
  if (card.system_prompt) {
    return card.system_prompt
  }

  // 如果配置为使用 description 拼装
  if (config.useDescriptionAsSystemPrompt) {
    const parts: string[] = []

    if (card.description) {
      parts.push(`## 角色描述\n${card.description}`)
    }

    if (config.mergePersonalityToDescription && card.personality) {
      parts.push(`## 性格特点\n${card.personality}`)
    }

    if (config.useScenarioAsBackground && card.scenario) {
      parts.push(`## 场景背景\n${card.scenario}`)
    }

    return parts.join('\n\n')
  }

  return ''
}

/** 映射人设描述 */
function mapDescription(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): string {
  let description = card.description || ''

  // 如果配置为合并 personality
  if (config.mergePersonalityToDescription && card.personality) {
    if (description) {
      description += '\n\n'
    }
    description += `性格特点：${card.personality}`
  }

  return description
}

/** 映射场景背景 */
function mapScenario(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): string {
  if (config.useScenarioAsBackground) {
    return card.scenario || ''
  }
  return ''
}

/** 映射开场白 */
function mapFirstMessage(card: SillyTavernCardV2 | SillyTavernCardV3): string {
  return card.first_mes || ''
}

/** 映射备用开场白 */
function mapAlternateGreetings(card: SillyTavernCardV2 | SillyTavernCardV3): string[] {
  return card.alternate_greetings || []
}

/** 映射对话示例 */
function mapMessageExample(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): string {
  if (config.importMessageExample) {
    return card.mes_example || ''
  }
  return ''
}

/** 映射后置指令 */
function mapPostHistoryInstructions(card: SillyTavernCardV2 | SillyTavernCardV3): string {
  return card.post_history_instructions || ''
}

/** 映射创建者备注 */
function mapCreatorNotes(card: SillyTavernCardV2 | SillyTavernCardV3): string {
  return card.creator_notes || ''
}

/** 映射标签 */
function mapTags(card: SillyTavernCardV2 | SillyTavernCardV3): string[] {
  return Array.isArray(card.tags) ? card.tags : []
}

/** 映射创建者 */
function mapCreator(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): string {
  return card.creator || config.defaultCreator
}

/** 映射版本 */
function mapVersion(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): string {
  return card.character_version || config.defaultVersion
}

/** 映射角色书 */
function mapCharacterBook(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  config: FieldMappingConfig
): CharacterBook | undefined {
  if (!config.importCharacterBook || !card.character_book) {
    return undefined
  }

  const book = card.character_book

  // 限制条目数量
  let entries = book.entries || []
  if (entries.length > config.maxCharacterBookEntries) {
    entries = entries.slice(0, config.maxCharacterBookEntries)
  }

  return {
    name: book.name || '导入的知识库',
    description: book.description,
    entries: entries.map(entry => ({
      keys: entry.keys || [],
      content: entry.content || '',
      extensions: entry.extensions || {},
      enabled: entry.enabled !== false,
      insertion_order: entry.insertion_order || 0,
      case_sensitive: entry.case_sensitive,
      name: entry.name,
      priority: entry.priority,
      id: entry.id,
      comment: entry.comment,
      selective: entry.selective,
      secondary_keys: entry.secondary_keys,
      constant: entry.constant,
      position: entry.position as 'before_char' | 'after_char' | undefined,
    })),
    extensions: book.extensions || {},
  }
}

/** 映射资产（V3 特有） */
function mapAssets(card: SillyTavernCardV2 | SillyTavernCardV3): AweeClawCharacterCard['assets'] {
  const v3Card = card as SillyTavernCardV3
  if (!v3Card.assets || !Array.isArray(v3Card.assets)) {
    return []
  }

  return v3Card.assets.map(asset => ({
    type: asset.type as 'icon' | 'emotion' | 'background' | 'voice',
    name: asset.name,
    description: asset.description,
    url: asset.url,
    local_path: asset.local_path,
    metadata: asset.metadata,
  }))
}

/** 映射扩展字段 */
function mapExtensions(card: SillyTavernCardV2 | SillyTavernCardV3): Record<string, unknown> {
  return card.extensions || {}
}

// ============================================
// 主映射函数
// ============================================

/** 将酒馆角色卡映射到 AweeClaw 格式 */
export function mapCardToAweeClaw(
  card: SillyTavernCardV2 | SillyTavernCardV3,
  source: 'sillytavern-v2' | 'sillytavern-v3',
  originalFormat: 'png' | 'json',
  config: FieldMappingConfig = DEFAULT_MAPPING_CONFIG
): AweeClawCharacterCard {
  const now = new Date().toISOString()

  // 处理 V3 特有字段
  const isV3 = 'assets' in card || 'creation_date' in card
  const v3Card = isV3 ? card as SillyTavernCardV3 : null

  return {
    id: generateCardId(),
    name: card.name,
    nickname: v3Card?.nickname,
    description: mapDescription(card, config),
    personality: card.personality || '',
    scenario: mapScenario(card, config),
    systemPrompt: mapSystemPrompt(card, config),
    firstMessage: mapFirstMessage(card),
    alternateGreetings: mapAlternateGreetings(card),
    messageExample: mapMessageExample(card, config),
    postHistoryInstructions: mapPostHistoryInstructions(card),
    creatorNotes: mapCreatorNotes(card),
    tags: mapTags(card),
    creator: mapCreator(card, config),
    version: mapVersion(card, config),
    assets: mapAssets(card),
    characterBook: mapCharacterBook(card, config),
    metadata: {
      importedAt: now,
      modifiedAt: now,
      source,
      originalFormat,
    },
    extensions: mapExtensions(card),
  }
}

/** 将 AweeClaw 角色卡转换回酒馆格式 */
export function mapCardToSillyTavern(
  card: AweeClawCharacterCard,
  version: 'v2' | 'v3' = 'v3'
): SillyTavernCardV2 | SillyTavernCardV3 {
  const base: SillyTavernCardV2 = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.firstMessage,
    mes_example: card.messageExample,
    creator_notes: card.creatorNotes,
    system_prompt: card.systemPrompt,
    post_history_instructions: card.postHistoryInstructions,
    alternate_greetings: card.alternateGreetings,
    character_book: card.characterBook,
    tags: card.tags,
    creator: card.creator,
    character_version: card.version,
    extensions: card.extensions,
  }

  if (version === 'v2') {
    return base
  }

  // V3 扩展
  const v3: SillyTavernCardV3 = {
    ...base,
    assets: card.assets.map(asset => ({
      type: asset.type,
      name: asset.name,
      description: asset.description,
      url: asset.url,
      local_path: asset.local_path,
      metadata: asset.metadata,
    })),
    group_only_greetings: [],
    creation_date: card.metadata.importedAt,
    modification_date: card.metadata.modifiedAt,
    nickname: card.nickname,
  }

  return v3
}

// ============================================
// 验证工具
// ============================================

/** 验证映射结果 */
export function validateMappingResult(card: AweeClawCharacterCard): {
  valid: boolean
  warnings: string[]
  errors: string[]
} {
  const warnings: string[] = []
  const errors: string[] = []

  // 必填字段检查
  if (!card.name) {
    errors.push('缺少角色名称')
  }

  if (!card.description && !card.systemPrompt) {
    warnings.push('缺少角色描述和系统提示词')
  }

  if (!card.firstMessage) {
    warnings.push('缺少开场白')
  }

  // 字段长度检查
  if (card.systemPrompt.length > 10000) {
    warnings.push('系统提示词过长（>10000字符），可能影响性能')
  }

  if (card.description.length > 5000) {
    warnings.push('角色描述过长（>5000字符）')
  }

  // 标签检查
  if (card.tags.length === 0) {
    warnings.push('没有标签，建议添加以便管理')
  }

  // 角色书检查
  if (card.characterBook) {
    if (card.characterBook.entries.length > 50) {
      warnings.push(`角色书条目较多（${card.characterBook.entries.length}条），可能影响上下文长度`)
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  }
}

/** 检查字段兼容性 */
export function checkFieldCompatibility(
  card: SillyTavernCardV2 | SillyTavernCardV3
): {
  compatible: boolean
  unsupportedFields: string[]
  warnings: string[]
} {
  const unsupportedFields: string[] = []
  const warnings: string[] = []

  // V3 特有字段
  if ('assets' in card && Array.isArray((card as SillyTavernCardV3).assets)) {
    const assets = (card as SillyTavernCardV3).assets!
    if (assets.length > 0) {
      warnings.push(`包含 ${assets.length} 个资产，将尝试导入`)
    }
  }

  // 检查扩展字段
  if (card.extensions && Object.keys(card.extensions).length > 0) {
    const extKeys = Object.keys(card.extensions)
    warnings.push(`包含扩展字段: ${extKeys.join(', ')}，将作为元数据保存`)
  }

  // 检查 character_book
  if (card.character_book) {
    const entryCount = card.character_book.entries?.length || 0
    if (entryCount > 100) {
      warnings.push(`角色书包含 ${entryCount} 条条目，建议限制在 100 条以内`)
    }
  }

  return {
    compatible: unsupportedFields.length === 0,
    unsupportedFields,
    warnings,
  }
}

// ============================================
// 工具函数
// ============================================

/** 生成新的角色卡 ID */
function generateCardId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 清理字段值 */
export function sanitizeFieldValue(value: string): string {
  if (!value) return ''

  // 移除控制字符
  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // 规范化换行符
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 移除首尾空白
  sanitized = sanitized.trim()

  return sanitized
}

/** 清理角色卡数据 */
export function sanitizeCardData(card: AweeClawCharacterCard): AweeClawCharacterCard {
  return {
    ...card,
    name: sanitizeFieldValue(card.name),
    nickname: card.nickname ? sanitizeFieldValue(card.nickname) : undefined,
    description: sanitizeFieldValue(card.description),
    personality: sanitizeFieldValue(card.personality),
    scenario: sanitizeFieldValue(card.scenario),
    systemPrompt: sanitizeFieldValue(card.systemPrompt),
    firstMessage: sanitizeFieldValue(card.firstMessage),
    alternateGreetings: card.alternateGreetings.map(sanitizeFieldValue),
    messageExample: sanitizeFieldValue(card.messageExample),
    postHistoryInstructions: sanitizeFieldValue(card.postHistoryInstructions),
    creatorNotes: sanitizeFieldValue(card.creatorNotes),
    tags: card.tags.map(sanitizeFieldValue).filter(tag => tag.length > 0),
    creator: sanitizeFieldValue(card.creator),
    version: sanitizeFieldValue(card.version),
  }
}
/**
 * 酒馆角色卡类型定义
 *
 * 基于 SillyTavern Card V2/V3 规范
 */

// 酒馆角色卡 V2 字段
export interface SillyTavernCardV2 {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  character_book?: CharacterBook
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, unknown>
}

// 酒馆角色卡 V3 增量字段
export interface SillyTavernCardV3 extends SillyTavernCardV2 {
  assets?: CharacterAsset[]
  group_only_greetings?: string[]
  creation_date?: string
  modification_date?: string
  nickname?: string
}

// 角色资产（V3）
export interface CharacterAsset {
  type: 'icon' | 'emotion' | 'background' | 'voice'
  name: string
  description?: string
  url?: string
  local_path?: string
  metadata?: Record<string, unknown>
}

// 角色书（知识库）
export interface CharacterBook {
  name: string
  description?: string
  entries: CharacterBookEntry[]
  extensions?: Record<string, unknown>
}

// 角色书条目
export interface CharacterBookEntry {
  keys: string[]
  content: string
  extensions?: Record<string, unknown>
  enabled: boolean
  insertion_order: number
  case_sensitive?: boolean
  name?: string
  priority?: number
  id?: number
  comment?: string
  selective?: boolean
  secondary_keys?: string[]
  constant?: boolean
  position?: 'before_char' | 'after_char'
}

// AweeClaw 角色卡格式
export interface AweeClawCharacterCard {
  id: string
  name: string
  nickname?: string
  description: string
  personality: string
  scenario: string
  systemPrompt: string
  firstMessage: string
  alternateGreetings: string[]
  messageExample: string
  postHistoryInstructions: string
  creatorNotes: string
  tags: string[]
  creator: string
  version: string
  assets: CharacterAsset[]
  characterBook?: CharacterBook
  metadata: {
    importedAt: string
    modifiedAt: string
    source: 'sillytavern-v2' | 'sillytavern-v3' | 'aweclaw'
    originalFormat?: 'png' | 'json'
  }
  // 扩展字段
  extensions: Record<string, unknown>
}

// 导入结果
export interface CardImportResult {
  success: boolean
  card?: AweeClawCharacterCard
  warnings: string[]
  errors: string[]
}

// 导出选项
export interface CardExportOptions {
  format: 'json' | 'png'
  includeAssets: boolean
  includeCharacterBook: boolean
  pngTemplatePath?: string
  outputPath?: string
}

// 存储统计
export interface CardStorageStats {
  totalCards: number
  totalSize: number
  lastModified: string
  categories: Record<string, number>
}

// 解析器配置
export interface CardParserConfig {
  maxFileSize: number // 最大文件大小（字节）
  supportedFormats: string[]
  validateCRC: boolean // PNG CRC 校验
  skipLargeImages: boolean // 跳过大图
  largeImageThreshold: number // 大图阈值（字节）
}

// 默认解析器配置
export const DEFAULT_PARSER_CONFIG: CardParserConfig = {
  maxFileSize: 50 * 1024 * 1024, // 50MB
  supportedFormats: ['.json', '.png'],
  validateCRC: true,
  skipLargeImages: true,
  largeImageThreshold: 10 * 1024 * 1024, // 10MB
}

// 角色卡查询选项
export interface CardQueryOptions {
  keyword?: string
  tags?: string[]
  creator?: string
  sortBy?: 'name' | 'importedAt' | 'modifiedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// 角色卡更新选项
export interface CardUpdateOptions {
  name?: string
  nickname?: string
  description?: string
  personality?: string
  scenario?: string
  systemPrompt?: string
  firstMessage?: string
  alternateGreetings?: string[]
  messageExample?: string
  postHistoryInstructions?: string
  creatorNotes?: string
  tags?: string[]
  creator?: string
  version?: string
  assets?: CharacterAsset[]
  characterBook?: CharacterBook
  extensions?: Record<string, unknown>
}
/**
 * 角色卡模块导出
 *
 * 本模块提供酒馆角色卡导入导出功能，支持：
 * 1. 酒馆角色卡 V2/V3 格式解析
 * 2. PNG tEXt chunk 角色卡解析
 * 3. JSON/PNG 格式导出
 * 4. 角色卡存储管理
 * 5. 字段映射与验证
 *
 * 设计要点：
 * 1. 先易后难：先做 JSON 直导，再做 PNG 解析
 * 2. CRC 校验：验证 PNG chunk 的完整性
 * 3. 大图跳过：避免解析超大 PNG 文件
 * 4. 错误降级：解析失败时返回明确错误信息
 *
 * @module character-card
 */

import { registerCharacterCardIpc, unregisterCharacterCardIpc } from './CharacterCardIpc'

// 类型定义
export type {
  SillyTavernCardV2,
  SillyTavernCardV3,
  CharacterAsset,
  CharacterBook,
  CharacterBookEntry,
  AweeClawCharacterCard,
  CardImportResult,
  CardExportOptions,
  CardQueryOptions,
  CardUpdateOptions,
  CardStorageStats,
  CardParserConfig,
} from './types'

export { DEFAULT_PARSER_CONFIG } from './types'

// 存储管理
export {
  saveCard,
  readCard,
  deleteCard,
  updateCard,
  queryCards,
  getAllCards,
  getStorageStats,
  backupCard,
  restoreCard,
  cardExists,
  generateCardId,
  initializeStorage,
  getCharacterCardsDataDir,
  getCardsDir,
  getAssetsDir,
  getCardFilePath,
  getCardAssetsDir,
  getThumbnailPath,
} from './CharacterCardStore'

// 解析器
export {
  parseJsonCard,
  parsePngCard,
  parseCardFile,
  validateCardData,
  isCharacterCardFile,
} from './CardParser'

// 序列化器
export {
  exportToJson,
  exportToPng,
  exportCard,
  exportMultipleCards,
  exportCardWithAssets,
  convertToSillyTavernV2,
  convertToSillyTavernV3,
} from './CardSerializer'

// 字段映射
export {
  mapCardToAweeClaw,
  mapCardToSillyTavern,
  validateMappingResult,
  checkFieldCompatibility,
  sanitizeFieldValue,
  sanitizeCardData,
  DEFAULT_MAPPING_CONFIG,
} from './CardFieldMapper'

export type { FieldMappingConfig } from './CardFieldMapper'

// IPC 处理器
// 注意：必须静态导入。打包后模块被内联进主进程 bundle，运行时 `require('./CharacterCardIpc')`
// 会因文件不存在抛 MODULE_NOT_FOUND，进而中断 moduleInitializer 后续模块初始化。
export { registerCharacterCardIpc, unregisterCharacterCardIpc }

/**
 * 初始化角色卡模块
 *
 * 在主进程启动时调用，注册 IPC 处理器。
 */
export function initializeCharacterCardModule(): void {
  // 静态引用，禁止 require（打包后相对路径失效会中断启动流程）
  registerCharacterCardIpc()

  console.log('[CharacterCard] 模块初始化完成')
}

/**
 * 清理角色卡模块
 *
 * 在应用退出时调用，释放资源。
 */
export async function cleanupCharacterCardModule(): Promise<void> {
  try {
    // 目前没有需要清理的资源
    console.log('[CharacterCard] 模块清理完成')
  } catch (error) {
    console.error('[CharacterCard] 模块清理失败:', error)
  }
}
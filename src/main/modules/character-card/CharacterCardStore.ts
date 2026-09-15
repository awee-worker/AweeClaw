/**
 * 角色卡存储管理
 *
 * 存储布局：
 *   <userData>/character-cards/
 *   ├── cards/                    # 角色卡数据
 *   │   ├── <id>.json            # 角色卡 JSON 文件
 *   │   └── assets/              # 角色资产（表情包、图标等）
 *   │       └── <card-id>/       # 每个角色卡的资产目录
 *   ├── index.json               # 索引文件（快速搜索）
 *   └── config.json              # 配置文件
 *
 * 设计要点：
 * 1. 每个角色卡独立存储为 JSON 文件
 * 2. 支持资产（表情包、图标等）的本地存储
 * 3. 索引文件用于快速搜索和列表
 * 4. 支持导入/导出/备份
 *
 * @module character-card/CharacterCardStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  AweeClawCharacterCard,
  CardImportResult,
  CardQueryOptions,
  CardUpdateOptions,
  CardStorageStats,
} from './types'

// ============================================
// 常量
// ============================================

const CHARACTER_CARDS_DIR_NAME = 'character-cards'
const CARDS_DIR_NAME = 'cards'
const ASSETS_DIR_NAME = 'assets'
const INDEX_FILE_NAME = 'index.json'
const CONFIG_FILE_NAME = 'config.json'

// ============================================
// 路径工具
// ============================================

/** 模块数据目录 */
export function getCharacterCardsDataDir(): string {
  return path.join(app.getPath('userData'), CHARACTER_CARDS_DIR_NAME)
}

/** 角色卡目录 */
export function getCardsDir(): string {
  return path.join(getCharacterCardsDataDir(), CARDS_DIR_NAME)
}

/** 资产目录 */
export function getAssetsDir(): string {
  return path.join(getCharacterCardsDataDir(), ASSETS_DIR_NAME)
}

/** 索引文件路径 */
export function getIndexPath(): string {
  return path.join(getCharacterCardsDataDir(), INDEX_FILE_NAME)
}

/** 配置文件路径 */
export function getConfigPath(): string {
  return path.join(getCharacterCardsDataDir(), CONFIG_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[CharacterCard] ensureDir failed:', dir, err)
  }
}

// ============================================
// 索引管理
// ============================================

interface CardIndex {
  id: string
  name: string
  nickname?: string
  tags: string[]
  creator: string
  importedAt: string
  modifiedAt: string
  filePath: string
  hasAssets: boolean
  thumbnailPath?: string
}

/** 读取索引 */
function readIndex(): CardIndex[] {
  const indexPath = getIndexPath()
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf-8')
      return JSON.parse(raw) as CardIndex[]
    }
  } catch (err) {
    logger.system.warn('[CharacterCard] readIndex failed:', err)
  }
  return []
}

/** 写入索引 */
function writeIndex(index: CardIndex[]): void {
  const indexPath = getIndexPath()
  ensureDir(path.dirname(indexPath))
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[CharacterCard] writeIndex failed:', err)
    throw err
  }
}

/** 更新索引中的单个条目 */
function updateIndexEntry(card: AweeClawCharacterCard): void {
  const index = readIndex()
  const existingIndex = index.findIndex(item => item.id === card.id)

  const entry: CardIndex = {
    id: card.id,
    name: card.name,
    nickname: card.nickname,
    tags: card.tags,
    creator: card.creator,
    importedAt: card.metadata.importedAt,
    modifiedAt: card.metadata.modifiedAt,
    filePath: getCardFilePath(card.id),
    hasAssets: card.assets.length > 0,
    thumbnailPath: getThumbnailPath(card.id),
  }

  if (existingIndex >= 0) {
    index[existingIndex] = entry
  } else {
    index.push(entry)
  }

  writeIndex(index)
}

/** 从索引中移除条目 */
function removeIndexEntry(cardId: string): void {
  const index = readIndex()
  const filtered = index.filter(item => item.id !== cardId)
  writeIndex(filtered)
}

// ============================================
// 文件路径工具
// ============================================

/** 角色卡文件路径 */
export function getCardFilePath(cardId: string): string {
  return path.join(getCardsDir(), `${cardId}.json`)
}

/** 角色卡资产目录 */
export function getCardAssetsDir(cardId: string): string {
  return path.join(getAssetsDir(), cardId)
}

/** 缩略图路径 */
export function getThumbnailPath(cardId: string): string | undefined {
  const assetsDir = getCardAssetsDir(cardId)
  const thumbnailPath = path.join(assetsDir, 'thumbnail.png')
  return fs.existsSync(thumbnailPath) ? thumbnailPath : undefined
}

// ============================================
// 存储操作
// ============================================

/** 保存角色卡 */
export function saveCard(card: AweeClawCharacterCard): void {
  const cardsDir = getCardsDir()
  ensureDir(cardsDir)

  const filePath = getCardFilePath(card.id)
  try {
    fs.writeFileSync(filePath, JSON.stringify(card, null, 2), 'utf-8')
    updateIndexEntry(card)
    logger.system.info('[CharacterCard] Card saved:', card.id, card.name)
  } catch (err) {
    logger.system.error('[CharacterCard] saveCard failed:', err)
    throw err
  }
}

/** 读取角色卡 */
export function readCard(cardId: string): AweeClawCharacterCard | null {
  const filePath = getCardFilePath(cardId)
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(raw) as AweeClawCharacterCard
    }
  } catch (err) {
    logger.system.error('[CharacterCard] readCard failed:', err)
  }
  return null
}

/** 删除角色卡 */
export function deleteCard(cardId: string): boolean {
  const filePath = getCardFilePath(cardId)
  const assetsDir = getCardAssetsDir(cardId)

  try {
    // 删除角色卡文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除资产目录
    if (fs.existsSync(assetsDir)) {
      fs.rmSync(assetsDir, { recursive: true, force: true })
    }

    // 从索引中移除
    removeIndexEntry(cardId)

    logger.system.info('[CharacterCard] Card deleted:', cardId)
    return true
  } catch (err) {
    logger.system.error('[CharacterCard] deleteCard failed:', err)
    return false
  }
}

/** 更新角色卡 */
export function updateCard(cardId: string, updates: CardUpdateOptions): AweeClawCharacterCard | null {
  const card = readCard(cardId)
  if (!card) {
    logger.system.warn('[CharacterCard] Card not found for update:', cardId)
    return null
  }

  // 应用更新
  const updatedCard: AweeClawCharacterCard = {
    ...card,
    ...updates,
    metadata: {
      ...card.metadata,
      modifiedAt: new Date().toISOString(),
    },
  }

  saveCard(updatedCard)
  return updatedCard
}

/** 查询角色卡 */
export function queryCards(options: CardQueryOptions = {}): AweeClawCharacterCard[] {
  const index = readIndex()
  let filtered = [...index]

  // 关键词搜索
  if (options.keyword) {
    const keyword = options.keyword.toLowerCase()
    filtered = filtered.filter(item =>
      item.name.toLowerCase().includes(keyword) ||
      (item.nickname && item.nickname.toLowerCase().includes(keyword)) ||
      item.tags.some(tag => tag.toLowerCase().includes(keyword))
    )
  }

  // 标签过滤
  if (options.tags && options.tags.length > 0) {
    filtered = filtered.filter(item =>
      options.tags!.some(tag => item.tags.includes(tag))
    )
  }

  // 创建者过滤
  if (options.creator) {
    filtered = filtered.filter(item => item.creator === options.creator)
  }

  // 排序
  if (options.sortBy) {
    const sortOrder = options.sortOrder || 'asc'
    filtered.sort((a, b) => {
      let valueA: string, valueB: string
      switch (options.sortBy) {
        case 'name':
          valueA = a.name
          valueB = b.name
          break
        case 'importedAt':
          valueA = a.importedAt
          valueB = b.importedAt
          break
        case 'modifiedAt':
          valueA = a.modifiedAt
          valueB = b.modifiedAt
          break
        default:
          valueA = a.name
          valueB = b.name
      }
      return sortOrder === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA)
    })
  }

  // 分页
  const offset = options.offset || 0
  const limit = options.limit || 100
  const paginated = filtered.slice(offset, offset + limit)

  // 加载完整角色卡数据
  return paginated
    .map(item => readCard(item.id))
    .filter((card): card is AweeClawCharacterCard => card !== null)
}

/** 获取所有角色卡 */
export function getAllCards(): AweeClawCharacterCard[] {
  return queryCards()
}

/** 获取角色卡统计信息 */
export function getStorageStats(): CardStorageStats {
  const index = readIndex()
  const cardsDir = getCardsDir()
  const assetsDir = getAssetsDir()

  let totalSize = 0
  const categories: Record<string, number> = {}

  // 计算角色卡文件大小
  if (fs.existsSync(cardsDir)) {
    const files = fs.readdirSync(cardsDir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(cardsDir, file)
        const stats = fs.statSync(filePath)
        totalSize += stats.size
      }
    }
  }

  // 计算资产大小
  if (fs.existsSync(assetsDir)) {
    const assetDirs = fs.readdirSync(assetsDir)
    for (const dir of assetDirs) {
      const dirPath = path.join(assetsDir, dir)
      if (fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath)
        for (const file of files) {
          const filePath = path.join(dirPath, file)
          const stats = fs.statSync(filePath)
          totalSize += stats.size
        }
      }
    }
  }

  // 统计标签分类
  for (const card of index) {
    for (const tag of card.tags) {
      categories[tag] = (categories[tag] || 0) + 1
    }
  }

  return {
    totalCards: index.length,
    totalSize,
    lastModified: index.length > 0
      ? index.reduce((latest, item) =>
          item.modifiedAt > latest ? item.modifiedAt : latest, index[0].modifiedAt)
      : new Date().toISOString(),
    categories,
  }
}

/** 检查角色卡是否存在 */
export function cardExists(cardId: string): boolean {
  const filePath = getCardFilePath(cardId)
  return fs.existsSync(filePath)
}

/** 生成新的角色卡 ID */
export function generateCardId(): string {
  return randomUUID()
}

/** 备份角色卡 */
export function backupCard(cardId: string): string | null {
  const card = readCard(cardId)
  if (!card) return null

  const backupDir = path.join(getCharacterCardsDataDir(), 'backups')
  ensureDir(backupDir)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `${cardId}_${timestamp}.json`)

  try {
    fs.writeFileSync(backupPath, JSON.stringify(card, null, 2), 'utf-8')
    logger.system.info('[CharacterCard] Card backed up:', cardId, backupPath)
    return backupPath
  } catch (err) {
    logger.system.error('[CharacterCard] backupCard failed:', err)
    return null
  }
}

/** 恢复角色卡 */
export function restoreCard(backupPath: string): CardImportResult {
  try {
    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        warnings: [],
        errors: ['备份文件不存在'],
      }
    }

    const raw = fs.readFileSync(backupPath, 'utf-8')
    const card = JSON.parse(raw) as AweeClawCharacterCard

    // 验证必要字段
    if (!card.id || !card.name) {
      return {
        success: false,
        warnings: [],
        errors: ['备份文件格式无效'],
      }
    }

    // 保存角色卡
    saveCard(card)

    return {
      success: true,
      card,
      warnings: [],
      errors: [],
    }
  } catch (err) {
    logger.system.error('[CharacterCard] restoreCard failed:', err)
    return {
      success: false,
      warnings: [],
      errors: [`恢复失败: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

/** 初始化存储目录 */
export function initializeStorage(): void {
  const dataDir = getCharacterCardsDataDir()
  const cardsDir = getCardsDir()
  const assetsDir = getAssetsDir()

  ensureDir(dataDir)
  ensureDir(cardsDir)
  ensureDir(assetsDir)

  logger.system.info('[CharacterCard] Storage initialized:', dataDir)
}
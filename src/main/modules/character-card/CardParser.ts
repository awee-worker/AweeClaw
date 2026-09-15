/**
 * 酒馆角色卡解析器
 *
 * 支持解析：
 * 1. JSON 格式角色卡（.json）
 * 2. PNG 格式角色卡（.png）- 包含 tEXt chunk 中的角色卡数据
 *
 * 酒馆角色卡 PNG 格式：
 * - chunk 关键字：`chara`（V2）或 `ccv3`（V3）
 * - 值：base64 → zlib 压缩的 JSON
 *
 * 设计要点：
 * 1. 先易后难：先做 JSON 直导，再做 PNG 解析
 * 2. CRC 校验：验证 PNG chunk 的完整性
 * 3. 大图跳过：避免解析超大 PNG 文件
 * 4. 错误降级：解析失败时返回明确错误信息
 *
 * @module character-card/CardParser
 */

import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  SillyTavernCardV2,
  SillyTavernCardV3,
  AweeClawCharacterCard,
  CardImportResult,
  CardParserConfig,
} from './types'
import { DEFAULT_PARSER_CONFIG } from './types'
import { generateCardId } from './CharacterCardStore'

// ============================================
// PNG 解析工具
// ============================================

/** PNG 文件签名 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

/** PNG chunk 类型 */
interface PngChunk {
  length: number
  type: string
  data: Buffer
  crc: Buffer
}

/** 验证 PNG 文件签名 */
function isPngFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r')
    const signature = Buffer.alloc(8)
    fs.readSync(fd, signature, 0, 8, 0)
    fs.closeSync(fd)
    return signature.equals(PNG_SIGNATURE)
  } catch (err) {
    logger.system.error('[CardParser] Failed to read PNG signature:', err)
    return false
  }
}

/** 读取 PNG chunk */
function readPngChunk(buffer: Buffer, offset: number): PngChunk | null {
  if (offset + 8 > buffer.length) return null

  const length = buffer.readUInt32BE(offset)
  const type = buffer.toString('ascii', offset + 4, offset + 8)
  const data = buffer.slice(offset + 8, offset + 8 + length)
  const crc = buffer.slice(offset + 8 + length, offset + 12 + length)

  return { length, type, data, crc }
}

/** 计算 CRC32 */
function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** 验证 PNG chunk CRC */
function validateChunkCrc(chunk: PngChunk): boolean {
  const typeBuffer = Buffer.from(chunk.type, 'ascii')
  const dataToCrc = Buffer.concat([typeBuffer, chunk.data])
  const calculatedCrc = crc32(dataToCrc)
  const expectedCrc = chunk.crc.readUInt32BE(0)
  return calculatedCrc === expectedCrc
}

/** 从 PNG 文件中提取 tEXt chunk 数据 */
function extractTextChunks(filePath: string, config: CardParserConfig): Map<string, string> {
  const textChunks = new Map<string, string>()

  try {
    const buffer = fs.readFileSync(filePath)

    // 验证 PNG 签名
    if (!buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
      logger.system.warn('[CardParser] Not a valid PNG file:', filePath)
      return textChunks
    }

    // 检查文件大小
    if (buffer.length > config.maxFileSize) {
      logger.system.warn('[CardParser] PNG file too large:', buffer.length, 'bytes')
      return textChunks
    }

    let offset = 8 // 跳过 PNG 签名

    while (offset < buffer.length) {
      const chunk = readPngChunk(buffer, offset)
      if (!chunk) break

      // 验证 CRC（如果启用）
      if (config.validateCRC && !validateChunkCrc(chunk)) {
        logger.system.warn('[CardParser] Invalid CRC for chunk:', chunk.type, 'at offset:', offset)
        offset += 12 + chunk.length
        continue
      }

      // 提取 tEXt chunk
      if (chunk.type === 'tEXt') {
        const nullIndex = chunk.data.indexOf(0)
        if (nullIndex > 0) {
          const keyword = chunk.data.slice(0, nullIndex).toString('ascii')
          const value = chunk.data.slice(nullIndex + 1).toString('utf-8')

          // 只提取角色卡相关的 chunk
          if (keyword === 'chara' || keyword === 'ccv3') {
            textChunks.set(keyword, value)
          }
        }
      }

      // 跳过 IEND chunk
      if (chunk.type === 'IEND') break

      offset += 12 + chunk.length
    }
  } catch (err) {
    logger.system.error('[CardParser] Failed to extract text chunks:', err)
  }

  return textChunks
}

/** 解码角色卡数据（base64 → zlib → JSON） */
function decodeCardData(encodedData: string): SillyTavernCardV2 | SillyTavernCardV3 | null {
  try {
    // base64 解码
    const compressed = Buffer.from(encodedData, 'base64')

    // zlib 解压
    const decompressed = zlib.inflateSync(compressed)

    // JSON 解析
    const json = JSON.parse(decompressed.toString('utf-8'))

    // 验证基本结构
    if (!json.name || typeof json.name !== 'string') {
      logger.system.warn('[CardParser] Invalid card data: missing name')
      return null
    }

    return json as SillyTavernCardV2 | SillyTavernCardV3
  } catch (err) {
    logger.system.error('[CardParser] Failed to decode card data:', err)
    return null
  }
}

// ============================================
// 字段映射
// ============================================

/** 将酒馆角色卡映射到 AweeClaw 格式 */
export function mapToAweeClawCard(
  tavernCard: SillyTavernCardV2 | SillyTavernCardV3,
  source: 'sillytavern-v2' | 'sillytavern-v3',
  originalFormat: 'png' | 'json'
): AweeClawCharacterCard {
  const now = new Date().toISOString()

  // 处理 V3 特有字段
  const isV3 = 'assets' in tavernCard
  const v3Card = isV3 ? tavernCard as SillyTavernCardV3 : null

  // 构建系统提示词
  let systemPrompt = tavernCard.system_prompt || ''
  if (!systemPrompt) {
    // 如果没有 system_prompt，用 description + personality 拼装
    const parts: string[] = []
    if (tavernCard.description) parts.push(`角色描述：${tavernCard.description}`)
    if (tavernCard.personality) parts.push(`性格特点：${tavernCard.personality}`)
    if (tavernCard.scenario) parts.push(`场景背景：${tavernCard.scenario}`)
    systemPrompt = parts.join('\n\n')
  }

  // 处理开场白
  const firstMessage = tavernCard.first_mes || ''
  const alternateGreetings = tavernCard.alternate_greetings || []

  // 处理对话示例
  const messageExample = tavernCard.mes_example || ''

  // 处理后置指令
  const postHistoryInstructions = tavernCard.post_history_instructions || ''

  // 处理标签
  const tags = Array.isArray(tavernCard.tags) ? tavernCard.tags : []

  // 处理资产
  const assets: AweeClawCharacterCard['assets'] = []
  if (v3Card?.assets && Array.isArray(v3Card.assets)) {
    for (const asset of v3Card.assets) {
      assets.push({
        type: asset.type as 'icon' | 'emotion' | 'background' | 'voice',
        name: asset.name,
        description: asset.description,
        url: asset.url,
        local_path: asset.local_path,
        metadata: asset.metadata,
      })
    }
  }

  // 处理角色书
  const characterBook = tavernCard.character_book ? {
    name: tavernCard.character_book.name || '导入的知识库',
    description: tavernCard.character_book.description,
    entries: (tavernCard.character_book.entries || []).map(entry => ({
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
    extensions: tavernCard.character_book.extensions || {},
  } : undefined

  return {
    id: generateCardId(),
    name: tavernCard.name,
    nickname: v3Card?.nickname,
    description: tavernCard.description || '',
    personality: tavernCard.personality || '',
    scenario: tavernCard.scenario || '',
    systemPrompt,
    firstMessage,
    alternateGreetings,
    messageExample,
    postHistoryInstructions,
    creatorNotes: tavernCard.creator_notes || '',
    tags,
    creator: tavernCard.creator || '未知',
    version: tavernCard.character_version || '1.0',
    assets,
    characterBook,
    metadata: {
      importedAt: now,
      modifiedAt: now,
      source,
      originalFormat,
    },
    extensions: tavernCard.extensions || {},
  }
}

// ============================================
// 解析器
// ============================================

/** 解析 JSON 角色卡文件 */
export function parseJsonCard(filePath: string): CardImportResult {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        warnings: [],
        errors: ['文件不存在'],
      }
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as SillyTavernCardV2 | SillyTavernCardV3

    // 验证基本字段
    if (!data.name || typeof data.name !== 'string') {
      return {
        success: false,
        warnings: [],
        errors: ['无效的角色卡格式：缺少 name 字段'],
      }
    }

    // 检测版本
    const isV3 = 'assets' in data || 'creation_date' in data
    const source = isV3 ? 'sillytavern-v3' : 'sillytavern-v2'

    // 映射到 AweeClaw 格式
    const card = mapToAweeClawCard(data, source, 'json')

    return {
      success: true,
      card,
      warnings: [],
      errors: [],
    }
  } catch (err) {
    logger.system.error('[CardParser] Failed to parse JSON card:', err)
    return {
      success: false,
      warnings: [],
      errors: [`解析失败: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

/** 解析 PNG 角色卡文件 */
export function parsePngCard(filePath: string, config: CardParserConfig = DEFAULT_PARSER_CONFIG): CardImportResult {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        warnings: [],
        errors: ['文件不存在'],
      }
    }

    // 检查文件大小
    const stats = fs.statSync(filePath)
    if (stats.size > config.maxFileSize) {
      return {
        success: false,
        warnings: [],
        errors: [`文件过大: ${stats.size} 字节，最大允许 ${config.maxFileSize} 字节`],
      }
    }

    // 验证 PNG 文件
    if (!isPngFile(filePath)) {
      return {
        success: false,
        warnings: [],
        errors: ['不是有效的 PNG 文件'],
      }
    }

    // 提取 tEXt chunk
    const textChunks = extractTextChunks(filePath, config)

    // 查找角色卡数据
    let encodedData: string | undefined
    let source: 'sillytavern-v2' | 'sillytavern-v3' = 'sillytavern-v2'

    if (textChunks.has('ccv3')) {
      encodedData = textChunks.get('ccv3')
      source = 'sillytavern-v3'
    } else if (textChunks.has('chara')) {
      encodedData = textChunks.get('chara')
      source = 'sillytavern-v2'
    }

    if (!encodedData) {
      return {
        success: false,
        warnings: [],
        errors: ['PNG 文件中未找到角色卡数据（tEXt chunk）'],
      }
    }

    // 解码角色卡数据
    const tavernCard = decodeCardData(encodedData)
    if (!tavernCard) {
      return {
        success: false,
        warnings: [],
        errors: ['角色卡数据解码失败'],
      }
    }

    // 映射到 AweeClaw 格式
    const card = mapToAweeClawCard(tavernCard, source, 'png')

    return {
      success: true,
      card,
      warnings: [],
      errors: [],
    }
  } catch (err) {
    logger.system.error('[CardParser] Failed to parse PNG card:', err)
    return {
      success: false,
      warnings: [],
      errors: [`解析失败: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

/** 自动解析角色卡文件（根据扩展名选择解析器） */
export function parseCardFile(filePath: string, config: CardParserConfig = DEFAULT_PARSER_CONFIG): CardImportResult {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case '.json':
      return parseJsonCard(filePath)
    case '.png':
      return parsePngCard(filePath, config)
    default:
      return {
        success: false,
        warnings: [],
        errors: [`不支持的文件格式: ${ext}`],
      }
  }
}

/** 验证角色卡数据 */
export function validateCardData(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['数据不是对象'] }
  }

  const card = data as Record<string, unknown>

  // 必填字段
  if (!card.name || typeof card.name !== 'string') {
    errors.push('缺少或无效的 name 字段')
  }

  // 可选字段类型检查
  if (card.description && typeof card.description !== 'string') {
    errors.push('description 字段必须是字符串')
  }

  if (card.personality && typeof card.personality !== 'string') {
    errors.push('personality 字段必须是字符串')
  }

  if (card.tags && !Array.isArray(card.tags)) {
    errors.push('tags 字段必须是数组')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/** 检测文件是否为酒馆角色卡 */
export function isCharacterCardFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.json') {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw)
      return validateCardData(data).valid
    } catch {
      return false
    }
  }

  if (ext === '.png') {
    return isPngFile(filePath)
  }

  return false
}
/**
 * 角色卡序列化器
 *
 * 支持导出：
 * 1. JSON 格式角色卡（.json）
 * 2. PNG 格式角色卡（.png）- 将角色卡数据嵌入 PNG tEXt chunk
 *
 * 设计要点：
 * 1. JSON 导出优先（互通性最好）
 * 2. PNG 嵌入作为增强（需按 chunk 规则重写 PNG）
 * 3. CRC32 计算确保数据完整性
 * 4. 支持资产打包导出
 *
 * @module character-card/CardSerializer
 */

import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  AweeClawCharacterCard,
  SillyTavernCardV2,
  SillyTavernCardV3,
  CardExportOptions,
} from './types'
import { readCard, getCardAssetsDir } from './CharacterCardStore'

// ============================================
// PNG 工具
// ============================================

/** PNG 文件签名 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

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

/** 创建 PNG chunk */
function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeBuffer = Buffer.from(type, 'ascii')
  const dataToCrc = Buffer.concat([typeBuffer, data])
  const crcValue = crc32(dataToCrc)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crcValue, 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

/** 创建 tEXt chunk */
function createTextChunk(keyword: string, value: string): Buffer {
  const keywordBuffer = Buffer.from(keyword, 'ascii')
  const valueBuffer = Buffer.from(value, 'utf-8')
  const data = Buffer.concat([keywordBuffer, Buffer.from([0]), valueBuffer])
  return createPngChunk('tEXt', data)
}

// ============================================
// 格式转换
// ============================================

/** 将 AweeClaw 角色卡转换为酒馆 V2 格式 */
export function convertToSillyTavernV2(card: AweeClawCharacterCard): SillyTavernCardV2 {
  return {
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
}

/** 将 AweeClaw 角色卡转换为酒馆 V3 格式 */
export function convertToSillyTavernV3(card: AweeClawCharacterCard): SillyTavernCardV3 {
  const v2 = convertToSillyTavernV2(card)

  return {
    ...v2,
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
}

// ============================================
// 导出器
// ============================================

/** 导出为 JSON 格式 */
export function exportToJson(
  card: AweeClawCharacterCard,
  outputPath?: string
): { success: boolean; filePath?: string; error?: string } {
  try {
    const outputDir = outputPath || path.join(process.cwd(), 'exports')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const fileName = `${card.name.replace(/[<>:"/\\|?*]/g, '_')}_${card.id.slice(0, 8)}.json`
    const filePath = path.join(outputDir, fileName)

    // 转换为酒馆 V3 格式（兼容性最好）
    const tavernCard = convertToSillyTavernV3(card)
    const json = JSON.stringify(tavernCard, null, 2)

    fs.writeFileSync(filePath, json, 'utf-8')

    logger.system.info('[CardSerializer] Card exported to JSON:', filePath)

    return {
      success: true,
      filePath,
    }
  } catch (err) {
    logger.system.error('[CardSerializer] Failed to export JSON:', err)
    return {
      success: false,
      error: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** 导出为 PNG 格式（需要模板 PNG 文件） */
export function exportToPng(
  card: AweeClawCharacterCard,
  templatePngPath?: string,
  outputPath?: string
): { success: boolean; filePath?: string; error?: string } {
  try {
    // 如果没有模板 PNG，创建一个简单的 PNG
    let pngBuffer: Buffer

    if (templatePngPath && fs.existsSync(templatePngPath)) {
      // 使用模板 PNG
      pngBuffer = fs.readFileSync(templatePngPath)
    } else {
      // 创建最小 PNG（1x1 像素透明图片）
      pngBuffer = createMinimalPng()
    }

    // 转换为酒馆 V3 格式
    const tavernCard = convertToSillyTavernV3(card)
    const json = JSON.stringify(tavernCard)

    // zlib 压缩
    const compressed = zlib.deflateSync(Buffer.from(json, 'utf-8'))

    // base64 编码
    const encoded = compressed.toString('base64')

    // 创建 tEXt chunk
    const textChunk = createTextChunk('ccv3', encoded)

    // 重新组装 PNG
    const outputPng = assemblePng(pngBuffer, textChunk)

    // 输出文件
    const outputDir = outputPath || path.join(process.cwd(), 'exports')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const fileName = `${card.name.replace(/[<>:"/\\|?*]/g, '_')}_${card.id.slice(0, 8)}.png`
    const filePath = path.join(outputDir, fileName)

    fs.writeFileSync(filePath, outputPng)

    logger.system.info('[CardSerializer] Card exported to PNG:', filePath)

    return {
      success: true,
      filePath,
    }
  } catch (err) {
    logger.system.error('[CardSerializer] Failed to export PNG:', err)
    return {
      success: false,
      error: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** 创建最小 PNG（1x1 像素透明图片） */
function createMinimalPng(): Buffer {
  // PNG 签名
  const signature = PNG_SIGNATURE

  // IHDR chunk（1x1 像素，8-bit RGBA）
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0) // width
  ihdrData.writeUInt32BE(1, 4) // height
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 6  // color type (RGBA)
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method
  const ihdrChunk = createPngChunk('IHDR', ihdrData)

  // IDAT chunk（压缩的像素数据）
  const rawData = Buffer.from([0, 0, 0, 0, 0]) // filter byte + RGBA pixel
  const compressedData = zlib.deflateSync(rawData)
  const idatChunk = createPngChunk('IDAT', compressedData)

  // IEND chunk
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk])
}

/** 重新组装 PNG，插入 tEXt chunk */
function assemblePng(originalPng: Buffer, textChunk: Buffer): Buffer {
  const chunks: Buffer[] = []

  // 保留 PNG 签名
  chunks.push(originalPng.slice(0, 8))

  let offset = 8
  let inserted = false

  // 遍历原始 PNG chunks
  while (offset < originalPng.length) {
    const length = originalPng.readUInt32BE(offset)
    const type = originalPng.toString('ascii', offset + 4, offset + 8)

    // 在 IEND 之前插入 tEXt chunk
    if (type === 'IEND' && !inserted) {
      chunks.push(textChunk)
      inserted = true
    }

    // 保留原始 chunk
    chunks.push(originalPng.slice(offset, offset + 12 + length))

    offset += 12 + length
  }

  return Buffer.concat(chunks)
}

/** 导出角色卡（自动选择格式） */
export function exportCard(
  cardId: string,
  options: CardExportOptions
): { success: boolean; filePath?: string; error?: string } {
  const card = readCard(cardId)
  if (!card) {
    return {
      success: false,
      error: '角色卡不存在',
    }
  }

  switch (options.format) {
    case 'json':
      return exportToJson(card, options.outputPath)
    case 'png':
      return exportToPng(card, options.pngTemplatePath, options.outputPath)
    default:
      return {
        success: false,
        error: `不支持的导出格式: ${options.format}`,
      }
  }
}

/** 批量导出角色卡 */
export function exportMultipleCards(
  cardIds: string[],
  options: CardExportOptions
): { success: boolean; results: Array<{ cardId: string; filePath?: string; error?: string }> } {
  const results: Array<{ cardId: string; filePath?: string; error?: string }> = []
  let allSuccess = true

  for (const cardId of cardIds) {
    const result = exportCard(cardId, options)
    results.push({
      cardId,
      filePath: result.filePath,
      error: result.error,
    })

    if (!result.success) {
      allSuccess = false
    }
  }

  return {
    success: allSuccess,
    results,
  }
}

/** 导出角色卡及其资产 */
export function exportCardWithAssets(
  cardId: string,
  outputPath?: string
): { success: boolean; zipPath?: string; error?: string } {
  try {
    const card = readCard(cardId)
    if (!card) {
      return {
        success: false,
        error: '角色卡不存在',
      }
    }

    const outputDir = outputPath || path.join(process.cwd(), 'exports')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // 创建临时目录
    const tempDir = path.join(outputDir, `temp_${cardId}`)
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // 导出角色卡 JSON
    const cardJson = JSON.stringify(convertToSillyTavernV3(card), null, 2)
    fs.writeFileSync(path.join(tempDir, 'card.json'), cardJson, 'utf-8')

    // 复制资产
    const assetsDir = getCardAssetsDir(cardId)
    if (fs.existsSync(assetsDir)) {
      const tempAssetsDir = path.join(tempDir, 'assets')
      if (!fs.existsSync(tempAssetsDir)) {
        fs.mkdirSync(tempAssetsDir, { recursive: true })
      }

      const files = fs.readdirSync(assetsDir)
      for (const file of files) {
        const srcPath = path.join(assetsDir, file)
        const destPath = path.join(tempAssetsDir, file)
        fs.copyFileSync(srcPath, destPath)
      }
    }

    // 创建 README
    const readme = `# ${card.name}

**创建者**: ${card.creator}
**版本**: ${card.version}
**导入时间**: ${card.metadata.importedAt}

## 描述
${card.description || '无描述'}

## 标签
${card.tags.length > 0 ? card.tags.join(', ') : '无标签'}

## 使用方法
1. 将 card.json 导入到 SillyTavern 或 AweeClaw
2. 将 assets 目录中的文件放在对应位置
`
    fs.writeFileSync(path.join(tempDir, 'README.md'), readme, 'utf-8')

    logger.system.info('[CardSerializer] Card exported with assets:', tempDir)

    return {
      success: true,
      zipPath: tempDir,
    }
  } catch (err) {
    logger.system.error('[CardSerializer] Failed to export card with assets:', err)
    return {
      success: false,
      error: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
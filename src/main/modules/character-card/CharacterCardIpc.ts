/**
 * 角色卡 IPC 处理器（主进程）
 *
 * 通道清单：
 * - character-card:import-card           导入角色卡
 * - character-card:export-card           导出角色卡
 * - character-card:get-card              获取角色卡
 * - character-card:get-all-cards         获取所有角色卡
 * - character-card:update-card           更新角色卡
 * - character-card:delete-card           删除角色卡
 * - character-card:query-cards           查询角色卡
 * - character-card:get-storage-stats     获取存储统计
 * - character-card:backup-card           备份角色卡
 * - character-card:restore-card          恢复角色卡
 * - character-card:validate-card         验证角色卡
 * - character-card:export-card-with-assets 导出角色卡及资产
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` / `{ success:false, error }`。
 *
 * @module character-card/CharacterCardIpc
 */

import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import {
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
} from './CharacterCardStore'
import { parseCardFile, validateCardData, isCharacterCardFile } from './CardParser'
import { exportCard, exportCardWithAssets } from './CardSerializer'
import { validateMappingResult, sanitizeCardData } from './CardFieldMapper'
import { DEFAULT_PARSER_CONFIG } from './types'
import type {
  CardExportOptions,
  CardQueryOptions,
  CardUpdateOptions,
} from './types'

/** 是否已注册 */
let registered = false

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 注册角色卡 IPC（幂等） */
export function registerCharacterCardIpc(): void {
  if (registered) return
  registered = true

  // 初始化存储目录
  initializeStorage()

  // --------------------------------------------
  // 导入
  // --------------------------------------------
  safeIpcHandle('character-card:import-card', async (_event, params: unknown) => {
    const { filePath, config } = params as { filePath: string; config?: typeof DEFAULT_PARSER_CONFIG }

    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }

      // 检查是否为角色卡文件
      if (!isCharacterCardFile(filePath)) {
        return { success: false, error: '不是有效的角色卡文件' }
      }

      // 解析角色卡
      const result = parseCardFile(filePath, config)

      if (!result.success || !result.card) {
        return { success: false, error: result.errors.join('; ') }
      }

      // 清理数据
      const sanitizedCard = sanitizeCardData(result.card)

      // 验证映射结果
      const validation = validateMappingResult(sanitizedCard)
      if (!validation.valid) {
        return { success: false, error: validation.errors.join('; ') }
      }

      // 保存角色卡
      saveCard(sanitizedCard)

      logger.system.info('[CharacterCard] Card imported:', sanitizedCard.id, sanitizedCard.name)

      return {
        success: true,
        data: {
          card: sanitizedCard,
          warnings: [...result.warnings, ...validation.warnings],
        },
      }
    } catch (err) {
      logger.system.error('[CharacterCard] import-card failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 导出
  // --------------------------------------------
  safeIpcHandle('character-card:export-card', async (_event, params: unknown) => {
    const { cardId, options } = params as { cardId: string; options: CardExportOptions }

    try {
      const result = exportCard(cardId, options)
      return result
    } catch (err) {
      logger.system.error('[CharacterCard] export-card failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('character-card:export-card-with-assets', async (_event, params: unknown) => {
    const { cardId, outputPath } = params as { cardId: string; outputPath?: string }

    try {
      const result = exportCardWithAssets(cardId, outputPath)
      return result
    } catch (err) {
      logger.system.error('[CharacterCard] export-card-with-assets failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 查询
  // --------------------------------------------
  safeIpcHandle('character-card:get-card', async (_event, params: unknown) => {
    const { cardId } = params as { cardId: string }

    try {
      const card = readCard(cardId)
      if (!card) {
        return { success: false, error: '角色卡不存在' }
      }
      return { success: true, data: card }
    } catch (err) {
      logger.system.error('[CharacterCard] get-card failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('character-card:get-all-cards', async () => {
    try {
      const cards = getAllCards()
      return { success: true, data: cards }
    } catch (err) {
      logger.system.error('[CharacterCard] get-all-cards failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('character-card:query-cards', async (_event, params: unknown) => {
    const options = params as CardQueryOptions

    try {
      const cards = queryCards(options)
      return { success: true, data: cards }
    } catch (err) {
      logger.system.error('[CharacterCard] query-cards failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 更新
  // --------------------------------------------
  safeIpcHandle('character-card:update-card', async (_event, params: unknown) => {
    const { cardId, updates } = params as { cardId: string; updates: CardUpdateOptions }

    try {
      const updatedCard = updateCard(cardId, updates)
      if (!updatedCard) {
        return { success: false, error: '角色卡不存在或更新失败' }
      }
      return { success: true, data: updatedCard }
    } catch (err) {
      logger.system.error('[CharacterCard] update-card failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 删除
  // --------------------------------------------
  safeIpcHandle('character-card:delete-card', async (_event, params: unknown) => {
    const { cardId } = params as { cardId: string }

    try {
      const success = deleteCard(cardId)
      if (!success) {
        return { success: false, error: '删除失败' }
      }
      return { success: true, data: { deleted: true } }
    } catch (err) {
      logger.system.error('[CharacterCard] delete-card failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 备份与恢复
  // --------------------------------------------
  safeIpcHandle('character-card:backup-card', async (_event, params: unknown) => {
    const { cardId } = params as { cardId: string }

    try {
      const backupPath = backupCard(cardId)
      if (!backupPath) {
        return { success: false, error: '备份失败' }
      }
      return { success: true, data: { backupPath } }
    } catch (err) {
      logger.system.error('[CharacterCard] backup-card failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('character-card:restore-card', async (_event, params: unknown) => {
    const { backupPath } = params as { backupPath: string }

    try {
      const result = restoreCard(backupPath)
      return result
    } catch (err) {
      logger.system.error('[CharacterCard] restore-card failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 验证
  // --------------------------------------------
  safeIpcHandle('character-card:validate-card', async (_event, params: unknown) => {
    const { data } = params as { data: unknown }

    try {
      const result = validateCardData(data)
      return { success: true, data: result }
    } catch (err) {
      logger.system.error('[CharacterCard] validate-card failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 统计
  // --------------------------------------------
  safeIpcHandle('character-card:get-storage-stats', async () => {
    try {
      const stats = getStorageStats()
      return { success: true, data: stats }
    } catch (err) {
      logger.system.error('[CharacterCard] get-storage-stats failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 工具
  // --------------------------------------------
  safeIpcHandle('character-card:check-card-exists', async (_event, params: unknown) => {
    const { cardId } = params as { cardId: string }

    try {
      const exists = cardExists(cardId)
      return { success: true, data: { exists } }
    } catch (err) {
      logger.system.error('[CharacterCard] check-card-exists failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('character-card:generate-id', async () => {
    try {
      const id = generateCardId()
      return { success: true, data: { id } }
    } catch (err) {
      logger.system.error('[CharacterCard] generate-id failed:', err)
      return fail(err)
    }
  })

  logger.system.info('[CharacterCard] IPC handlers registered')
}

/** 注销角色卡 IPC */
export function unregisterCharacterCardIpc(): void {
  // 注意：safeIpcHandle 不提供注销机制，但可以通过 registered 标志避免重复注册
  registered = false
  logger.system.info('[CharacterCard] IPC handlers unregistered')
}
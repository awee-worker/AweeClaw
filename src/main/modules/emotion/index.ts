/**
 * 表情包管理模块
 *
 * 功能：
 * 1. 管理全局表情包资产
 * 2. 支持角色卡资产中的表情包
 * 3. 提供表情包查询接口
 * 4. 支持自定义协议加载本地表情包
 *
 * @module emotion
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'

// ============================================
// 常量
// ============================================

const EMOTION_DIR_NAME = 'emotions'
const EMOTION_CONFIG_FILE = 'emotions.json'

/** 模块数据目录 */
export function getEmotionDataDir(): string {
  return path.join(app.getPath('userData'), EMOTION_DIR_NAME)
}

/** 配置文件路径 */
export function getEmotionConfigPath(): string {
  return path.join(getEmotionDataDir(), EMOTION_CONFIG_FILE)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[Emotion] ensureDir failed:', dir, err)
  }
}

// ============================================
// 表情包管理
// ============================================

interface EmotionAsset {
  id: string
  name: string
  file_path: string
  category?: string
  tags?: string[]
  created_at: string
}

interface EmotionConfig {
  emotions: EmotionAsset[]
  last_updated: string
}

/** 读取表情包配置 */
function readEmotionConfig(): EmotionConfig {
  const configPath = getEmotionConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(raw) as EmotionConfig
    }
  } catch (err) {
    logger.system.warn('[Emotion] Failed to read config:', err)
  }
  return { emotions: [], last_updated: new Date().toISOString() }
}

/** 写入表情包配置 */
function writeEmotionConfig(config: EmotionConfig): void {
  const configPath = getEmotionConfigPath()
  ensureDir(path.dirname(configPath))
  try {
    config.last_updated = new Date().toISOString()
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[Emotion] Failed to write config:', err)
    throw err
  }
}

/** 获取表情包 */
export function getEmotion(name: string): EmotionAsset | null {
  const config = readEmotionConfig()
  return config.emotions.find(e => e.name === name) || null
}

/** 获取所有表情包 */
export function getAllEmotions(): EmotionAsset[] {
  const config = readEmotionConfig()
  return config.emotions
}

/** 添加表情包 */
export function addEmotion(emotion: Omit<EmotionAsset, 'id' | 'created_at'>): EmotionAsset {
  const config = readEmotionConfig()

  // 检查是否已存在
  const existing = config.emotions.find(e => e.name === emotion.name)
  if (existing) {
    throw new Error(`Emotion "${emotion.name}" already exists`)
  }

  const newEmotion: EmotionAsset = {
    ...emotion,
    id: `emotion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    created_at: new Date().toISOString(),
  }

  config.emotions.push(newEmotion)
  writeEmotionConfig(config)

  return newEmotion
}

/** 更新表情包 */
export function updateEmotion(name: string, updates: Partial<EmotionAsset>): EmotionAsset | null {
  const config = readEmotionConfig()
  const index = config.emotions.findIndex(e => e.name === name)

  if (index === -1) {
    return null
  }

  config.emotions[index] = { ...config.emotions[index], ...updates }
  writeEmotionConfig(config)

  return config.emotions[index]
}

/** 删除表情包 */
export function deleteEmotion(name: string): boolean {
  const config = readEmotionConfig()
  const index = config.emotions.findIndex(e => e.name === name)

  if (index === -1) {
    return false
  }

  // 删除文件
  const emotion = config.emotions[index]
  if (fs.existsSync(emotion.file_path)) {
    try {
      fs.unlinkSync(emotion.file_path)
    } catch (err) {
      logger.system.warn('[Emotion] Failed to delete file:', err)
    }
  }

  config.emotions.splice(index, 1)
  writeEmotionConfig(config)

  return true
}

/** 导入表情包文件 */
export function importEmotionFile(filePath: string, name?: string): EmotionAsset {
  const dataDir = getEmotionDataDir()
  ensureDir(dataDir)

  // 验证文件存在
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found')
  }

  // 验证文件类型
  const ext = path.extname(filePath).toLowerCase()
  const supportedFormats = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
  if (!supportedFormats.includes(ext)) {
    throw new Error(`Unsupported file format: ${ext}`)
  }

  // 生成文件名
  const fileName = name
    ? `${name}${ext}`
    : `emotion_${Date.now()}${ext}`

  const destPath = path.join(dataDir, fileName)

  // 复制文件
  fs.copyFileSync(filePath, destPath)

  // 添加到配置
  const emotionName = name || path.basename(filePath, ext)
  const emotion = addEmotion({
    name: emotionName,
    file_path: destPath,
    category: 'custom',
    tags: [],
  })

  return emotion
}

// ============================================
// IPC 注册
// ============================================

/** 是否已注册 */
let registered = false

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 注册表情包 IPC（幂等） */
export function registerEmotionIpc(): void {
  if (registered) return
  registered = true

  // 初始化存储目录
  ensureDir(getEmotionDataDir())

  // 获取表情包
  safeIpcHandle('emotion:get-emotion', async (_event, params: unknown) => {
    const { name } = params as { name: string }

    try {
      const emotion = getEmotion(name)
      if (!emotion) {
        return { success: false, error: 'Emotion not found' }
      }
      return { success: true, data: emotion }
    } catch (err) {
      return fail(err)
    }
  })

  // 获取所有表情包
  safeIpcHandle('emotion:get-all-emotions', async () => {
    try {
      const emotions = getAllEmotions()
      return { success: true, data: emotions }
    } catch (err) {
      return fail(err)
    }
  })

  // 添加表情包
  safeIpcHandle('emotion:add-emotion', async (_event, params: unknown) => {
    const emotionData = params as Omit<EmotionAsset, 'id' | 'created_at'>

    try {
      const emotion = addEmotion(emotionData)
      return { success: true, data: emotion }
    } catch (err) {
      return fail(err)
    }
  })

  // 更新表情包
  safeIpcHandle('emotion:update-emotion', async (_event, params: unknown) => {
    const { name, updates } = params as { name: string; updates: Partial<EmotionAsset> }

    try {
      const emotion = updateEmotion(name, updates)
      if (!emotion) {
        return { success: false, error: 'Emotion not found' }
      }
      return { success: true, data: emotion }
    } catch (err) {
      return fail(err)
    }
  })

  // 删除表情包
  safeIpcHandle('emotion:delete-emotion', async (_event, params: unknown) => {
    const { name } = params as { name: string }

    try {
      const success = deleteEmotion(name)
      if (!success) {
        return { success: false, error: 'Emotion not found' }
      }
      return { success: true, data: { deleted: true } }
    } catch (err) {
      return fail(err)
    }
  })

  // 导入表情包文件
  safeIpcHandle('emotion:import-file', async (_event, params: unknown) => {
    const { filePath, name } = params as { filePath: string; name?: string }

    try {
      const emotion = importEmotionFile(filePath, name)
      return { success: true, data: emotion }
    } catch (err) {
      return fail(err)
    }
  })

  logger.system.info('[Emotion] IPC handlers registered')
}

/** 注销表情包 IPC */
export function unregisterEmotionIpc(): void {
  registered = false
  logger.system.info('[Emotion] IPC handlers unregistered')
}

// ============================================
// 模块初始化
// ============================================

/**
 * 初始化表情包模块
 *
 * 在主进程启动时调用，注册 IPC 处理器。
 */
export function initializeEmotionModule(): void {
  registerEmotionIpc()
  console.log('[Emotion] 模块初始化完成')
}

/**
 * 清理表情包模块
 *
 * 在应用退出时调用，释放资源。
 */
export async function cleanupEmotionModule(): Promise<void> {
  try {
    // 目前没有需要清理的资源
    console.log('[Emotion] 模块清理完成')
  } catch (error) {
    console.error('[Emotion] 模块清理失败:', error)
  }
}
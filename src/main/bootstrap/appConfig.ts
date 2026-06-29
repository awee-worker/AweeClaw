/**
 * 应用配置文件管理
 *
 * 首次启动时在 {userData}/.aweeclaw/ 下创建 aweeclaw-config.json，
 * 包含服务端地址等基础信息。该文件独立于 electron-store，便于运维直接修改。
 */
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { getUserConfigDir } from '../modules/configPath'

const CONFIG_DIR_NAME = '.aweeclaw'
const CONFIG_FILE_NAME = 'aweeclaw-config.json'
const DEFAULT_SERVER_URL = 'https://gateway.aweeclaw.com'

/** 确保应用配置文件存在，不存在则写入默认值 */
export function ensureAppConfig(): void {
  try {
    const configDir = path.join(getUserConfigDir(), CONFIG_DIR_NAME)
    const configPath = path.join(configDir, CONFIG_FILE_NAME)

    if (fs.existsSync(configPath)) return

    fs.mkdirSync(configDir, { recursive: true })
    const defaultConfig = { serverUrl: DEFAULT_SERVER_URL }
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
    logger.system.info('[AppConfig] Created default config:', configPath)
  } catch (err) {
    logger.system.warn('[AppConfig] Failed to create config:', err)
  }
}

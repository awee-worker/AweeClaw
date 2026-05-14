/**
 * Skills IPC 处理器
 * 提供全局 Skills 目录路径等功能
 */

import * as path from 'path'
import * as fs from 'fs'
import { safeIpcHandle } from './safeHandle'
import { logger } from '@shared/utils/Logger'
import { getUserConfigDir } from '../services/configPath'
import { securityManager } from '../security/securityModule'

export function registerSkillsHandlers(): void {
  const globalSkillsDir = path.join(getUserConfigDir(), 'skills')

  securityManager.addAllowedAppPath(globalSkillsDir)

  fs.promises.mkdir(globalSkillsDir, { recursive: true }).catch(() => {})

  safeIpcHandle('skills:getGlobalDir', async () => {
    await fs.promises.mkdir(globalSkillsDir, { recursive: true })
    return globalSkillsDir
  })

  logger.ipc.info('[Skills IPC] Handlers registered')
}

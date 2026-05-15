/**
 * Skills IPC 处理器
 * 提供全局 Skills 目录路径等功能
 */

import * as path from 'path'
import * as fs from 'fs'
import { safeIpcHandle } from './ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getUserConfigDir } from '../modules/configPath'
import { securityManager } from '../guard/securityPolicyEngine'

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

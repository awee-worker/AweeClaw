/**
 * Skills 注册表 — 全局技能目录管理
 *
 * 职责：
 * - 暴露全局 Skills 目录路径查询 IPC 接口
 * - 自动创建用户级 Skills 目录
 * - 将 Skills 目录注册到安全白名单，允许 Agent 访问
 */

import * as path from 'path'
import * as fs from 'fs'
import { safeIpcHandle } from '../core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getUserConfigDir } from '../../modules/configPath'
import { securityManager } from '../../guard/securityPolicyEngine'

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

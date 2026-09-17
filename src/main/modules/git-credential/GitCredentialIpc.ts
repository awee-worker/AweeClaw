/**
 * Git 凭证 IPC 通道（主进程）
 *
 * 通道清单（均通过 safeIpcHandle 注册，异常被统一包装）：
 *   git:credential:list    列出已存凭证（掩码，无明文）
 *   git:credential:save    保存凭证（remember=true 时加密落盘，否则仅会话有效）
 *   git:credential:remove  删除指定主机的凭证
 *   git:credential:clear   清空全部凭证
 *   git:credential:has     查询指定主机是否已有可用凭证
 *
 * 安全说明：
 * - 明文密钥只入不出：save 请求携带明文，但任何响应都不回传明文
 * - 长度与类型强校验，避免渲染进程被注入后写入超大 / 畸形数据
 *
 * @module git-credential/GitCredentialIpc
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { gitCredentialStore, normalizeHost, resolveProtocol } from './GitCredentialStore'
import type { GitCredentialInput, GitCredentialProtocol } from './types'

const MAX_HOST_LENGTH = 255
const MAX_USERNAME_LENGTH = 256
const MAX_SECRET_LENGTH = 8192

interface CredentialSaveResponse {
  success: boolean
  host?: string
  username?: string
  error?: string
}

function isValidProtocol(value: unknown): value is GitCredentialProtocol {
  return value === 'https' || value === 'http' || value === 'ssh'
}

/** 幂等保护：重复注册会导致 ipcMain 抛错 */
let registered = false

export function registerGitCredentialIpc(): void {
  if (registered) return
  registered = true

  safeIpcHandle('git:credential:list', async () => {
    return { success: true, credentials: gitCredentialStore.list() }
  })

  safeIpcHandle('git:credential:save', async (_event, input: GitCredentialInput): Promise<CredentialSaveResponse> => {
    const rawHost = typeof input?.host === 'string' ? input.host.trim() : ''
    const username = typeof input?.username === 'string' ? input.username.trim() : ''
    const secret = typeof input?.secret === 'string' ? input.secret : ''

    if (!rawHost) return { success: false, error: 'host is required' }
    if (rawHost.length > MAX_HOST_LENGTH) return { success: false, error: 'host too long' }
    if (username.length > MAX_USERNAME_LENGTH) return { success: false, error: 'username too long' }
    if (secret.length > MAX_SECRET_LENGTH) return { success: false, error: 'secret too long' }
    if (!secret) return { success: false, error: 'secret is required' }

    const protocol = isValidProtocol(input?.protocol) ? input.protocol : resolveProtocol(rawHost)
    if (protocol === 'ssh') {
      return { success: false, error: 'ssh 凭证请使用 SSH Key，本模块只处理 http(s) 账号密码' }
    }

    const saved = gitCredentialStore.save({
      host: rawHost,
      username,
      secret,
      remember: input?.remember === true,
      protocol,
    })

    if (!saved) return { success: false, error: 'invalid host' }

    logger.system.info(`[GitCredential] 已保存凭证: ${saved.host} (remember=${saved.remember})`)
    return { success: true, host: saved.host, username: saved.username }
  })

  safeIpcHandle('git:credential:remove', async (_event, host: string) => {
    const target = typeof host === 'string' ? host : ''
    if (!target) return { success: false, error: 'host is required' }
    const removed = gitCredentialStore.remove(target)
    return { success: removed }
  })

  safeIpcHandle('git:credential:clear', async () => {
    gitCredentialStore.clear()
    return { success: true }
  })

  safeIpcHandle('git:credential:has', async (_event, host: string) => {
    const target = normalizeHost(typeof host === 'string' ? host : '')
    return { success: true, has: target ? gitCredentialStore.has(target) : false }
  })
}

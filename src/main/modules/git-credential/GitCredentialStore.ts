/**
 * Git 凭证存储（主进程）
 *
 * 存储布局：
 *   <userData>/git/git_credentials.json
 *
 * 安全约定：
 * - `secret`（密码 / Personal Access Token）落盘前由 safeStorage 加密（enc:v1: 前缀）
 * - safeStorage 不可用时（Linux 无 libsecret）降级为明文并打印安全告警 —— 与 VtsStore /
 *   LiveStore / OpenApiStore 保持一致，不额外造轮子
 * - 渲染进程永远拿不到明文：`list()` 只返回掩码，明文仅在主进程执行 git 时注入环境变量
 *
 * 会话凭证（用户未勾选「记住」）只存在于主进程内存，进程退出即失效。
 *
 * @module git-credential/GitCredentialStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { decryptString, encryptString } from '../../guard/safeStorageUtil'
import type {
  GitCredentialInput,
  GitCredentialProtocol,
  GitCredentialPublic,
  GitCredentialRecord,
  GitSessionCredential,
} from './types'

const GIT_DIR_NAME = 'git'
const CREDENTIAL_FILE_NAME = 'git_credentials.json'
const FILE_VERSION = 1

interface CredentialFile {
  version: number
  credentials: Record<string, GitCredentialRecord>
}

/**
 * 从 remote URL 中解析主机名
 *
 * 支持三类写法：
 * - https://github.com/user/repo.git      → github.com
 * - https://user@gitlab.com:8443/a/b.git  → gitlab.com:8443（含非默认端口）
 * - git@github.com:user/repo.git          → github.com（scp-like 语法，无协议头）
 */
export function normalizeHost(raw: string): string {
  const value = (raw || '').trim()
  if (!value) return ''

  // scp-like：git@host:path（无 "://"）
  if (!value.includes('://')) {
    const scpMatch = value.match(/^(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?[:/]/)
    if (scpMatch) return scpMatch[1].toLowerCase()
    // 纯 host 字符串
    return value.replace(/^\/+|\/+$/g, '').toLowerCase()
  }

  try {
    const url = new URL(value)
    return url.host.toLowerCase()
  } catch {
    const hostMatch = value.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/?#]+)/i)
    return hostMatch ? hostMatch[1].toLowerCase() : ''
  }
}

/** 从 remote URL 推断协议 */
export function resolveProtocol(raw: string): GitCredentialProtocol {
  const value = (raw || '').trim().toLowerCase()
  if (value.startsWith('http://')) return 'http'
  if (value.startsWith('https://')) return 'https'
  if (!value || value.startsWith('git@') || value.startsWith('ssh://')) return 'ssh'
  return 'https'
}

/** 该 host 是否需要账号密码（ssh 走密钥，不需要） */
export function hostNeedsCredential(host: string, protocol: GitCredentialProtocol): boolean {
  return protocol !== 'ssh' && host.length > 0
}

function maskSecret(secret: string): string {
  if (!secret) return ''
  return '••••••••'
}

class GitCredentialStore {
  private cache: CredentialFile | null = null
  /** 会话级凭证（未勾选记住），不落盘 */
  private sessionCredentials = new Map<string, GitSessionCredential>()

  getDataDir(): string {
    return path.join(app.getPath('userData'), GIT_DIR_NAME)
  }

  getFilePath(): string {
    return path.join(this.getDataDir(), CREDENTIAL_FILE_NAME)
  }

  private ensureDir(): void {
    try {
      const dir = this.getDataDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      logger.system.warn('[GitCredential] ensureDir failed:', err)
    }
  }

  private load(): CredentialFile {
    if (this.cache) return this.cache

    const filePath = this.getFilePath()
    let parsed: CredentialFile | null = null
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw) as Partial<CredentialFile>
        if (data && typeof data === 'object' && data.credentials && typeof data.credentials === 'object') {
          parsed = {
            version: typeof data.version === 'number' ? data.version : FILE_VERSION,
            credentials: data.credentials as Record<string, GitCredentialRecord>,
          }
        }
      }
    } catch (err) {
      logger.system.warn('[GitCredential] 读取凭证文件失败，按空处理:', err)
    }

    this.cache = parsed ?? { version: FILE_VERSION, credentials: {} }
    return this.cache
  }

  private persist(): void {
    if (!this.cache) return
    try {
      this.ensureDir()
      fs.writeFileSync(this.getFilePath(), JSON.stringify(this.cache, null, 2), 'utf-8')
      // 凭证文件按用户可读可写、其余不可见收敛权限（POSIX 生效）
      try {
        fs.chmodSync(this.getFilePath(), 0o600)
      } catch { /* Windows 上忽略 */ }
    } catch (err) {
      logger.system.error('[GitCredential] 写入凭证文件失败:', err)
    }
  }

  /** 凭证列表（掩码，供设置页展示） */
  list(): GitCredentialPublic[] {
    const file = this.load()
    const stored = Object.values(file.credentials).map<GitCredentialPublic>((record) => ({
      host: record.host,
      protocol: record.protocol,
      username: record.username,
      secretMask: maskSecret(record.secret),
      remember: record.remember,
      updatedAt: record.updatedAt,
    }))
    // 会话凭证一并列出（标记 remember=false，UI 可提示「本次会话有效」）
    const session = Array.from(this.sessionCredentials.values())
      .filter((item) => !file.credentials[item.host])
      .map<GitCredentialPublic>((item) => ({
        host: item.host,
        protocol: item.protocol,
        username: item.username,
        secretMask: maskSecret(item.secret),
        remember: false,
        updatedAt: Date.now(),
      }))
    return [...stored, ...session].sort((a, b) => a.host.localeCompare(b.host))
  }

  /**
   * 解析可用于注入的凭证（明文，仅主进程内部使用）
   *
   * 优先级：会话凭证 → 落盘凭证
   */
  resolve(hostOrUrl: string): GitSessionCredential | null {
    const host = normalizeHost(hostOrUrl)
    if (!host) return null

    const session = this.sessionCredentials.get(host)
    if (session) return session

    const file = this.load()
    const record = file.credentials[host]
    if (!record || !record.username) return null

    try {
      return {
        host,
        username: record.username,
        secret: decryptString(record.secret),
        protocol: record.protocol,
      }
    } catch (err) {
      logger.system.warn('[GitCredential] 解密凭证失败:', err)
      return null
    }
  }

  /** 保存凭证；remember=false 时只写内存会话 */
  save(input: GitCredentialInput): GitCredentialPublic | null {
    const host = normalizeHost(input.host)
    if (!host) return null
    const protocol = input.protocol ?? resolveProtocol(input.host)
    const username = (input.username || '').trim()
    const secret = input.secret || ''
    const remember = input.remember === true

    if (!remember) {
      this.sessionCredentials.set(host, { host, username, secret, protocol })
      logger.system.info(`[GitCredential] 会话凭证已登记（不落盘）: ${host}`)
      return {
        host,
        protocol,
        username,
        secretMask: maskSecret(secret),
        remember: false,
        updatedAt: Date.now(),
      }
    }

    const file = this.load()
    const now = Date.now()
    const existing = file.credentials[host]
    const record: GitCredentialRecord = {
      host,
      protocol,
      username,
      secret: encryptString(secret),
      remember: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    file.credentials[host] = record
    this.cache = file
    this.persist()
    this.sessionCredentials.delete(host)
    logger.system.info(`[GitCredential] 凭证已加密落盘: ${host}`)

    return {
      host,
      protocol,
      username,
      secretMask: maskSecret(record.secret),
      remember: true,
      updatedAt: now,
    }
  }

  /** 删除凭证（落盘 + 会话） */
  remove(hostOrUrl: string): boolean {
    const host = normalizeHost(hostOrUrl)
    if (!host) return false

    const sessionDeleted = this.sessionCredentials.delete(host)

    const file = this.load()
    if (file.credentials[host]) {
      delete file.credentials[host]
      this.cache = file
      this.persist()
      return true
    }
    return sessionDeleted
  }

  /** 清空全部凭证 */
  clear(): void {
    this.sessionCredentials.clear()
    this.cache = { version: FILE_VERSION, credentials: {} }
    this.persist()
  }

  /**
   * 是否存在可用凭证
   *
   * 用于判断「是否值得提示用户输入」：若已存凭证却仍失败，说明凭证过期，
   * 应提示用户重新输入而不是重复使用旧凭证。
   */
  has(hostOrUrl: string): boolean {
    const host = normalizeHost(hostOrUrl)
    if (!host) return false
    if (this.sessionCredentials.has(host)) return true
    return Boolean(this.load().credentials[host]?.username)
  }
}

export const gitCredentialStore = new GitCredentialStore()

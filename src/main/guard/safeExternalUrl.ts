/**
 * shell.openExternal 安全封装
 *
 * 防止协议注入攻击（如 file:///、javascript: 等），
 * 仅允许白名单协议通过 shell.openExternal 打开外部链接。
 */

import { shell } from 'electron'
import { exec } from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'

/** 允许通过 shell.openExternal 打开的协议白名单 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:']

/** 允许的域名白名单（用于 devtools:// 等特殊协议） */
const ALLOWED_SPECIAL_ORIGINS = ['devtools://']

/**
 * 校验 URL 是否属于允许的协议
 */
export function isUrlAllowed(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false

  // 清理 Markdown 残留符号
  const url = rawUrl
    .replace(/[*_~`#|]+$/g, '')
    .replace(/^[*_~`#|]+/g, '')
    .trim()

  if (!url) return false

  try {
    const parsed = new URL(url)
    // 白名单协议
    if (ALLOWED_PROTOCOLS.includes(parsed.protocol)) return true
    // 特殊来源
    if (ALLOWED_SPECIAL_ORIGINS.some((origin) => url.startsWith(origin))) return true
    return false
  } catch {
    // URL 解析失败，拒绝
    return false
  }
}

/**
 * 安全地打开外部链接
 *
 * 1. 校验协议白名单（http/https/mailto/devtools）
 * 2. 清理 Markdown 残留符号
 * 3. 调用 shell.openExternal，失败时回退到系统命令
 *
 * @returns 是否成功触发打开
 */
export async function safeOpenExternal(rawUrl: string): Promise<boolean> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    logger.security.warn('[SafeOpen] Rejected: empty or non-string URL')
    return false
  }

  // 清理 Markdown 残留符号
  const url = rawUrl
    .replace(/[*_~`#|]+$/g, '')
    .replace(/^[*_~`#|]+/g, '')
    .trim()

  if (!url) {
    logger.security.warn('[SafeOpen] Rejected: URL is empty after cleanup')
    return false
  }

  // 协议白名单校验
  if (!isUrlAllowed(url)) {
    logger.security.warn(`[SafeOpen] Rejected: disallowed protocol in URL: ${url.substring(0, 100)}`)
    return false
  }

  try {
    await shell.openExternal(url)
    return true
  } catch (e) {
    logger.system.warn('[SafeOpen] shell.openExternal failed, falling back to system command:', e)
    return openWithSystemCommand(url)
  }
}

/**
 * 系统命令回退打开
 */
function openWithSystemCommand(url: string): boolean {
  const escaped = url.replace(/"/g, '\\"')
  const cmd =
    process.platform === 'darwin'
      ? `open "${escaped}"`
      : process.platform === 'win32'
        ? `start "" "${escaped}"`
        : `xdg-open "${escaped}"`

  try {
    exec(cmd, (err) => {
      if (err) logger.system.warn('[SafeOpen] System fallback also failed:', url, err.message)
    })
    return true
  } catch (e) {
    logger.system.warn('[SafeOpen] System command exec failed:', e)
    return false
  }
}

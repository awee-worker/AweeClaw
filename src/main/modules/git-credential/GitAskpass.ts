/**
 * Git 凭证注入与认证失败识别（主进程）
 *
 * 为什么需要 askpass：
 *   git 在需要账号密码时会优先询问 credential helper，其次调用 GIT_ASKPASS 脚本，
 *   最后才是终端交互。Electron 主进程通过 dugite 执行 git 时没有可交互终端，
 *   因此必须提供 askpass 脚本来回答 git 的提问。
 *
 * 注入策略：
 *   1. 有凭证时 → 先 `-c credential.helper=` 清空 helper 链，再用 askpass 回答
 *      （否则系统 keychain 里的旧凭证会抢先被使用，导致用户新输入的密码"不生效"）
 *   2. 无凭证时 → 保留系统 helper，仅设 GIT_TERMINAL_PROMPT=0
 *      （让已配置了 keychain 的用户无需任何输入即可推送）
 *
 * 认证失败识别：
 *   `GIT_TERMINAL_PROMPT=0` 会让 git 在缺少凭证时立即失败而非挂起，
 *   我们据此把失败转成结构化的 `authRequired` 返回给渲染层 → 弹出凭证输入框。
 *
 * @module git-credential/GitAskpass
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

/** 需要网络认证的 git 子命令 */
const NETWORK_SUBCOMMANDS = new Set([
  'push',
  'pull',
  'fetch',
  'clone',
  'ls-remote',
  'remote', // remote add/set-url 本身不需要认证，但解析 host 时会用到
  'submodule',
  'archive',
])

/** 真正需要凭证的网络子命令（remote 仅是元数据操作，不触发认证） */
const AUTH_SUBCOMMANDS = new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote', 'submodule'])

export interface AskpassEnv {
  env: Record<string, string>
  /** 需要注入到 git 参数前的全局选项（清空 credential helper） */
  globalArgs: string[]
}

/**
 * 判断是否为需要网络访问的 git 命令
 */
export function isNetworkGitCommand(args: string[]): boolean {
  const sub = pickSubcommand(args)
  return sub ? NETWORK_SUBCOMMANDS.has(sub) : false
}

/**
 * 判断该命令是否可能触发凭证询问
 */
export function requiresAuth(args: string[]): boolean {
  const sub = pickSubcommand(args)
  return sub ? AUTH_SUBCOMMANDS.has(sub) : false
}

/** 跳过全局选项，取出真正的子命令 */
export function pickSubcommand(args: string[]): string | null {
  let idx = 0
  while (idx < args.length && args[idx].startsWith('-')) {
    if (args[idx] === '-c' || args[idx] === '-C') {
      idx += 2
    } else {
      idx += 1
    }
  }
  return idx < args.length ? args[idx].toLowerCase() : null
}

/**
 * 生成（或复用）askpass 脚本
 *
 * 只生成 .sh：Git for Windows 自带 sh，且 dugite 内置 git 在 Windows 上也通过
 * MSYS sh 执行 GIT_ASKPASS，POSIX 脚本跨平台一致（Windows 批处理的转义坑更多）。
 */
export function ensureAskpassScript(gitDir: string): string | null {
  const scriptPath = path.join(gitDir, 'askpass.sh')
  const content = [
    '#!/bin/sh',
    '# AweeClaw Git askpass —— 由主进程注入，凭证只通过环境变量传递，不落盘到脚本',
    'case "$1" in',
    '  Username*|username*) printf \'%s\\n\' "$AWEE_GIT_USERNAME" ;;',
    '  Password*|password*) printf \'%s\\n\' "$AWEE_GIT_PASSWORD" ;;',
    '  *) printf \'%s\\n\' "$AWEE_GIT_PASSWORD" ;;',
    'esac',
    '',
  ].join('\n')

  try {
    if (!fs.existsSync(gitDir)) fs.mkdirSync(gitDir, { recursive: true })
    const needWrite =
      !fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf-8') !== content
    if (needWrite) {
      fs.writeFileSync(scriptPath, content, { encoding: 'utf-8', mode: 0o700 })
    }
    try {
      fs.chmodSync(scriptPath, 0o700)
    } catch { /* Windows 忽略 */ }
    return scriptPath
  } catch (err) {
    logger.system.warn('[GitAskpass] 生成 askpass 脚本失败:', err)
    return null
  }
}

/**
 * 构建带凭证的 git 执行环境
 *
 * @param gitDir      git 数据目录（用于生成 askpass 脚本）
 * @param credential  凭证（明文，仅在主进程内存中存在）
 */
export function buildCredentialEnv(
  gitDir: string,
  credential: { username: string; secret: string },
): AskpassEnv | null {
  const scriptPath = ensureAskpassScript(gitDir)
  if (!scriptPath) return null

  return {
    env: {
      GIT_ASKPASS: scriptPath,
      // 禁止 git 打开终端提示：没有凭证时立即失败，由渲染层弹窗收集
      GIT_TERMINAL_PROMPT: '0',
      AWEE_GIT_USERNAME: credential.username || '',
      AWEE_GIT_PASSWORD: credential.secret || '',
    },
    // `credential.helper=`（空值）会重置 helper 列表，确保我们注入的凭证优先
    globalArgs: ['-c', 'credential.helper='],
  }
}

/** 无凭证时的基础环境：只禁用交互式提示，保留系统 keychain helper */
export function buildPromptlessEnv(): Record<string, string> {
  return { GIT_TERMINAL_PROMPT: '0' }
}

export interface AuthFailureInfo {
  /** 是否为「需要用户提供凭证」类失败 */
  authRequired: boolean
  /** 失败涉及的主机（可从错误信息里解析出来时） */
  host?: string
  /** 是否属于「该平台已禁用密码认证，必须用 Token」（仅 authRequired 时有意义） */
  tokenRequired?: boolean
  /** 面向用户的原始错误摘要 */
  message?: string
}

const AUTH_FAILURE_PATTERNS: RegExp[] = [
  /could not read Username/i,
  /could not read Password/i,
  /terminal prompts disabled/i,
  /Authentication failed/i,
  /Invalid username or password/i,
  /Invalid username or token/i,
  /HTTP Basic: Access denied/i,
  /fatal: Authentication failed/i,
  /could not authenticate/i,
  /Authentication required/i,
  /The requested URL returned error: 401/i,
  /The requested URL returned error: 403/i,
  /Support for password authentication was removed/i,
  /Password authentication is not supported/i,
  /remote: Invalid credentials/i,
  /Repository not found/i,
]

/** 这些失败与凭证无关（ssh key 缺失等），不应弹账号密码框 */
const NON_CREDENTIAL_PATTERNS: RegExp[] = [
  /Permission denied \(publickey\)/i,
  /Host key verification failed/i,
  /Could not resolve host/i,
  /Connection (timed out|refused)/i,
  /Network is unreachable/i,
  /SSL certificate problem/i,
]

const TOKEN_REQUIRED_PATTERNS: RegExp[] = [
  /Support for password authentication was removed/i,
  /Password authentication is not supported/i,
  /Invalid username or token/i,
]

/**
 * 从 git 错误输出中识别认证失败
 */
export function detectAuthFailure(stderr: string, stdout = ''): AuthFailureInfo {
  const text = `${stderr || ''}\n${stdout || ''}`
  if (!text.trim()) return { authRequired: false }

  if (NON_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { authRequired: false, message: firstLine(stderr) }
  }

  const matched = AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text))
  if (!matched) return { authRequired: false, message: firstLine(stderr) }

  return {
    authRequired: true,
    host: extractHostFromError(text) ?? undefined,
    tokenRequired: TOKEN_REQUIRED_PATTERNS.some((pattern) => pattern.test(text)),
    message: firstLine(stderr),
  }
}

/** 从错误文本中提取 URL / host（git 的报错里通常带完整 URL） */
export function extractHostFromError(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/([^/'"\s]+)/i)
  if (urlMatch) return urlMatch[1].toLowerCase()

  const scpMatch = text.match(/([A-Za-z0-9._-]+@[A-Za-z0-9.-]+)[:/]/)
  if (scpMatch) {
    const host = scpMatch[1].split('@')[1]
    if (host) return host.toLowerCase()
  }
  return null
}

/** 从命令行参数里提取 URL（clone / ls-remote 场景） */
export function extractUrlFromArgs(args: string[]): string | null {
  for (const arg of args) {
    if (/^https?:\/\//i.test(arg)) return arg
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(arg)) return arg
  }
  return null
}

/** 取错误信息首行（避免把整段 stack 塞给用户） */
function firstLine(text: string): string {
  const line = (text || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return line || ''
}

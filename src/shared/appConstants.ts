/**
 * 共享常量
 * 
 * 架构说明：
 * - 此文件只包含真正的常量（不可配置的值）
 * - 可配置的默认值在 config/defaults.ts
 * - 安全相关的模式匹配放在这里（不应该被用户修改）
 */

import { BRAND } from './brand'

// ==========================================
// 布局常量（UI 固定值，不需要用户配置）
// ==========================================

export const LAYOUT = {
  ACTIVITY_BAR_WIDTH: 48,
  SIDEBAR_MIN_WIDTH: 170,
  SIDEBAR_MAX_WIDTH: 600,
  SIDEBAR_DEFAULT_WIDTH: 175,
  CHAT_MIN_WIDTH: 460,
  CHAT_MAX_WIDTH: 880,
  CHAT_DEFAULT_WIDTH: 600,
} as const

// ==========================================
// 窗口默认值
// ==========================================

export const WINDOW_DEFAULTS = {
  WIDTH: 1600,
  HEIGHT: 1000,
  MIN_WIDTH: 960,
  MIN_HEIGHT: 640,
  BACKGROUND_COLOR: '#f5faff',
} as const

// ==========================================
// 安全相关常量（不可配置）
// ==========================================

/** 敏感文件/目录模式 - 禁止访问 */
export const SENSITIVE_PATH_PATTERNS = [
  // 系统目录 - Windows
  /^C:\\Windows/i,
  /^C:\\Program Files/i,
  /^C:\\Program Files \(x86\)/i,
  /^C:\\ProgramData/i,
  // 系统目录 - Unix
  /^\/etc\//i,
  /^\/var\//i,
  /^\/usr\//i,
  /^\/bin\//i,
  /^\/sbin\//i,
  /^\/root\//i,
  // 用户敏感目录
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.azure[/\\]/i,
  /[/\\]\.kube[/\\]/i,
  // 私钥文件
  /[/\\]id_rsa$/i,
  /[/\\]id_ed25519$/i,
] as const

/** 危险路径模式 - 目录遍历 */
export const DANGEROUS_PATH_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /\0/,
  /%2e%2e/i,
  /%252e%252e/i,
] as const

export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(normalized))
}

export function hasPathTraversal(path: string): boolean {
  return DANGEROUS_PATH_PATTERNS.some(pattern => pattern.test(path))
}

/** 受保护的应用数据目录名（工作区内的 .aweeclaw） */
export const PROTECTED_APP_DIR_NAME = BRAND.dirName

/** 删除类命令动词（覆盖 POSIX / Windows / PowerShell） */
const DELETE_VERB_PATTERN =
  /(?:^|[\s;&|()])(rm|rmdir|rd|del|erase|unlink|remove-item|ri)\b/i

/**
 * 路径是否位于受保护的应用数据目录（.aweeclaw）内（含目录本身）
 *
 * 该目录存储项目配置、记忆、索引等核心数据，禁止删除及破坏性操作。
 */
export function isProtectedAppDirPath(targetPath: string): boolean {
  if (!targetPath) return false
  const normalized = targetPath.replace(/\\/g, '/')
  return normalized.split('/').includes(PROTECTED_APP_DIR_NAME)
}

/**
 * 命令是否为删除受保护应用目录（.aweeclaw）及其内容的操作
 *
 * 用于主进程安全底线静默拦截：命中即拒绝执行且不弹窗，
 * 避免 AI 自主执行任务时频繁误触打扰用户。
 */
export function isProtectedAppDirDeletion(command: string): boolean {
  if (!command) return false
  if (!command.includes(PROTECTED_APP_DIR_NAME)) return false
  return DELETE_VERB_PATTERN.test(command)
}

/**
 * Shell 命令安全配置
 *
 * - SHELL_COMMANDS: 旧版白名单（保留以兼容已安装版本，不再用于校验）
 * - DENIED_SHELL_COMMANDS: 黑名单默认值，命中即禁止执行
 * - GIT_SUBCOMMANDS: Git 子命令白名单（仍用于 git:execSecure 校验）
 */
export const SECURITY_DEFAULTS = {
  SHELL_COMMANDS: [
    'npm', 'yarn', 'pnpm', 'bun',
    'node', 'npx', 'deno',
    'eslint', 'tsc',
    'git',
    'python', 'python3', 'pip', 'pip3', 'uv',
    'java', 'javac', 'mvn', 'gradle',
    'go', 'rust', 'cargo',
    'make', 'gcc', 'clang', 'cmake',
    'pwd', 'ls', 'dir', 'cat', 'type', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'cd',
    'open', 'find',
  ],
  // 默认 Shell 命令黑名单：仅包含具有破坏性/提权/系统级影响的命令。
  // 注意：curl/wget 等网络命令不放入默认黑名单（已由 DANGEROUS_PATTERNS 防御 curl|sh 等危险用法）
  DENIED_SHELL_COMMANDS: [
    // 'rm', 'rmdir', 'del', 'erase',   // 删除
    'format', 'mkfs', 'fdisk',        // 磁盘格式化
    // 'sudo', 'su', 'doas',             // 提权
    // 'chmod', 'chown', 'chattr',       // 权限变更
    'shutdown', 'reboot', 'halt', 'poweroff',  // 关机重启
    'dd',                              // 块设备读写
    // 'systemctl', 'service',            // 系统服务控制
    // 'crontab',                         // 计划任务修改
  ],
  GIT_SUBCOMMANDS: [
    'status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'rev-list', 'blame',
    'add', 'commit', 'reset', 'restore',
    'push', 'pull', 'fetch', 'remote',
    'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick',
    'clone', 'init', 'stash', 'tag', 'config', 'symbolic-ref',
  ],
} as const

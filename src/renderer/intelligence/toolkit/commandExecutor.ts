import { platform as runtimePlatform } from '@shared/toolkit/pathHelper'

/**
 * 长运行命令匹配模式
 *
 * 包含两类：
 * 1. 持续运行的服务类命令（dev server、watch 等）— 永不退出
 * 2. 耗时较长的安装/构建命令（install、ci、build 等）— 可能耗时数分钟
 *    这类命令不作为后台进程，但需要更长的超时时间
 */
export const LONG_RUNNING_COMMAND_PATTERN = /^(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|watch)|python\s+-m\s+(http\.server|flask)|uvicorn|nodemon|webpack|vite/

/**
 * 安装/构建类耗时命令模式
 *
 * 这些命令不是持续运行的服务，但通常耗时较长（数十秒到数分钟），
 * 需要更长的超时时间。匹配后使用 EXTENDED_TIMEOUT_MS 作为超时。
 */
export const EXTENDED_TIMEOUT_COMMAND_PATTERN = /^(npm|yarn|pnpm|bun)\s+(install|ci|i|add|install-save|install-save-dev)\b|^(npm|yarn|pnpm|bun)\s+(run\s+)?(build|test|tsc|lint)\b|^(cargo|go)\s+(build|test|mod)\b|^make\b|^cmake\b/

/** 安装/构建类命令的扩展超时时间（5 分钟） */
export const EXTENDED_TIMEOUT_MS = 300000

export type InteractiveTerminalBackend = 'pty' | 'pipe'

const currentPlatform: NodeJS.Platform = runtimePlatform.isWindows ? 'win32' : runtimePlatform.isMac ? 'darwin' : 'linux'

export function isLongRunningCommand(command: string, isBackground = false): boolean {
  return Boolean(isBackground) || LONG_RUNNING_COMMAND_PATTERN.test(command.trim())
}

export function getInteractiveTerminalBackend(
  platform: NodeJS.Platform = currentPlatform,
): InteractiveTerminalBackend {
  return platform === 'darwin' ? 'pipe' : 'pty'
}

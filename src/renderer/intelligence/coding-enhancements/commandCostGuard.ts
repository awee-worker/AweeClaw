/**
 * 高代价命令预检（代码开发场景编程能力增强）
 *
 * 背景：全文件系统扫描、全仓类型检查、依赖安装等命令单次耗时可达数十秒，
 * 长会话中反复执行会累积大量浪费。本模块对已知高代价命令模式做识别，
 * 在命令结果头部附加降级建议 —— 只提示、不拦截，避免误伤合理操作；
 * 危险命令拦截仍由 ToolApprovalManager 硬门禁负责。
 *
 * 触发条件：
 * - 当前场景为代码开发（dev）且 commandCostGuard 开关开启；
 * - 工具为 run_command 且命令文本命中高代价模式。
 */

import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { getCodingEnhancements } from '../capabilities/sceneMode/SceneModeDescriptor'

type CostPattern = {
  /** 命令文本命中（不区分大小写） */
  match: RegExp
  /** 附加的降级建议 */
  hint: string
}

/**
 * 高代价命令模式映射表。
 * 按声明顺序匹配，先命中先用（一条命令只提示一次）。
 */
const COST_PATTERNS: CostPattern[] = [
  {
    // 全盘 / 根目录扫描：find / 或 grep -r 自系统根目录
    match: /\bfind\s+\/(?:\s|$)|\bgrep\s+(-\w+\s+)*-r\w*\s+\S*\s+\/(?:\s|$)/,
    hint: 'full-filesystem scan detected — prefer search_files scoped to the workspace, or narrow the search root.',
  },
  {
    // 全仓类型检查（无增量）：tsc --noEmit 且未带 incremental/tsbuildinfo
    match: /\btsc\b(?![^\n]*--incremental)[^\n]*--noEmit/,
    hint: 'full-project type check (no incremental) — scope to the touched package or reuse --incremental; the language server diagnostics (get_lint_errors) are usually enough.',
  },
  {
    // 全量构建
    match: /\bnpm\s+run\s+build\b|\byarn\s+build\b|\bpnpm\s+build\b/,
    hint: 'full build is expensive — verify with lint/typecheck on the changed files first, or build only the affected package.',
  },
  {
    // 依赖安装
    match: /\b(?:npm|yarn|pnpm)\s+(?:install|add|i)\b|\bpip\s+install\b|\buv\s+(?:pip\s+)?install\b/,
    hint: 'dependency install can take minutes — run it with is_background=true and poll the terminal output instead of blocking.',
  },
]

/**
 * 为 run_command 生成代价提示文本。
 *
 * @returns 提示文本；不触发时返回 null
 */
export function buildCommandCostHint(
  toolName: string,
  args: Record<string, unknown> | undefined | null,
): string | null {
  if (toolName !== 'run_command') return null

  const { activeProfile } = useSceneModeStore.getState()
  const { commandCostGuard } = getCodingEnhancements(activeProfile)
  if (!commandCostGuard) return null

  const command = typeof args?.command === 'string' ? args.command : ''
  if (!command) return null

  const pattern = COST_PATTERNS.find((p) => p.match.test(command))
  if (!pattern) return null
  return `[Cost hint] ${pattern.hint}`
}

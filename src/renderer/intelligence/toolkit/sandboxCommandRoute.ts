/**
 * `run_command` 的沙箱路由（渲染层侧）
 *
 * ── 为什么路由判断放在渲染层 ──
 *
 * `run_command` 的实际执行方在渲染进程（xterm 会话 + 流式预览 + 中止信号都在这里）。
 * 沙箱需要系统层能力，只能在主进程做。所以渲染层只做一件事：
 * **问主进程「这条路你接不接」**——`handled:false` 就原样落到宿主终端路径。
 *
 * 这层判断刻意做得很薄，就是为了满足「`off` 状态下行为与改造前完全一致」：
 * 策略为 `off` 时主进程直接回 `handled:false`，渲染层不产生任何分支副作用
 * （不建终端、不改超时、不碰中止信号）。
 *
 * ── 为什么不把长进程也送进沙箱 ──
 *
 * 沙箱执行是「起进程 → 收敛全部输出 → 回收」的一次性模型：没有 stdin 交互、
 * 没有持续输出通道、超时即整组回收。而 `npm run dev` 这类长进程需要**活着的会话**
 * （用户要 `send_terminal_input`、要 `read_terminal_output` 持续读日志）。
 * 强行送进去只会让「启动服务」变成「启动后在 120s 时被杀」。
 * 因此调用方必须只在 `!isLongRunningProcess` 时调用本函数。
 *
 * @module intelligence/toolkit/sandboxCommandRoute
 */

import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import type { ToolExecutionResult } from '@intelligence/providerTypes'
import type { SandboxRunResult } from '@shared/protocols/sandboxProtocol'

/**
 * 尝试在沙箱中执行命令。
 *
 * @returns
 *   · `null` —— 策略为 `off`（或沙箱不可用未接管），**调用方必须回退到宿主终端路径**
 *   · `ToolExecutionResult` —— 沙箱已接管（含执行成功 / 命令失败 / 拒绝执行）
 */
export async function tryRunCommandInSandbox(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ToolExecutionResult | null> {
  let response: Awaited<ReturnType<typeof api.sandbox.execute>>
  try {
    response = await api.sandbox.execute({ command, cwd, timeoutMs })
  } catch (err) {
    // IPC 层异常（主进程未注册 / 通道断）不应让命令凭空消失：回退宿主路径
    logger.security.warn('[run_command] sandbox IPC failed, falling back to host shell:', err)
    return null
  }

  if (!response?.success) {
    logger.security.warn('[run_command] sandbox rejected request:', response?.error)
    return null
  }

  const outcome = response.data
  if (!outcome?.handled || !outcome.result) return null

  return buildSandboxResult(command, cwd, outcome.result)
}

/** 把沙箱结果翻译成工具返回（模型只看到文本，所以文本必须自解释） */
function buildSandboxResult(command: string, cwd: string, result: SandboxRunResult): ToolExecutionResult {
  const text = formatSandboxOutput(result)

  return {
    success: result.success,
    result: text,
    error: result.success ? undefined : text,
    meta: {
      command,
      cwd,
      // 沙箱路径没有终端会话：显式给 null，避免上层误以为可以 read_terminal_output
      terminalId: null,
      commandSessionId: null,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      finalStatus: result.timedOut ? 'timed_out' : result.success ? 'completed' : 'failed',
      durationMs: result.durationMs,
      // 沙箱专有字段：让「这条命令实际跑在哪」在工具卡片上可见
      sandboxProvider: result.provider,
      sandboxDegradations: result.degradations,
      sandboxRefused: result.refused === true,
    },
  }
}

/**
 * 组装给人 / 给模型看的输出。
 *
 * 顺序刻意固定：`[沙箱环境]` 头 → 降级警示 → stdout → stderr → 备注。
 * 头与警示放在最前面，是因为**「这条命令跑在没有隔离的环境里」是比命令输出更重要的信息**，
 * 放在末尾会被长输出淹没。
 */
export function formatSandboxOutput(result: SandboxRunResult): string {
  const lines: string[] = []

  if (result.refused) {
    lines.push('[沙箱拒绝执行] 命令未运行。')
    lines.push(...result.notes.map((n) => `· ${n}`))
    lines.push('请在「设置 → 代码沙箱」中检查后端可用性，或将策略改回「关闭」。')
    return lines.join('\n')
  }

  lines.push(`[沙箱环境] ${describeProvider(result.provider)}`)

  if (result.degradations.length > 0) {
    lines.push('[注意] 发生了降级，实际隔离能力低于预期：')
    for (const d of result.degradations) {
      lines.push(`· ${d.from} → ${d.to ?? '拒绝执行'}：${d.reason}`)
    }
  }

  const body = result.stdout.trim()
  const err = result.stderr.trim()

  if (body) lines.push(body)
  if (err) {
    lines.push(body ? '\n[stderr]' : '[stderr]')
    lines.push(err)
  }

  if (!body && !err) {
    if (result.timedOut) {
      lines.push(`Command timed out after ${Math.round(result.durationMs / 1000)}s`)
    } else {
      lines.push(
        result.exitCode === 0
          ? 'Command executed successfully (no output)'
          : `Command finished with exit code ${result.exitCode} (no output)`,
      )
    }
  }

  if (result.notes.length > 0) {
    lines.push('')
    lines.push(...result.notes.map((n) => `[沙箱] ${n}`))
  }

  return lines.join('\n')
}

function describeProvider(provider: SandboxRunResult['provider']): string {
  switch (provider) {
    case 'docker':
      return 'docker 容器（无网络 / 隔离文件系统 / 资源限额）'
    case 'e2b':
      return 'E2B 云沙箱（⚠️ 命令与工作目录已上传至云端）'
    case 'local':
      return 'local 受限子进程（仅超时与输出限制，**无**网络 / 文件系统隔离）'
    case 'off':
    default:
      return '未经过沙箱'
  }
}

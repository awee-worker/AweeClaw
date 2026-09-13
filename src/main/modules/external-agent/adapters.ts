/**
 * 外部智能体 CLI 适配器实现
 *
 * - ClaudeCodeAdapter：claude -p <task> --output-format stream-json（非交互协议最成熟）
 * - CodexAdapter：codex exec <task>（非交互，结果落盘 + 退出码）
 * - CursorAdapter：agent -p <task> --output-format stream-json（headless 非交互 + --force 写文件）
 */

import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { nodeManager } from '../node-runtime'
import type {
  ExternalAgentAdapter,
  AgentRunContext,
  AgentRunState,
} from './types'
import type {
  ExternalAgentId,
  AgentStreamEvent,
  AgentPreflightResult,
  AgentPermissionMode,
  ExternalAgentConfig,
  ExternalAgentRunResult,
} from '@shared/externalAgents'

// ============================================
// 公共工具
// ============================================

/** 在增强 PATH 中查找可执行文件（Windows 补 .cmd/.exe 候选） */
function findBinary(names: string[]): string | null {
  const pathEnv = nodeManager.getAugmentedPath() || process.env.PATH || ''
  const dirs = pathEnv.split(path.delimiter).filter(Boolean)
  for (const name of names) {
    const candidates = process.platform === 'win32'
      ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`]
      : [name]
    for (const dir of dirs) {
      for (const candidate of candidates) {
        const full = path.join(dir, candidate)
        try {
          if (fs.existsSync(full)) return full
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null
}

/**
 * Cursor CLI 可执行文件探测（增强版）：
 * - 先走增强 PATH（findBinary）
 * - 再探测官方默认安装位置 ~/.local/bin（官方安装脚本默认写入该目录，
 *   但不会自动加入系统 PATH，这是 Cursor 卡片常被置灰/判定不可用的根因）
 */
function findCursorBinary(): string | null {
  const inPath = findBinary(['agent', 'cursor-agent'])
  if (inPath) return inPath
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (!home) return null
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, '.local', 'bin', 'agent.cmd'),
        path.join(home, '.local', 'bin', 'agent.exe'),
        path.join(home, '.local', 'bin', 'agent'),
        path.join(home, '.local', 'bin', 'cursor-agent.cmd'),
        path.join(home, '.local', 'bin', 'cursor-agent.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'agent'),
        path.join(home, '.local', 'bin', 'cursor-agent'),
        path.join(home, '.cursor', 'bin', 'agent'),
      ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Cursor CLI 官方安装目录（~/.local/bin），运行时补入 PATH */
function cursorLocalBinDir(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (!home) return null
  return path.join(home, '.local', 'bin')
}

/** 执行 `<cmd> --version` 快速探测（15s 超时） */
function probeVersion(command: string, extraArgs: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, extraArgs, {
        timeout: 15_000,
        env: { ...process.env, PATH: nodeManager.getAugmentedPath() },
      })
      let out = ''
      proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { out += d.toString() })
      proc.on('close', (code) => resolve(code === 0 ? out.trim().split('\n')[0] || null : null))
      proc.on('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

/** 构建子进程环境变量（增强 PATH + 额外键值） */
function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  env.PATH = nodeManager.getAugmentedPath() || env.PATH
  if (extra) Object.assign(env, extra)
  return env
}

/** 确保 Node 环境就绪（幂等，失败不阻断） */
async function ensureNodeReady(): Promise<void> {
  try {
    await nodeManager.ensureReady()
  } catch {
    /* 未就绪时仅影响 npx 回退路径 */
  }
}

// ============================================
// Claude Code 适配器
// ============================================

/** 权限模式 → Claude CLI --permission-mode 参数值 */
function claudePermissionArg(mode: AgentPermissionMode): string {
  switch (mode) {
    case 'acceptEdits': return 'acceptEdits'
    case 'planOnly': return 'plan'
    case 'bypass': return 'bypassPermissions'
    default: return 'default'
  }
}

class ClaudeCodeAdapter implements ExternalAgentAdapter {
  readonly id: ExternalAgentId = 'claude-code'

  async preflight(_config: ExternalAgentConfig): Promise<AgentPreflightResult> {
    await ensureNodeReady()
    const binary = findBinary(['claude'])
    const npx = nodeManager.getNpxPath?.()
    if (binary) {
      const version = await probeVersion(binary, ['--version'])
      return {
        agent: this.id,
        available: true,
        binaryPath: binary,
        version: version ?? undefined,
        headlessSupported: true,
      }
    }
    if (npx) {
      // 通过 npx -y @anthropic-ai/claude-code 可用（首次运行会下载）
      return {
        agent: this.id,
        available: true,
        binaryPath: npx,
        version: 'via npx @anthropic-ai/claude-code',
        headlessSupported: true,
      }
    }
    return {
      agent: this.id,
      available: false,
      reason: '未检测到 claude 命令或 npx（Node 环境缺失）',
      headlessSupported: true,
    }
  }

  buildCommand(
    task: string,
    options: { workdir: string; permissionMode: AgentPermissionMode; resumeSession?: string },
    config: ExternalAgentConfig,
  ): { command: string; args: string[]; env: Record<string, string> } | null {
    const binary = findBinary(['claude'])
    const npx = nodeManager.getNpxPath?.()

    const args: string[] = []
    if (!binary) {
      if (!npx) return null
      args.push('-y', '@anthropic-ai/claude-code')
    }
    args.push(
      '-p', task,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', claudePermissionArg(options.permissionMode),
    )
    if (options.resumeSession) {
      args.push('--resume', options.resumeSession)
    }

    const extra: Record<string, string> = {}
    const key = config.apiKeys?.['claude-code'] || process.env.ANTHROPIC_API_KEY
    if (key) extra.ANTHROPIC_API_KEY = key

    return {
      command: binary || npx!,
      args,
      env: buildEnv(extra),
    }
  }

  parseLine(line: string, state: AgentRunState): AgentStreamEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // 非 JSON 行（警告输出等）忽略
      return []
    }

    const events: AgentStreamEvent[] = []
    const type = parsed.type as string | undefined

    if (type === 'system' && parsed.subtype === 'init') {
      state.sessionId = (parsed.session_id as string) || state.sessionId
      events.push({ type: 'status', stage: 'thinking' })
    } else if (type === 'assistant') {
      const message = parsed.message as { content?: unknown } | undefined
      const content = message?.content
      if (Array.isArray(content)) {
        for (const item of content) {
          const block = item as { type: string; text?: string; name?: string; input?: Record<string, unknown> }
          if (block.type === 'text' && block.text) {
            state.capturedOutput.push(block.text)
            events.push({ type: 'text', content: block.text })
          } else if (block.type === 'tool_use' && block.name) {
            state.toolCalls.push(block.name)
            state.lastStage = 'tool_call'
            events.push({ type: 'tool', name: block.name })
          }
        }
      }
    } else if (type === 'result') {
      state.sessionId = (parsed.session_id as string) || state.sessionId
      const resultText = (parsed.result as string) || ''
      state.capturedOutput.push(resultText)
      events.push({ type: 'status', stage: 'done' })
    }

    return events
  }

  finalize(state: AgentRunState, exitCode: number, stderrTail: string): ExternalAgentRunResult {
    if (exitCode === 0) {
      return {
        success: true,
        agent: this.id,
        status: 'done',
        output: state.capturedOutput.slice(-8).join('\n').trim() || '(no output)',
        session: state.sessionId,
      }
    }
    return {
      success: false,
      agent: this.id,
      status: 'error',
      output: state.capturedOutput.slice(-4).join('\n').trim(),
      session: state.sessionId,
      error: `Claude Code exited with code ${exitCode}${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`,
    }
  }
}

// ============================================
// Codex 适配器
// ============================================

class CodexAdapter implements ExternalAgentAdapter {
  readonly id: ExternalAgentId = 'codex'

  async preflight(): Promise<AgentPreflightResult> {
    await ensureNodeReady()
    const binary = findBinary(['codex'])
    const npx = nodeManager.getNpxPath?.()
    if (binary) {
      const version = await probeVersion(binary, ['--version'])
      return {
        agent: this.id,
        available: true,
        binaryPath: binary,
        version: version ?? undefined,
        headlessSupported: true,
      }
    }
    if (npx) {
      return {
        agent: this.id,
        available: true,
        binaryPath: npx,
        version: 'via npx @openai/codex',
        headlessSupported: true,
      }
    }
    return {
      agent: this.id,
      available: false,
      reason: '未检测到 codex 命令或 npx（Node 环境缺失）',
      headlessSupported: true,
    }
  }

  buildCommand(
    task: string,
    options: { workdir: string; permissionMode: AgentPermissionMode; resumeSession?: string },
    config: ExternalAgentConfig,
  ): { command: string; args: string[]; env: Record<string, string> } | null {
    const binary = findBinary(['codex'])
    const npx = nodeManager.getNpxPath?.()
    if (!binary && !npx) return null

    const args: string[] = []
    if (!binary) args.push('@openai/codex')
    args.push('exec', task)
    // bypass 权限模式：放开审批与沙箱（危险，仅在用户显式选择时使用）
    if (options.permissionMode === 'bypass') {
      args.push('--dangerously-bypass-approvals-and-sandbox')
    }

    const extra: Record<string, string> = {}
    const key = config.apiKeys?.['codex'] || process.env.OPENAI_API_KEY
    if (key) extra.OPENAI_API_KEY = key

    return {
      command: binary || npx!,
      args,
      env: buildEnv(extra),
    }
  }

  parseLine(line: string, state: AgentRunState): AgentStreamEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    // codex exec 输出为纯文本：积累输出并节流推送（仅非空行）
    state.capturedOutput.push(trimmed)
    if (state.capturedOutput.length === 1) {
      return [{ type: 'status', stage: 'thinking' }]
    }
    return []
  }

  finalize(state: AgentRunState, exitCode: number, stderrTail: string): ExternalAgentRunResult {
    const tail = state.capturedOutput.slice(-40).join('\n')
    if (exitCode === 0) {
      return {
        success: true,
        agent: this.id,
        status: 'done',
        output: tail || '(no output)',
      }
    }
    return {
      success: false,
      agent: this.id,
      status: 'error',
      output: tail,
      error: `Codex exited with code ${exitCode}${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`,
    }
  }
}

// ============================================
// Cursor 适配器（headless CLI：agent -p + stream-json）
// ============================================
/**
 * Cursor CLI（cursor.com/install.sh 安装，命令名 agent / cursor-agent）：
 * - `agent -p <task> --output-format stream-json`：非交互运行，JSONL 事件流
 * - 事件类型：system/init（会话初始化）、assistant（文本块）、
 *   tool_call（started/completed 工具事件）、result（最终结果）
 * - `--force`：跳过 propose 审批直接写文件（对应 acceptEdits / bypass 权限模式）
 * - 凭据：CURSOR_API_KEY 或已登录的 Cursor 订阅（cursor login）
 */
class CursorAdapter implements ExternalAgentAdapter {
  readonly id: ExternalAgentId = 'cursor'

  async preflight(_config: ExternalAgentConfig): Promise<AgentPreflightResult> {
    const binary = findCursorBinary()
    if (binary) {
      const version = await probeVersion(binary, ['--version'])
      return {
        agent: this.id,
        available: true,
        binaryPath: binary,
        version: version ?? undefined,
        headlessSupported: true,
      }
    }
    return {
      agent: this.id,
      available: false,
      reason:
        '未检测到 Cursor CLI（命令 agent / cursor-agent，含 ~/.local/bin 官方安装目录）。'
        + '安装：macOS/Linux：curl https://cursor.com/install -fsS | bash；'
        + 'Windows：irm \'https://cursor.com/install?win32=true\' | iex；'
        + '安装后若仍未检测到，请将 ~/.local/bin 加入 PATH，并需 Cursor 订阅或 CURSOR_API_KEY',
      headlessSupported: true,
    }
  }

  buildCommand(
    task: string,
    options: { workdir: string; permissionMode: AgentPermissionMode; resumeSession?: string },
    config: ExternalAgentConfig,
  ): { command: string; args: string[]; env: Record<string, string> } | null {
    const binary = findCursorBinary()
    if (!binary) return null

    // resumeSession：Cursor CLI 无 --resume 参数（会话历史绑定工作区目录），
    // 用续接提示词回灌上下文，使 Agent 从上次中断处继续
    const finalTask = options.resumeSession
      ? `${task}\n\n[Continuing previous agent session "${options.resumeSession}" — its file changes may already exist in the workspace; inspect current state before proceeding, and do not repeat completed steps.]`
      : task

    const args: string[] = ['-p', finalTask, '--output-format', 'stream-json']
    // 权限模式映射：acceptEdits / bypass 允许直接写文件（--force）；
    // default / planOnly 走 propose 模式（不直接修改文件）
    if (options.permissionMode === 'acceptEdits' || options.permissionMode === 'bypass') {
      args.push('--force')
    }

    const extra: Record<string, string> = {}
    const key = config.apiKeys?.['cursor'] || process.env.CURSOR_API_KEY
    if (key) extra.CURSOR_API_KEY = key

    // ~/.local/bin 可能不在系统 PATH 中，运行时补入（agent 内部调用 / 自动更新需要）
    const localBin = cursorLocalBinDir()
    const env = buildEnv(extra)
    if (localBin && !env.PATH?.split(path.delimiter).includes(localBin)) {
      env.PATH = localBin + path.delimiter + env.PATH
    }

    return {
      command: binary,
      args,
      env,
    }
  }

  parseLine(line: string, state: AgentRunState): AgentStreamEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // 非 JSON 行（警告输出等）积累到输出尾部，避免完全丢失
      state.capturedOutput.push(trimmed)
      return []
    }

    const events: AgentStreamEvent[] = []
    const type = parsed.type as string | undefined

    if (type === 'system' && parsed.subtype === 'init') {
      state.sessionId = (parsed.session_id as string) || state.sessionId
      events.push({ type: 'status', stage: 'thinking' })
    } else if (type === 'assistant') {
      const message = parsed.message as { content?: unknown } | undefined
      const content = message?.content
      if (Array.isArray(content)) {
        for (const item of content) {
          const block = item as { type: string; text?: string; name?: string }
          if (block.type === 'text' && block.text) {
            state.capturedOutput.push(block.text)
            events.push({ type: 'text', content: block.text })
          } else if (block.name) {
            state.toolCalls.push(block.name)
            state.lastStage = 'tool_call'
            events.push({ type: 'tool', name: block.name })
          }
        }
      }
    } else if (type === 'tool_call') {
      // 工具调用事件（started / completed）：官方 stream-json 的 tool_call 对象
      // 按工具类型分字段（writeToolCall / readToolCall / ...），映射为友好工具名
      const tc = (parsed.tool_call as Record<string, unknown> | undefined) || {}
      const subtype = parsed.subtype as string | undefined
      const TOOL_FIELD_LABELS: Record<string, string> = {
        writeToolCall: 'write_file',
        readToolCall: 'read_file',
        editToolCall: 'edit_file',
        executeBashToolCall: 'run_command',
        searchToolCall: 'search',
        taskToolCall: 'subagent',
      }
      let name = ''
      for (const [field, label] of Object.entries(TOOL_FIELD_LABELS)) {
        if (tc[field]) {
          name = subtype === 'completed' ? `${label} ✓` : label
          break
        }
      }
      if (!name) {
        name =
          (typeof parsed.name === 'string' ? parsed.name : '') ||
          (subtype === 'completed' ? 'tool completed' : 'tool')
      }
      state.toolCalls.push(name)
      state.lastStage = 'tool_call'
      events.push({ type: 'tool', name })
    } else if (type === 'result') {
      state.sessionId = (parsed.session_id as string) || state.sessionId
      const resultText = (parsed.result as string) || ''
      if (resultText) state.capturedOutput.push(resultText)
      events.push({ type: 'status', stage: 'done' })
    }

    return events
  }

  finalize(state: AgentRunState, exitCode: number, stderrTail: string): ExternalAgentRunResult {
    if (exitCode === 0) {
      return {
        success: true,
        agent: this.id,
        status: 'done',
        output: state.capturedOutput.slice(-8).join('\n').trim() || '(no output)',
        session: state.sessionId,
      }
    }
    return {
      success: false,
      agent: this.id,
      status: 'error',
      output: state.capturedOutput.slice(-4).join('\n').trim(),
      session: state.sessionId,
      error: `Cursor Agent exited with code ${exitCode}${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`,
    }
  }
}
// ============================================
// 导出
// ============================================
export function createAdapters(): Record<ExternalAgentId, ExternalAgentAdapter> {
  return {
    'claude-code': new ClaudeCodeAdapter(),
    codex: new CodexAdapter(),
    cursor: new CursorAdapter(),
  }
}

export { findBinary, findCursorBinary, probeVersion, buildEnv }
export type { AgentRunContext }

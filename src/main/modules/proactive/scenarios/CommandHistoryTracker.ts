/**
 * 命令历史追踪器（阶段10 s10-08 新增）
 *
 * 轻量级单例，记录 shell 命令执行历史，供 CodingScenario 探测器使用：
 * - 构建失败检测：检查最近命令的退出码和输出模式
 * - 重复命令检测：统计同一命令在时间窗口内的执行次数
 *
 * 数据流：
 *   shell 执行 IPC → recordCommand(cmd, exitCode, output)
 *     → CommandHistoryTracker（内存环形缓冲区，保留最近 100 条 + 1h 窗口）
 *     → CodingScenario 探测器读取
 *
 * 设计原则：
 * - 纯内存，不持久化（重启后清空，符合"实时探测"定位）
 * - 环形缓冲区限制内存占用
 * - 线程安全（Node.js 单线程，无需锁）
 *
 * @module proactive/scenarios/CommandHistoryTracker
 */

import { logger } from '@shared/toolkit/LogEngine'

// ============================================================
// 类型定义
// ============================================================

/** 命令历史条目 */
export interface CommandHistoryEntry {
  /** 命令文本（已截断到 200 字符） */
  command: string
  /** 退出码（0=成功，非0=失败，undefined=未结束） */
  exitCode: number | undefined
  /** 执行开始时间戳（ms） */
  startedAt: number
  /** 执行结束时间戳（ms，未结束为 undefined） */
  finishedAt: number | undefined
  /** 输出摘要（最后 500 字符，用于错误模式检测） */
  outputTail: string | undefined
  /** 是否检测到错误模式（error/fail/exception 等） */
  hasErrorPattern: boolean
}

// ============================================================
// 常量
// ============================================================

/** 最大历史记录数（环形缓冲区大小） */
const MAX_HISTORY_SIZE = 100

/** 命令文本最大长度 */
const MAX_COMMAND_LENGTH = 200

/** 输出摘要最大长度 */
const MAX_OUTPUT_TAIL_LENGTH = 500

/** 错误模式正则（检测构建失败/运行时错误） */
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfail(ed|ure)?\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bpanic\b/i,
  /\bundefined reference\b/i,
  /\bcannot find\b/i,
  /\bno such file or directory\b/i,
  /\bsyntax error\b/i,
  /\bcompilation failed\b/i,
]

// ============================================================
// CommandHistoryTracker 单例
// ============================================================

export class CommandHistoryTracker {
  private static instance: CommandHistoryTracker | null = null

  /** 环形缓冲区（按时间顺序，最新在末尾） */
  private history: CommandHistoryEntry[] = []

  private constructor() {}

  static getInstance(): CommandHistoryTracker {
    if (!CommandHistoryTracker.instance) {
      CommandHistoryTracker.instance = new CommandHistoryTracker()
    }
    return CommandHistoryTracker.instance
  }

  // ============================================================
  // 写入接口（由 shell 执行 IPC 调用）
  // ============================================================

  /**
   * 记录命令开始执行
   * @returns 命令条目的引用索引（用于 finishCommand）
   */
  recordCommandStart(command: string): CommandHistoryEntry {
    const entry: CommandHistoryEntry = {
      command: command.slice(0, MAX_COMMAND_LENGTH),
      exitCode: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
      outputTail: undefined,
      hasErrorPattern: false,
    }

    this.history.push(entry)
    this.trimHistory()

    logger.proactive?.debug(
      `[CommandHistoryTracker] 命令开始: ${entry.command.slice(0, 50)}`,
    )
    return entry
  }

  /**
   * 记录命令执行完成
   * @param entry recordCommandStart 返回的条目引用
   * @param exitCode 退出码
   * @param output 命令输出（可选，仅截取末尾用于模式检测）
   */
  recordCommandFinish(
    entry: CommandHistoryEntry,
    exitCode: number,
    output?: string,
  ): void {
    entry.exitCode = exitCode
    entry.finishedAt = Date.now()
    entry.outputTail = output
      ? output.slice(-MAX_OUTPUT_TAIL_LENGTH)
      : undefined
    entry.hasErrorPattern = this.detectErrorPattern(output, exitCode)

    logger.proactive?.debug(
      `[CommandHistoryTracker] 命令完成: exitCode=${exitCode}, hasError=${entry.hasErrorPattern}`,
    )
  }

  // ============================================================
  // 读取接口（由 CodingScenario 探测器调用）
  // ============================================================

  /**
   * 获取指定时间窗口内的命令历史
   * @param windowMs 时间窗口（ms），默认 1 小时
   * @returns 按时间正序排列的命令列表
   */
  getRecentCommands(windowMs: number = 60 * 60 * 1000): CommandHistoryEntry[] {
    const cutoff = Date.now() - windowMs
    return this.history.filter((e) => e.startedAt >= cutoff)
  }

  /**
   * 获取最近 N 条已完成命令
   * @param count 数量
   */
  getRecentFinishedCommands(count: number = 10): CommandHistoryEntry[] {
    return this.history
      .filter((e) => e.finishedAt !== undefined)
      .slice(-count)
      .reverse()
  }

  /**
   * 检测重复命令模式
   * @param windowMs 时间窗口
   * @param threshold 触发阈值（同一命令执行次数 ≥ threshold）
   * @returns 重复命令列表（命令文本 + 执行次数）
   */
  detectRepeatCommands(
    windowMs: number = 60 * 60 * 1000,
    threshold: number = 3,
  ): Array<{ command: string; count: number }> {
    const recent = this.getRecentCommands(windowMs)
    const counts = new Map<string, number>()

    for (const entry of recent) {
      // 规范化命令（去除参数中的路径/数字，保留命令主体）
      const normalized = this.normalizeCommand(entry.command)
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }

    const result: Array<{ command: string; count: number }> = []
    for (const [command, count] of counts) {
      if (count >= threshold) {
        result.push({ command, count })
      }
    }
    return result.sort((a, b) => b.count - a.count)
  }

  /**
   * 检测最近的构建失败模式
   * @param lookbackCount 检查最近多少条命令
   * @param historyThreshold 同类错误历史次数阈值
   * @returns 构建失败信号（null 表示无）
   */
  detectBuildFailure(
    lookbackCount: number = 5,
    historyThreshold: number = 2,
  ): { command: string; outputTail: string; recentFailureCount: number } | null {
    const recent = this.getRecentFinishedCommands(lookbackCount)
    if (recent.length === 0) return null

    // 查找最近一条失败的命令
    const latestFailure = recent.find(
      (e) => e.exitCode !== undefined && e.exitCode !== 0 && e.hasErrorPattern,
    )
    if (!latestFailure) return null

    // 统计同类错误历史次数（相同命令前缀 + hasErrorPattern）
    const cmdPrefix = this.normalizeCommand(latestFailure.command)
    const sameErrorCount = this.history.filter(
      (e) =>
        e.hasErrorPattern &&
        this.normalizeCommand(e.command) === cmdPrefix,
    ).length

    if (sameErrorCount < historyThreshold) return null

    return {
      command: latestFailure.command,
      outputTail: latestFailure.outputTail ?? '',
      recentFailureCount: sameErrorCount,
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 检测输出中是否包含错误模式 */
  private detectErrorPattern(output: string | undefined, exitCode: number): boolean {
    // 退出码非 0 且无输出 → 视为错误
    if (exitCode !== 0 && !output) return true
    if (!output) return false

    return ERROR_PATTERNS.some((pattern) => pattern.test(output))
  }

  /** 规范化命令文本（用于重复检测） */
  private normalizeCommand(command: string): string {
    return command
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/['"`]/g, '')
      .replace(/\/[\w./-]+/g, '<path>')
      .replace(/\b\d+\b/g, '<n>')
      .slice(0, 100)
  }

  /** 修剪历史记录到 MAX_HISTORY_SIZE */
  private trimHistory(): void {
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history = this.history.slice(-MAX_HISTORY_SIZE)
    }
  }

  /** 清空历史（测试用） */
  clear(): void {
    this.history = []
  }
}

/** 单例实例 */
export const commandHistoryTracker = CommandHistoryTracker.getInstance()

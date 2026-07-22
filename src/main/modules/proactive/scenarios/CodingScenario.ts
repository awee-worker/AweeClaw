/**
 * 编码场景探测器（阶段10 s10-08 新增）
 *
 * 包含 4 个 ScenarioDetector 实现：
 * 1. BuildFailureDetector  — 构建失败模式检测（终端输出 error/fail + 同类错误历史 ≥ 2）
 * 2. RepeatCommandDetector — 重复命令模式检测（同一命令 1h 内 ≥ 3 次）
 * 3. ImpactAnalysisDetector — 影响分析提示（文件保存 + GitCoModificationAnalyzer 有共修改）
 * 4. DebugStallDetector     — 调试卡顿检测（10min 无操作 + 最近有错误）
 *
 * 数据流：
 *   各信号源 → 探测器 detect() → ScenarioSignal[]
 *     → ProactiveDecisionEngine.collectScenarioSignals()
 *     → 规则引擎 → ProactiveProposal → ProactiveActionTrigger
 *
 * @module proactive/scenarios/CodingScenario
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  type ScenarioDetector,
  type ScenarioSignal,
} from '../ProactiveInterface'
import { commandHistoryTracker } from './CommandHistoryTracker'
import { activityTracker } from './ActivityTracker'
import { GitCoModificationAnalyzer } from '../../perception/GitCoModificationAnalyzer'

// ============================================================
// 常量
// ============================================================

/** 调试卡顿空闲阈值（10 分钟） */
const DEBUG_STALL_IDLE_MS = 10 * 60 * 1000

/** 重复命令检测窗口（1 小时） */
const REPEAT_CMD_WINDOW_MS = 60 * 60 * 1000

/** 重复命令触发阈值 */
const REPEAT_CMD_THRESHOLD = 3

/** 构建失败同类错误历史阈值 */
const BUILD_FAILURE_HISTORY_THRESHOLD = 2

/** 构建失败检测回溯命令数 */
const BUILD_FAILURE_LOOKBACK = 5

// ============================================================
// 探测器 1：构建失败模式
// ============================================================

/**
 * 构建失败模式探测器
 *
 * 触发条件：终端输出检测到 error/fail 模式 + 同类错误历史 ≥ 2 次
 * 行动：suggest（建议修复方案）
 */
export class BuildFailureDetector implements ScenarioDetector {
  readonly name = 'BuildFailureDetector'
  readonly source = 'coding' as const

  async detect(): Promise<ScenarioSignal[]> {
    try {
      const failure = commandHistoryTracker.detectBuildFailure(
        BUILD_FAILURE_LOOKBACK,
        BUILD_FAILURE_HISTORY_THRESHOLD,
      )
      if (!failure) return []

      const signal: ScenarioSignal = {
        source: 'coding',
        trigger: `build_failure:${failure.command.slice(0, 50)}`,
        severity: 'medium',
        title: '构建失败模式检测',
        description: `检测到"${failure.command.slice(0, 40)}"已失败 ${failure.recentFailureCount} 次，建议查看错误输出并修复`,
        action: {
          type: 'suggest',
          payload: `构建命令"${failure.command}"已失败 ${failure.recentFailureCount} 次。请检查以下错误输出并修复：\n\n${failure.outputTail.slice(0, 300)}`,
        },
        confidence: Math.min(0.5 + failure.recentFailureCount * 0.15, 0.9),
        reason: `同类构建错误在历史中已出现 ${failure.recentFailureCount} 次，退出码非 0 且输出包含错误模式`,
        dedupKey: `build_failure:${this.normalizeCmd(failure.command)}`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }

  private normalizeCmd(cmd: string): string {
    return cmd.trim().replace(/\s+/g, ' ').slice(0, 50)
  }
}

// ============================================================
// 探测器 2：重复命令模式
// ============================================================

/**
 * 重复命令模式探测器
 *
 * 触发条件：同一命令 1h 内执行 ≥ 3 次
 * 行动：suggest（建议封装脚本/别名）
 */
export class RepeatCommandDetector implements ScenarioDetector {
  readonly name = 'RepeatCommandDetector'
  readonly source = 'coding' as const

  async detect(): Promise<ScenarioSignal[]> {
    try {
      const repeats = commandHistoryTracker.detectRepeatCommands(
        REPEAT_CMD_WINDOW_MS,
        REPEAT_CMD_THRESHOLD,
      )
      if (repeats.length === 0) return []

      // 只取最频繁的一个（避免一次产出过多信号）
      const top = repeats[0]
      const signal: ScenarioSignal = {
        source: 'coding',
        trigger: `repeat_command:${top.command.slice(0, 50)}`,
        severity: 'low',
        title: '重复命令模式检测',
        description: `"${top.command.slice(0, 40)}"在 1 小时内已执行 ${top.count} 次，建议封装为脚本或别名`,
        action: {
          type: 'suggest',
          payload: `检测到命令"${top.command}"在 1 小时内已执行 ${top.count} 次。建议封装为 shell 脚本或设置 alias 以提高效率。`,
        },
        confidence: Math.min(0.4 + top.count * 0.1, 0.85),
        reason: `命令在 ${REPEAT_CMD_WINDOW_MS / 60000} 分钟窗口内执行 ${top.count} 次，超过阈值 ${REPEAT_CMD_THRESHOLD}`,
        dedupKey: `repeat_command:${top.command}`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }
}

// ============================================================
// 探测器 3：影响分析提示
// ============================================================

/**
 * 影响分析提示探测器
 *
 * 触发条件：检测到文件保存 + GitCoModificationAnalyzer 有共修改数据
 * 行动：suggest（提示共修改文件）
 *
 * 注意：此探测器依赖 GitCoModificationAnalyzer 的分析结果。
 *       由于文件保存事件由渲染层触发，此处通过检查最近活动文件的共修改数据来判断。
 */
export class ImpactAnalysisDetector implements ScenarioDetector {
  readonly name = 'ImpactAnalysisDetector'
  readonly source = 'coding' as const

  /** 上次提示时间（避免频繁打扰，30 分钟内不重复） */
  private lastPromptAt: number = 0

  /** 提示间隔（30 分钟） */
  private static readonly PROMPT_INTERVAL_MS = 30 * 60 * 1000

  async detect(): Promise<ScenarioSignal[]> {
    try {
      // 频率控制：30 分钟内不重复提示
      const now = Date.now()
      if (now - this.lastPromptAt < ImpactAnalysisDetector.PROMPT_INTERVAL_MS) {
        return []
      }

      // 获取工作区路径
      const workspacePath = this.getWorkspacePath()
      if (!workspacePath) return []

      // 查询 GitCoModificationAnalyzer 是否有数据
      const analyzer = GitCoModificationAnalyzer.getInstance()
      const stats = analyzer.getStats(workspacePath)
      if (!stats || stats.totalCommits < 5 || stats.uniqueFilePairs === 0) {
        return []
      }

      // 查询最近修改文件的共修改数据
      const recentFile = this.getRecentActiveFile()
      if (!recentFile) return []

      const queryResult = await analyzer.getCoModifiedFiles(workspacePath, recentFile, 5)
      if (!queryResult || queryResult.coModifiedFiles.length === 0) return []

      // 只在有高共现次数的文件时才提示
      const topCoModified = queryResult.coModifiedFiles[0]
      if (topCoModified.coOccurrence < 3) return []

      this.lastPromptAt = now

      const signal: ScenarioSignal = {
        source: 'coding',
        trigger: `impact_analysis:${recentFile.slice(-40)}`,
        severity: 'low',
        title: '影响分析提示',
        description: `"${recentFile.split('/').pop()}"的修改可能影响 ${queryResult.coModifiedFiles.length} 个关联文件（最高共现 ${topCoModified.coOccurrence} 次）`,
        action: {
          type: 'suggest',
          payload: `文件 "${recentFile}" 在 git 历史中与以下文件频繁共修改：\n${queryResult.coModifiedFiles.slice(0, 5).map((f) => `  - ${f.relativePath}（共现 ${f.coOccurrence} 次）`).join('\n')}\n\n建议同步检查这些文件的兼容性。`,
        },
        confidence: Math.min(0.4 + topCoModified.coOccurrence * 0.08, 0.8),
        reason: `文件在 ${stats.totalCommits} 次 commit 中与 ${queryResult.coModifiedFiles.length} 个文件有共修改记录，最高共现 ${topCoModified.coOccurrence} 次`,
        dedupKey: `impact_analysis:${recentFile}`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }

  /** 获取工作区路径（从 app 命令行参数或默认路径） */
  private getWorkspacePath(): string | null {
    // 优先从最近的活动文件推断工作区
    // 兜底：使用 app 的 userData 目录上级（不理想但避免硬编码）
    return this.cachedWorkspacePath
  }

  /** 缓存的工作区路径（由外部设置） */
  private cachedWorkspacePath: string | null = null

  /** 设置工作区路径（由 moduleInitializer 调用） */
  setWorkspacePath(path: string): void {
    this.cachedWorkspacePath = path
  }

  /** 获取最近活动文件（简化实现，后续可接入文件保存事件） */
  private getRecentActiveFile(): string | null {
    // 此处返回缓存的最近活动文件相对路径
    // 实际应由文件保存事件更新
    return this.cachedRecentFile
  }

  /** 缓存的最近活动文件 */
  private cachedRecentFile: string | null = null

  /** 设置最近活动文件（由文件保存事件调用） */
  setRecentFile(filePath: string): void {
    this.cachedRecentFile = filePath
  }
}

// ============================================================
// 探测器 4：调试卡顿
// ============================================================

/**
 * 调试卡顿探测器
 *
 * 触发条件：10min 无操作 + 最近有错误状态
 * 行动：chat（主动提供排查建议）
 */
export class DebugStallDetector implements ScenarioDetector {
  readonly name = 'DebugStallDetector'
  readonly source = 'coding' as const

  /** 上次提示时间（避免频繁打扰，30 分钟内不重复） */
  private lastPromptAt: number = 0

  /** 提示间隔（30 分钟） */
  private static readonly PROMPT_INTERVAL_MS = 30 * 60 * 1000

  async detect(): Promise<ScenarioSignal[]> {
    try {
      // 频率控制
      const now = Date.now()
      if (now - this.lastPromptAt < DebugStallDetector.PROMPT_INTERVAL_MS) {
        return []
      }

      // 检查空闲时间
      const idleMs = activityTracker.getIdleMs()
      if (idleMs < DEBUG_STALL_IDLE_MS) return []

      // 检查最近是否有错误状态
      const recentCommands = commandHistoryTracker.getRecentFinishedCommands(5)
      const hasRecentError = recentCommands.some(
        (e) =>
          e.exitCode !== undefined &&
          e.exitCode !== 0 &&
          now - (e.finishedAt ?? 0) < 15 * 60 * 1000, // 15 分钟内有错误
      )
      if (!hasRecentError) return []

      this.lastPromptAt = now

      const idleMin = Math.round(idleMs / 60000)
      const signal: ScenarioSignal = {
        source: 'coding',
        trigger: `debug_stall:idle_${idleMin}min`,
        severity: 'medium',
        title: '调试卡顿检测',
        description: `已空闲 ${idleMin} 分钟，且最近有命令执行失败，是否需要排查帮助？`,
        action: {
          type: 'chat',
          payload: `检测到用户已空闲 ${idleMin} 分钟，且最近 15 分钟内有命令执行失败。可能正在调试问题。请主动提供排查建议，包括：\n1. 检查最近的错误输出\n2. 建议常见调试步骤\n3. 询问是否需要进一步帮助`,
        },
        confidence: 0.65,
        reason: `用户空闲 ${idleMin} 分钟（超过 ${DEBUG_STALL_IDLE_MS / 60000} 分钟阈值），且最近 15 分钟内有失败的命令`,
        dedupKey: `debug_stall:idle`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }
}

// ============================================================
// 导出所有探测器实例
// ============================================================

export const codingDetectors: ScenarioDetector[] = [
  new BuildFailureDetector(),
  new RepeatCommandDetector(),
  new ImpactAnalysisDetector(),
  new DebugStallDetector(),
]

/** 影响分析探测器单例引用（用于外部设置工作区路径和最近文件） */
export const impactAnalysisDetector = codingDetectors.find(
  (d) => d.name === 'ImpactAnalysisDetector',
) as ImpactAnalysisDetector

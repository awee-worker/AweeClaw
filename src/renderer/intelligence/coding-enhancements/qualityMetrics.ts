/**
 * 会话质量埋点（代码开发场景编程能力增强）
 *
 * 背景：工具失败率、编辑验证通过率等质量指标此前无统计，
 * 后续的优化动作缺乏度量依据。本模块按会话累计采集：
 * - tool_invoked / tool_failed：工具调用与失败计数（失败率分母 / 分子）；
 * - edit_verified / verify_clean / verify_issues：编辑验证闭环的触发与通过情况。
 *
 * 数据只落内存（本期不做持久化与上报），供设置面板「开发者」页与调试使用；
 * 同时双写 agentHarness.observability 的 MetricCollector，接入既有可观测总线。
 */

import { logger } from '@toolkit/LogEngine'
import { agentHarness } from '../harness'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { getCodingEnhancements } from '../capabilities/sceneMode/SceneModeDescriptor'

/** 会话级质量计数快照 */
export interface SessionQualitySnapshot {
  /** 工具调用总数 */
  invoked: number
  /** 工具调用失败数（业务失败 + 调用失败） */
  failed: number
  /** 编辑验证触发数（lint 参与的编辑 / 写入类成功调用） */
  editVerified: number
  /** 验证通过（无诊断问题）数 */
  verifyClean: number
  /** 验证发现问题数 */
  verifyIssues: number
}

const EMPTY_SNAPSHOT: SessionQualitySnapshot = {
  invoked: 0,
  failed: 0,
  editVerified: 0,
  verifyClean: 0,
  verifyIssues: 0,
}

let counters: SessionQualitySnapshot = { ...EMPTY_SNAPSHOT }

function metricsEnabled(): boolean {
  const { activeProfile } = useSceneModeStore.getState()
  return getCodingEnhancements(activeProfile).qualityMetrics
}

function observeMetric(name: string, labels: Record<string, string>): void {
  try {
    agentHarness.observability.metrics.observe(name, 1, labels)
  } catch (error) {
    logger.agent.warn('[QualityMetrics] failed to record metric:', error)
  }
}

/**
 * 记录一次工具调用终态（成功 / 失败）与编辑验证结果。
 *
 * @param toolName       工具名
 * @param failed         本次调用是否失败
 * @param verification   编辑验证文本（verifyEditedFile 的返回值；未触发验证为 null）
 */
export function recordToolQuality(
  toolName: string,
  failed: boolean,
  verification: string | null,
): void {
  if (!metricsEnabled()) return

  counters.invoked += 1
  if (failed) counters.failed += 1

  const scene = useSceneModeStore.getState().currentSceneMode
  observeMetric('tool_invoked', { tool: toolName, scene })
  if (failed) {
    observeMetric('tool_failed', { tool: toolName, scene })
  }

  if (verification) {
    counters.editVerified += 1
    const clean = verification.includes('no lint issues')
    if (clean) counters.verifyClean += 1
    else counters.verifyIssues += 1
    observeMetric('edit_verified', { tool: toolName, scene, result: clean ? 'clean' : 'issues' })
  }
}

/** 读取当前会话的质量计数快照 */
export function getQualitySnapshot(): Readonly<SessionQualitySnapshot> {
  return { ...counters }
}

/** 工具失败率（0~1；无调用时返回 0） */
export function getToolFailureRate(): number {
  return counters.invoked === 0 ? 0 : counters.failed / counters.invoked
}

/** 编辑验证通过率（0~1；未触发验证时返回 0） */
export function getVerifyCleanRate(): number {
  return counters.editVerified === 0 ? 0 : counters.verifyClean / counters.editVerified
}

/** 重置会话计数（新会话 / 手动清零时调用） */
export function resetQualitySnapshot(): void {
  counters = { ...EMPTY_SNAPSHOT }
}

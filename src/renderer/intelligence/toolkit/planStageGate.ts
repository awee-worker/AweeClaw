/**
 * 计划阶段门控（任务计划模式 / plan 的 planning 阶段）
 *
 * 计划阶段下 getToolsForContext 只下发「建计划 + 只读探索」工具，写类与执行类工具
 * 一律不进入模型可见列表。本模块维护模块级同步缓存，用于执行层兜底校验：
 * 即便工具定义被误注入、或调用方绕过上下文过滤直接发起调用，也不会真的去写文件、
 * 跑命令、改环境。缓存统一由 setToolLoadingContext 刷新。
 */

let cachedPlanStageActive = false

/** 同步读取：本轮是否处于计划阶段 */
export function isPlanStageActive(): boolean {
  return cachedPlanStageActive
}

/** 刷新缓存（由 setToolLoadingContext 调用） */
export function setPlanStageActive(active: boolean): void {
  cachedPlanStageActive = active === true
}

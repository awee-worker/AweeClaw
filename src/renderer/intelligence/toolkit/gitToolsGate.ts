/**
 * Git 工具门控（按需暴露）
 *
 * git_* 工具默认不对 LLM 可见，只有用户在消息里明确要求版本控制操作时，
 * 才由工具加载上下文（ToolLoadingContext.gitToolsEnabled）放行。
 *
 * 本模块维护模块级同步缓存，用于执行层兜底校验：
 * 即便工具定义被误注入、或调用方绕过上下文过滤直接发起调用，
 * 也不会真的去读写工作区仓库。缓存统一由 setToolLoadingContext 刷新，
 * 避免每个调用点各写一遍。
 */

let cachedGitToolsEnabled = false

/** 同步读取：git_* 工具本轮是否被放行 */
export function isGitToolsEnabled(): boolean {
  return cachedGitToolsEnabled
}

/** 刷新缓存（由 setToolLoadingContext 调用） */
export function setGitToolsEnabled(enabled: boolean): void {
  cachedGitToolsEnabled = enabled === true
}

/**
 * 外部编码智能体工具门控（按需暴露）
 *
 * external_agent_* 工具默认不对 LLM 可见。
 * 门控值取自「设置 → 外部智能体 → 向 AI 暴露工具」开关（toolsExposed，主进程 electron-store），
 * 本模块维护模块级同步缓存，供 setToolLoadingContext 调用点同步读取。
 *
 * 刷新时机：
 * - 模块加载时 fire-and-forget 拉取一次（保证首轮对话即有值）
 * - 设置面板保存 toolsExposed 后立即调用 refreshExternalAgentToolsExposed() 更新缓存
 */

let cachedToolsExposed = false

/** 从主进程拉取最新配置并更新缓存 */
export async function refreshExternalAgentToolsExposed(): Promise<boolean> {
  try {
    const cfg = await window.electronAPI.externalAgent.getConfig()
    cachedToolsExposed = Boolean(cfg?.toolsExposed)
  } catch {
    // 主进程不可用（如纯 Web 环境）时保持关闭
    cachedToolsExposed = false
  }
  return cachedToolsExposed
}

/** 同步读取：external_agent_* 工具是否应暴露给 LLM */
export function isExternalAgentToolsExposed(): boolean {
  return cachedToolsExposed
}

// 模块加载即刷新（fire-and-forget）
void refreshExternalAgentToolsExposed()

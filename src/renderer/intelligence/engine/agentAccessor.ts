/**
 * Agent 单例惰性访问门面
 *
 * 背景：`IntelligenceCore` 是整个引擎的聚合起点（主循环、工具编排、流式处理、
 * 多智能体、图执行全部经由它连通）。渲染层只要对它写一句静态导入，
 * 打包时整条引擎链路就会被提升进首屏 chunk —— 用户打开应用、还没发出第一条消息，
 * 就已经把整套 Agent 引擎解析、求值了一遍。
 *
 * 本门面把「引用 Agent」和「加载 Agent」拆开：
 * - `getAgent()` 返回 Promise，首次调用才真正 `import()` 引擎；
 * - `peekAgent()` 只在引擎已加载时返回值，未加载返回 null；
 * - `withLoadedAgent()` 用于中止 / 审批这类「引擎没跑起来就无事可做」的动作，
 *   引擎既未加载也未在加载时直接跳过，不会为了一个中止操作去加载整套引擎。
 *
 * 类型通过 `typeof import(...)` 取得，属纯类型引用，编译后不留下运行时依赖。
 *
 * @module intelligence/engine/agentAccessor
 */

type AgentModule = typeof import('./IntelligenceCore')

/** Agent 单例的类型（与 `IntelligenceCore` 导出的实例完全一致） */
export type AgentInstance = AgentModule['Agent']

/** 已加载的单例缓存 */
let cached: AgentInstance | null = null
/** 进行中的加载 Promise，并发调用共用同一次加载 */
let loading: Promise<AgentInstance> | null = null

/**
 * 取得 Agent 单例，必要时触发引擎模块加载。
 *
 * 加载失败时清空 loading，让下一次调用可以重试 —— 动态 import 失败在开发期
 * 常由 HMR 或临时编译错误引起，缓存失败会让引擎此后永久不可用。
 */
export async function getAgent(): Promise<AgentInstance> {
  if (cached) return cached
  if (!loading) {
    loading = import('./IntelligenceCore')
      .then((mod) => {
        cached = mod.Agent
        return mod.Agent
      })
      .catch((err) => {
        loading = null
        throw err
      })
  }
  return loading
}

/** 引擎已加载则返回单例，否则返回 null（不触发加载） */
export function peekAgent(): AgentInstance | null {
  return cached
}

/**
 * 对一个「引擎未运行就没有意义」的动作做惰性派发。
 *
 * - 引擎已加载：同步执行，保持原有调用时序；
 * - 引擎正在加载：等加载完成再补执行（用户刚点发送就点停止的场景）；
 * - 引擎既未加载也未在加载：直接跳过 —— 没有引擎实例就没有正在执行的任务，
 *   为此去加载整套引擎反而是浪费。
 */
export function withLoadedAgent(action: (agent: AgentInstance) => void): void {
  if (cached) {
    action(cached)
    return
  }
  if (loading) {
    void loading.then(action).catch(() => {})
  }
}

/** 是否已加载引擎（供诊断与测试使用） */
export function isAgentLoaded(): boolean {
  return cached !== null
}

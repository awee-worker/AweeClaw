/**
 * 主进程模块清单契约与初始化编排
 *
 * 背景：模块初始化原本是一串手写的 `await safeInit(...)` 调用。顺序之所以重要，
 * 是因为模块之间存在真实的先后约束 —— 对外 API 网关要接管 A2A 的监听权，
 * 套餐能力收敛要读全部业务模块的配置。但这些约束只存在于行间注释里，
 * 由人记住「不可打乱」。一旦有人插入或调换一行，编译器不会提醒，
 * 故障要等到用户看到「No handler registered」才暴露。
 *
 * 这里把约束变成数据：每个模块声明自己依赖谁，编排器做拓扑排序，
 * 顺序错误从「运行时偶发故障」变成「启动即报的循环依赖」。
 *
 * 排序稳定性：无依赖约束的模块保持声明顺序 —— 这一点很关键，
 * 迁移期间必须保证排出来的结果与原来手写的顺序一致，否则会引入难以定位的
 * 启动竞态。`resolveInitOrder` 因此用稳定的 Kahn 算法（就绪队列按声明下标排序）。
 *
 * @module bootstrap/moduleManifest
 */

/** 初始化阶段：首屏必需 / 延迟后台 */
export type ModulePhase = 'boot' | 'deferred'

/** 单个模块的初始化声明 */
export interface ModuleManifest {
  /** 唯一标识，供 dependsOn 引用，同时用于日志定位 */
  id: string
  /** 所属阶段 */
  phase: ModulePhase
  /** 必须先完成初始化的模块 id（仅同阶段内生效） */
  dependsOn?: string[]
  /** 初始化函数 */
  init: () => unknown | Promise<unknown>
}

/** 排序结果 */
export interface InitOrderResult {
  /** 按依赖关系排好的模块 */
  order: ModuleManifest[]
  /** 无法排序的原因（循环依赖 / 引用了不存在的模块），空数组表示健康 */
  problems: string[]
}

/** 阶段执行顺序，用于判断跨阶段依赖是否成立 */
const PHASE_SEQUENCE: ModulePhase[] = ['boot', 'deferred']

function phaseRank(phase: ModulePhase): number {
  const index = PHASE_SEQUENCE.indexOf(phase)
  return index < 0 ? PHASE_SEQUENCE.length : index
}

/**
 * 按依赖关系计算某阶段的初始化顺序。
 *
 * 只考虑同阶段的依赖：跨阶段的先后由「先跑 boot 再跑 deferred」保证，
 * 若在此处混算，deferred 依赖 boot 的边会让首屏清单被无谓拉长。
 *
 * 循环依赖不会抛异常，而是返回 problems —— 启动流程应当把问题记录到日志后
 * 仍按声明顺序尽力初始化，避免一个配置错误让应用完全起不来。
 */
export function resolveInitOrder(
  modules: ModuleManifest[],
  phase: ModulePhase,
): InitOrderResult {
  const scoped = modules.filter((m) => m.phase === phase)
  const allIds = new Set(modules.map((m) => m.id))
  const indexOf = new Map<string, number>()
  scoped.forEach((m, i) => {
    if (!indexOf.has(m.id)) indexOf.set(m.id, i)
  })

  const problems: string[] = []
  const byIdAll = new Map(modules.map((m) => [m.id, m]))
  const seen = new Set<string>()
  for (const m of scoped) {
    if (seen.has(m.id)) problems.push(`模块 id 重复: ${m.id}`)
    seen.add(m.id)
  }

  // 入度与邻接表，依赖关系中只保留同阶段且真实存在的边
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const m of scoped) {
    indegree.set(m.id, 0)
    dependents.set(m.id, [])
  }
  for (const m of scoped) {
    for (const dep of m.dependsOn ?? []) {
      if (!indexOf.has(dep)) {
        // 跨阶段依赖不必在此排序：阶段本身已保证顺序（boot 整体先于 deferred）。
        // 因此依赖更早阶段的模块是合法的，依赖更晚阶段的模块则是死约束。
        if (!allIds.has(dep)) {
          problems.push(`模块 ${m.id} 依赖了不存在的模块 ${dep}`)
        } else if (phaseRank(byIdAll.get(dep)!.phase) > phaseRank(phase)) {
          const depPhase = byIdAll.get(dep)!.phase
          problems.push(`模块 ${m.id}（${phase}）依赖了更晚阶段 ${depPhase} 的模块 ${dep}`)
        }
        continue
      }
      if (dep === m.id) {
        problems.push(`模块 ${m.id} 依赖了自身`)
        continue
      }
      indegree.set(m.id, (indegree.get(m.id) ?? 0) + 1)
      dependents.get(dep)!.push(m.id)
    }
  }

  // 稳定 Kahn：就绪集合始终按声明下标升序，无依赖的模块因此保持原顺序
  const ready = scoped.filter((m) => (indegree.get(m.id) ?? 0) === 0).map((m) => m.id)
  const order: ModuleManifest[] = []
  const byId = new Map(scoped.map((m) => [m.id, m]))

  while (ready.length > 0) {
    ready.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0))
    const id = ready.shift()!
    order.push(byId.get(id)!)
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) ready.push(next)
    }
  }

  if (order.length < scoped.length) {
    const stuck = scoped.filter((m) => !order.some((o) => o.id === m.id)).map((m) => m.id)
    problems.push(`检测到循环依赖，涉及模块: ${stuck.join(', ')}`)
    // 尽力而为：把剩余模块按声明顺序补在末尾，避免整段初始化被跳过
    for (const m of scoped) {
      if (!order.some((o) => o.id === m.id)) order.push(m)
    }
  }

  return { order, problems }
}

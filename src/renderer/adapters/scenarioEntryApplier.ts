/**
 * 工作空间就绪后把当前场景落到界面上
 *
 * 「新建窗口 → 选工作空间」这条链路上，窗口先在选择界面停住，此时既没有工作空间，
 * 也没有场景入口去调用 activateScenarioPanels / switchToFirstPanel。选定目录后
 * 只加载工作空间，界面会按 store 里遗留的侧栏面板（默认工作台那一套）渲染，
 * 表现为「刚在原型工坊里新建的窗口，选完目录却回到默认工作台」。
 *
 * 因此这里补上场景落位：注册场景面板组件，并把侧栏切到该场景的首个面板。
 * 场景 id 本身随设置持久化，新窗口启动时已从同一份配置恢复，无需再传参。
 *
 * 外部场景的 bundle 是异步加载的（选工作空间窗口刻意推迟到目录就绪之后），
 * 所以本函数不等待它：场景已注册就当场应用；尚未注册则挂一次性等待，
 * 加载完成后自动补应用。等待期间界面先按默认布局渲染，这是 bundle 加载
 * 的必然二段式，好过把用户卡在选择页上。
 */

import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@/scenarios'
import { activateScenarioPanels, switchToFirstPanel } from '@components/scenario/panelUtils'
import type { ScenarioPlugin } from '@shared/protocols/scenario'

/**
 * 等待外部场景注册的上限
 *
 * bundle 需要先 fetch 再 dynamic import。超过这个时长仍无注册结果就放弃，
 * 保持默认工作台，避免挂着一个永不结束的监听。
 */
const SCENARIO_READY_TIMEOUT_MS = 8000
const SCENARIO_READY_POLL_MS = 200

/** 正在等待注册的场景，避免重复挂等待 */
const waitingScenarioIds = new Set<string>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 把场景落到当前窗口：注册面板组件并切换侧栏首面板 */
function applyScenario(scenario: ScenarioPlugin): void {
  const scenarioId = scenario.id
  const workspaceRoot = useStore.getState().workspace?.roots?.[0] ?? null

  try {
    scenarioRegistry.setActive(scenarioId)
    if (!scenarioLoader.isActive(scenarioId)) {
      // 激活失败不影响面板落位：面板组件与 loader 生命周期相互独立
      void scenarioLoader.activate(scenarioId, workspaceRoot)
    }
    activateScenarioPanels(scenario)
    switchToFirstPanel(scenario)
    logger.ui.info('[ScenarioEntry] Applied active scenario to new window', {
      scenarioId,
      workspaceRoot,
    })
  } catch (e) {
    logger.ui.error('[ScenarioEntry] Failed to apply active scenario:', e)
  }
}

/** 场景尚未注册时挂一次等待，注册后补应用 */
async function waitThenApply(scenarioId: string): Promise<void> {
  if (waitingScenarioIds.has(scenarioId)) return
  waitingScenarioIds.add(scenarioId)

  try {
    const deadline = Date.now() + SCENARIO_READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      const scenario = scenarioRegistry.get(scenarioId)
      if (scenario) {
        applyScenario(scenario)
        return
      }
      await sleep(SCENARIO_READY_POLL_MS)
    }

    logger.ui.warn(
      '[ScenarioEntry] Active scenario not registered in time, keep default workbench:',
      scenarioId,
    )
  } finally {
    waitingScenarioIds.delete(scenarioId)
  }
}

/**
 * 把 activeScenarioId 指向的场景应用到当前窗口
 *
 * 只在工作空间就绪后调用：侧栏切换与面板注册都需要工作空间上下文。
 * 场景不存在（已卸载或加载失败）时保持默认工作台，不抛错，也不阻塞调用方。
 */
export function applyActiveScenarioToWorkspace(): void {
  const scenarioId = useStore.getState().activeScenarioId
  if (!scenarioId) return

  const scenario = scenarioRegistry.get(scenarioId)
  if (scenario) {
    applyScenario(scenario)
    return
  }

  // 外部场景还没加载完：先交界面，加载完成后补应用
  void waitThenApply(scenarioId)
}

/**
 * 场景工作区面板（scenario-workspace）
 *
 * 区域树里的 panel 节点是静态的：一条节点固定挂一个面板 id。而场景提供的往往
 * 是一组可切换的面板（sidebarItems），当前显示哪一块由 activeSidePanel 决定。
 * 该面板把两者接起来 —— 读 activeSidePanel 选出目标面板并渲染它。
 *
 * 为什么做成宿主内置面板，而不是让场景在 getComponents 里自带一个容器：
 * - panel 节点按 PanelRegistry 的键解析，键必须全局稳定；内置键不会因为场景包
 *   改名、或场景尚未加载而失效
 * - 场景面板的注册原先只发生在 DynamicPanelView 的副作用里。场景若改用自建
 *   容器，就绕开了那条路径，树里的面板会一直停在「未注册」占位。这里显式注册
 *
 * 没有直接复用 DynamicPanelView 是为了避开模块循环
 * （PanelRegistry → 本文件 → AdaptivePanelView → PanelRegistry）：注册动作在
 * 本文件完成，渲染只依赖 getPanelComponent 这一处读取。
 */

import { createElement, useEffect, useState } from 'react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getPanelComponent, registerScenarioPanelComponents } from '../PanelRegistry'

/**
 * 解析工作区当前应显示的面板 id
 *
 * 优先跟随 activeSidePanel；它可能指向别的场景的入口（切换场景后状态残留），
 * 此时回落到本场景的 defaultSidePanel，再不行取 sidebarItems 的第一项。
 * 场景没有声明 sidebarItems 时保持原值，让宿主侧边栏面板照常显示。
 */
/**
 * 该面板 id 是否属于其它场景
 *
 * 面板组件在 PanelRegistry 里按 id 全局共享，切场景时未必注销。拿到别的场景的 id
 * 就等于拿到它的组件，渲染结果会是「本场景的工作区位置出现上一个场景的界面」。
 */
function isPanelOfOtherScenario(scenarioId: string, panelId: string): boolean {
  return scenarioRegistry
    .getAll()
    .some(
      (other) =>
        other.id !== scenarioId &&
        Boolean(other.ui?.sidebarItems?.some((item) => item.id === panelId)),
    )
}

export function resolveWorkspacePanelId(
  scenarioId: string | null,
  activeSidePanel: string | null,
): string | null {
  if (!scenarioId) return activeSidePanel

  const scenario = scenarioRegistry.get(scenarioId)
  const items = scenario?.ui?.sidebarItems ?? []
  if (items.length === 0) {
    // 场景没有自己的侧栏项时沿用宿主的 activeSidePanel，但要拒绝其它场景的面板 id
    return activeSidePanel && !isPanelOfOtherScenario(scenarioId, activeSidePanel)
      ? activeSidePanel
      : null
  }

  if (activeSidePanel && items.some((item) => item.id === activeSidePanel)) {
    return activeSidePanel
  }

  return scenario?.ui?.defaultSidePanel ?? items[0].id
}

export function ScenarioWorkspacePanel() {
  const activeScenarioId = useStore((s) => s.activeScenarioId)
  const activeSidePanel = useStore((s) => s.activeSidePanel)

  /** 本场景的面板是否已完成注册：未完成时留白，避免闪一段「面板未注册」 */
  const [ready, setReady] = useState(false)
  /** 注册是同步副作用，不触发重渲染；用递增计数作为重渲染的信号 */
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!activeScenarioId) {
      setReady(true)
      return
    }
    registerScenarioPanelComponents(activeScenarioId)
    setReady(true)
    setVersion((v) => v + 1)
  }, [activeScenarioId])

  const panelId = resolveWorkspacePanelId(activeScenarioId, activeSidePanel)
  if (!panelId) return null

  const PanelComponent = getPanelComponent(panelId)

  if (!PanelComponent) {
    if (!ready) return null
    return (
      <div className="flex h-full w-full items-center justify-center bg-background-secondary p-4 text-center">
        <div className="max-w-xs space-y-1">
          <p className="text-xs font-medium text-text-secondary">面板不可用</p>
          <p className="text-[11px] leading-relaxed break-all text-text-tertiary">{panelId}</p>
        </div>
      </div>
    )
  }

  return createElement(PanelComponent, { key: version } as never)
}

export default ScenarioWorkspacePanel

/**
 * 场景渲染上下文注入
 *
 * 场景拿到的是三样东西：
 * - hostParts：宿主已实现的整块功能（对话、侧边栏、配额…），场景可自行组合
 * - slots：外壳槽位内容，供声明式区域树直接引用
 * - renderRegions：同一套摆放规则，场景自渲染与宿主渲染结果一致
 *
 * 值的来源都在这层收敛：
 * - hostParts 取自 HostPartRegistry，注册发生在 AweeApp 模块加载时，早于首次渲染
 * - renderRegions 复用 RegionRenderer，不另写一份摆放逻辑
 *
 * 之所以挂在 SDK 的 context 上而不在客户端自建：场景通过
 * `@aweeclaw/scenario-sdk/react` 取 context，宿主要能与它共享同一个实例。
 * 客户端通过 vite / tsconfig 别名直接指向 SDK 源码，两边是同一份模块。
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  ScenarioRenderContext,
  type HostPartId,
  type HostPartsMap,
  type RegionNode,
  type RegionSlotMap,
  type ScenarioRenderContextValue,
  type ScenarioShellMode,
} from '@aweeclaw/scenario-sdk/react'
import { useStore } from '@store'
import { getHostPart, listRegisteredHostParts } from './HostPartRegistry'
import { RegionRenderer } from './RegionRenderer'

export interface ScenarioRenderBridgeProps {
  /** 外壳槽位内容 */
  slots: RegionSlotMap
  /** 当前放权档位；缺省按「场景摆位」处理 */
  shellMode?: ScenarioShellMode
  children: ReactNode
}

/** 把注册表里的部件整理成按 id 索引的表 */
function collectHostParts(): HostPartsMap {
  const parts: Record<string, unknown> = {}
  for (const id of listRegisteredHostParts()) {
    const component = getHostPart(id)
    if (component) parts[id] = component
  }
  return parts as HostPartsMap
}

export function ScenarioRenderBridge({ slots, shellMode = 'regions', children }: ScenarioRenderBridgeProps) {
  const activeScenarioId = useStore((s) => s.activeScenarioId)

  // 注册表在模块加载后不再变化（部件是编译期固定的），只读一次即可
  const hostParts = useMemo<HostPartsMap>(() => collectHostParts(), [])

  const value = useMemo<ScenarioRenderContextValue>(() => ({
    scenarioId: activeScenarioId,
    shellMode,
    hostParts,
    slots,
    renderRegions: (root: RegionNode) => <RegionRenderer root={root} slots={slots} />,
    hasHostPart: (id: HostPartId) => Boolean(hostParts[id]),
  }), [activeScenarioId, shellMode, hostParts, slots])

  return <ScenarioRenderContext.Provider value={value}>{children}</ScenarioRenderContext.Provider>
}

export default ScenarioRenderBridge

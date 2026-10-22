/**
 * 宿主部件注册表
 *
 * 与 PanelRegistry 的分工：
 * - PanelRegistry 管「场景 / 插件贡献的面板」，内容来自场景包
 * - HostPartRegistry 管「宿主自己拆出来的部件」，内容来自客户端
 *
 * 区域树里的 part 节点按下标（id）到这里取组件。部件被拆成独立组件之后，
 * 场景既能用声明式树摆放，也能通过 SDK 拿组件自己组合。
 *
 * 单实例约束不在这里兜底：同一 part id 在树里出现两次时，校验层早已拒绝
 * 整棵树（见 validateRegionTree）。注册表只负责「有这个 id 就渲染它」。
 */

import type { ComponentType } from 'react'
import type { HostPartId, PartPresentation } from '@shared/protocols/scenario-regions'

/**
 * 部件被渲染时的入参。
 *
 * 声明式用法由 RegionRenderer 传入；命令式用法（场景自己渲染组件）由
 * 场景传 presentation / visible / onClose。
 */
export interface HostPartComponentProps {
  /** 呈现形态，缺省按树内外排 */
  presentation?: PartPresentation
  /** 显隐由排版层合成后传入，部件自身不读布局 store */
  visible?: boolean
  /** 抽屉 / 弹窗形态的关闭回调 */
  onClose?: () => void
}

export type HostPartComponent = ComponentType<HostPartComponentProps>

const hostPartRegistry = new Map<HostPartId, HostPartComponent>()

/** 注册部件组件；重复注册时后写入的覆盖先前的，便于热更新 */
export function registerHostPart(id: HostPartId, component: HostPartComponent): void {
  hostPartRegistry.set(id, component)
}

export function unregisterHostPart(id: HostPartId): void {
  hostPartRegistry.delete(id)
}

export function getHostPart(id: HostPartId): HostPartComponent | undefined {
  return hostPartRegistry.get(id)
}

/** 已注册的部件 id，用于开发模式展示「哪些部件还没落地」 */
export function listRegisteredHostParts(): HostPartId[] {
  return [...hostPartRegistry.keys()]
}

/** 测试收尾用：清空注册表 */
export function clearHostParts(): void {
  hostPartRegistry.clear()
}

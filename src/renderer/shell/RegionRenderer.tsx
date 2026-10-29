/**
 * 外壳区域树渲染器
 *
 * 递归消费 RegionNode，把节点替换成调用方提供的实际内容：
 * - slot    → 调用方给的 slot 映射（导航栏 / 标题栏 / 侧边栏 / 主区 / 状态栏）
 * - panel   → PanelRegistry 里注册的组件（场景面板、插件面板）
 * - sandbox → 隔离 webview 里加载的自定义页面
 *
 * 渲染器自身不持有任何布局知识：所有伸缩、溢出、圆角都在节点的 className 里，
 * 因此换一棵树就能换一套布局，渲染路径保持不变。
 */

import { Fragment, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  RegionNode,
  RegionSlotMap,
  RegionSplitNode,
} from '@shared/protocols/scenario-regions'
import { REGION_MAX_DEPTH } from '@shared/protocols/scenario-regions'
import {
  getPanelComponent,
  getPanelHost,
  getPanelRegistryVersion,
  subscribePanelRegistry,
} from '@components/explorer/PanelRegistry'
import { getHostPart } from './HostPartRegistry'
import SandboxFrame from './SandboxFrame'

export interface RegionRendererProps {
  root: RegionNode
  slots: RegionSlotMap
  /**
   * 沙箱地址解析器。
   *
   * 场景 / 插件声明里写的是相对路径（它们不知道自己被装在哪里），
   * 由调用方补上 bundle 根目录。已在解析器内处理过的完整 URL 应原样返回。
   */
  resolveSandboxSrc?: (src: string) => string
  /** 沙箱顶栏的退出按钮回调；不传则不渲染退出按钮 */
  onSandboxExit?: (sandboxId: string) => void
  /**
   * 树深度上限，缺省 REGION_MAX_DEPTH。
   *
   * 接管整壳的场景（shellMode: 'full'）可用更深的嵌套，调用方按档位传
   * REGION_MAX_DEPTH_FULL，否则校验通过的树会在渲染时被截断。
   */
  maxDepth?: number
}

/** 递归过程用的上下文，避免逐层透传多个参数 */
interface RenderContext {
  slots: RegionSlotMap
  maxDepth: number
  resolveSandboxSrc?: (src: string) => string
  onSandboxExit?: (sandboxId: string) => void
}

/** 比例容器的兜底样式：让内层节点无论自身是否有 flex-1 都能撑满被分配的空间 */
const RATIO_WRAPPER_BASE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
}

function buildSplitStyle(node: RegionSplitNode): CSSProperties | undefined {
  if (!node.gap) return undefined
  return { gap: node.gap }
}

/** 未显式给出 className 时的最小可用容器样式 */
function fallbackSplitClassName(dir: RegionSplitNode['dir']): string {
  return dir === 'row' ? 'flex flex-row min-w-0 min-h-0' : 'flex flex-col min-w-0 min-h-0'
}

/**
 * 面板未注册占位
 *
 * 面板 id 拼错、插件被禁用、场景被卸载都会走到这里。画一块明确的提示
 * 比返回 null 好：空白区域看不出是布局问题还是内容没加载，而面板作者
 * 需要的恰恰是「这个 id 找不到」这一条信息。
 */
function PanelPlaceholder({ panelId }: { panelId: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background-secondary p-4 text-center">
      <div className="max-w-xs space-y-1">
        <p className="text-xs font-medium text-text-secondary">面板不可用</p>
        <p className="text-[11px] leading-relaxed break-all text-text-tertiary">{panelId}</p>
        <p className="text-[11px] leading-relaxed text-text-tertiary">
          该面板未注册：插件可能被禁用，或 id 与 contributions 不一致
        </p>
      </div>
    </div>
  )
}

/**
 * 渲染单个节点
 *
 * path 同时用于 React key 与调试定位：区域树由数据驱动，出现渲染异常时
 * 只看组件树无法区分是哪个节点，带上路径可以一路追到数据源头。
 */
function renderNode(node: RegionNode, ctx: RenderContext, path: string, depth: number): ReactNode {
  if (depth > ctx.maxDepth) return null

  if (node.type === 'slot') {
    if (node.visible === false) return null

    const content = ctx.slots[node.slot]
    if (content === undefined || content === null) return null

    if (!node.className) return content

    return <div className={node.className}>{content}</div>
  }

  if (node.type === 'panel') {
    const Component = getPanelComponent(node.id)
    let body: ReactNode

    if (Component) {
      // 插件面板的宿主 API 由注册表一并存下，场景面板没有 host
      const host = getPanelHost(node.id)
      body = host
        ? <Component {...({ host } as Record<string, unknown>)} />
        : <Component />
    } else {
      body = <PanelPlaceholder panelId={node.id} />
    }

    return node.className ? <div className={node.className}>{body}</div> : body
  }

  if (node.type === 'sandbox') {
    const src = ctx.resolveSandboxSrc ? ctx.resolveSandboxSrc(node.src) : node.src
    const exitHandler = ctx.onSandboxExit ? () => ctx.onSandboxExit!(node.id) : undefined

    const body = <SandboxFrame src={src} title={node.title} onExit={exitHandler} />
    return node.className ? <div className={node.className}>{body}</div> : body
  }
  if (node.type === 'part') {
    const Part = getHostPart(node.id)

    if (!Part) {
      // 部件尚未落地（P2 之前只注册了契约）或场景 SDK 比客户端新。
      // 前者是客户端自己的进度，后者已在校验层告警，这里不再重复刷屏。
      return null
    }

    const body = (
      <Part
        presentation={node.presentation}
        {...((node.props ?? {}) as Record<string, unknown>)}
      />
    )

    // className 只作用于 wrapper：允许换位置，不允许改部件内部视觉
    return node.className ? <div className={node.className}>{body}</div> : body
  }

  if (node.type === 'spacer') {
    return <div key={path} className={node.className ?? 'flex-1'} />
  }

  const containerStyle = buildSplitStyle(node)
  const hasRatio = Array.isArray(node.ratio) && node.ratio.length === node.children.length

  return (
    <div
      key={path}
      className={node.className ?? fallbackSplitClassName(node.dir)}
      style={containerStyle}
    >
      {node.children.map((child, index) => {
        const childPath = `${path}.${index}`
        const rendered = renderNode(child, ctx, childPath, depth + 1)
        if (rendered === null) return null

        // 不分配比例时不额外加 DOM 层：Fragment 只承载 key，渲染结果与手写 JSX 同形
        if (!hasRatio) return <Fragment key={childPath}>{rendered}</Fragment>

        return (
          <div key={childPath} style={{ ...RATIO_WRAPPER_BASE, flex: node.ratio![index] }}>
            {rendered}
          </div>
        )
      })}
    </div>
  )
}

export function RegionRenderer({
  root,
  slots,
  resolveSandboxSrc,
  onSandboxExit,
  maxDepth,
}: RegionRendererProps) {
  // 面板组件在运行时才注册（场景切换、插件 ui.js 懒加载、外部场景 bundle 异步加载）。
  // 订阅注册表版本，注册补齐后重渲染这棵树，否则已经画出来的节点会一直停在
  // 「该面板未注册」占位上 —— 冷启动恢复整壳场景（如视频工坊）时尤其明显。
  useSyncExternalStore(subscribePanelRegistry, getPanelRegistryVersion, getPanelRegistryVersion)

  const ctx: RenderContext = {
    slots,
    maxDepth: maxDepth ?? REGION_MAX_DEPTH,
    resolveSandboxSrc,
    onSandboxExit,
  }
  return <>{renderNode(root, ctx, 'root', 0)}</>
}
export default RegionRenderer


/**
 * 右侧抽屉状态
 *
 * 两类目标共用这一份状态，保证「同一时刻只有一个抽屉」：
 * - plugin：插件贡献的面板（如「使用模板」拉起的模板选择器），由 PluginDrawerHost 渲染
 * - panel：宿主内置面板（待办 / 项目 / 知识库 / 邮件中心等），由 PanelDrawerHost 渲染
 *
 * 内置面板不再接管主内容区：点击左侧菜单只是在这里登记目标，主区域的对话与
 * 工作内容保持原样，抽屉关掉就回到原来的地方，不需要再还原一次布局。
 *
 * 用独立的小 store 而不是并入全局 store，是因为它只服务于抽屉这一处，
 * 生命周期短、写入稀疏，没必要让整个应用为它重渲染。
 */

import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * 抽屉宽度
 *
 * - md：420px，插件默认窄档，服务「唤出即用」的小面板
 * - lg：920px，多列信息的管理型面板（插件 manifest 的 drawerWidth: 'lg'）
 * - xl：1180px，列表 + 详情 + 阅读器这类三栏工作台
 * - full：铺满左侧菜单以外的整个宽度（100vw - 导航栏宽度），随导航栏开合自动变化
 * - number：直接给像素值，内置面板按各自内容密度精确取值
 *
 * md / lg / xl 受 94vw 上限约束，窄屏下不会顶到窗口外；full 本身就是按视口
 * 计算的，上限反而会把它裁掉，因此不受这一约束。
 */
export type PanelDrawerWidth = 'md' | 'lg' | 'xl' | 'full' | number

/** 抽屉要展示的目标 */
export interface PluginDrawerTarget {
  /** 已注册到 PanelRegistry 的面板 id，如 "design-image-gen:templates" 或 "todo-hub" */
  panelId: string
  /** 抽屉标题（英文） */
  title?: string
  /** 抽屉标题（中文） */
  titleZh?: string
  /** 宽度档位，见 PanelDrawerWidth */
  width?: PanelDrawerWidth
  /** 透传给面板组件的附加参数 */
  payload?: Record<string, unknown>
  /** 目标类型：省略按 plugin 处理，保持既有调用点（插件二级选项）不变 */
  kind?: 'plugin' | 'panel'
}

/** 宽度档位 → CSS 宽度；navRailWidth 只对 full 生效，为左侧菜单占用的像素 */
export function resolvePanelDrawerWidth(width?: PanelDrawerWidth, navRailWidth = 0): string {
  if (width === 'full') return `calc(100vw - ${Math.max(0, Math.round(navRailWidth))}px)`
  if (typeof width === 'number') return `${Math.max(320, Math.round(width))}px`
  if (width === 'xl') return '1180px'
  if (width === 'lg') return '920px'
  return '420px'
}

/**
 * 抽屉内部控制句柄
 *
 * 面板组件不一定知道自己是「整页」还是「抽屉」里渲染的，但它自带的关闭按钮
 * 必须关掉当前这一层。内置面板从 context 取，取不到说明不在抽屉里，走原逻辑。
 */
export interface PanelDrawerControl {
  /** 关闭抽屉：面板内的关闭按钮统一走这里 */
  close: () => void
}

export const PanelDrawerContext = createContext<PanelDrawerControl | null>(null)

/** 读取当前面板是否渲染在抽屉内（不在抽屉里返回 null） */
export function usePanelDrawer(): PanelDrawerControl | null {
  return useContext(PanelDrawerContext)
}

let current: PluginDrawerTarget | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

export function subscribePluginDrawer(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPluginDrawerTarget(): PluginDrawerTarget | null {
  return current
}

/** 打开抽屉；重复打开同一个面板时只更新标题与参数，不重置已挂载的组件状态 */
export function openPluginDrawer(target: PluginDrawerTarget): void {
  if (!target?.panelId) return
  current = { ...target }
  notify()
}

/**
 * 打开宿主内置面板
 *
 * 与插件抽屉共用同一个槽位：打开内置面板会顶掉插件抽屉，反之亦然，
 * 不会出现两层浮层叠在一起。
 */
export function openPanelDrawer(target: Omit<PluginDrawerTarget, 'kind'>): void {
  if (!target?.panelId) return
  current = { ...target, kind: 'panel' }
  notify()
}

export function closePluginDrawer(): void {
  if (!current) return
  current = null
  notify()
}

/**
 * 内置面板的抽屉宽度
 *
 * 菜单、工作台卡片、设置页都会打开这些面板，宽度只应有一处定义，
 * 否则同一个面板从不同入口打开会一宽一窄。
 *
 * 这些面板都是列表 + 详情型的协作界面，列越多人越挤，统一取 full —
 * 铺满左侧菜单以外的宽度，导航栏展开 / 收起时跟着让位，窗口变大也不会留空边。
 * 待办中心单列表也能铺满：条目含来源、优先级、截止日期与操作按钮，
 * 窄档下容易被挤成两三行，全屏反而更好扫读。
 */
export const PANEL_DRAWER_WIDTHS: Record<string, PanelDrawerWidth> = {
  'todo-hub': 'full',
  projects: 'full',
  automation: 'full',
  knowledge: 'full',
  'mail-center': 'full',
  'plugin-market': 'full',
  'ai-browser': 'full',
}

/** 该面板是否以抽屉形式打开 */
export function isBuiltinDrawerPanel(panelId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PANEL_DRAWER_WIDTHS, panelId)
}

/**
 * 按面板 id 打开内置面板
 *
 * 只认 id：宽度查 PANEL_DRAWER_WIDTHS，标题由抽屉宿主按当前场景的
 * sidebarItems 声明兜底，调用方不用各自准备中英双份文案。
 */
export function openBuiltinPanel(panelId: string): void {
  if (!panelId) return
  openPanelDrawer({ panelId, width: PANEL_DRAWER_WIDTHS[panelId] })
}

/** 关闭当前抽屉（内置面板与插件面板通用） */
export function closePanelDrawer(): void {
  closePluginDrawer()
}

/** React 侧读取当前抽屉目标 */
export function usePluginDrawerTarget(): PluginDrawerTarget | null {
  return useSyncExternalStore(subscribePluginDrawer, getPluginDrawerTarget, getPluginDrawerTarget)
}

/** 语义别名：内置面板侧读同一份状态 */
export const usePanelDrawerTarget = usePluginDrawerTarget

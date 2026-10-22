/**
 * 外壳区域树（Region Tree）
 *
 * 主窗口的固定槽位（导航栏 / 标题栏 / 侧边栏 / 主内容区 / 状态栏）在这里被描述成
 * 一棵可递归的布局树，由 RegionRenderer 逐层渲染。渲染器只负责摆放，槽位里放什么
 * 由调用方通过 slot 映射提供。
 *
 * 目前树由客户端按固定结构生成，与改造前的 JSX 层级一一对应；后续要支持场景自定义
 * 布局，只需更换树的来源（如从 ScenarioUI 读取），渲染路径无需改动。
 */

import type { ReactNode } from 'react'

/**
 * 外壳可摆放的槽位。
 *
 * rail / titlebar / sidebar / main / statusbar 由外壳层直接摆放；
 * chat / editor 位于主内容区内部，由主内容区自己的区域树消费，外壳层不直接使用。
 */
export type UISlot =
  | 'rail'
  | 'titlebar'
  | 'sidebar'
  | 'main'
  | 'statusbar'
  | 'chat'
  | 'editor'

export type RegionSplitDir = 'row' | 'col'

/** 容器节点：按行或列排布子区域 */
export interface RegionSplitNode {
  type: 'split'
  dir: RegionSplitDir
  /**
   * 容器样式。
   *
   * 不提供时按 dir 生成最小可用的 flex 容器；需要精确控制伸缩行为
   * （flex-1 / min-w-0 / overflow 等）时应显式给出，避免依赖兜底样式。
   */
  className?: string
  /**
   * 子区域比例，长度需与 children 一致。
   *
   * 提供时会为每个子区域额外包一层 flex 容器来承载比例；不提供时子区域的
   * 伸缩完全由其自身 className 决定，DOM 层级与手写 JSX 一致。
   */
  ratio?: number[]
  /** 子区域间距（像素） */
  gap?: number
  children: RegionNode[]
}

/** 槽位节点：引用一个由调用方提供内容的固定区域 */
export interface RegionSlotNode {
  type: 'slot'
  slot: UISlot
  /** false 时整块不渲染，缺省为 true */
  visible?: boolean
  /** 槽位包裹层样式，部分槽位需要外层 flex 容器才能正确占位 */
  className?: string
}

/**
 * 面板节点：引用一个已注册的面板组件。
 *
 * id 与 PanelRegistry 的键一致 —— 场景面板用 sidebarItems[].id，
 * 插件面板用 contributes.sidebarPanels[].id。插件面板的宿主 API
 * 由注册表一并保存，渲染时作为 props.host 传入。
 */
export interface RegionPanelNode {
  type: 'panel'
  id: string
  props?: Record<string, unknown>
  /** 包裹层样式；面板需要显式撑满时给出 */
  className?: string
}

/**
 * 沙箱节点：在隔离的 webview 里加载一段自定义页面。
 *
 * 用于数据大屏、游戏化交互这类「整块界面都要自定义」的需求。
 * 页面跑在独立渲染进程里，只能通过 postMessage 使用宿主能力，
 * 无法直接访问主应用的 store 与 IPC。
 *
 * src 可以写完整 URL（http/https/plugin-bundle/scenario-bundle），
 * 也可以写相对路径 —— 相对路径由调用方通过 RegionRenderer 的
 * resolveSandboxSrc 注入的解析器展开（因为只有调用方知道当前是哪个
 * 场景或插件的 bundle 根目录）。
 */
export interface RegionSandboxNode {
  type: 'sandbox'
  /** 唯一标识，用于 React key 与调试定位 */
  id: string
  /** 页面地址：完整 URL 或由调用方解析的相对路径 */
  src: string
  /** 客户端顶栏显示的标题 */
  title?: string
  className?: string
}

// ============================================
// 宿主部件（part）
// ============================================

/**
 * 外壳放权档位
 *
 * - chrome  ：宿主排壳，场景用 chrome.hideXxx 逐个关元素（缺省）
 * - regions ：场景摆位，内容仍由宿主提供
 * - full    ：场景接管整壳，只保留三项不可移除的部件
 */
export type ScenarioShellMode = 'chrome' | 'regions' | 'full'

/** 部件呈现形态 */
export type PartPresentation = 'inline' | 'drawer' | 'modal'

/**
 * 宿主部件入参
 *
 * 这张表是部件 id 的唯一事实源：新增部件必须同时登记到 HOST_PART_IDS，
 * 漏填会让该 id 在类型层不合法，场景一写就编译报错。
 *
 * 无入参的部件写 Record<string, never> 而不是 {}：空对象类型在 TS 里表示
 * 「任意非 null 值」，等于重新放开了参数，Record<string, never> 才是真正的
 * 「不接受参数」。
 */
export interface PartPropsById {
  chat: { defaultOpen?: boolean; width?: number }
  'chat-history': { expanded?: boolean }
  'rail-user': { expanded?: boolean }
  sidebar: { defaultPanel?: string }
  quota: { placement?: 'compact' | 'full' }
  notifications: { placement?: 'top' | 'bottom' }
  rail: { collapsed?: boolean }

  'scene-switcher': Record<string, never>
  'sidebar-toggle': Record<string, never>
  'window-controls': Record<string, never>
  'drag-region': Record<string, never>
  editor: Record<string, never>
  statusbar: Record<string, never>
}

/** 宿主部件 id，与 PartPropsById 的键一一对应 */
export type HostPartId = keyof PartPropsById

/** 运行时部件清单，用于识别场景比客户端新的未知 id */
export const HOST_PART_IDS: readonly HostPartId[] = [
  'chat',
  'chat-history',
  'sidebar',
  'quota',
  'notifications',
  'rail',
  'rail-user',
  'scene-switcher',
  'sidebar-toggle',
  'window-controls',
  'drag-region',
  'editor',
  'statusbar',
]

/**
 * 保留集：full 档位下必须存在，缺任一项整树拒绝。
 *
 * scene-switcher 是唯一的场景出口，去掉后用户被锁死在一个场景里；
 * window-controls 承担非 macOS 平台的最小化与关闭；drag-region 是无边框
 * 窗口的拖拽依据。三者都没有替代品，因此不做成可配置项。
 */
export const RESERVED_PART_IDS: readonly HostPartId[] = [
  'scene-switcher',
  'window-controls',
  'drag-region',
]

/**
 * 部件节点。
 *
 * 用映射类型生成而不是写成 interface：若写成 interface
 * （id: HostPartId; props?: PartPropsById[HostPartId]），props 取到的是所有
 * 部件入参类型的并集，写 id:'chat' 却传 quota 的 props 也不报错，判别联合
 * 就白做了。映射类型让 id 与 props 同源分发，才能真正按 id 收窄。
 */
export type RegionPartNode = {
  [K in HostPartId]: {
    type: 'part'
    id: K
    /**
     * 缺省 'inline'（按树内外排）。'drawer' / 'modal' 时部件内部把同一份
     * 子树挪到 portal，DOM 父节点变化但组件实例不重建。
     */
    presentation?: PartPresentation
    /** 部件专有入参，类型随 id 联动 */
    props?: PartPropsById[K]
    /** 只作用于渲染器包在部件外面的 wrapper div，不穿透到部件内部 */
    className?: string
  }
}[HostPartId]

/**
 * 占位节点：flex 布局里把两侧内容顶开，缺省 flex-1。
 *
 * 用空的 split 也能凑出占位，但场景会写出 { type:'split', children: [] }
 * 这种畸形结构，校验也拦不住。布局是刚需，就给一等公民待遇。
 */
export interface RegionSpacerNode {
  type: 'spacer'
  className?: string
}

export type RegionNode =
  | RegionSplitNode
  | RegionSlotNode
  | RegionPanelNode
  | RegionSandboxNode
  | RegionPartNode
  | RegionSpacerNode

/** 槽位内容映射：渲染器只摆放，内容由调用方决定 */
export type RegionSlotMap = Partial<Record<UISlot, ReactNode>>

/**
 * 外壳层可摆放的槽位。
 *
 * chat / editor 属于主内容区内部，由主内容区自己的区域树消费：外壳层的槽位映射里
 * 没有它们的内容，场景若把它们写进外壳树，渲染结果是一块空白而不是报错，因此
 * 校验时需要显式限定允许范围。
 */
export const SHELL_SLOTS: readonly UISlot[] = ['rail', 'titlebar', 'sidebar', 'main', 'statusbar']

/** 区域树最大嵌套深度，防御异常数据导致渲染栈溢出 */
export const REGION_MAX_DEPTH = 8

/**
 * full 档位的深度上限。
 *
 * rail | (titlebar / (sidebar | (main / chat))) 这类结构本身已到 5-6 层，
 * 再套一层容器就逼近 8 层上限。接管整壳的场景需要更多嵌套余量。
 */
export const REGION_MAX_DEPTH_FULL = 12

/**
 * 当前客户端支持的区域树契约版本。
 *
 * 场景在 ui.regionsSchemaVersion 里声明自己按哪一版编写；高于此值说明场景比客户端新，
 * 直接渲染可能得到乱版，因此忽略该树并回退默认布局。
 *
 * 版本 2 解锁 part / spacer 节点，与 shellMode 无关：任何档位都可以用。
 */
export const REGIONS_SCHEMA_VERSION = 2

export interface RegionValidationResult {
  ok: boolean
  errors: string[]
  /**
   * 不阻断渲染的问题。
   *
   * 目前只有一类：未知 part id（场景 SDK 比客户端新）。为一个不认识的可选
   * 部件让整棵树失效，代价过大，因此降级为告警 + 渲染时忽略该节点。
   */
  warnings: string[]
}

/**
 * 校验上下文
 *
 * 只传槽位数组时按「不限定档位」处理，保持旧调用点兼容。
 */
export interface RegionValidationContext {
  /** 当前层可用槽位，缺省不限 */
  allowedSlots?: readonly UISlot[]
  /** 放权档位。'full' 时才做保留集与可达性校验 */
  shellMode?: ScenarioShellMode
  /** 平台能力，用于条件化校验（mac 下 window-controls 渲染 null，但仍要求节点存在） */
  capabilities?: { platform: 'mac' | 'win' | 'linux' }
  /** 场景声明的 sidebarItems，用于 rail 缺省时的可达性判断 */
  sidebarItemIds?: readonly string[]
  /** 场景声明的契约版本，缺省 1；低于 2 时不允许出现 part / spacer 节点 */
  regionsSchemaVersion?: number
}

/**
 * 区分旧式「槽位数组」参数与完整上下文。
 *
 * 写成类型守卫而不是直接 Array.isArray：readonly 数组不满足 any[] 的
 * 缩窄条件，直接判断无法让联合类型收窄。
 */
function isSlotArray(
  value: readonly UISlot[] | RegionValidationContext,
): value is readonly UISlot[] {
  return Array.isArray(value)
}

/**
 * 校验区域树
 *
 * 拒绝整树的情况（结构本身不成立，或安全边界被突破）：
 * - 同一槽位 / 同一部件重复引用：会挂载两份实例，会话流与编辑器状态各走一套
 * - ratio 长度与子节点数量不匹配、必填字段缺失
 * - 嵌套过深（full 档位 12 层，其余 8 层）
 * - 引用了当前层不存在的槽位
 * - full 档位缺保留件，或 rail 缺省又没有任何面板入口（产出死界面）
 *
 * 只告警不拒绝的情况：
 * - 未知 part id（场景 SDK 比客户端新），渲染时忽略该节点即可
 *
 * 第二参数既可传槽位数组（旧调用点），也可传完整上下文。
 */
export function validateRegionTree(
  root: RegionNode,
  ctxOrSlots?: readonly UISlot[] | RegionValidationContext,
): RegionValidationResult {
  const ctx: RegionValidationContext =
    ctxOrSlots === undefined
      ? {}
      : isSlotArray(ctxOrSlots)
        ? { allowedSlots: ctxOrSlots }
        : ctxOrSlots


  const { allowedSlots, shellMode, sidebarItemIds } = ctx
  const schemaVersion = ctx.regionsSchemaVersion ?? 1
  const isFull = shellMode === 'full'
  const maxDepth = isFull ? REGION_MAX_DEPTH_FULL : REGION_MAX_DEPTH
  const partsUnlocked = schemaVersion >= 2

  const errors: string[] = []
  const warnings: string[] = []
  const seenSlots = new Set<UISlot>()
  const seenParts = new Set<HostPartId>()

  // rail 缺省时的可达性判断素材
  const panelIds: string[] = []
  let hasChatPart = false
  let hasRail = false

  const walk = (node: RegionNode, depth: number, path: string): void => {
    if (depth > maxDepth) {
      errors.push(`${path}: 嵌套深度超过 ${maxDepth} 层`)
      return
    }

    if (node.type === 'slot') {
      if (allowedSlots && !allowedSlots.includes(node.slot)) {
        errors.push(
          `${path}: 槽位 "${node.slot}" 不属于当前层，可用槽位为 ${allowedSlots.join(' / ')}`,
        )
      }
      if (seenSlots.has(node.slot)) {
        errors.push(`${path}: 槽位 "${node.slot}" 被重复引用`)
      }
      seenSlots.add(node.slot)
      if (node.slot === 'rail') hasRail = true
      return
    }

    if (node.type === 'split') {
      if (node.ratio && node.ratio.length !== node.children.length) {
        errors.push(
          `${path}: ratio 长度 ${node.ratio.length} 与子节点数量 ${node.children.length} 不一致`,
        )
      }
      node.children.forEach((child, index) => {
        walk(child, depth + 1, `${path}.children[${index}]`)
      })
      return
    }

    if (node.type === 'part') {
      if (!partsUnlocked) {
        errors.push(`${path}: 部件节点需要 regionsSchemaVersion 2，当前为 ${schemaVersion}`)
        return
      }

      const partId = node.id as string
      if (!(HOST_PART_IDS as readonly string[]).includes(partId)) {
        warnings.push(`${path}: 未知部件 "${partId}"，渲染时忽略该节点`)
        return
      }

      const id = partId as HostPartId
      if (seenParts.has(id)) {
        errors.push(`${path}: 部件 "${id}" 被重复引用`)
      }
      seenParts.add(id)
      if (id === 'rail') hasRail = true
      if (id === 'chat') hasChatPart = true
      return
    }

    if (node.type === 'spacer') {
      if (!partsUnlocked) {
        errors.push(`${path}: 占位节点需要 regionsSchemaVersion 2，当前为 ${schemaVersion}`)
      }
      return
    }

    if (node.type === 'panel') {
      if (!node.id) {
        errors.push(`${path}: 面板节点缺少 id`)
      } else {
        panelIds.push(node.id)
      }
    }

    if (node.type === 'sandbox') {
      if (!node.id) errors.push(`${path}: 沙箱节点缺少 id`)
      if (!node.src) errors.push(`${path}: 沙箱节点缺少 src`)
    }
  }

  walk(root, 0, 'root')

  if (isFull) {
    RESERVED_PART_IDS.forEach((id) => {
      if (!seenParts.has(id)) errors.push(`root: 缺少保留部件 "${id}"`)
    })

    if (!hasRail) {
      // 面板导航的等价手段：树里有可触达的 sidebarItems 入口，或场景自有的
      // 面板 / 会话部件。全都没有时用户会被关在一个空窗口里，必须拒绝。
      const reachableViaSidebar = (sidebarItemIds ?? []).some((id) => panelIds.includes(id))
      const reachableViaOwnPanel = panelIds.length > 0 || hasChatPart
      if (!reachableViaSidebar && !reachableViaOwnPanel) {
        errors.push('root: 未提供 rail，也没有任何可达的面板入口，用户将被关在空窗口里')
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}


export interface DefaultShellRegionOptions {
  /** 是否显示左侧导航栏 */
  showActivityBar: boolean
  /** 是否显示底部状态栏 */
  showStatusBar: boolean
  /**
   * 布局切换时的淡入淡出类名。
   *
   * 由调用方按动画状态给出，这里只负责拼进根容器样式，不参与任何布局决策。
   */
  animateClass?: string
}

/**
 * 生成默认外壳区域树
 *
 * 结构与改造前的 JSX 完全一致：根容器横排 [导航栏, 主列]，
 * 主列纵排 [标题栏, 中间行, 状态栏]，中间行横排 [侧边栏, 主内容区]。
 */
export function buildDefaultShellRegions(options: DefaultShellRegionOptions): RegionNode {
  const { showActivityBar, showStatusBar, animateClass = '' } = options

  return {
    type: 'split',
    dir: 'row',
    className: `flex h-full w-full overflow-hidden transition-opacity duration-300 ${animateClass}`.trim(),
    children: [
      { type: 'slot', slot: 'rail', visible: showActivityBar },
      {
        type: 'split',
        dir: 'col',
        className: 'flex-1 flex flex-col min-w-0',
        children: [
          { type: 'slot', slot: 'titlebar' },
          {
            type: 'split',
            dir: 'row',
            className: 'flex-1 flex min-w-0 overflow-hidden',
            children: [
              { type: 'slot', slot: 'sidebar' },
              {
                type: 'slot',
                slot: 'main',
                className: 'flex-1 flex min-w-0 bg-background relative',
              },
            ],
          },
          { type: 'slot', slot: 'statusbar', visible: showStatusBar },
        ],
      },
    ],
  }
}

/**
 * 插件区域树构建
 *
 * 把 manifest 里的 PluginRegionNode（纯数据、无 slot 变体）转成渲染器消费的
 * RegionNode，并在转换过程中做两件事：
 *
 * 1. 沙箱地址解析：插件写的是相对自己根目录的路径，这里补成 plugin-bundle://
 *    地址 —— 插件不可能知道自己被装到哪儿。
 * 2. 结构校验：JSON 是外部输入，可能有 slot、重复面板、ratio 长度不对等。
 *    校验不通过就整棵丢弃（回退默认面板视图），而不是渲染一棵半坏的树。
 */

import type { PluginContributes, PluginRegionNode } from '@shared/plugin-sdk/types'
import type { RegionNode } from '@shared/protocols/scenario-regions'
import { validateRegionTree } from '@shared/protocols/scenario-regions'
import { buildPluginBundleUrl } from './rewriteBareSpecifiers'

/** 插件面板块包裹样式：撑满被分配的空间 */
const PANEL_FILL_CLASS = 'flex-1 min-h-0 min-w-0 overflow-hidden'

export interface BuildPluginRegionsOptions {
  pluginKey: string
  /** 插件根目录绝对路径（ui.js 所在目录） */
  pluginRootAbsDir: string
  contributes: PluginContributes
  /**
   * primaryView 归一化后的面板 id。
   *
   * primaryView 是「单个组件占满主区域」的简写，内部统一转成
   * { type:'panel', id } 的一格树，渲染路径只剩 regions 一条。
   * 未声明 primaryView 时传 undefined。
   */
  primaryPanelId?: string
}

/** 已是完整地址时不重复拼接 */
function isAbsoluteUrl(src: string): boolean {
  return /^(https?:|plugin-bundle:|scenario-bundle:|file:|data:)/i.test(src)
}

/**
 * 递归转换并解析沙箱地址
 *
 * 只在 sandbox 节点上动手，其余节点原样透传 —— 转换阶段不改变布局语义。
 */
function convertNode(node: PluginRegionNode, pluginRootAbsDir: string): RegionNode {
  if (node.type === 'split') {
    return {
      type: 'split',
      dir: node.dir,
      ratio: node.ratio,
      gap: node.gap,
      className: node.className,
      children: node.children.map((child) => convertNode(child, pluginRootAbsDir)),
    }
  }

  if (node.type === 'sandbox') {
    // 空 src 必须原样留空交给校验阶段拦下：直接拼 URL 会得到一个指向目录的
    // 地址（plugin-bundle://.../），校验看起来通过，运行时却是一个空白页
    const rawSrc = node.src?.trim()
    return {
      type: 'sandbox',
      id: node.id,
      src: rawSrc
        ? (isAbsoluteUrl(rawSrc) ? rawSrc : buildPluginBundleUrl(pluginRootAbsDir, rawSrc))
        : '',
      title: node.title,
      className: node.className,
    }
  }

  return {
    type: 'panel',
    id: node.id,
    className: node.className ?? PANEL_FILL_CLASS,
  }
}

/**
 * 构建插件的面板区域树
 *
 * 返回 undefined 表示没有可用声明（或声明非法），调用方应回退默认面板视图。
 */
export function buildPluginRegions(options: BuildPluginRegionsOptions): RegionNode | undefined {
  const { pluginKey, pluginRootAbsDir, contributes, primaryPanelId } = options

  let root: RegionNode | undefined

  if (contributes.regions) {
    root = convertNode(contributes.regions, pluginRootAbsDir)
  } else if (contributes.primaryView?.component && primaryPanelId) {
    root = { type: 'panel', id: primaryPanelId, className: PANEL_FILL_CLASS }
  }

  if (!root) return undefined

  // 插件不能引用任何外壳槽位：allowedSlots 传空数组，任何 slot 都会被判为越界
  const result = validateRegionTree(root, [])
  if (!result.ok) {
    console.warn(
      `[PluginRegions] 插件 ${pluginKey} 的 regions 校验未通过，回退默认面板视图：${result.errors.join('；')}`,
    )
    return undefined
  }

  return root
}

/**
 * 预览 Tab 常驻挂载的选择逻辑
 *
 * 内置浏览器预览 Tab 采用「常驻挂载」：切走只隐藏，不卸载 webview。
 * 卸载会销毁 webview → 主进程解绑该会话的健康采集与自动化记录
 * （PreviewHealthMonitor.detach），表现为「标签页还在，但 AI 定位不到」，
 * 且切回来要整页重载。
 *
 * 但每个挂载的 Tab 都持有一个 webview（独立渲染进程），长会话里 AI 陆续打开
 * 多个页面时全部保活会持续堆积内存。这里收敛为「当前激活 + 最近使用」的
 * 前若干个：当前激活的必须挂载（否则页面区域空白），其余按最近使用排序补齐。
 * 超出上限的 Tab 仍留在标签栏，切到前台时按最近使用重新进入保活集合。
 *
 * 抽成纯函数是为了能脱离 React 单独验证排序与取舍边界。
 */

/** 参与选择的最小字段集合（与 store 的 OpenFile 结构解耦，便于测试） */
export interface MountablePreviewTab {
    path: string
    lastAccessed?: number
}

/**
 * 选出需要常驻挂载的预览 Tab
 *
 * @param tabs 全部预览 Tab（顺序不限）
 * @param activePath 当前激活的文件路径；非预览或为空时按纯最近使用取舍
 * @param maxMounted 挂载数量上限
 * @returns 需要挂载的 Tab 列表；未超上限时原样返回（保持引用，避免无谓重渲染）
 */
export function selectMountedPreviewTabs<T extends MountablePreviewTab>(
    tabs: T[],
    activePath: string | null,
    maxMounted: number,
): T[] {
    if (maxMounted <= 0) return []
    if (tabs.length <= maxMounted) return tabs

    // 当前激活的预览 Tab 必须挂载，否则页面区域会空白
    const active = activePath ? tabs.find((tab) => tab.path === activePath) : undefined

    // 有激活项时为它保留一个席位；没有激活项（用户切到非预览 Tab）时名额全归最近使用
    const restLimit = active ? maxMounted - 1 : maxMounted
    const rest = tabs
        .filter((tab) => tab.path !== activePath)
        .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))
        .slice(0, restLimit)

    return active ? [active, ...rest] : rest
}

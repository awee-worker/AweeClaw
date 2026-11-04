/**
 * 站点后台窗口的页面事件协议
 *
 * 站点托管的自动化跑在主进程的隐藏窗口里，用户看得见的是内置浏览器的 webview。
 * 两边共用同一个 persist 分区，却是两个独立的 webContents：隐藏窗口翻到哪一页，
 * 可见页面完全不知道。于是出现「对话里说已打开订单统计页，屏幕上还停在原来的列表」。
 *
 * 主进程把隐藏窗口的页面变化推给渲染进程，由内置浏览器把可见页面带到同一地址。
 *
 * @module protocols/siteBrowserProtocol
 */

/** 页面事件推送频道（main → render） */
export const SITE_BROWSER_PAGE_CHANNEL = 'site-browser:page'

/**
 * 事件来源
 *
 * - navigate：主文档加载完成（整页跳转）
 * - in-page：同文档路由切换（SPA 的 pushState / replaceState / hash 变化）
 * - title：页面标题变化
 */
export type SiteBrowserPageKind = 'navigate' | 'in-page' | 'title'

/** 站点后台窗口的一次页面变化 */
export interface SiteBrowserPageEvent {
  /** 站点 ID，与内置浏览器当前承载的站点比对 */
  siteId: string
  /** 变化后的地址 */
  url: string
  /** 变化后的页面标题；取不到时为空串 */
  title: string
  kind: SiteBrowserPageKind
}

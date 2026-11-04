/**
 * 站点后台窗口 API
 *
 * 覆盖 IPC 频道：
 * - site-browser:page   站点后台窗口的页面变化推送（main → render）
 *
 * 站点托管的自动化跑在主进程的隐藏窗口里（见 plugin-sdk/SiteBrowserBridge），
 * 内置浏览器需要知道它翻到了哪一页，才能把可见页面同步过去。
 */
import { on } from '../ipcHelpers'
import {
  SITE_BROWSER_PAGE_CHANNEL,
  type SiteBrowserPageEvent,
} from '../../../shared/protocols/siteBrowserProtocol'

export function createSiteBrowserApi() {
  return {
    /**
     * 订阅站点后台窗口的页面变化
     *
     * 事件带 siteId，消费方按自己当前承载的站点过滤：同一台机器上可能同时有
     * 多个站点窗口在跑，别的站点的跳转与这里的页面无关。
     */
    onPage: on<SiteBrowserPageEvent>(SITE_BROWSER_PAGE_CHANNEL),
  }
}

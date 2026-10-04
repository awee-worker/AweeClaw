/**
 * MailCenterView — 邮件中心（宽屏面板）
 *
 * 在主窗口内以宽屏面板形式承载邮件中心，不再单独开窗口：
 * 复用独立窗口那套三栏界面（账户与文件夹 → 邮件列表 → 阅读器），
 * 因此 MailCenterApp 只负责界面与数据，本组件只提供撑满主区域的容器。
 *
 * 使用方式：场景 ui.sidebarItems 声明 { id: 'mail-center', component: 'MailCenterView',
 * wideMode: true, hideChat: true }，点击左侧「邮件中心」即接管主内容区。
 */

import { MailCenterApp } from '@components/mail-center/MailCenterApp'

export function MailCenterView() {
  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <MailCenterApp />
    </div>
  )
}

export default MailCenterView

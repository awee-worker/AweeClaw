/**
 * 宿主部件注册入口
 *
 * 所有从这里导出的组件都已登记到 HostPartRegistry，区域树里写
 * { type: 'part', id: 'xxx' } 即可摆放。注册动作由 AweeApp 在模块加载时
 * 触发一次：AweeApp 本身是懒加载的，注册紧随其后同 chunk 执行，早于首次渲染，
 * 因此不会出现「部件还没注册所以渲染成空白」的闪动。
 *
 * 新增部件时三处要同步：
 * 1. shared/protocols/scenario-regions.ts 的 PartPropsById / HOST_PART_IDS
 * 2. 本目录下的部件文件
 * 3. 本文件的注册表
 *
 * 注册表必须覆盖 HOST_PART_IDS 全集：漏注册的 id 能通过校验却在渲染时
 * 返回 null，表现为「照文档写了部件，界面上什么都没有」。parts.test.ts
 * 守住这条不变量。
 */

import { registerHostPart } from '../HostPartRegistry'
import SceneSwitcherPart from './SceneSwitcherPart'
import DragRegionPart from './DragRegionPart'
import DividerPart from './DividerPart'
import NotificationsPart from './NotificationsPart'
import QuotaPart from './QuotaPart'
import SidebarTogglePart from './SidebarTogglePart'
import WindowControlsPart from './WindowControlsPart'
import ChatPart from './ChatPart'
import ChatHistoryPart from './ChatHistoryPart'
import RailUserPart from './RailUserPart'
import RailPart from './RailPart'
import SidebarPart from './SidebarPart'
import EditorPart from './EditorPart'
import StatusbarPart from './StatusbarPart'

export {
  SceneSwitcherPart,
  DragRegionPart,
  DividerPart,
  NotificationsPart,
  QuotaPart,
  SidebarTogglePart,
  WindowControlsPart,
  ChatPart,
  ChatHistoryPart,
  RailUserPart,
  RailPart,
  SidebarPart,
  EditorPart,
  StatusbarPart,
}

let registered = false

/** 注册客户端自带的全部宿主部件；重复调用无副作用 */
export function registerDefaultHostParts(): void {
  if (registered) return
  registered = true

  registerHostPart('scene-switcher', SceneSwitcherPart)
  registerHostPart('drag-region', DragRegionPart)
  registerHostPart('divider', DividerPart)
  registerHostPart('notifications', NotificationsPart)
  registerHostPart('quota', QuotaPart)
  registerHostPart('sidebar-toggle', SidebarTogglePart)
  registerHostPart('window-controls', WindowControlsPart)
  registerHostPart('chat', ChatPart)
  registerHostPart('chat-history', ChatHistoryPart)
  registerHostPart('rail-user', RailUserPart)
  registerHostPart('rail', RailPart)
  registerHostPart('sidebar', SidebarPart)
  registerHostPart('editor', EditorPart)
  registerHostPart('statusbar', StatusbarPart)
}

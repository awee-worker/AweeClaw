/**
 * 拖拽区域部件（drag-region）
 *
 * 无边框窗口靠 -webkit-app-region: drag 的区域移动窗口。标题栏内容之间需要
 * 一块「没有按钮、可以按住拖走」的余量，该部件就是这块余量：默认 flex-1，
 * 把左右两侧的内容顶开，同时承担拖拽。
 *
 * 场景给出 className 时以场景为准（例如固定宽度、或换成绝对定位铺满）。
 */

import type { HostPartComponentProps } from '../HostPartRegistry'

export function DragRegionPart({ presentation: _presentation }: HostPartComponentProps) {
  return <div className="drag-region flex-1 min-w-0 h-full" aria-hidden />
}

export default DragRegionPart

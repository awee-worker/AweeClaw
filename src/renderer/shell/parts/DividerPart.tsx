/**
 * 分隔线部件（divider）
 *
 * 顶栏右侧往往把「套餐 / 消息 / 账号」几个入口并排放，任何两个相邻入口之间
 * 都可能需要一条细线把不同职责分开。用 spacer 撑开只能表达间距，用 border
 * 挂在某个入口上又会让该入口在缺省状态下多一道边（未登录时套餐入口不渲染，
 * 线还留在原地）。单独抽一个部件，场景就能独立摆放、独立移除。
 *
 * 尺寸取舍：竖线宽度 1px、高度 16px，与标题栏里场景 / 工作空间之间的分隔
 * 保持一致；不带外边距，间距交给容器 gap 决定，避免与场景自己的布局叠加。
 */

import type { HostPartComponentProps } from '../HostPartRegistry'

export interface DividerPartProps extends HostPartComponentProps {
  /** 线方向，缺省竖线（顶栏场景） */
  orientation?: 'vertical' | 'horizontal'
}

export function DividerPart({ orientation = 'vertical' }: DividerPartProps) {
  const isVertical = orientation !== 'horizontal'

  return (
    <div
      aria-hidden
      className={
        isVertical
          ? 'w-[1px] h-4 bg-border/60 shrink-0'
          : 'h-[1px] w-full bg-border/60 shrink-0'
      }
    />
  )
}

export default DividerPart

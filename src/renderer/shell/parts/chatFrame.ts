/**
 * 对话部件的外框计算
 *
 * 拆成纯函数的理由：外框（inline / drawer / modal、显隐、宽度策略）决定的是
 * 「这块对话区怎么摆」，与对话内容本身无关。把计算抽出来之后，可以单测一条关键
 * 不变量 —— 任何呈现形态下内容的子结构标识完全一致，切换形态只换外框，
 * 因此 ChatPanel 实例不会被重建。
 *
 * 部件内部据此渲染：外框是唯一随 presentation / visible 变化的节点，
 * 内容子树始终挂在同一个位置。
 */

import type { CSSProperties } from 'react'
import type { PartPresentation } from '@shared/protocols/scenario-regions'

/** 内容子树的稳定标识：所有呈现形态共用同一个值，切换时不得变化 */
export const CHAT_CONTENT_KEY = 'chat-body'

export interface ChatFrameInput {
  /** 呈现形态，缺省 inline */
  presentation?: PartPresentation
  /** 显隐，由排版层合成后传入 */
  visible: boolean
  /** 非弹性模式下的宽度（像素） */
  width: number
  /** 是否撑满剩余空间（primary 模式且左侧无内容） */
  flexible: boolean
  /** 非弹性模式下的最小宽度（像素） */
  minWidth: number
}

export interface ChatFrame {
  /** 外框内联样式 */
  style: CSSProperties
  /** 外框类名 */
  className: string
  /** 是否渲染拖拽手柄 */
  resizable: boolean
  /** 是否需要遮罩层 */
  needsBackdrop: boolean
  /**
   * 内容子树标识。
   *
   * 恒为 CHAT_CONTENT_KEY：外框怎么变都不影响内容结构，这是「切换形态不重挂载」
   * 的结构前提，由单测守住。
   */
  contentKey: string
}

/**
 * 计算对话外框
 *
 * 隐藏时不用条件渲染、只用样式收起：
 * - inline：display:none，不占位，等同原先「不渲染」的视觉效果
 * - drawer：滑出视口外并禁用交互，保留过渡动画
 * - modal：透明且不可交互，保留居中变换，避免下一次展开时位置跳变
 */
export function resolveChatFrame(input: ChatFrameInput): ChatFrame {
  const { presentation = 'inline', visible, width, flexible, minWidth } = input
  const presentationKind = presentation === 'drawer' || presentation === 'modal' ? presentation : 'inline'

  if (presentationKind === 'drawer') {
    const style: CSSProperties = {
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width,
      maxWidth: '92vw',
      zIndex: 60,
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
      transition: 'transform 200ms ease-out',
    }
    return {
      style,
      className: 'border-l border-border/30 chat-surface-solid shadow-[-8px_0_24px_rgba(0,0,0,0.12)] flex flex-col',
      resizable: false,
      needsBackdrop: visible,
      contentKey: CHAT_CONTENT_KEY,
    }
  }

  if (presentationKind === 'modal') {
    const style: CSSProperties = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: 'min(1200px, 92vw)',
      height: '86vh',
      zIndex: 70,
      transform: 'translate(-50%, -50%)',
      opacity: visible ? 1 : 0,
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
      transition: 'opacity 160ms ease-out',
    }
    return {
      style,
      className: 'border border-border/40 rounded-xl chat-surface-solid shadow-[0_24px_64px_rgba(0,0,0,0.28)] overflow-hidden flex flex-col',
      resizable: false,
      needsBackdrop: visible,
      contentKey: CHAT_CONTENT_KEY,
    }
  }

  const style: CSSProperties = visible
    ? {
        width: flexible ? undefined : width,
        minWidth: flexible ? undefined : minWidth,
        flex: flexible ? '1 1 0%' : undefined,
      }
    : { display: 'none' }

  return {
    style,
    className: flexible
      ? 'relative min-w-0 border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 chat-surface'
      : 'relative flex-shrink-0 border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 chat-surface',
    resizable: visible && !flexible,
    needsBackdrop: false,
    contentKey: CHAT_CONTENT_KEY,
  }
}

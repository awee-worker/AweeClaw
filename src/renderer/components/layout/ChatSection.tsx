/**
 * 聊天面板区域组件
 *
 * 实现已迁到宿主部件 shell/parts/ChatPart.tsx（part id: chat）。这里保留原有调用
 * 签名，既有布局分支无需改动；行为上只改了一处关键点：visible=false 时不再
 * return null，而是把外框收起（display:none），对话子树保持挂载 —— 展开时不必
 * 重建 ChatPanel，消息 DOM、虚拟列表与滚动位置都还在。
 *
 * 需要抽屉 / 弹窗形态时直接用 ChatPart，并把 presentation 交给排版层决定。
 */

import { ChatPart } from '@renderer/shell/parts/ChatPart'

interface ChatSectionProps {
  /** 是否显示聊天面板 */
  visible: boolean
  /** 布局模式：primary 对应 chatPosition=primary，secondary 对应其他 */
  mode?: 'primary' | 'secondary'
  /** 是否有文件打开，用于控制宽度行为 */
  hasFile?: boolean
}

export default function ChatSection({ visible, mode = 'secondary', hasFile }: ChatSectionProps) {
  return <ChatPart presentation="inline" visible={visible} chatMode={mode} hasFile={hasFile} />
}

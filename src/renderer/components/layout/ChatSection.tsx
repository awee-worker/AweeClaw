/**
 * 聊天面板区域组件
 *
 * 封装 ChatPanel 的懒加载、ErrorBoundary、宽度拖拽调整逻辑。
 * 从 AweeApp.tsx 中提取，消除两种布局模式下的重复代码。
 *
 * 支持两种模式：
 * - primary: Chat 在主内容区右侧，带最小宽度约束
 * - secondary: Chat 在侧边栏右侧，无最小宽度约束
 */

import { Suspense, useRef, lazy } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useChatResize } from '@hooks'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { ChatSkeleton } from '@components/ui/ProgressIndicator'

const ChatPanel = lazy(() => import('@components/intelligence/ChatPanel'))

interface ChatSectionProps {
  /** 是否显示聊天面板 */
  visible: boolean
  /** 布局模式：primary 对应 chatPosition=primary，secondary 对应其他 */
  mode?: 'primary' | 'secondary'
}

export default function ChatSection({ visible, mode = 'secondary' }: ChatSectionProps) {
  const { chatWidth, setChatWidth } = useStore(useShallow((s) => ({
    chatWidth: s.chatWidth,
    setChatWidth: s.setChatWidth,
  })))

  const chatRef = useRef<HTMLDivElement>(null)
  const { startResize } = useChatResize(setChatWidth, chatRef)

  if (!visible) return null

  const isPrimary = mode === 'primary'

  return (
    <div
      ref={chatRef}
      style={{ width: chatWidth, ...(isPrimary ? { minWidth: chatWidth } : {}) }}
      className={`flex-shrink-0 relative border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 bg-background-chat ${isPrimary ? 'min-w-[580px]' : ''}`}
    >
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
        onMouseDown={startResize}
      />
      <ErrorBoundary>
        <Suspense fallback={<ChatSkeleton />}>
          <ChatPanel />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

/**
 * 聊天面板区域组件
 *
 * 封装 ChatPanel 的懒加载、ErrorBoundary、宽度拖拽调整逻辑。
 * 从 AweeApp.tsx 中提取，消除两种布局模式下的重复代码。
 *
 * 支持两种模式：
 * - primary: Chat 在主内容区右侧，带最小宽度约束
 * - secondary: Chat 在侧边栏右侧，无最小宽度约束
 *
 * 语音对话模式：
 * 当 voiceConversationActive 为 true 时，在聊天区域上方覆盖 VoiceConversationOverlay，
 * 替代原有聊天界面（非全屏覆盖，仅覆盖聊天面板区域）。
 */

import { Suspense, useRef, lazy, useCallback } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useChatResize } from '@hooks'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { ChatSkeleton } from '@components/ui/ProgressIndicator'
import { LAYOUT } from '@shared/appConstants'

const ChatPanel = lazy(() => import('@components/intelligence/ChatPanel'))
import { VoiceConversationOverlay } from '@components/voice/VoiceConversationOverlay'

interface ChatSectionProps {
  /** 是否显示聊天面板 */
  visible: boolean
  /** 布局模式：primary 对应 chatPosition=primary，secondary 对应其他 */
  mode?: 'primary' | 'secondary'
  /** 是否有文件打开，用于控制宽度行为 */
  hasFile?: boolean
}

export default function ChatSection({ visible, mode = 'secondary', hasFile }: ChatSectionProps) {
  const { chatWidth, setChatWidth, setChatVisible, voiceConversationActive, setVoiceConversationActive } = useStore(useShallow((s) => ({
    chatWidth: s.chatWidth,
    setChatWidth: s.setChatWidth,
    setChatVisible: s.setChatVisible,
    voiceConversationActive: s.voiceConversationActive,
    setVoiceConversationActive: s.setVoiceConversationActive,
  })))

  const chatRef = useRef<HTMLDivElement>(null)

  /** 拖拽到最小宽度及以下时自动收起聊天面板，并恢复默认宽度以便下次打开 */
  const handleCollapse = useCallback(() => {
    setChatWidth(LAYOUT.CHAT_DEFAULT_WIDTH)
    setChatVisible(false)
  }, [setChatWidth, setChatVisible])

  const { startResize } = useChatResize(setChatWidth, chatRef, handleCollapse)

  if (!visible) return null

  const isPrimary = mode === 'primary'
  // primary 模式下，无文件时 ChatSection 应占满剩余空间
  const isFlexible = isPrimary && !hasFile

  return (
    <div
      ref={chatRef}
      style={{
        width: isFlexible ? undefined : chatWidth,
        minWidth: isPrimary && !isFlexible ? LAYOUT.CHAT_MIN_WIDTH : undefined,
        flex: isFlexible ? '1 1 0%' : undefined,
      }}
      className={`relative border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 bg-background-chat ${isFlexible ? 'min-w-0' : 'flex-shrink-0'}`}
    >
      {/* 非弹性模式下显示拖拽手柄 */}
      {!isFlexible && (
        <div
          className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
          onMouseDown={startResize}
        />
      )}
      <ErrorBoundary>
        <Suspense fallback={<ChatSkeleton />}>
          <ChatPanel />
        </Suspense>
      </ErrorBoundary>

      {/* 语音对话覆盖层 - 仅覆盖聊天区域 */}
      {voiceConversationActive && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <VoiceConversationOverlay onClose={() => setVoiceConversationActive(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}

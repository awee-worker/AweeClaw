/**
 * 对话部件（chat）
 *
 * 原先这段逻辑长在 layout/ChatSection 里，由 MainContentArea 在多种布局分支中
 * 各写一遍；`visible=false` 时直接 return null，等于把整棵对话子树连带 ChatPanel
 * 卸载掉。ChatPanel 携带整段消息 DOM、虚拟列表与滚动位置，重挂载一次就是主窗口
 * 卡顿 + 画面跳动。
 *
 * 收成宿主部件之后职责划清：
 * - 显隐优先取排版层传入的 visible；没有传入时跟随 store 里的 chatVisible；
 * - 呈现形态（presentation）只改变外框，内容子树结构恒定（见 chatFrame）；
 * - 因此 inline / drawer / modal 之间切换，以及展开 / 收起，都不重建 ChatPanel。
 *
 * 为什么抽屉形态要读 chatVisible：抽屉需要被外部重新打开。历史会话条目、
 * 全局快捷键、菜单项调用的都是 setChatVisible，部件若完全不看这个状态，
 * 用户关掉抽屉后无论点什么都打不开，只能刷新。`props.defaultOpen` 因此只
 * 在取值变化时写一次初值（场景切换复用同一实例也按新值重算），之后一律
 * 跟随 store，避免两处状态长期分叉。
 *
 * 两条使用路径：
 * - 声明式：区域树写 { type: 'part', id: 'chat', presentation: 'drawer' }
 * - 命令式：场景直接渲染 <ChatPart visible={...} />
 */

import { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { useShallow } from 'zustand/react/shallow'
import { useChatResize } from '@hooks'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { ChatSkeleton } from '@components/ui/ProgressIndicator'
import { LAYOUT } from '@shared/appConstants'
import { VoiceConversationOverlay } from '@components/voice/VoiceConversationOverlay'
import type { HostPartComponentProps } from '../HostPartRegistry'
import { CHAT_CONTENT_KEY, resolveChatFrame } from './chatFrame'

const ChatPanel = lazy(() => import('@components/intelligence/ChatPanel'))

export interface ChatPartProps extends HostPartComponentProps {
  /**
   * 挂载时写入 chatVisible 的初值
   *
   * 只写一次，不做双向同步：之后显隐完全由 visible 或 store 决定，
   * 否则用户关掉抽屉会被初值立刻弹回来。
   *
   * 缺省按形态决定：抽屉 / 弹窗为 false，内排为 true。
   *
   * 抽屉是覆盖层，场景把它写进区域树往往只是「留一个随时可唤出的入口」，
   * 缺省展开会直接压住工作区；内排是常驻一栏，收起会让对话凭空消失。
   * 两种情况都允许场景显式覆盖。
   */
  defaultOpen?: boolean
  /** 期望宽度（像素）；缺省取用户上次拖拽的 chatWidth */
  width?: number
  /**
   * 内排时的宽度策略
   *
   * primary：对话与编辑器并列，左侧无内容时撑满剩余空间；
   * secondary：固定宽度，可拖拽调整。
   */
  chatMode?: 'primary' | 'secondary'
  /** 左侧工作区是否有内容，决定 primary 下是否撑满 */
  hasFile?: boolean
}

export function ChatPart({
  presentation,
  visible,
  onClose,
  defaultOpen,
  width,
  chatMode = 'secondary',
  hasFile,
}: ChatPartProps) {
  /** 抽屉 / 弹窗属于覆盖层，缺省收起；内排是常驻栏位，缺省展开 */
  const resolvedDefaultOpen = defaultOpen ?? (presentation === 'drawer' || presentation === 'modal' ? false : true)
  const {
    chatWidth,
    setChatWidth,
    chatVisible,
    setChatVisible,
    voiceConversationActive,
    setVoiceConversationActive,
    activeScenarioId,
    language,
  } = useStore(
    useShallow((s) => ({
      chatWidth: s.chatWidth,
      setChatWidth: s.setChatWidth,
      chatVisible: s.chatVisible,
      setChatVisible: s.setChatVisible,
      voiceConversationActive: s.voiceConversationActive,
      setVoiceConversationActive: s.setVoiceConversationActive,
      activeScenarioId: s.activeScenarioId,
      language: s.language,
    })),
  )
  /**
   * 初值同步：按「场景 + defaultOpen」的变化执行，离开场景时还原
   *
   * `chatVisible` 是全局状态，别的场景（走 ChatSection 的布局）也读它。
   * 只写不还原的话，进过一次「对话默认收起的场景」再切回去，对话会凭空
   * 消失，用户只能手动打开。
   *
   * 触发条件记的是「已应用过的场景与取值」而不是「是否应用过」：区域树在
   * 场景之间切换时，同名部件可能被 React 复用而不重新挂载，只按挂载计时
   * 的话，新场景声明的初值永远不会生效；而离开再回来时除非重算一次，
   * 抽屉仍会带着上个场景的状态展开。同一场景内这两个值都恒定，因此不会
   * 把用户手动关掉的抽屉弹回来。
   *
   * 用 ref 而不是空依赖数组 + eslint-disable：后者会连带屏蔽掉真正的
   * 依赖遗漏，且以后新增依赖不会有人发现。
   */
  const appliedDefaultRef = useRef<string | null>(null)
  const restoreRef = useRef<boolean | null>(null)
  /** 写入初值时的场景 id：卸载时据此分辨「确实离开场景」与「同场景内的模拟卸载」 */
  const appliedScenarioRef = useRef<string | null>(null)
  useEffect(() => {
    if (visible !== undefined) return
    const appliedKey = `${activeScenarioId ?? ''}:${resolvedDefaultOpen}`
    if (appliedDefaultRef.current === appliedKey) return
    appliedDefaultRef.current = appliedKey
    appliedScenarioRef.current = activeScenarioId ?? null
    const previous = useStore.getState().chatVisible
    if (previous === resolvedDefaultOpen) return
    restoreRef.current = previous
    setChatVisible(resolvedDefaultOpen)
  }, [visible, resolvedDefaultOpen, activeScenarioId, setChatVisible])

  useEffect(() => () => {
    if (restoreRef.current === null) return
    /*
     * 只有场景真的换了才还原。
     *
     * 开发态 StrictMode 把挂载拆成「执行 → 清理 → 再执行」，同场景内的树重排
     * 也会走同一段清理。这两种情况的场景 id 没变，还原会把刚写进去的初值顶
     * 回去，而再执行时 appliedDefaultRef 已记下同一个 key，会直接返回 —— 结果
     * 抽屉停在展开态，用户看到的就是「切进原型工坊，对话抽屉还开着」。
     * 还原值保留在 ref 里，等真正离开这个场景时再写回去。
     */
    if ((useStore.getState().activeScenarioId ?? null) === appliedScenarioRef.current) return
    setChatVisible(restoreRef.current)
    restoreRef.current = null
  }, [setChatVisible])

  const chatRef = useRef<HTMLDivElement>(null)

  /** 拖拽到最小宽度及以下时自动收起聊天面板，并恢复默认宽度以便下次打开 */
  const handleCollapse = useCallback(() => {
    setChatWidth(LAYOUT.CHAT_DEFAULT_WIDTH)
    setChatVisible(false)
  }, [setChatWidth, setChatVisible])

  const { startResize } = useChatResize(setChatWidth, chatRef, handleCollapse)

  const shown = visible ?? chatVisible
  const flexible = chatMode === 'primary' && !hasFile
  const frame = resolveChatFrame({
    presentation,
    visible: shown,
    width: width ?? chatWidth,
    flexible,
    minWidth: LAYOUT.CHAT_MIN_WIDTH,
  })

  const isDetached = presentation === 'drawer' || presentation === 'modal'

  /**
   * 抽屉 / 弹窗形态的关闭
   *
   * 抽屉的可见性由两条状态合成（见 MainContentArea）：chatVisible 决定要不要有
   * 对话栏，chatAsDrawer 只决定它是浮层还是内排。所以关抽屉必须两条一起收：
   * 只写 chatVisible，chatAsDrawer 仍为 true，面板会原地留在右侧；只交给
   * closeChatDrawer，它会按要求把显隐还原成打开前的值，用户先在主界面开着
   * 对话再去浏览器唤起抽屉时，返回后对话又以内排形态顶回来。两种情况看上去
   * 都是「点了没反应」。
   *
   * 顺序不能反：closeChatDrawer 会写 chatVisible，必须由后面的 setChatVisible(false)
   * 把它覆盖掉。排版层的 onClose 放在最后，外部接管时的自定义行为（如切回某个页面）
   * 才不会被前两步的收面板操作打断。
   */
  const handleClose = useCallback(() => {
    const state = useStore.getState()
    if (state.chatAsDrawer) state.closeChatDrawer()
    state.setChatVisible(false)
    if (onClose) onClose()
  }, [onClose])

  return (
    <>
      {/* 遮罩与面板是兄弟节点：遮罩若放进面板内部，会因面板的 transform 建立包含块而失去视口定位 */}
      {frame.needsBackdrop && (
        <div
          key="backdrop"
          aria-hidden
          onClick={handleClose}
          className="fixed inset-0 z-[59] bg-black/30"
        />
      )}
      <div
        key="frame"
        ref={chatRef}
        style={frame.style}
        className={frame.className}
        data-chat-presentation={presentation ?? 'inline'}
      >
        {frame.resizable && (
          <div
            className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
            onMouseDown={startResize}
          />
        )}

        {/* 抽屉顶部栏：左侧返回键关闭抽屉，标题交代这块面板是什么。
            底色与面板同源（chat-surface-solid），内容区滚动时压在它下面，
            不会从顶部透出来。右侧留出关闭图标的位置（pr-10），避免标题压到它。 */}
        {presentation === 'drawer' && shown && (
          <div className="relative z-10 shrink-0 h-11 flex items-center gap-1.5 pl-1.5 pr-10 border-b border-border/60 chat-surface-solid">
            <button
              type="button"
              onClick={handleClose}
              title={t('ctxBack', language)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <span className="text-[13px] font-medium text-text-primary truncate">
              {t('app.aiassistant', language)}
            </span>
          </div>
        )}

        {/* 右上角关闭：抽屉和弹窗都保留，位置固定在浮层右上角 */}
        {isDetached && shown && (
          <button
            type="button"
            onClick={handleClose}
            title="关闭"
            className="absolute top-2 right-2 z-20 w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/*
         * 内容子树：结构与位置在所有呈现形态下保持一致，切换形态不重建 ChatPanel。
         *
         * 定位上下文只给抽屉：ChatPanel 根节点是 absolute inset-0，要贴着有高度的
         * 祖先铺满。抽屉外框是 flex 容器，内容区 flex-1 拿到高度，加上 relative 才能
         * 把聊天区限制在顶栏下方；inline 外框是普通块级盒，flex-1 不生效，内容区
         * 高度由子元素撑开，此时再补 relative 会让它塌成 0，内嵌对话整块消失。
         */}
        <div
          key={CHAT_CONTENT_KEY}
          className={`flex-1 min-h-0 flex flex-col ${presentation === 'drawer' ? 'relative' : ''}`}
        >
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
      </div>
    </>
  )
}

export default ChatPart

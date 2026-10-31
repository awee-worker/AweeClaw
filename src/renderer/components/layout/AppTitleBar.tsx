/**
 * 应用标题栏
 *
 * 该文件只保留「还留在宿主手里、尚未做成独立部件」的部分，其余均已在
 * shell/parts 下拆分并注册到 HostPartRegistry：
 *
 * - scene-switcher  场景 / 工作空间 / 搜索
 * - drag-region     内容之间的拖拽余量
 * - notifications   消息中心 + 服务状态
 * - quota           套餐 / Token 用量
 * - sidebar-toggle  侧边栏与助手开关
 * - window-controls 非 macOS 的最小化 / 最大化 / 关闭
 *
 * 还留在这里的是右侧动作组（新对话、环境安装提示、语音对话、桌面伴侣、
 * 插件贡献按钮），它们没有独立的 part id，等出现第二个使用方再拆。
 */

import { Plus, Phone, Bot, RefreshCw, Loader2, CheckCircle2, X } from 'lucide-react'
import { api } from '../../adapters/electronBridge'
import { useStore } from '@store'
import { closeOverlaysForChat } from '@renderer/utils/chatOverlays'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { resolveUserMenuPlacement } from '@shared/protocols/scenario'
import { useShallow } from 'zustand/react/shallow'
import { useAllThreads, useAgentActions, useRunningThreadIds } from '@hooks/useAgent'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { updaterService, type UpdateStatus } from '@renderer/adapters/updateAdapter'
import { PluginTopActions } from '@renderer/plugins/PluginTopActions'
import { HintOverlay } from '@components/ui/HintOverlay'
import { useClickOutside, useEscapeKey } from '@hooks/usePerformance'
import { BreathingDot } from '@components/ui/BreathingDot'
import { getThreadDisplayTitle, type ChatThread } from '@intelligence/providerTypes'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import ImStatusFloating from './ImStatusFloating'
import { useCallback, useEffect, useRef, useState } from 'react'
import SceneSwitcherPart from '@renderer/shell/parts/SceneSwitcherPart'
import DragRegionPart from '@renderer/shell/parts/DragRegionPart'
import NotificationsPart from '@renderer/shell/parts/NotificationsPart'
import QuotaPart from '@renderer/shell/parts/QuotaPart'
import SidebarTogglePart from '@renderer/shell/parts/SidebarTogglePart'
import WindowControlsPart from '@renderer/shell/parts/WindowControlsPart'
import RailUserPart from '@renderer/shell/parts/RailUserPart'

/**
 * "重启以更新" 按钮
 *
 * 当应用更新下载完成后，在顶部"新对话"按钮前显示一个醒目按钮，
 * 用户点击后触发 quitAndInstall 重启应用安装更新。
 *
 * 订阅 updaterService 状态，仅在 status === 'downloaded' 时显示。
 */
function UpdateReadyButton({ language }: { language: Language }) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const unsubscribe = updaterService.subscribe(status => {
      setUpdateStatus(status)
    })
    // 主动获取一次当前状态（避免订阅前的状态丢失）
    updaterService.getStatus().then(setUpdateStatus).catch(() => {})
    return unsubscribe
  }, [])

  // 仅在更新下载完成后显示
  if (!updateStatus || updateStatus.status !== 'downloaded') return null

  const isZh = language === 'zh'
  const handleInstall = () => {
    if (installing) return
    setInstalling(true)
    try {
      updaterService.installAndRestart()
    } catch {
      setInstalling(false)
    }
  }

  return (
    <button
      onClick={handleInstall}
      disabled={installing}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-60"
      title={isZh ? `重启以更新到 v${updateStatus.version || ''}` : `Restart to update to v${updateStatus.version || ''}`}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${installing ? 'animate-spin' : ''}`} />
      {isZh ? '重启以更新' : 'Restart to Update'}
    </button>
  )
}

/**
 * 「N 个任务正在执行」状态提示
 *
 * 之前的会话还在跑、用户又点了新建任务时，让用户知道后台仍有任务在执行：
 * 计数来自 useRunningThreadIds，点击弹窗列出执行中的会话，点条目跳回该会话。
 * 没有执行中的任务时不渲染，不占顶部空间。
 *
 * 弹层形态与消息中心一致：从提示按钮下方展开的锚定面板（DockPopover 同款
 * 样式与关闭逻辑），不是居中模态 —— 用户扫一眼列表就该能顺手点走。
 */
function RunningTasksIndicator() {
  const language = useStore((s) => s.language)
  const currentThreadId = useAgentStore((s) => s.currentThreadId)
  const runningIds = useRunningThreadIds()
  const allThreads = useAllThreads()
  const { switchThread } = useAgentActions()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 正在看的这条会话不需要提醒：只有不在当前会话界面上的执行中任务才计数
  const backgroundIds = runningIds.filter((id) => id !== currentThreadId)

  useClickOutside(() => setOpen(false), open, [panelRef, triggerRef])
  useEscapeKey(() => setOpen(false), open)

  if (backgroundIds.length === 0) return null

  const isZh = language === 'zh'
  const label = isZh
    ? `${backgroundIds.length} 个任务正在执行`
    : `${backgroundIds.length} task${backgroundIds.length > 1 ? 's' : ''} running`

  /** 从面板进入会话：先收掉挡在聊天区前的浮层，再切到目标会话 */
  const handleOpenThread = (threadId: string) => {
    setOpen(false)
    closeOverlaysForChat()
    void switchThread(threadId)
  }

  const runningThreads = backgroundIds
    .map((id) => allThreads.find((th) => th.id === id))
    .filter((th): th is ChatThread => !!th)

  return (
    <div className="relative">
      <HintOverlay content={label} side="bottom" delay={300}>
        <button
          ref={triggerRef}
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium rounded-md transition-colors ${
            open
              ? 'text-accent bg-accent/15'
              : 'text-accent hover:text-accent-hover hover:bg-accent/10'
          }`}
        >
          <BreathingDot className="w-3.5 h-3.5" />
          <span className="text-xs">{label}</span>
        </button>
      </HintOverlay>
      {open && (
        <div
          ref={panelRef}
          className="absolute top-full right-0 mt-2 origin-top-right animate-slide-down bg-popover backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden z-50 w-[300px]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-white/[0.02] shrink-0">
            <span className="text-[12px] font-bold text-text-muted uppercase tracking-wider">
              {isZh ? '正在执行的任务' : 'Running Tasks'}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="p-2 flex flex-col gap-1 max-h-[280px] overflow-y-auto custom-scrollbar">
            {runningThreads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => handleOpenThread(thread.id)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-text-primary/[0.06] transition-colors text-left"
              >
                <BreathingDot className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 min-w-0 text-[13px] text-text-primary truncate">
                  {getThreadDisplayTitle(thread)}
                </span>
                <span className="shrink-0 text-[11px] text-accent">{isZh ? '执行中' : 'Running'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 桌面伴侣开关按钮（顶部栏「语音对话」右侧）
 *
 * 状态来源：挂载时经 getState 取初值（伴侣可能按「随应用启动」已显示），
 * 之后由主进程广播的 `vrm-companion:state-changed` 同步 —— 因此无论从
 * 本按钮、设置面板还是伴侣窗口自身关闭，图标状态都是一致的。
 */
function VrmCompanionToggleButton({ language }: { language: Language }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let disposed = false
    void api.vrmCompanion
      .getState()
      .then((res) => {
        if (!disposed && res.success && res.data) setVisible(!!res.data.visible)
      })
      .catch((err) => logger.system.debug('[AppTitleBar] read companion state failed:', err))

    const off = api.vrmCompanion.onStateChanged((state) => setVisible(!!state.visible))
    return () => {
      disposed = true
      off()
    }
  }, [])

  const handleToggle = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await api.vrmCompanion.toggle()
      if (res.success && res.data) setVisible(!!res.data.visible)
    } catch (err) {
      logger.system.warn('[AppTitleBar] toggle companion failed:', err)
    } finally {
      setBusy(false)
    }
  }, [busy])

  return (
    <HintOverlay
      content={
        language === 'zh'
          ? visible
            ? '关闭桌面伴侣'
            : '打开桌面伴侣'
          : visible
            ? 'Close desktop companion'
            : 'Open desktop companion'
      }
      side="bottom"
      delay={300}
    >
      <button
        onClick={() => void handleToggle()}
        disabled={busy}
        className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
          visible ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-accent hover:bg-accent/10'
        } ${busy ? 'opacity-60 cursor-default' : ''}`}
      >
        {/* Bot 图形在 24 视口内的实体占比小于 Phone，同尺寸下会显得偏小，故放大一档 */}
        <Bot className="w-4 h-4" />
      </button>
    </HintOverlay>
  )
}

/** 仅在登录后渲染套餐部件；跟随其后 的分隔线一并收进，避免未登录时留下孤立竖线 */
function QuotaPartHost() {
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return null
  return (
    <>
      <QuotaPart />
      <div className="w-[1px] h-4 bg-border/50 mx-1"></div>
    </>
  )
}

export default function AppTitleBar() {
  const {
    language,
    chatVisible,
    setVoiceConversationActive,
    closeAllFullPages,
    setShowEnvironmentSetup,
    showWelcomePage,
    activeScenarioId,
  } = useStore(useShallow(s => ({
    language: s.language,
    chatVisible: s.chatVisible,
    setVoiceConversationActive: s.setVoiceConversationActive,
    closeAllFullPages: s.closeAllFullPages,
    setShowEnvironmentSetup: s.setShowEnvironmentSetup,
    showWelcomePage: s.showWelcomePage,
    activeScenarioId: s.activeScenarioId,
  })))

  /**
   * 场景声明要隐藏的外壳入口
   *
   * 场景自己已经在工作区里提供了对应操作时（如短剧工坊的导航栏与制作台），
   * 顶部再摆一套通用入口只会造成重复与误操作，因此按场景收起。
   */
  const scenarioChrome = scenarioRegistry.get(activeScenarioId)?.ui?.chrome
  const hideVoiceConversation = scenarioChrome?.hideVoiceConversation === true
  const hideDesktopCompanion = scenarioChrome?.hideDesktopCompanion === true

  // 场景把账号区挪到顶部右侧时，导航栏底部不再渲染它，改由这里接管
  const userMenuInTitlebar = resolveUserMenuPlacement(scenarioChrome) === 'titlebar'

  const { createThread } = useAgentActions()
  const envInstallStatus = useStore((s) => s.envInstallStatus)

  return (
    <div className="h-11 flex items-center justify-between px-0 drag-region select-none bg-background z-50 border-b border-border/30">
      <SceneSwitcherPart />

      {/* 左右内容之间的余量，同时是无边框窗口的拖拽区 */}
      <DragRegionPart />

      <div className="flex items-center justify-end h-full pr-2 gap-1">
        <div className="no-drag flex items-center gap-1 h-full mr-2">
          <ImStatusFloating />

          {chatVisible && (
            <>
              <UpdateReadyButton language={language as Language} />
              {/* 环境安装状态提示：在"新对话"按钮前显示 */}
              {envInstallStatus.isInstalling && (
                <HintOverlay
                  content={language === 'zh' ? '环境安装中，点击查看进度' : 'Installing environment, click for progress'}
                  side="bottom"
                  delay={300}
                >
                  <button
                    onClick={() => setShowEnvironmentSetup(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium text-accent hover:text-accent-hover hover:bg-accent/10 rounded-md transition-colors animate-pulse"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs">{envInstallStatus.message}</span>
                  </button>
                </HintOverlay>
              )}
              {envInstallStatus.state === 'done' && !envInstallStatus.isInstalling && (
                <HintOverlay
                  content={language === 'zh' ? '环境安装完成' : 'Environment setup complete'}
                  side="bottom"
                  delay={300}
                >
                  <button
                    onClick={() => setShowEnvironmentSetup(false)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium text-green-500 hover:text-green-400 hover:bg-green-500/10 rounded-md transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-xs">{envInstallStatus.message}</span>
                  </button>
                </HintOverlay>
              )}
              {/* 正在执行的任务提示：新建任务按钮前，点击查看后台仍在跑的会话 */}
              <RunningTasksIndicator />
              {!showWelcomePage && (
                <HintOverlay content={t('layout.newchat', language as Language)} side="bottom" delay={300}>
                  <button
                    onClick={() => {
                      // 新对话要回到聊天区：抽屉 / 侧边面板挡在前面时一并收起
                      closeOverlaysForChat()
                      // 若当前已选择工作空间，默认打开工作空间面板
                      if (useStore.getState().workspace?.roots?.length) {
                        useStore.getState().setActiveSidePanel('explorer')
                      }
                      createThread()
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-[rgba(var(--text-primary),0.06)] rounded-md transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('layout.newchat2', language as Language)}
                  </button>
                </HintOverlay>
              )}
              {!hideVoiceConversation && (
                <HintOverlay
                  content={language === 'zh' ? '语音对话' : 'Voice conversation'}
                  side="bottom"
                  delay={300}
                >
                  <button
                    onClick={() => {
                      setVoiceConversationActive(true)
                      // 异步关闭其他全屏页面，避免阻塞语音窗口渲染
                      setTimeout(() => closeAllFullPages(), 0)
                    }}
                    className="flex items-center justify-center w-7 h-7 text-text-muted hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </HintOverlay>
              )}
              {/* 桌面伴侣开关：紧跟语音对话按钮 */}
              {!hideDesktopCompanion && <VrmCompanionToggleButton language={language as Language} />}
              {/* 插件贡献的顶部按钮（扩展点），紧跟语音按钮之后 */}
              <PluginTopActions />
            </>
          )}

          <div className="w-[1px] h-4 bg-border/50 mx-1"></div>

          {/* 套餐 / Token 用量入口：仅登录后可见（其后的分隔线随它一起渲染） */}
          <QuotaPartHost />

          <NotificationsPart />

          <div className="w-[1px] h-4 bg-border/50 mx-1"></div>

          <SidebarTogglePart />

          {/* 账号区落到最右：场景关掉左侧导航栏时，账号入口只剩这一处 */}
          {userMenuInTitlebar && (
            <>
              <div className="w-[1px] h-4 bg-border/50 mx-1"></div>
              <RailUserPart placement="titlebar" expanded={false} />
            </>
          )}
        </div>
      </div>

      <WindowControlsPart />
    </div>
  )
}

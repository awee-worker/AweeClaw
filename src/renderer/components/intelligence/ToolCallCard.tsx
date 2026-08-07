/**
 * 工具调用卡片组件
 * 采用「状态指示器 + 标题栏 + 内容区 + 审批栏」组合架构：
 *  - 状态指示器：根据运行/成功/错误/拒绝状态显示不同图标
 *  - 标题栏：展示工具状态文案、耗时、终端入口
 *  - 内容区：委托预览注册表渲染对应工具的预览
 *  - 审批栏：待审批时展示批准/拒绝按钮
 */
import { memo, useCallback, useMemo } from 'react'
import { AlertTriangle, Check, ChevronDown, Terminal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import type { ToolCall } from '@intelligence/providerTypes'
import { useToolDisplayState } from '@intelligence/display/toolResultRenderer'
import { getFriendlyToolName } from '@intelligence/display/toolFriendlyName'
import { useToolCardExpansion } from '@hooks'
import { toast } from '@components/foundation/NotificationProvider'
import { TOOL_LABEL_KEYS } from './toolCallCard/helpers'
import { getStatusText } from './toolCallCard/statusTextRegistry'
import { renderToolPreview } from './toolCallCard/previewRegistry'
import { ToolElapsedTime } from './toolCallCard/ToolElapsedTime'

interface ToolCallCardProps {
  toolCall: ToolCall
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
  defaultExpanded?: boolean
}

/** 状态指示器视觉配置 */
function resolveStatusVisual(isStreaming: boolean, isRunning: boolean, isSuccess: boolean, isError: boolean, isRejected: boolean, isAwaitingApproval?: boolean) {
  // 待批准：显示警告图标，不显示默认空心圆圈
  if (isAwaitingApproval) {
    return (
      <div className="w-3.5 h-3.5 flex items-center justify-center">
        <AlertTriangle className="w-3 h-3 text-status-warning" />
      </div>
    )
  }
  if (isStreaming || isRunning) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      </div>
    )
  }
  if (isSuccess) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-status-success/10 flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-status-success" />
      </div>
    )
  }
  if (isError || isRejected) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-status-error/10 flex items-center justify-center">
        <X className="w-2.5 h-2.5 text-status-error" />
      </div>
    )
  }
  return <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
}

/** 卡片样式配置 */
function resolveCardStyle(isAwaitingApproval: boolean, isError: boolean, isStreaming: boolean, isRunning: boolean): string {
  if (isAwaitingApproval) return 'border border-status-warning/20 bg-status-warning/5 rounded-lg shadow-sm shadow-status-warning/5 overflow-hidden'
  if (isError) return 'bg-status-error/5 rounded-lg overflow-hidden'
  if (isStreaming || isRunning) return 'bg-accent/5 rounded-lg overflow-hidden'
  return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden'
}

const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  isAwaitingApproval,
  onApprove,
  onReject,
  defaultExpanded,
}: ToolCallCardProps) {
  const { language, setTerminalVisible, currentTheme, expandToolCallsByDefault } = useStore(
    useShallow((state) => ({
      language: state.language,
      setTerminalVisible: state.setTerminalVisible,
      currentTheme: state.currentTheme,
      expandToolCallsByDefault: state.agentConfig.expandToolCallsByDefault ?? false,
    })),
  )
  const { args, effectiveName, isSuccess, isError, isRejected, isRunning, isStreaming, previewState } = useToolDisplayState(toolCall)
  const isActive = isRunning || isStreaming
  // 自动展开的工具：todo_write（任务列表）和 run_command（命令执行）
  // 这些工具的内容需要用户实时查看，不受"默认展开工具调用"设置影响
  const shouldAutoExpand = effectiveName === 'todo_write' || effectiveName === 'run_command'
  const { isExpanded, animateContent, handleToggleExpanded } = useToolCardExpansion({
    defaultExpanded: defaultExpanded ?? (shouldAutoExpand || expandToolCallsByDefault),
    isActive,
  })

  const statusText = useMemo(
    () => getStatusText(effectiveName, args, toolCall.status, isStreaming, language, toolCall.result, isExpanded),
    [effectiveName, args, toolCall.status, isStreaming, language, toolCall.result, isExpanded],
  )

  const cardStyle = useMemo(
    () => resolveCardStyle(!!isAwaitingApproval, isError, isStreaming, isRunning),
    [isAwaitingApproval, isError, isStreaming, isRunning],
  )

  const runCommandMeta = useMemo(() => {
    if (effectiveName !== 'run_command') return null
    const meta = (args as { _meta?: { terminalId?: string; executionMode?: string } })._meta
    return {
      terminalId: meta?.terminalId,
      hasLiveTerminal: !!meta?.terminalId,
      wasDirectExecution: !!meta?.executionMode && meta.executionMode !== 'terminal',
    }
  }, [effectiveName, args])

  const handleOpenTerminal = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      const meta = runCommandMeta
      if (!meta?.terminalId) {
        toast.info(
          meta?.wasDirectExecution
            ? t('tool.directExecutionNoTerminal', language as any)
            : t('tool.noTerminalSession', language as any),
        )
        return
      }
      const { terminalManager } = await import('@services/TerminalAdapter')
      if (!terminalManager.hasTerminal(meta.terminalId)) {
        toast.info(t('tool.terminalClosed', language as any))
        return
      }
      setTerminalVisible(true)
      terminalManager.setActiveTerminal(meta.terminalId!)
      // 等待 xterm mount + fit，确保 PTY cols 与 xterm 一致，排版正确
      // 命令可能是在终端面板不可见时执行的（PTY 用默认 120 cols），
      // 用户点击查看时需要 fit 到实际 cols，后续输出排版才会正确
      await terminalManager.ensureTerminalReady(meta.terminalId)
      window.setTimeout(() => terminalManager.setActiveTerminal(meta.terminalId!), 0)
    },
    [runCommandMeta, language, setTerminalVisible],
  )

  const handleCopyResult = useCallback(() => {
    if (toolCall.result) {
      navigator.clipboard.writeText(toolCall.result)
    }
  }, [toolCall.result])

  const contentBody = (
    <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
      <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />
      <div className="relative z-10 space-y-2 mt-1">
        {renderToolPreview({
          toolCall,
          args,
          effectiveName,
          isRunning,
          isStreaming,
          language,
          currentTheme,
          onCopyResult: handleCopyResult,
          previewState,
        })}
        {toolCall.error && (
          <div className="px-3 py-2 bg-status-error/10 rounded-md">
            <div className="flex items-center gap-2 text-status-error text-xs font-medium mb-1">
              <AlertTriangle className="w-3 h-3" />
              {t('tool.error', language as any)}
            </div>
            <p className="text-[12px] text-status-error/80 font-mono break-all">{toolCall.error}</p>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className={`group my-0.5 relative ${cardStyle}`}>
      {(isStreaming || isRunning) && (
        <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
          <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent tool-card-sweep" />
        </div>
      )}

      <div
        className="flex min-h-[32px] items-center gap-2 py-1.5 cursor-pointer select-none"
        onClick={handleToggleExpanded}
      >
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="shrink-0 text-text-muted/85 hover:text-text-muted"
        >
          <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
        </motion.div>

        <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
          {resolveStatusVisual(isStreaming, isRunning, isSuccess, isError, isRejected, isAwaitingApproval)}
        </div>

        <div className="flex-1 min-w-0 flex items-center justify-between gap-2 overflow-hidden relative z-10">
          <span
            className={`text-[12px] truncate ${isStreaming || isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}
          >
            {statusText || (
              <span className="opacity-50 inline-flex items-center gap-1.5">
                <span>
                  {TOOL_LABEL_KEYS[effectiveName]
                    ? t(TOOL_LABEL_KEYS[effectiveName] as any, language as any)
                    : getFriendlyToolName(effectiveName, language).label}
                </span>
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {runCommandMeta && (isRunning || runCommandMeta.hasLiveTerminal) && (
              <span
                className={`flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 select-none ${
                  isRunning
                    ? 'text-accent bg-accent/10'
                    : 'text-text-muted cursor-pointer hover:text-text-primary hover:bg-surface-hover'
                }`}
                onClick={runCommandMeta.hasLiveTerminal ? handleOpenTerminal : undefined}
                title={runCommandMeta.hasLiveTerminal ? t('tool.viewInTerminal', language as any) : undefined}
              >
                <Terminal className={`w-3 h-3 ${isRunning ? 'animate-pulse' : ''}`} />
                <span>{isRunning ? t('tool.running', language as any) : t('tool.terminal', language as any)}</span>
              </span>
            )}
            <ToolElapsedTime startTime={toolCall.startTime} endTime={toolCall.endTime} isRunning={isRunning || isStreaming} />
          </div>
        </div>
      </div>

      {isExpanded &&
        (animateContent ? (
          <AnimatePresence initial={false}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {contentBody}
            </motion.div>
          </AnimatePresence>
        ) : (
          contentBody
        ))}

      {isAwaitingApproval && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-status-warning/10 bg-status-warning/5">
          <span className="text-xs text-status-warning/70 truncate">{t('toolAwaitingApproval', language as any)}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onReject}
              className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 rounded-md transition-all"
            >
              {t('toolReject', language as any)}
            </button>
            <button
              onClick={onApprove}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground hover:bg-accent-hover rounded-md transition-all"
            >
              {t('toolApprove', language as any)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default ToolCallCard
export { ExpandablePreviewContainer } from './toolCallCard/ExpandablePreviewContainer'

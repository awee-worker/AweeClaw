/**
 * 顶部「后台服务」状态入口
 *
 * AI 执行过程中常通过 run_command(is_background) 起一个或多个本地 http 服务
 * （dev server / 预览服务）。这些进程默认不会自动退出，用户需要一个入口能随时
 * 看到「现在有哪些服务在跑」，并能直接访问或结束它们。
 *
 * 数据来源分两处，各司其职：
 * - terminalManager：后台命令会话（isBackground + detached）是「进程仍在运行」的事实源，
 *   也是「结束」时的操作对象（关闭终端即回收整棵进程树）。
 * - devServerDiscoveryService：从终端输出里解析出的本地 URL，提供「访问」地址。
 * 两者按 terminalId 关联：只有「既有存活后台会话、又解析到地址」的终端才算一个服务，
 * 避免把普通长命令或历史残留 URL 误报成服务。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, ExternalLink, Square } from 'lucide-react'
import DockPopover from '../ui/DockPopover'
import { terminalManager, type TerminalManagerState } from '@services/TerminalAdapter'
import { devServerDiscoveryService } from '@renderer/preview/devServerLocator'
import { previewSessionService } from '@renderer/preview/previewSessionManager'
import type { PreviewServerCandidate, PreviewServerStatus } from '@shared/protocols/previewProtocol'
import { t, type Language } from '@renderer/i18n'

interface RunningService {
  terminalId: string
  command: string
  url: string
  label: string
  status: PreviewServerStatus
  candidateId: string
  workspaceRoot?: string
}

/** 后台会话是否仍在运行：detached 是 run_command(is_background) 的常态，running 兜底瞬时状态 */
function isLiveBackgroundSession(session: { isBackground: boolean; status: string } | undefined | null): boolean {
  if (!session || !session.isBackground) return false
  return session.status === 'detached' || session.status === 'running'
}

function pickBackgroundSession(info: { current: { isBackground: boolean; status: string; command: string } | null; last: { isBackground: boolean; status: string; command: string } | null } | undefined) {
  if (!info) return null
  if (isLiveBackgroundSession(info.current)) return info.current
  if (isLiveBackgroundSession(info.last)) return info.last
  return null
}

export default function ServiceStatusPopover({ language }: { language: Language }) {
  const [termState, setTermState] = useState<TerminalManagerState>(() => terminalManager.getState())
  const [candidates, setCandidates] = useState<PreviewServerCandidate[]>(() => devServerDiscoveryService.getState().candidates)

  useEffect(() => terminalManager.subscribe(setTermState), [])
  useEffect(() => devServerDiscoveryService.subscribe((state) => setCandidates(state.candidates)), [])

  // 组件挂载后补扫一次终端缓冲，把「本组件挂载前就已启动」的服务补进候选表，
  // 否则图标会因为检测不到历史服务而一直不出现。
  useEffect(() => {
    devServerDiscoveryService.initialize()
    const timer = setTimeout(() => devServerDiscoveryService.rescanAllTerminalBuffers(), 1500)
    return () => clearTimeout(timer)
  }, [])

  // 打开面板时再补扫一次，覆盖挂载后新起但 URL 未被实时捕获的服务
  const handleOpen = useCallback(() => {
    devServerDiscoveryService.rescanAllTerminalBuffers()
  }, [])

  const services = useMemo<RunningService[]>(() => {
    const liveTerminalIds = new Set(termState.terminals.map((terminal) => terminal.id))
    const seen = new Set<string>()
    const result: RunningService[] = []

    for (const candidate of candidates) {
      const terminalId = candidate.terminalId
      if (!terminalId || seen.has(candidate.id)) continue
      if (!liveTerminalIds.has(terminalId)) continue

      const session = pickBackgroundSession(termState.commandInfoByTerminal[terminalId])
      if (!session) continue

      seen.add(candidate.id)
      result.push({
        terminalId,
        command: session.command,
        url: candidate.url,
        label: candidate.label || candidate.title || candidate.url,
        status: candidate.status,
        candidateId: candidate.id,
        workspaceRoot: candidate.workspaceRoot,
      })
    }

    return result
  }, [candidates, termState])

  const handleOpenService = useCallback((service: RunningService) => {
    previewSessionService.openUrl(service.url, {
      title: service.label,
      source: 'terminal',
      workspaceRoot: service.workspaceRoot,
      candidateId: service.candidateId,
      activate: true,
    })
  }, [])

  const handleStopService = useCallback((service: RunningService) => {
    terminalManager.closeTerminal(service.terminalId)
  }, [])

  // 没有在跑的服务时不占位，避免顶部图标长期存在造成干扰
  if (services.length === 0) return null

  const isZh = language === 'zh'

  return (
    <DockPopover
      placement="bottom"
      icon={<Play className="w-4 h-4" />}
      badge={services.length > 9 ? '9+' : services.length}
      tooltip={t('services.title', language)}
      title={t('services.title', language)}
      width={340}
      height={360}
      language={isZh ? 'zh' : 'en'}
      onOpen={handleOpen}
    >
      <div className="py-1">
        {services.map((service) => (
          <div
            key={service.candidateId}
            className="flex items-center gap-2 px-3 py-2 hover:bg-text-primary/[0.04] transition-colors"
          >
            <Play
              className={`w-3.5 h-3.5 shrink-0 ${service.status === 'ready' ? 'text-emerald-400' : 'text-text-muted'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-text-primary truncate" title={service.url}>
                {service.label}
              </div>
              <div className="text-[10.5px] text-text-muted truncate" title={service.command}>
                {service.command}
              </div>
            </div>
            <button
              onClick={() => handleOpenService(service)}
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              title={t('services.open', language)}
            >
              <ExternalLink className="w-3 h-3" />
              {t('services.open', language)}
            </button>
            <button
              onClick={() => handleStopService(service)}
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={t('services.stop', language)}
            >
              <Square className="w-3 h-3" />
              {t('services.stop', language)}
            </button>
          </div>
        ))}
      </div>
    </DockPopover>
  )
}

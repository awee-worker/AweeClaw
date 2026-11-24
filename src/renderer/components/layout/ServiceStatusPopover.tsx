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
  /** 该服务关联的全部后台终端：同一地址被多个终端重复输出时一并记录，结束时一起回收 */
  terminalIds: string[]
  command: string
  url: string
  label: string
  status: PreviewServerStatus
  candidateId: string
  workspaceRoot?: string
}

/** 回环地址的等价写法，统一按 localhost 展示与合并 */
const HOST_ALIASES = new Set(['127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/**
 * 归一化服务地址，作为「是否同一个服务」的判定依据
 *
 * 同一个 dev server 会以多种写法出现：localhost 与 127.0.0.1、默认端口省略、
 * 末尾斜杠、带 query / hash / 子路径，以及被多个终端重复输出。这些都指向同一个
 * 监听端口，因此只按 host:port 判定：一个端口只保留一条记录。
 */
function toServiceKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()
    const host = HOST_ALIASES.has(hostname) ? 'localhost' : hostname
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return `${host}:${port}`
  } catch {
    return rawUrl.replace(/\/+$/, '').toLowerCase()
  }
}

/** 地址是否为站点根（无子路径）：合并时优先用它作为该服务的访问入口 */
function isRootUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).pathname.replace(/\/+$/, '') === ''
  } catch {
    return false
  }
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
    // 按归一化服务地址合并：同一端点的多种写法 / 多个终端重复输出，只保留一条
    const merged = new Map<string, RunningService>()

    for (const candidate of candidates) {
      const terminalId = candidate.terminalId
      if (!terminalId) continue
      if (!liveTerminalIds.has(terminalId)) continue

      const session = pickBackgroundSession(termState.commandInfoByTerminal[terminalId])
      if (!session) continue

      const key = toServiceKey(candidate.url)
      const existing = merged.get(key)
      if (existing) {
        // 同一端口的重复登记：只保留一条，记住全部终端以便「结束」时一起回收
        if (!existing.terminalIds.includes(terminalId)) {
          existing.terminalIds.push(terminalId)
        }

        // 展示用的地址按「可访问 > 站点根」优先，避免入口停在某个子路径上
        const preferNew =
          (existing.status !== 'ready' && candidate.status === 'ready') ||
          (candidate.status === existing.status && isRootUrl(candidate.url) && !isRootUrl(existing.url))
        if (preferNew) {
          existing.url = candidate.url
          existing.label = candidate.label || candidate.title || existing.label
          existing.status = candidate.status
          existing.candidateId = candidate.id
          existing.workspaceRoot = candidate.workspaceRoot
        }
        continue
      }

      merged.set(key, {
        terminalIds: [terminalId],
        command: session.command,
        url: candidate.url,
        label: candidate.label || candidate.title || candidate.url,
        status: candidate.status,
        candidateId: candidate.id,
        workspaceRoot: candidate.workspaceRoot,
      })
    }

    return [...merged.values()]
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
    // 合并后的条目可能对应多个终端，逐一关闭，避免残留进程仍占用该端口
    for (const terminalId of service.terminalIds) {
      terminalManager.closeTerminal(terminalId)
    }
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

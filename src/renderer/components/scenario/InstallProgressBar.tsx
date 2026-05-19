import { useState, useEffect } from 'react'
import { Download, CheckCircle, Loader2, AlertCircle, Shield, FileArchive, Settings } from 'lucide-react'
import { useStore } from '@store'
import { getAPI } from '@services/electronBridge'

interface InstallProgress {
  scenarioId: string
  phase: 'downloading' | 'verifying' | 'extracting' | 'configuring'
  bytesDownloaded: number
  bytesTotal: number
  percent: number
}

interface InstallProgressBarProps {
  scenarioId: string
  scenarioName: string
  scenarioNameZh: string
  onComplete?: () => void
  onError?: (error: string) => void
}

const PHASE_META: Record<string, { icon: React.ReactNode; labelZh: string; labelEn: string }> = {
  downloading: {
    icon: <Download className="w-3.5 h-3.5 animate-bounce" />,
    labelZh: '下载中',
    labelEn: 'Downloading',
  },
  verifying: {
    icon: <Shield className="w-3.5 h-3.5" />,
    labelZh: '校验中',
    labelEn: 'Verifying',
  },
  extracting: {
    icon: <FileArchive className="w-3.5 h-3.5" />,
    labelZh: '解压中',
    labelEn: 'Extracting',
  },
  configuring: {
    icon: <Settings className="w-3.5 h-3.5" />,
    labelZh: '配置中',
    labelEn: 'Configuring',
  },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function InstallProgressBar({
  scenarioId,
  scenarioName,
  scenarioNameZh,
  onComplete,
  onError,
}: InstallProgressBarProps) {
  const language = useStore(s => s.language)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)
  const displayName = language === 'zh' ? scenarioNameZh : scenarioName

  useEffect(() => {
    const api = getAPI()
    const unsub = api.onScenarioInstallProgress?.((data: InstallProgress) => {
      if (data.scenarioId === scenarioId) {
        setProgress(data)
      }
    })

    return () => {
      unsub?.()
    }
  }, [scenarioId])

  useEffect(() => {
    if (progress && progress.percent >= 100 && progress.phase === 'configuring') {
      const timer = setTimeout(() => setCompleted(true), 300)
      return () => clearTimeout(timer)
    }
  }, [progress])

  useEffect(() => {
    if (completed && onComplete) {
      onComplete()
    }
  }, [completed, onComplete])

  useEffect(() => {
    if (error && onError) {
      onError(error)
    }
  }, [error, onError])

  const phase = progress?.phase || 'downloading'
  const percent = progress?.percent || 0
  const phaseMeta = PHASE_META[phase]

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-lg">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
        <span className="text-xs text-red-400">{error}</span>
      </div>
    )
  }

  if (completed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg">
        <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        <span className="text-xs text-green-400">
          {t(`"${scenarioNameZh}" 安装完成`, `"${scenarioName}" installed successfully`)}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {phaseMeta.icon}
          <span className="text-xs text-[var(--color-text)]">
            {t(
              `${displayName} ${phaseMeta.labelZh}`,
              `${displayName} ${phaseMeta.labelEn}`,
            )}
          </span>
        </div>
        <span className="text-xs font-mono text-[var(--color-text)] opacity-60">
          {percent}%
        </span>
      </div>

      <div className="w-full h-1.5 bg-[var(--color-bg)] rounded-full overflow-hidden">
        <div
          className="h-full bg-violet-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      {progress && progress.bytesTotal > 0 && (
        <div className="text-[10px] text-[var(--color-text)] opacity-40">
          {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal)}
        </div>
      )}
    </div>
  )
}

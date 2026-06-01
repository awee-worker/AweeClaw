import { useEffect, useState } from 'react'
import { AlertCircle, ArrowUpCircle, CheckCircle, Download, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { updaterService, type UpdateStatus } from '@services/updateAdapter'
import { useStore } from '@store'
import { api } from '../../adapters/electronBridge'
import { OverlayDialog } from '../ui/OverlayDialog'
import { t, type Language } from '@renderer/i18n'

export function UpdateModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const language = useStore(state => state.language)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [currentVersion, setCurrentVersion] = useState('')

  useEffect(() => {
    updaterService.initialize()
    const unsubscribe = updaterService.subscribe(setStatus)
    void updaterService.getStatus().then(setStatus)
    void api.getAppVersion().then(setCurrentVersion)
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (isOpen) {
      void updaterService.checkForUpdates()
    }
  }, [isOpen])

  const handleCheck = async () => updaterService.checkForUpdates()

  const handleDownload = async () => {
    if (status?.requiresManualDownload) {
      updaterService.openDownloadPage()
      return
    }
    await updaterService.downloadUpdate()
  }

  const handleInstall = () => updaterService.installAndRestart()

  const hasUpdate = status?.status === 'available' || status?.status === 'downloaded'
  const isChecking = status?.status === 'checking'
  const isDownloading = status?.status === 'downloading'
  const isError = status?.status === 'error'

  const labels = {
    title: t('layout.systemupdate', language as Language),
    checking: t('layout.checkingforupdates', language as Language),
    available: t('layout.newversionavailable', language as Language),
    downloaded: t('layout.updateready', language as Language),
    downloading: t('layout.downloadingupdate', language as Language),
    notAvailable: t('layout.youareuptodate', language as Language),
    error: t('layout.updatefailed', language as Language),
    download: t('layout.updatenow', language as Language),
    install: t('layout.restarttoapply', language as Language),
    openPage: t('layout.opendownloadpage', language as Language),
    checkNow: t('layout.checkforupdates', language as Language),
    manualHint:
      t('layout.thisinstalltypecannotupdate', language as Language),
    current: t('layout.current', language as Language),
  }

  return (
    <OverlayDialog isOpen={isOpen} onClose={onClose} size="sm">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <span className="text-[11px] font-black text-text-muted uppercase tracking-[0.2em]">{labels.title}</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-text-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative mb-4">
            <div
              className={`absolute inset-0 blur-2xl rounded-full opacity-40 transition-all duration-500 ${
                hasUpdate ? 'bg-accent' : isError ? 'bg-red-500' : 'bg-emerald-500'
              }`}
            />
            <div
              className={`relative w-16 h-16 rounded-3xl flex items-center justify-center border border-white/10 shadow-xl ${
                hasUpdate
                  ? 'bg-accent text-white'
                  : isChecking || isDownloading
                    ? 'bg-surface-active text-accent'
                    : isError
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              {isChecking || isDownloading ? (
                <Loader2 className="w-8 h-8 animate-spin" />
              ) : hasUpdate ? (
                <ArrowUpCircle className="w-8 h-8" />
              ) : isError ? (
                <AlertCircle className="w-8 h-8" />
              ) : (
                <CheckCircle className="w-8 h-8" />
              )}
            </div>
          </div>

          <h4 className="text-lg font-bold text-text-primary tracking-tight">
            {status?.status === 'available'
              ? labels.available
              : status?.status === 'downloaded'
                ? labels.downloaded
                : status?.status === 'downloading'
                  ? labels.downloading
                  : status?.status === 'checking'
                    ? labels.checking
                    : status?.status === 'error'
                      ? labels.error
                      : labels.notAvailable}
          </h4>

          <div className="mt-2 flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[12px] font-medium">
            {status?.version && hasUpdate ? (
              <>
                <span className="text-text-muted opacity-60">v{currentVersion}</span>
                <div className="w-1 h-1 rounded-full bg-text-muted opacity-30" />
                <span className="text-accent font-bold">v{status.version}</span>
              </>
            ) : (
              <span className="text-text-muted">
                {labels.current}: v{currentVersion}
              </span>
            )}
          </div>
        </div>

        {isDownloading && status?.progress !== undefined && (
          <div className="mb-6 space-y-2">
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent shadow-[0_0_12px_rgba(var(--accent),0.8)]"
                initial={{ width: 0 }}
                animate={{ width: `${status.progress}%` }}
                transition={{ ease: 'circOut' }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-bold text-text-muted uppercase tracking-widest opacity-60">
              <span>{labels.downloading}</span>
              <span className="text-accent">{status.progress.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {hasUpdate && status?.requiresManualDownload && (
          <div className="mb-6 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-200/80 leading-relaxed text-center">
            {labels.manualHint}
          </div>
        )}

        <div className="space-y-2">
          {hasUpdate ? (
            status?.status === 'downloaded' ? (
              <button
                onClick={handleInstall}
                className="w-full h-11 rounded-2xl bg-green-500 hover:bg-green-600 text-white text-sm font-bold shadow-[0_10px_20px_-5px_rgba(34,197,94,0.4)] transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {labels.install}
              </button>
            ) : (
              <button
                onClick={handleDownload}
                className="w-full h-11 rounded-2xl bg-accent hover:bg-accent-hover text-white text-sm font-bold shadow-[0_10px_20px_-5px_rgba(var(--accent)/0.4)] transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {status?.requiresManualDownload ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                {status?.requiresManualDownload ? labels.openPage : labels.download}
              </button>
            )
          ) : (
            !isChecking &&
            !isDownloading && (
              <button
                onClick={handleCheck}
                className="w-full h-11 rounded-2xl bg-surface-active hover:bg-white/10 border border-border/50 text-text-primary text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {labels.checkNow}
              </button>
            )
          )}
        </div>
      </div>
    </OverlayDialog>
  )
}

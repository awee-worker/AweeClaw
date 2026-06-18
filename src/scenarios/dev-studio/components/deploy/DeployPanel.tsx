/**
 * DeployPanel - 部署面板（主容器）
 *
 * 集成 DeployTargetSelector 和 DeployHistoryList。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { Cloud, Rocket, Loader2 } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../services/PreviewService'
import type { DeployTarget } from '../../services/PreviewService'
import DeployTargetSelector from './DeployTargetSelector'
import DeployHistoryList from './DeployHistoryList'

interface DeployPanelProps {
  projectId?: string
  projectName?: string
}

const DeployPanel: React.FC<DeployPanelProps> = ({
  projectId,
  projectName,
}) => {
  const { t } = useI18n()
  const [selectedTarget, setSelectedTarget] = useState<DeployTarget | null>(null)
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleDeploy = useCallback(async () => {
    if (!projectId || !selectedTarget) return

    setDeploying(true)
    setError(null)
    try {
      await previewService.deploy(projectId, selectedTarget, { env: envVars })
      setRefreshKey(k => k + 1)
      setSelectedTarget(null)
      setEnvVars({})
    } catch (err) {
      setError(t('studio.deploy.deployFailed'))
    } finally {
      setDeploying(false)
    }
  }, [projectId, selectedTarget, envVars])

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-4">
        <Cloud className="w-8 h-8 opacity-30" />
        <p className="text-xs">{t('studio.deploy.selectProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Cloud className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-xs font-medium">{t('studio.deploy.title')}</span>
          {projectName && (
            <span className="text-[10px] text-muted-foreground">{projectName}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 目标选择 */}
        <DeployTargetSelector
          selected={selectedTarget}
          onSelect={setSelectedTarget}
        />

        {/* 环境变量 */}
        {selectedTarget && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">
              {t('studio.deploy.envVars')}
            </label>
            <textarea
              value={Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n')}
              onChange={e => {
                const vars: Record<string, string> = {}
                e.target.value.split('\n').forEach(line => {
                  const [k, ...v] = line.split('=')
                  if (k.trim()) vars[k.trim()] = v.join('=').trim()
                })
                setEnvVars(vars)
              }}
              placeholder="KEY=value&#10;API_URL=https://..."
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-[10px] font-mono h-20 resize-none focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="px-2 py-1.5 rounded bg-red-500/10 text-[10px] text-red-500">
            {error}
          </div>
        )}

        {/* 部署按钮 */}
        {selectedTarget && (
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 disabled:opacity-50 transition-colors"
          >
            {deploying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Rocket className="w-3.5 h-3.5" />
            )}
            {deploying ? t('studio.deploy.deploying') : t('studio.deploy.deployTo', { target: selectedTarget })}
          </button>
        )}

        {/* 分隔线 */}
        <div className="border-t border-border" />

        {/* 部署历史 */}
        <DeployHistoryList
          projectId={projectId}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  )
}

export default DeployPanel
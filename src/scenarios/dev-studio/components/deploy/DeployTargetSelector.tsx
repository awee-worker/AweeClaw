/**
 * DeployTargetSelector - 部署目标选择器
 *
 * 展示可用的部署平台，支持选择。
 */
import type React from 'react'
import { Globe, Cloud, Server, Check } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { DEPLOY_TARGETS } from '../../services/PreviewService'
import type { DeployTarget } from '../../services/PreviewService'

interface DeployTargetSelectorProps {
  selected: DeployTarget | null
  onSelect: (target: DeployTarget) => void
}

const TARGET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Vercel: Globe,
  Netlify: Globe,
  Cloudflare: Globe,
  GitHub: Globe,
  Docker: Cloud,
  Server: Server,
}

const TARGET_COLORS: Record<string, string> = {
  Vercel: 'bg-black text-white',
  Netlify: 'bg-cyan-500 text-white',
  Cloudflare: 'bg-orange-500 text-white',
  GitHub: 'bg-purple-600 text-white',
  Docker: 'bg-blue-500 text-white',
  Server: 'bg-slate-600 text-white',
}

const DeployTargetSelector: React.FC<DeployTargetSelectorProps> = ({
  selected,
  onSelect,
}) => {
  const { t } = useI18n()

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-medium text-muted-foreground">
        {t('studio.deploy.target')}
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        {DEPLOY_TARGETS.map(target => {
          const Icon = TARGET_ICONS[target.icon] ?? Globe
          const isSelected = selected === target.id
          return (
            <button
              key={target.id}
              onClick={() => onSelect(target.id)}
              className={`flex items-start gap-2 px-2.5 py-2 rounded-md border text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                  : 'border-border hover:border-primary/30 hover:bg-muted/30'
              }`}
            >
              <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${TARGET_COLORS[target.icon] ?? 'bg-muted'}`}>
                <Icon className="w-3 h-3" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-medium">{t(`studio.deploy.target.${target.id}`)}</span>
                  {target.free && (
                    <span className="px-1 py-0.5 rounded text-[7px] bg-emerald-500/10 text-emerald-500">{t('studio.deploy.free')}</span>
                  )}
                </div>
                <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">
                  {t(`studio.deploy.target.${target.id}Desc`)}
                </p>
              </div>
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default DeployTargetSelector
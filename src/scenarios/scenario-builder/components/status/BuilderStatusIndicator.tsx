/**
 * 构建状态指示器
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'

const BuilderStatusIndicator: React.FC = () => {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-1 px-2 text-xs">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <span className="text-muted-foreground">{t('builder.statusBar.ready')}</span>
    </div>
  )
}

export default BuilderStatusIndicator

/**
 * 构建状态栏
 *
 * 显示当前项目和构建状态。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'

const BuilderStatusBar: React.FC = () => {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
      <span>{t('builder.statusBar.noProject')}</span>
    </div>
  )
}

export default BuilderStatusBar

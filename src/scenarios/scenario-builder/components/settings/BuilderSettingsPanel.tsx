/**
 * 场景开发助手设置面板
 */
import { useState, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'

const BuilderSettingsPanel: React.FC = () => {
  const { t } = useI18n()
  const [cliPath, setCliPath] = useState('aweeclaw-scenario')
  const [autoValidate, setAutoValidate] = useState(true)
  const [hotReload, setHotReload] = useState(true)
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(() => {
    // 保存设置到 localStorage
    localStorage.setItem(
      'scenario-builder:settings',
      JSON.stringify({ cliPath, autoValidate, hotReload }),
    )
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [cliPath, autoValidate, hotReload])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.settings.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* CLI 路径 */}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('builder.settings.cliPath')}</label>
          <input
            type="text"
            value={cliPath}
            onChange={(e) => setCliPath(e.target.value)}
            placeholder={t('builder.settings.cliPathPlaceholder')}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
          />
        </div>

        {/* 自动校验 */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">{t('builder.settings.autoValidate')}</div>
            <div className="text-xs text-muted-foreground">{t('builder.settings.autoValidateDesc')}</div>
          </div>
          <button
            onClick={() => setAutoValidate(!autoValidate)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              autoValidate ? 'bg-accent' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                autoValidate ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* 热重载 */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">{t('builder.settings.hotReload')}</div>
            <div className="text-xs text-muted-foreground">{t('builder.settings.hotReloadDesc')}</div>
          </div>
          <button
            onClick={() => setHotReload(!hotReload)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              hotReload ? 'bg-accent' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                hotReload ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="border-t border-border p-3">
        <button
          onClick={handleSave}
          className="w-full rounded bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-accent/90"
        >
          {saved ? t('builder.settings.saved') : t('builder.settings.save')}
        </button>
      </div>
    </div>
  )
}

export default BuilderSettingsPanel

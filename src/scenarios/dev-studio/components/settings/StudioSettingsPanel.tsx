import { useState, useEffect, useCallback } from 'react'
import type React from 'react'

export interface StudioSettings {
  autoSave: boolean
  autoSaveInterval: number
  agentMode: 'solo' | 'collaborative'
  pipelineTrigger: 'manual' | 'push'
  shellType: string
  fontSize: number
  theme: string
}

const DEFAULT_SETTINGS: StudioSettings = {
  autoSave: true,
  autoSaveInterval: 5,
  agentMode: 'solo',
  pipelineTrigger: 'manual',
  shellType: 'zsh',
  fontSize: 14,
  theme: 'system',
}

interface StudioSettingsPanelProps {
  embedded?: boolean
  onClose?: () => void
  initialSettings?: StudioSettings
  onSettingsChange?: (settings: StudioSettings) => void
}

type SettingsTab = 'general' | 'editor' | 'agent' | 'pipeline' | 'deploy' | 'terminal'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'agent', label: 'Agent' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'terminal', label: 'Terminal' },
]

const StudioSettingsPanel: React.FC<StudioSettingsPanelProps> = ({
  embedded = false,
  onClose,
  initialSettings,
  onSettingsChange,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const [autoSave, setAutoSave] = useState(initialSettings?.autoSave ?? DEFAULT_SETTINGS.autoSave)
  const [autoSaveInterval, setAutoSaveInterval] = useState(initialSettings?.autoSaveInterval ?? DEFAULT_SETTINGS.autoSaveInterval)
  const [agentMode, setAgentMode] = useState<'solo' | 'collaborative'>(initialSettings?.agentMode ?? DEFAULT_SETTINGS.agentMode)
  const [pipelineTrigger, setPipelineTrigger] = useState<'manual' | 'push'>(initialSettings?.pipelineTrigger ?? DEFAULT_SETTINGS.pipelineTrigger)
  const [shellType, setShellType] = useState(initialSettings?.shellType ?? DEFAULT_SETTINGS.shellType)
  const [fontSize, setFontSize] = useState(initialSettings?.fontSize ?? DEFAULT_SETTINGS.fontSize)
  const [theme, setTheme] = useState(initialSettings?.theme ?? DEFAULT_SETTINGS.theme)

  // 同步外部传入的初始值
  useEffect(() => {
    if (initialSettings) {
      setAutoSave(initialSettings.autoSave)
      setAutoSaveInterval(initialSettings.autoSaveInterval)
      setAgentMode(initialSettings.agentMode)
      setPipelineTrigger(initialSettings.pipelineTrigger)
      setShellType(initialSettings.shellType)
      setFontSize(initialSettings.fontSize)
      setTheme(initialSettings.theme)
    }
  }, [initialSettings])

  const notifyChange = useCallback((settings: StudioSettings) => {
    onSettingsChange?.(settings)
  }, [onSettingsChange])

  const buildSettings = useCallback((): StudioSettings => ({
    autoSave, autoSaveInterval, agentMode, pipelineTrigger, shellType, fontSize, theme,
  }), [autoSave, autoSaveInterval, agentMode, pipelineTrigger, shellType, fontSize, theme])

  const handleAutoSaveToggle = useCallback(() => {
    setAutoSave(prev => {
      const next = !prev
      notifyChange({ ...buildSettings(), autoSave: next })
      return next
    })
  }, [buildSettings, notifyChange])

  const handleAutoSaveInterval = useCallback((val: number) => {
    setAutoSaveInterval(val)
    notifyChange({ ...buildSettings(), autoSaveInterval: val })
  }, [buildSettings, notifyChange])

  const handleAgentMode = useCallback((val: 'solo' | 'collaborative') => {
    setAgentMode(val)
    notifyChange({ ...buildSettings(), agentMode: val })
  }, [buildSettings, notifyChange])

  const handlePipelineTrigger = useCallback((val: 'manual' | 'push') => {
    setPipelineTrigger(val)
    notifyChange({ ...buildSettings(), pipelineTrigger: val })
  }, [buildSettings, notifyChange])

  const handleShellType = useCallback((val: string) => {
    setShellType(val)
    notifyChange({ ...buildSettings(), shellType: val })
  }, [buildSettings, notifyChange])

  const handleFontSize = useCallback((val: number) => {
    setFontSize(val)
    notifyChange({ ...buildSettings(), fontSize: val })
  }, [buildSettings, notifyChange])

  const handleTheme = useCallback((val: string) => {
    setTheme(val)
    notifyChange({ ...buildSettings(), theme: val })
  }, [buildSettings, notifyChange])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 标题栏 */}
      {!embedded && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Dev Studio Settings</h2>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded hover:bg-muted">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 标签栏 */}
        <div className="w-44 border-r border-border p-2 space-y-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 设置内容 */}
        <div className="flex-1 overflow-auto p-6">
          {/* General */}
          {activeTab === 'general' && (
            <div className="max-w-md space-y-5">
              <h3 className="text-sm font-semibold">General Settings</h3>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Auto Save</label>
                  <p className="text-xs text-muted-foreground">Automatically save files while editing</p>
                </div>
                <button
                  onClick={handleAutoSaveToggle}
                  className={`relative w-9 h-5 rounded-full transition-colors ${autoSave ? 'bg-accent' : 'bg-muted'}`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      autoSave ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {autoSave && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">Auto Save Interval (seconds)</label>
                  <input
                    type="number"
                    value={autoSaveInterval}
                    onChange={e => handleAutoSaveInterval(Number(e.target.value))}
                    min={1}
                    max={30}
                    className="w-24 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5">Theme</label>
                <select
                  value={theme}
                  onChange={e => handleTheme(e.target.value)}
                  className="w-40 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>
          )}

          {/* Editor */}
          {activeTab === 'editor' && (
            <div className="max-w-md space-y-5">
              <h3 className="text-sm font-semibold">Editor Settings</h3>

              <div>
                <label className="block text-sm font-medium mb-1.5">Font Size</label>
                <input
                  type="number"
                  value={fontSize}
                  onChange={e => handleFontSize(Number(e.target.value))}
                  min={10}
                  max={32}
                  className="w-24 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
            </div>
          )}

          {/* Agent */}
          {activeTab === 'agent' && (
            <div className="max-w-md space-y-5">
              <h3 className="text-sm font-semibold">Agent Settings</h3>

              <div>
                <label className="block text-sm font-medium mb-2">Agent Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAgentMode('solo')}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      agentMode === 'solo'
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    Solo
                  </button>
                  <button
                    onClick={() => handleAgentMode('collaborative')}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      agentMode === 'collaborative'
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    Collaborative
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {agentMode === 'solo'
                    ? 'Single agent handles all development tasks'
                    : 'Multiple agents collaborate on development (PM, Coder, Reviewer, Tester, DevOps)'}
                </p>
              </div>
            </div>
          )}

          {/* Pipeline */}
          {activeTab === 'pipeline' && (
            <div className="max-w-md space-y-5">
              <h3 className="text-sm font-semibold">Pipeline Settings</h3>

              <div>
                <label className="block text-sm font-medium mb-2">Pipeline Trigger</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePipelineTrigger('manual')}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      pipelineTrigger === 'manual'
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => handlePipelineTrigger('push')}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      pipelineTrigger === 'push'
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    Auto on Push
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Deploy */}
          {activeTab === 'deploy' && (
            <div className="max-w-md space-y-5">
              <h3 className="text-sm font-semibold">Deploy Settings</h3>
              <p className="text-xs text-muted-foreground">
                Deployment configuration will be available in a future update.
              </p>
            </div>
          )}

          {/* Terminal */}
          {activeTab === 'terminal' && (
            <div className="max-w-md space-y-5">
              <h3 className="text-sm font-semibold">Terminal Settings</h3>

              <div>
                <label className="block text-sm font-medium mb-1.5">Shell Type</label>
                <select
                  value={shellType}
                  onChange={e => handleShellType(e.target.value)}
                  className="w-40 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="zsh">zsh</option>
                  <option value="bash">bash</option>
                  <option value="sh">sh</option>
                  <option value="powershell">PowerShell</option>
                  <option value="cmd">CMD</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default StudioSettingsPanel
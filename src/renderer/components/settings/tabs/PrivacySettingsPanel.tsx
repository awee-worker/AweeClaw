import { type Dispatch, type SetStateAction } from 'react'
import { Shield, Database, Cloud, Lock, HardDriveDownload } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language } from '@renderer/i18n'
import type { PrivacySettings } from '@shared/configuration/defaultProfile'

interface PrivacySettingsPanelProps {
  language: Language
  privacySettings: PrivacySettings
  setPrivacySettings: Dispatch<SetStateAction<PrivacySettings>>
}

const SYNC_MODE_OPTIONS: Array<{ value: PrivacySettings['knowledgeSyncMode']; labelZh: string; labelEn: string; descZh: string; descEn: string; icon: React.ReactNode }> = [
  {
    value: 'local-only',
    labelZh: '仅本地',
    labelEn: 'Local Only',
    descZh: '知识库数据仅存储在本地浏览器IndexedDB中，不会上传到服务器',
    descEn: 'Knowledge data is stored locally in IndexedDB only, never uploaded to the server',
    icon: <Database className="w-5 h-5 text-emerald-400" />,
  },
  {
    value: 'sync-with-encryption',
    labelZh: '加密同步',
    labelEn: 'Encrypted Sync',
    descZh: '知识库数据通过端到端加密同步到云端，服务器无法读取明文',
    descEn: 'Knowledge data synced to cloud via E2EE, server cannot read plaintext',
    icon: <Lock className="w-5 h-5 text-violet-400" />,
  },
  {
    value: 'sync-plain',
    labelZh: '明文同步',
    labelEn: 'Plain Sync',
    descZh: '知识库数据以明文形式同步到云端，方便多设备访问但隐私性较低',
    descEn: 'Knowledge data synced in plaintext to cloud, convenient for multi-device but less private',
    icon: <Cloud className="w-5 h-5 text-blue-400" />,
  },
]

export function PrivacySettingsPanel({ language, privacySettings, setPrivacySettings }: PrivacySettingsPanelProps) {
  const isZh = language === 'zh'

  const update = (updates: Partial<PrivacySettings>) => {
    setPrivacySettings(prev => ({ ...prev, ...updates }))
  }

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      <div className="p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0">
          <Shield className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-emerald-500 mb-1 tracking-tight">
            {isZh ? '隐私保护' : 'Privacy Protection'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed opacity-90">
            {isZh
              ? '控制知识库数据的存储和同步方式。您的知识可能包含敏感信息，默认仅保存在本地。'
              : 'Control how your knowledge data is stored and synced. Your knowledge may contain sensitive info, stored locally by default.'}
          </p>
        </div>
      </div>

      <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '数据同步模式' : 'Data Sync Mode'}
        </h4>
        <div className="space-y-3">
          {SYNC_MODE_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => update({
                knowledgeSyncMode: option.value,
                enableServerSync: option.value !== 'local-only',
                enableE2EE: option.value === 'sync-with-encryption',
              })}
              className={`w-full flex items-start gap-4 p-4 rounded-xl border transition-all text-left ${
                privacySettings.knowledgeSyncMode === option.value
                  ? 'border-accent/50 bg-accent/5 shadow-sm'
                  : 'border-border/50 bg-surface/30 hover:border-border hover:bg-surface/50'
              }`}
            >
              <div className="p-2 bg-surface/60 rounded-lg shrink-0 mt-0.5">
                {option.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-text-primary">
                    {isZh ? option.labelZh : option.labelEn}
                  </span>
                  {privacySettings.knowledgeSyncMode === option.value && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent/20 text-accent rounded">
                      {isZh ? '当前' : 'Active'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                  {isZh ? option.descZh : option.descEn}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '本地图谱提取' : 'Local Graph Extraction'}
        </h4>
        <div className="space-y-4">
          <ToggleSwitch
            label={isZh ? '启用本地规则图谱提取' : 'Enable local rule-based graph extraction'}
            checked={privacySettings.enableLocalGraphExtraction}
            onChange={e => update({ enableLocalGraphExtraction: e.target.checked })}
          />
          <p className="text-[11px] text-text-muted leading-relaxed ml-1">
            {isZh
              ? '使用本地规则引擎从知识条目中自动提取实体和关系，构建知识图谱。所有处理在浏览器本地完成，无需网络。'
              : 'Use local rule engine to extract entities and relationships from knowledge entries to build the knowledge graph. All processing happens locally in the browser, no network required.'}
          </p>
        </div>
      </section>

      <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '离线与存储' : 'Offline & Storage'}
        </h4>
        <div className="space-y-4">
          <ToggleSwitch
            label={isZh ? '启用离线模式' : 'Enable offline mode'}
            checked={privacySettings.enableOfflineMode}
            onChange={e => update({ enableOfflineMode: e.target.checked })}
          />
          <p className="text-[11px] text-text-muted leading-relaxed ml-1">
            {isZh
              ? '离线模式下，所有知识操作仅使用本地存储，即使网络断开也能正常工作。'
              : 'In offline mode, all knowledge operations use local storage only, works even without network.'}
          </p>
        </div>
      </section>

      {privacySettings.knowledgeSyncMode !== 'local-only' && (
        <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
          <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
            {isZh ? '同步设置' : 'Sync Settings'}
          </h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {privacySettings.enableE2EE ? (
                  <Lock className="w-4 h-4 text-violet-400" />
                ) : (
                  <Cloud className="w-4 h-4 text-blue-400" />
                )}
                <span className="text-[13px] text-text-primary">
                  {privacySettings.enableE2EE
                    ? (isZh ? '端到端加密已启用' : 'E2EE enabled')
                    : (isZh ? '明文同步' : 'Plain sync')}
                </span>
              </div>
              <span className="text-[11px] text-text-muted">
                {isZh
                  ? `每 ${Math.round(privacySettings.autoSyncIntervalMs / 60000)} 分钟同步`
                  : `Sync every ${Math.round(privacySettings.autoSyncIntervalMs / 60000)} min`}
              </span>
            </div>

            {privacySettings.enableE2EE && (
              <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <Lock className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[12px] font-medium text-violet-400">
                    {isZh ? '端到端加密 (E2EE)' : 'End-to-End Encryption (E2EE)'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  {isZh
                    ? '数据在本地加密后才上传，服务器仅存储密文，即使数据泄露也无法读取。密钥仅保存在您的设备上。'
                    : 'Data is encrypted locally before upload. Server stores ciphertext only. Even if data leaks, it cannot be read. Keys are stored only on your devices.'}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '数据管理' : 'Data Management'}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-surface/40 rounded-xl border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[12px] font-medium text-text-primary">
                {isZh ? '本地存储' : 'Local Storage'}
              </span>
            </div>
            <p className="text-[11px] text-text-muted">
              {isZh ? 'IndexedDB 浏览器本地存储' : 'IndexedDB browser local storage'}
            </p>
          </div>
          <div className="p-3 bg-surface/40 rounded-xl border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <HardDriveDownload className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[12px] font-medium text-text-primary">
                {isZh ? '数据导出' : 'Data Export'}
              </span>
            </div>
            <p className="text-[11px] text-text-muted">
              {isZh ? '导出/导入知识库数据' : 'Export/import knowledge data'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * 记忆系统设置面板
 * 配置遗忘参数、分类规则、隐私选项、云端同步等
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Settings,
  Clock,
  Brain,
  Shield,
  Trash2,
  Save,
  RotateCcw,
  AlertTriangle,
  Cloud,
  CloudDownload,
  CloudUpload,
  Info,
  RefreshCw,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { memoryApi } from '../api'
import { TIER_META, type MemoryTier } from '../types'

interface MemorySettings {
  // 遗忘引擎
  autoForgettingEnabled: boolean
  forgettingIntervalHours: number
  reviewBoostMultiplier: number
  // 分类
  autoClassificationEnabled: boolean
  minClassificationConfidence: number
  // 隐私
  shareMemoryForTraining: boolean
  encryptSensitiveMemory: boolean
  // 保留策略
  tierRetentionDays: Record<MemoryTier, number>
  // 云端同步
  cloudSyncEnabled: boolean
  autoSyncOnExit: boolean
}

const DEFAULT_SETTINGS: MemorySettings = {
  autoForgettingEnabled: true,
  forgettingIntervalHours: 24,
  reviewBoostMultiplier: 1.0,
  autoClassificationEnabled: true,
  minClassificationConfidence: 0.6,
  shareMemoryForTraining: false,
  encryptSensitiveMemory: true,
  tierRetentionDays: {
    permanent: 3650,
    long_term: 180,
    short_term: 30,
    working: 1,
  },
  cloudSyncEnabled: false,
  autoSyncOnExit: false,
}

const STORAGE_KEY = 'memory-settings'

export function MemorySettingsPanel() {
  const [settings, setSettings] = useState<MemorySettings>(DEFAULT_SETTINGS)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  // 云端同步状态
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)

  // 加载设置
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) })
      }
      // 加载上次同步时间
      const lastSync = localStorage.getItem('memory-last-synced-at')
      if (lastSync) {
        setLastSyncedAt(parseInt(lastSync, 10))
      }
    } catch (err) {
      console.warn('加载记忆设置失败', err)
    }
  }, [])

  const updateSetting = useCallback(<K extends keyof MemorySettings>(
    key: K,
    value: MemorySettings[K],
  ) => {
    setSettings((s) => ({ ...s, [key]: value }))
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      setDirty(false)
    } catch (err) {
      console.error('保存设置失败', err)
    } finally {
      setSaving(false)
    }
  }, [settings])

  const handleReset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    setDirty(true)
  }, [])

  // 清空所有记忆
  const handleClearAll = useCallback(async () => {
    setShowClearConfirm(false)
    try {
      // 通过 API 批量删除（这里简化处理，实际可调用专用接口）
      const stats = await memoryApi.forgetting.getStats()
      if (stats.total > 0) {
        // 提示用户前往列表页手动删除，或调用清理接口
        alert(`共有 ${stats.total} 条记忆。请前往列表页使用批量删除功能，或运行遗忘引擎清理。`)
      }
    } catch (err) {
      console.error('清空记忆失败', err)
    }
  }, [])

  /**
   * 手动拉取云端记忆到本地 SQLite
   * 场景：用户在另一台设备（如移动端）新增了记忆，或开启了云端同步后想立即同步
   */
  const handlePullFromCloud = useCallback(async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      // 获取当前用户 ID（从 useStore 或 localStorage）
      const userId = localStorage.getItem('current-user-id') || 'default'
      const result = await memoryApi.sync.pullAll(userId)

      if ('error' in result) {
        setSyncMessage({ type: 'error', text: `拉取失败: ${result.error}` })
        return
      }

      if (!result.items || result.items.length === 0) {
        setSyncMessage({ type: 'info', text: '云端暂无记忆数据' })
        return
      }

      // 将云端记忆写入本地 SQLite
      await api.memoryDb.initialize()
      const entries = result.items.map((item: any) => ({
        id: item.id,
        user_id: item.userId ?? null,
        conversation_id: item.conversationId ?? null,
        type: item.tier === 'long_term' ? 'LONG_TERM' : 'SHORT_TERM',
        content: item.content ?? '',
        summary: item.summary ?? null,
        importance: item.importance ?? 0.5,
        access_count: item.accessCount ?? 0,
        last_accessed_at: item.lastAccessedAt ?? null,
        expires_at: item.expiresAt ?? null,
        created_at: new Date(item.createdAt).getTime() || Date.now(),
        updated_at: new Date(item.updatedAt).getTime() || Date.now(),
        category: item.category ?? null,
        subcategory: item.subcategory ?? null,
        tier: item.tier ?? 'short_term',
        classification_confidence: item.classificationConfidence ?? 0,
        classified_by: item.classifiedBy ?? null,
        classified_at: item.classifiedAt ?? null,
        content_hash: item.contentHash ?? null,
        retention_score: item.retentionScore ?? 1.0,
        last_reviewed_at: item.lastReviewedAt ?? null,
        review_count: item.reviewCount ?? 0,
        spatial_context: item.spatialContext ?? null,
        tags: JSON.stringify(item.tags ?? []),
        enabled: item.enabled !== false ? 1 : 0,
        source: item.source ?? null,
        version: item.version ?? 1,
        sync_status: 'synced',
        remote_id: item.id,
        last_synced_at: Date.now(),
      }))

      await api.memoryDb.batchUpsertEntries(entries)
      const now = Date.now()
      setLastSyncedAt(now)
      localStorage.setItem('memory-last-synced-at', String(now))
      setSyncMessage({ type: 'success', text: `成功拉取 ${entries.length} 条云端记忆到本地` })
    } catch (err) {
      console.error('拉取云端记忆失败', err)
      setSyncMessage({ type: 'error', text: `拉取失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setSyncing(false)
    }
  }, [])

  /**
   * 手动推送本地记忆到云端（备份）
   */
  const handlePushToCloud = useCallback(async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      await api.memoryDb.initialize()
      const pending = await api.memoryDb.getPendingPush(1000)

      if (pending.length === 0) {
        setSyncMessage({ type: 'info', text: '没有需要推送的新记忆' })
        return
      }

      const userId = localStorage.getItem('current-user-id') || 'default'
      const result = await memoryApi.sync.push(userId, pending as any)

      if ('error' in result) {
        setSyncMessage({ type: 'error', text: `推送失败: ${result.error}` })
        return
      }

      // 标记已同步
      for (const entry of pending) {
        await api.memoryDb.markAsSynced(entry.id, entry.id)
      }

      const now = Date.now()
      setLastSyncedAt(now)
      localStorage.setItem('memory-last-synced-at', String(now))
      setSyncMessage({ type: 'success', text: `成功推送 ${pending.length} 条记忆到云端` })
    } catch (err) {
      console.error('推送记忆到云端失败', err)
      setSyncMessage({ type: 'error', text: `推送失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setSyncing(false)
    }
  }, [])

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar p-4 space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">记忆系统设置</h3>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              重置
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
              dirty && !saving
                ? 'text-white bg-accent hover:bg-accent/90'
                : 'text-text-muted bg-surface-hover cursor-not-allowed'
            }`}
          >
            <Save className="w-3 h-3" />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 遗忘引擎设置 */}
      <SettingsSection title="遗忘引擎" icon={<Clock className="w-4 h-4" />}>
        <ToggleRow
          label="自动遗忘"
          description="定期运行遗忘引擎，自动调整记忆保留值"
          checked={settings.autoForgettingEnabled}
          onChange={(v) => updateSetting('autoForgettingEnabled', v)}
        />
        <NumberRow
          label="运行间隔（小时）"
          description="遗忘引擎自动运行的间隔时间"
          value={settings.forgettingIntervalHours}
          min={1}
          max={168}
          onChange={(v) => updateSetting('forgettingIntervalHours', v)}
          disabled={!settings.autoForgettingEnabled}
        />
        <SliderRow
          label="复习提升倍数"
          description="每次复习对保留值的提升倍数"
          value={settings.reviewBoostMultiplier}
          min={0.5}
          max={2.0}
          step={0.1}
          onChange={(v) => updateSetting('reviewBoostMultiplier', v)}
        />
      </SettingsSection>

      {/* 分类设置 */}
      <SettingsSection title="自动分类" icon={<Brain className="w-4 h-4" />}>
        <ToggleRow
          label="自动分类新记忆"
          description="使用 AI 自动对新记忆进行分类"
          checked={settings.autoClassificationEnabled}
          onChange={(v) => updateSetting('autoClassificationEnabled', v)}
        />
        <SliderRow
          label="最低分类置信度"
          description="低于此置信度的分类将标记为待确认"
          value={settings.minClassificationConfidence}
          min={0.3}
          max={0.9}
          step={0.05}
          onChange={(v) => updateSetting('minClassificationConfidence', v)}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          disabled={!settings.autoClassificationEnabled}
        />
      </SettingsSection>

      {/* 保留策略 */}
      <SettingsSection title="保留策略" icon={<Clock className="w-4 h-4" />}>
        <div className="space-y-2">
          {(Object.keys(settings.tierRetentionDays) as MemoryTier[]).map((tier) => {
            const meta = TIER_META[tier]
            return (
              <div key={tier} className="flex items-center justify-between p-2 rounded-lg bg-surface-hover/20">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span className="text-xs text-text-primary">{meta.label}</span>
                  <span className="text-[10px] text-text-muted">{meta.description}</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={settings.tierRetentionDays[tier]}
                    onChange={(e) =>
                      updateSetting('tierRetentionDays', {
                        ...settings.tierRetentionDays,
                        [tier]: parseInt(e.target.value) || 0,
                      })
                    }
                    min={0}
                    max={3650}
                    className="w-16 px-2 py-0.5 text-xs text-right bg-surface border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <span className="text-[10px] text-text-muted">天</span>
                </div>
              </div>
            )
          })}
        </div>
      </SettingsSection>

      {/* 隐私设置 */}
      <SettingsSection title="隐私与安全" icon={<Shield className="w-4 h-4" />}>
        <ToggleRow
          label="加密敏感记忆"
          description="对标记为敏感的记忆内容进行加密存储"
          checked={settings.encryptSensitiveMemory}
          onChange={(v) => updateSetting('encryptSensitiveMemory', v)}
        />
        <ToggleRow
          label="共享记忆用于训练"
          description="允许使用你的记忆数据改进 AI 模型（默认关闭）"
          checked={settings.shareMemoryForTraining}
          onChange={(v) => updateSetting('shareMemoryForTraining', v)}
        />
      </SettingsSection>

      {/* 云端同步 */}
      <SettingsSection title="云端同步" icon={<Cloud className="w-4 h-4" />}>
        {/* 同步开关 */}
        <ToggleRow
          label="启用云端同步"
          description="将记忆备份到云端，支持跨设备使用（PC + 移动端）"
          checked={settings.cloudSyncEnabled}
          onChange={(v) => updateSetting('cloudSyncEnabled', v)}
        />

        {/* 同步好处提示 */}
        {settings.cloudSyncEnabled && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-accent/5 border border-accent/20">
            <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
            <div className="text-[10px] text-text-secondary leading-relaxed">
              <div className="font-medium text-accent mb-1">同步至云端的好处：</div>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>跨设备使用记忆（PC + 移动端 App）</li>
                <li>数据备份，防止本地丢失</li>
                <li>重装系统后可一键恢复</li>
                <li>长期积累的用户画像不会丢失</li>
              </ul>
            </div>
          </div>
        )}

        {/* 自动同步开关 */}
        {settings.cloudSyncEnabled && (
          <ToggleRow
            label="退出时自动同步"
            description="应用退出时自动推送本地记忆到云端"
            checked={settings.autoSyncOnExit}
            onChange={(v) => updateSetting('autoSyncOnExit', v)}
          />
        )}

        {/* 上次同步时间 */}
        {lastSyncedAt && (
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <Clock className="w-3 h-3" />
            <span>上次同步：{new Date(lastSyncedAt).toLocaleString('zh-CN')}</span>
          </div>
        )}

        {/* 同步操作按钮 */}
        {settings.cloudSyncEnabled && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handlePullFromCloud}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-hover/40 hover:bg-surface-hover/60 border border-border/40 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CloudDownload className="w-3 h-3" />}
              拉取云端记忆
            </button>
            <button
              onClick={handlePushToCloud}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CloudUpload className="w-3 h-3" />}
              推送到云端
            </button>
          </div>
        )}

        {/* 同步消息 */}
        {syncMessage && (
          <div
            className={`flex items-start gap-2 p-2.5 rounded-lg text-[10px] leading-relaxed ${
              syncMessage.type === 'success'
                ? 'bg-green-500/10 border border-green-500/20 text-green-600'
                : syncMessage.type === 'error'
                ? 'bg-red-500/10 border border-red-500/20 text-red-500'
                : 'bg-blue-500/10 border border-blue-500/20 text-blue-500'
            }`}
          >
            {syncMessage.type === 'success' ? (
              <CloudDownload className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : syncMessage.type === 'error' ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            )}
            <span>{syncMessage.text}</span>
          </div>
        )}
      </SettingsSection>

      {/* 危险区域 */}
      <SettingsSection title="数据管理" icon={<AlertTriangle className="w-4 h-4 text-red-500" />}>
        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors w-full"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清空所有记忆
          </button>
        ) : (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 space-y-2">
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>确定要清空所有记忆吗？此操作不可恢复！</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearAll}
                className="px-3 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
              >
                确认清空
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

// ============ 辅助组件 ============

function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent">{icon}</span>
        <h4 className="text-sm font-medium text-text-primary">{title}</h4>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="text-xs font-medium text-text-primary">{label}</div>
        {description && <div className="text-[10px] text-text-muted mt-0.5">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-accent' : 'bg-surface-hover'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </div>
  )
}

function NumberRow({
  label,
  description,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex-1">
        <div className="text-xs font-medium text-text-primary">{label}</div>
        {description && <div className="text-[10px] text-text-muted mt-0.5">{description}</div>}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        className="w-20 px-2 py-1 text-xs text-right bg-surface border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:cursor-not-allowed"
      />
    </div>
  )
}

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
}) {
  return (
    <div className={`space-y-1 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-text-primary">{label}</div>
          {description && <div className="text-[10px] text-text-muted mt-0.5">{description}</div>}
        </div>
        <span className="text-xs font-mono text-accent">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-surface-hover rounded-full appearance-none cursor-pointer accent-accent disabled:cursor-not-allowed"
      />
    </div>
  )
}

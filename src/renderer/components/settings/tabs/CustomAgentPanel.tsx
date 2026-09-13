import { useState, useMemo, useEffect, useRef } from 'react'

import {
  Bot, Plus, Edit2, Trash2, X, Sparkles, Zap,
  Search, Check, Plug, RefreshCw,
  AlertCircle, Settings2, ArrowLeft, Upload, Trash2 as TrashIcon,
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { TextField, ToggleSwitch, AgentIcon, AgentIconPreview, AGENT_PRESET_ICONS } from '@components/ui'
import type { AgentConfig } from '@shared/configuration/configTypes'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'

// ─── 系统提示词最大长度 ───
const SYSTEM_PROMPT_MAX = 10000

type TriggerMode = 'always' | 'on_request' | 'manual'

interface CustomAgent {
  id: string
  name: string
  description: string
  systemPrompt: string
  icon?: string
  capabilities: string[]
  priority: number
  enabled: boolean
  identifier?: string
  callable?: boolean
  triggerMode?: TriggerMode
  builtinTools?: string[]
  mcpServices?: string[]
  plugins?: string[]
  createdAt?: number
  updatedAt?: number
}
interface Props {
  agentConfig: AgentConfig
  setAgentConfig: (config: AgentConfig) => void
  language: Language
  onNewAgentCreated?: (agentId: string) => void
  pendingNewAgentId?: string
  /** 自动打开指定智能体的编辑器（编辑已有智能体，来自聊天输入区「设置智能体」入口） */
  editAgentId?: string
}

function createEmptyAgent({ allMcpIds }: { allMcpIds: string[] }): CustomAgent {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    description: '',
    systemPrompt: '',
    icon: 'bot',
    capabilities: [],
    priority: 5,
    enabled: true,
    identifier: '',
    callable: false,
    triggerMode: 'manual',
    // 致命问题 #3：内置工具不再需要勾选 —— 选择智能体后内置工具全部放行
    builtinTools: undefined,
    mcpServices: [...allMcpIds],
    plugins: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function CustomAgentPanel({ agentConfig, setAgentConfig, language, onNewAgentCreated, pendingNewAgentId, editAgentId }: Props) {
  const { mcpServers } = useStore(useShallow(s => ({
    mcpServers: s.mcpServers,
  })))

  const connectedMcpNames = useMemo(() =>
    mcpServers.filter(s => s.status === 'connected').map(s => ({ id: s.id, name: s.config.name })),
    [mcpServers],
  )

  const profiles = agentConfig.customAgentProfiles || []
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // 新建的草稿智能体（未保存到列表前）
  const [pendingNewAgent, setPendingNewAgent] = useState<CustomAgent | null>(null)
  // 视图：list=列表视图，editor=编辑器视图（两者分离，不混排）
  const [view, setView] = useState<'list' | 'editor'>('list')

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles
    const q = searchQuery.toLowerCase()
    return profiles.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.identifier || '').toLowerCase().includes(q),
    )
  }, [profiles, searchQuery])

  const handleCreate = () => {
    const empty = createEmptyAgent({
      allMcpIds: connectedMcpNames.map(s => s.id),
    })
    setPendingNewAgent(empty)
    setEditingId(empty.id)
    setView('editor')
  }

  const handleCloseEditor = () => {
    setEditingId(null)
    setPendingNewAgent(null)
    setView('list')
  }

  const handleUpdate = (updates: Partial<CustomAgent>, isNew: boolean) => {
    if (isNew && pendingNewAgent) {
      const saved = { ...pendingNewAgent, ...updates, updatedAt: Date.now() }
      setAgentConfig({ ...agentConfig, customAgentProfiles: [...profiles, saved] })
      onNewAgentCreated?.(saved.id)
      setPendingNewAgent(null)
      setEditingId(null)
      setView('list')
    } else if (!isNew && editingId) {
      const next = profiles.map(p =>
        p.id === editingId ? { ...p, ...updates, updatedAt: Date.now() } : p,
      )
      setAgentConfig({ ...agentConfig, customAgentProfiles: next })
      setEditingId(null)
      setView('list')
    }
  }

  // 当外部传入 pendingNewAgentId 时，自动打开新建表单（编辑器视图）
  useEffect(() => {
    if (pendingNewAgentId && !editingId && !pendingNewAgent) {
      const empty = createEmptyAgent({
        allMcpIds: connectedMcpNames.map(s => s.id),
      })
      setPendingNewAgent(empty)
      setEditingId(empty.id)
      setView('editor')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewAgentId])

  // 当外部传入 editAgentId 时，自动打开该智能体的编辑器（编辑已有智能体）
  useEffect(() => {
    if (!editAgentId || editingId || pendingNewAgent) return
    const profile = profiles.find(p => p.id === editAgentId)
    if (profile) {
      setEditingId(profile.id)
      setView('editor')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAgentId])

  const handleDelete = async (profile: CustomAgent) => {
    const confirmed = await globalConfirm({
      title: t('agent.delete', language as Language),
      message: t('agent.deleteConfirm', language as Language, { name: profile.name }),
      confirmText: t('app.confirm', language as Language) || '确认',
      cancelText: t('app.cancel', language as Language) || '取消',
      variant: 'danger',
    })
    if (!confirmed) return
    const next = profiles.filter(p => p.id !== profile.id)
    setAgentConfig({ ...agentConfig, customAgentProfiles: next })
    if (editingId === profile.id) handleCloseEditor()
  }

  const handleEnableToggle = (id: string) => {
    const next = profiles.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled, updatedAt: Date.now() } : p,
    )
    setAgentConfig({ ...agentConfig, customAgentProfiles: next })
  }

  const selectedProfile = editingId
    ? profiles.find(p => p.id === editingId) ?? pendingNewAgent
    : pendingNewAgent

  const isEditingNew = editingId === pendingNewAgent?.id
  const isZh = language === 'zh'

  // ── 编辑器视图：与列表完全分离 ──
  if (view === 'editor' && selectedProfile) {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* 编辑器顶部栏 */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCloseEditor}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {isZh ? '返回列表' : 'Back to list'}
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-text-primary truncate">
              {isEditingNew
                ? (isZh ? '新建智能体' : 'Create Agent')
                : (isZh ? '编辑智能体' : 'Edit Agent')}
            </h3>
            <p className="text-[11px] text-text-muted truncate">
              {isEditingNew
                ? (isZh ? '填写信息后点击「保存智能体」完成创建' : 'Fill in the details and click Save to create')
                : selectedProfile.name || t('agent.edit', language as Language)}
            </p>
          </div>
          {isEditingNew && (
            <span className="text-[10px] px-2 py-0.5 bg-accent/15 text-accent rounded-full font-medium flex-shrink-0">
              {isZh ? '草稿' : 'Draft'}
            </span>
          )}
        </div>

        <AgentEditor
          profile={selectedProfile}
          connectedMcpServers={connectedMcpNames}
          language={language as Language}
          onUpdate={(updates) => handleUpdate(updates, isEditingNew)}
          isNew={isEditingNew}
        />
      </div>
    )
  }

  // ── 列表视图 ──
  return (
    <div className="space-y-4 animate-fade-in">
      {/* 头部：搜索 + 新建按钮 */}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 bg-surface-active/50 rounded-xl px-3 py-2 border border-border/40">
          <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('app.search', language as Language)}
            className="bg-transparent text-xs text-text-primary outline-none flex-1 placeholder:text-text-muted/60"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-text-muted hover:text-text-primary">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-xs font-semibold rounded-xl hover:bg-accent-hover transition-all shadow-sm shadow-accent/20 active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('agent.create', language as Language)}
        </button>
      </div>

      {/* 智能体列表 */}
      {filteredProfiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-surface-active flex items-center justify-center mb-3">
            <Bot className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-xs text-text-muted">
            {searchQuery
              ? (isZh ? '没有找到匹配的智能体' : 'No agents found')
              : t('agent.noAgents', language as Language)
            }
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProfiles.map(profile => (
            <AgentCard
              key={profile.id}
              profile={profile}
              isActive={false}
              language={language as Language}
              onEdit={() => { setEditingId(profile.id); setView('editor') }}
              onDelete={() => handleDelete(profile)}
              onToggleEnabled={() => handleEnableToggle(profile.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}


// ─── 智能体卡片 ───────────────────────────────────────────────

function AgentCard({
  profile, isActive, language, onEdit, onDelete, onToggleEnabled,
}: {
  profile: CustomAgent
  isActive: boolean
  language: Language
  onEdit: () => void
  onDelete: () => void
  onToggleEnabled: () => void
}) {
  const isZh = language === 'zh'

  return (
    <div className={`rounded-xl border transition-all ${
      isActive
        ? 'border-accent/40 bg-accent/5 shadow-sm'
        : 'border-border/40 bg-surface/30 hover:border-border/60'
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* 图标 */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          profile.enabled ? 'bg-accent/10' : 'bg-surface-active/50 opacity-50'
        }`}>
          <AgentIconPreview icon={profile.icon} size={18} className="text-accent" />
        </div>

        {/* 信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold truncate ${
              profile.enabled ? 'text-text-primary' : 'text-text-muted'
            }`}>
              {profile.name}
            </span>
            {profile.callable && (
              <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 text-[10px] font-medium rounded border border-purple-500/20 flex-shrink-0">
                {isZh ? '可调用' : 'Callable'}
              </span>
            )}
            {profile.triggerMode === 'always' && (
              <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-medium rounded border border-emerald-500/20 flex-shrink-0">
                {isZh ? '始终' : 'Always'}
              </span>
            )}
            {(profile.mcpServices?.length ?? 0) > 0 && (
              <span className="text-[10px] text-text-muted flex items-center gap-0.5">
                <Plug className="w-2.5 h-2.5" />{profile.mcpServices?.length}
              </span>
            )}
            {(profile.plugins?.length ?? 0) > 0 && (
              <span className="text-[10px] text-text-muted flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" />{profile.plugins?.length}
              </span>
            )}
          </div>
        </div>

        {/* 启用开关 */}
        <ToggleSwitch
          checked={profile.enabled}
          onChange={onToggleEnabled}
          switchSize="sm"
        />

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-surface-active text-text-muted hover:text-text-primary transition-colors"
            title={t('agent.edit', language as Language)}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors"
            title={t('agent.delete', language as Language)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 智能体编辑器 ───────────────────────────────────────────────

function AgentEditor({
  profile,
  connectedMcpServers,
  language,
  onUpdate,
  isNew,
}: {
  profile: CustomAgent
  connectedMcpServers: Array<{ id: string; name: string }>
  language: Language
  onUpdate: (updates: Partial<CustomAgent>) => void
  isNew: boolean
}) {
  const isZh = language === 'zh'
  const [localName, setLocalName] = useState(profile.name)
  const [localIdentifier, setLocalIdentifier] = useState(profile.identifier || '')
  const [localDescription, setLocalDescription] = useState(profile.description)
  const [localSystemPrompt, setLocalSystemPrompt] = useState(profile.systemPrompt)
  const [localIcon, setLocalIcon] = useState(profile.icon || 'bot')
  const [localCallable, setLocalCallable] = useState(profile.callable || false)
  const [localTriggerMode, setLocalTriggerMode] = useState<TriggerMode>(profile.triggerMode || 'manual')
  const [localMcpServices, setLocalMcpServices] = useState<string[]>(profile.mcpServices || [])
  const [localPriority, setLocalPriority] = useState(profile.priority)

  // 图标选择窗口状态
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconError, setIconError] = useState('')
  const iconPickerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 点击图标选择窗口外部时关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target as Node)) {
        setIconPickerOpen(false)
        setIconError('')
      }
    }
    if (iconPickerOpen) {
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }
  }, [iconPickerOpen])

  const handleSave = () => {
    if (!localName.trim()) return
    onUpdate({
      name: localName.trim(),
      identifier: localIdentifier.trim(),
      description: localDescription.trim(),
      systemPrompt: localSystemPrompt,
      icon: localIcon.trim() || 'bot',
      callable: localCallable,
      triggerMode: localTriggerMode,
      // 致命问题 #3：内置工具全放行，不再保存 builtinTools 白名单
      builtinTools: undefined,
      mcpServices: localMcpServices,
      priority: localPriority,
    })
  }

  const toggleMcpService = (serverId: string) => {
    setLocalMcpServices(prev =>
      prev.includes(serverId) ? prev.filter(s => s !== serverId) : [...prev, serverId],
    )
  }

  // 上传自定义图标（转 data URL）
  const handleIconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setIconError(isZh ? '仅支持图片文件' : 'Only image files are supported')
      return
    }
    if (file.size > 1024 * 1024) {
      setIconError(isZh ? '图片大小不能超过 1MB' : 'Image size must be under 1MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setLocalIcon(reader.result as string)
      setIconPickerOpen(false)
      setIconError('')
    }
    reader.onerror = () => {
      setIconError(isZh ? '图片读取失败，请重试' : 'Failed to read image, please retry')
    }
    reader.readAsDataURL(file)
  }


  return (
    <div className="space-y-5 pb-4">
      {/* 基础信息 */}
      <section>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          {isZh ? '基础信息' : 'Basic Info'}
        </h4>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">
                {t('agent.icon', language as Language)}
              </label>
              {/* 图标选择器：点击图标才弹出选择窗口 */}
              <div className="relative" ref={iconPickerRef}>
                <button
                  type="button"
                  onClick={() => setIconPickerOpen(open => !open)}
                  className={`w-20 h-20 rounded-xl border-2 flex items-center justify-center transition-all ${
                    iconPickerOpen
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-border/40 bg-surface-active/40 hover:border-accent/40 hover:bg-surface-active/70'
                  }`}
                  title={t('agent.iconChoose', language as Language)}
                >
                  <AgentIconPreview icon={localIcon} size={32} className="text-accent" />
                </button>

                {iconPickerOpen && (
                  <div className="absolute left-0 top-full mt-2 z-30 w-72 bg-surface border border-border rounded-xl shadow-2xl p-3 animate-scale-in">
                    {/* 预设图标 */}
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
                      {t('agent.iconPreset', language as Language)}
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 mb-3">
                      {AGENT_PRESET_ICONS.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => { setLocalIcon(item.id); setIconPickerOpen(false); setIconError('') }}
                          className={`aspect-square rounded-lg flex items-center justify-center transition-all ${
                            localIcon === item.id
                              ? 'bg-accent/20 text-accent border border-accent/50'
                              : 'bg-surface-active/40 text-text-muted border border-border/20 hover:border-accent/40 hover:text-text-primary'
                          }`}
                        >
                          <AgentIcon icon={item.id} size={18} />
                        </button>
                      ))}
                    </div>

                    {/* 上传 / 移除 */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-active/50 border border-border/40 text-xs text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
                      >
                        <Upload className="w-3 h-3" />
                        {t('agent.iconUpload', language as Language)}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLocalIcon('bot'); setIconError('') }}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-surface-active/50 border border-border/40 text-xs text-text-muted hover:border-red-400/40 hover:text-red-400 transition-colors"
                        title={t('agent.iconRemove', language as Language)}
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-[10px] text-text-muted mt-1.5">
                      {t('agent.iconUploadHint', language as Language)}
                    </div>
                    {iconError && (
                      <div className="text-[10px] text-red-400 mt-1">{iconError}</div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleIconFileChange}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">
                {t('agent.name', language as Language)} <span className="text-red-400">*</span>
              </label>
              <TextField
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                placeholder={t('agent.namePlaceholder', language as Language)}
                className="bg-surface-active/50 border-border text-xs h-9"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              {t('agent.description', language as Language)}
            </label>
            <TextField
              value={localDescription}
              onChange={e => setLocalDescription(e.target.value)}
              placeholder={t('agent.descriptionPlaceholder', language as Language)}
              className="bg-surface-active/50 border-border text-xs h-9"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              {t('agent.identifier', language as Language)}
              <span className="ml-1 text-text-muted font-normal normal-case">({t('agent.identifierDesc', language as Language)})</span>
            </label>
            <TextField
              value={localIdentifier}
              onChange={e => setLocalIdentifier(e.target.value)}
              placeholder={t('agent.identifierPlaceholder', language as Language)}
              className="bg-surface-active/50 border-border text-xs font-mono h-9"
            />
          </div>
        </div>
      </section>


      {/* 系统提示词（位于行为配置之前） */}
      <section>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          {isZh ? '系统提示词' : 'System Prompt'}
        </h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-secondary">
              {isZh ? '定义智能体的核心行为和角色' : 'Define the agent\'s core behavior and role'}
            </label>
            <span className={`text-[10px] tabular-nums ${localSystemPrompt.length >= SYSTEM_PROMPT_MAX ? 'text-red-400 font-semibold' : 'text-text-muted'}`}>
              {localSystemPrompt.length} / {SYSTEM_PROMPT_MAX}
            </span>
          </div>
          <textarea
            value={localSystemPrompt}
            onChange={e => setLocalSystemPrompt(e.target.value.slice(0, SYSTEM_PROMPT_MAX))}
            maxLength={SYSTEM_PROMPT_MAX}
            placeholder={isZh ? '请输入系统提示词，定义智能体的角色和行为...' : 'Enter system prompt to define the agent\'s role and behavior...'}
            className="w-full h-32 px-3 py-2 bg-surface-active/50 border border-border rounded-lg text-xs outline-none focus:border-accent/50 resize-none placeholder:text-text-muted/60"
          />
        </div>
      </section>

      {/* 行为配置 */}
      <section>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Settings2 className="w-3 h-3" />
          {isZh ? '行为配置' : 'Behavior'}
        </h4>
        <div className="space-y-3">
          {/* 可被调用 */}
          <div className="flex items-center justify-between p-3 bg-surface-active/30 rounded-lg border border-border/30">
            <div>
              <div className="text-sm font-medium text-text-primary">{t('agent.callable', language as Language)}</div>
              <div className="text-[11px] text-text-muted mt-0.5">{t('agent.callableDesc', language as Language)}</div>
            </div>
            <ToggleSwitch
              checked={localCallable}
              onChange={() => setLocalCallable(!localCallable)}
              switchSize="sm"
            />
          </div>

          {/* 触发模式 */}
          <div className="flex items-center justify-between p-3 bg-surface-active/30 rounded-lg border border-border/30">
            <div>
              <div className="text-sm font-medium text-text-primary">{t('agent.triggerMode', language as Language)}</div>
            </div>
            <select
              value={localTriggerMode}
              onChange={e => setLocalTriggerMode(e.target.value as TriggerMode)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50"
            >
              <option value="always">{t('agent.triggerMode.always', language as Language)}</option>
              <option value="on_request">{t('agent.triggerMode.on_request', language as Language)}</option>
              <option value="manual">{t('agent.triggerMode.manual', language as Language)}</option>
            </select>
          </div>

          {/* 优先级 */}
          <div className="flex items-center justify-between p-3 bg-surface-active/30 rounded-lg border border-border/30">
            <div>
              <div className="text-sm font-medium text-text-primary">{t('agent.priority', language as Language)}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={10}
                value={localPriority}
                onChange={e => setLocalPriority(Number(e.target.value))}
                className="w-24 accent-accent"
              />
              <span className="text-xs text-text-muted w-6 text-right">{localPriority}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 内置工具说明（致命问题 #3：无需选择，全部可用） */}
      <section>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="w-3 h-3" />
          {t('agent.tools', language as Language)}
          <span className="text-text-muted font-normal normal-case text-[10px]">({t('agent.toolsDesc', language as Language)})</span>
        </h4>
        <div className="flex items-start gap-2 px-3 py-2.5 bg-surface-active/30 rounded-lg border border-border/30 text-xs text-text-muted leading-relaxed">
          <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent" />
          <span>
            {isZh
              ? '内置工具已全部启用（文件读写、搜索、终端、网页等），无需单独配置。如需扩展能力，请在下方连接插件与技能（MCP）。'
              : 'All built-in tools are enabled (file I/O, search, terminal, web, etc.) — no configuration needed. Connect plugins & skills (MCP) below for more capabilities.'}
          </span>
        </div>
      </section>

      {/* 插件与技能（MCP 服务） */}
      <section>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Plug className="w-3 h-3" />
          {isZh ? '插件与技能' : 'Plugins & Skills'}
          <span className="text-text-muted font-normal normal-case text-[10px]">({isZh ? 'MCP 插件和技能' : 'MCP plugins & skills'})</span>
        </h4>
        {connectedMcpServers.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-active/30 rounded-lg border border-border/30 text-xs text-text-muted">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {isZh
              ? '暂无已连接的插件与技能，请先在「插件与技能」设置中添加'
              : 'No plugins & skills connected. Configure them in Settings → Plugins & Skills.'
            }
          </div>
        ) : (
          <div className="space-y-1.5">
            {connectedMcpServers.map(server => (
              <button
                key={server.id}
                onClick={() => toggleMcpService(server.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                  localMcpServices.includes(server.id)
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border/30 bg-surface-active/30 text-text-muted hover:border-border/60'
                }`}
              >
                {localMcpServices.includes(server.id) && <Check className="w-3 h-3 flex-shrink-0" />}
                <span className="font-mono truncate">{server.name}</span>
                <span className="text-[10px] opacity-60 ml-auto flex-shrink-0">{server.id}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 底部操作 */}
      <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/30">
        <button
          onClick={() => {
            setLocalName(profile.name)
            setLocalIdentifier(profile.identifier || '')
            setLocalDescription(profile.description)
            setLocalSystemPrompt(profile.systemPrompt)
            setLocalIcon(profile.icon || 'bot')
            setLocalCallable(profile.callable || false)
            setLocalTriggerMode(profile.triggerMode || 'manual')
            setLocalMcpServices(profile.mcpServices || [])
            setLocalPriority(profile.priority)
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          {isZh ? '重置' : 'Reset'}
        </button>
        <button
          onClick={handleSave}
          disabled={!localName.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs font-semibold rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check className="w-3 h-3" />
          {isZh ? (isNew ? '保存智能体' : '更新智能体') : (isNew ? 'Save Agent' : 'Update Agent')}
        </button>
      </div>
    </div>
  )
}


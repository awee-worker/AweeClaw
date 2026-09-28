/**
 * 角色模型选择器
 *
 * 可选范围与交互方式对齐聊天输入框的模型选择器（自定义 / 云端两类候选、可搜索），
 * 但选择结果只写入角色自身的 modelPreference，不改变当前会话使用的全局模型。
 * 未选择任何模型时，角色继承当前会话配置。
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search, Cloud, Puzzle, RotateCcw } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { backendApi, getServerUrl } from '@services/backendApi'
import { ProviderIcon } from '@components/ui/ProviderIcon'
import { buildEnabledLocalModels, type FlatModel } from '@components/conversation/availableModels'
import type { RoleModelPreference } from '@intelligence/capabilities/role/RoleDescriptor'

interface RoleModelPickerProps {
  value: RoleModelPreference
  onChange: (next: Pick<RoleModelPreference, 'provider' | 'model'>) => void
  disabled?: boolean
}

export function RoleModelPicker({ value, onChange, disabled = false }: RoleModelPickerProps) {
  const { providerConfigs, llmConfig, cloudMode, isAuthenticated, serverUrl } = useStore(
    useShallow(s => ({
      providerConfigs: s.providerConfigs,
      llmConfig: s.llmConfig,
      cloudMode: s.cloudMode,
      isAuthenticated: s.isAuthenticated,
      serverUrl: s.serverUrl,
    })),
  )

  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>(
    cloudMode === 'cloud' ? 'cloud' : 'local',
  )
  const [cloudModels, setCloudModels] = useState<FlatModel[]>([])
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  /** 弹层跟随触发按钮定位：下方空间不足时改为向上展开 */
  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 300),
      maxHeight: Math.min(320, openUp ? spaceAbove : spaceBelow),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    })
  }, [])

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      return
    }
    updateDropdownPosition()

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const insideTrigger = containerRef.current?.contains(target)
      const insideDropdown = dropdownRef.current?.contains(target)
      if (!insideTrigger && !insideDropdown) setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)
    const focusTimer = setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 50)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
      clearTimeout(focusTimer)
    }
  }, [isOpen, updateDropdownPosition])

  // 打开弹层时按当前云 / 本地模式同步所属 tab
  useEffect(() => {
    if (isOpen) setActiveTab(cloudMode === 'cloud' ? 'cloud' : 'local')
  }, [isOpen, cloudMode])

  const fetchCloudModels = useCallback(() => {
    if (!isAuthenticated) {
      setCloudModels([])
      return
    }
    const sUrl = getServerUrl() || serverUrl
    if (!sUrl) return

    backendApi
      .get<Array<{ provider: string; models: string[] }>>('/api/v1/llm/models')
      .then(data => {
        const flat: FlatModel[] = []
        for (const item of data) {
          for (const modelId of item.models) {
            flat.push({
              id: modelId,
              name: modelId.split('/').pop() || modelId,
              providerId: item.provider.toLowerCase(),
              providerName: item.provider,
            })
          }
        }
        setCloudModels(flat)
      })
      .catch(() => setCloudModels([]))
  }, [isAuthenticated, serverUrl])

  useEffect(() => {
    if (isOpen && activeTab === 'cloud' && isAuthenticated) fetchCloudModels()
  }, [isOpen, activeTab, isAuthenticated, fetchCloudModels])

  const localModels = useMemo(
    () => buildEnabledLocalModels(providerConfigs, llmConfig.apiKey),
    [providerConfigs, llmConfig.apiKey],
  )

  const allModels = useMemo(
    () => (activeTab === 'cloud' ? cloudModels : localModels),
    [activeTab, cloudModels, localModels],
  )

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allModels
    return allModels.filter(
      m =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.providerName.toLowerCase().includes(q),
    )
  }, [allModels, searchQuery])

  const currentModel = useMemo(
    () => allModels.find(m => m.providerId === value.provider && m.id === value.model) || null,
    [allModels, value.provider, value.model],
  )

  const isInherited = !value.provider && !value.model

  const handleTabSwitch = (tab: 'local' | 'cloud') => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setSearchQuery('')
  }

  const triggerLabel = currentModel
    ? currentModel.name
    : isInherited
      ? '继承当前会话配置'
      : `${value.provider ?? ''} / ${value.model ?? ''}`

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        className={`
          w-full flex items-center gap-2 px-2.5 py-1.5 text-xs bg-input border border-input-border rounded-lg
          outline-none transition-colors hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed
          ${isOpen ? 'border-accent ring-1 ring-accent/20' : ''}
        `}
      >
        {currentModel ? (
          <ProviderIcon providerId={currentModel.providerId} size={14} className="opacity-80 flex-shrink-0" />
        ) : (
          <RotateCcw className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
        <span
          className={`truncate flex-1 text-left ${isInherited ? 'text-text-muted' : 'text-text-primary'}`}
          title={triggerLabel}
        >
          {triggerLabel}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-text-muted transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="flex flex-col bg-surface border border-border min-w-[240px] rounded-xl shadow-2xl z-[9999] animate-scale-in overflow-hidden"
          >
            {/* Tab 切换栏 */}
            <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-border/50 shrink-0">
              <button
                type="button"
                onClick={() => handleTabSwitch('local')}
                className={`
                  flex flex-1 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${activeTab === 'local'
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                  }
                `}
              >
                <Puzzle className="w-3.5 h-3.5" />
                <span>自定义</span>
              </button>
              <button
                type="button"
                onClick={() => handleTabSwitch('cloud')}
                disabled={!isAuthenticated}
                title={!isAuthenticated ? '请先登录' : undefined}
                className={`
                  flex flex-1 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${activeTab === 'cloud'
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                  }
                  ${!isAuthenticated ? 'opacity-40 cursor-not-allowed' : ''}
                `}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>云端</span>
              </button>
            </div>

            {/* 搜索框 */}
            <div className="p-2 border-b border-border/50 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="搜索模型..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-input border border-input-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/85 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
            </div>

            {/* 模型列表 */}
            <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
              {/* 继承项：仅本地 tab 展示，避免与云端候选混淆 */}
              {activeTab === 'local' && !searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    onChange({ provider: undefined, model: undefined })
                    setIsOpen(false)
                  }}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors mb-0.5
                    ${isInherited
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                    }
                  `}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <RotateCcw className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                    <span className="truncate">继承当前会话配置</span>
                  </span>
                  {isInherited && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                </button>
              )}

              {activeTab === 'cloud' && !isAuthenticated ? (
                <div className="py-6 px-4 text-center">
                  <Cloud className="w-6 h-6 text-text-muted/40 mx-auto mb-2" />
                  <p className="text-xs text-text-muted">请先登录后使用云端模型</p>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">
                  {activeTab === 'cloud' ? '暂无可用云端模型' : '无相关模型'}
                </div>
              ) : (
                filteredModels.map(model => {
                  const isSelected = value.provider === model.providerId && value.model === model.id
                  return (
                    <button
                      type="button"
                      key={`${model.providerId}-${model.id}`}
                      onClick={() => {
                        onChange({ provider: model.providerId, model: model.id })
                        setIsOpen(false)
                      }}
                      className={`
                        w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors mb-0.5 last:mb-0
                        ${isSelected ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
                      `}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <ProviderIcon providerId={model.providerId} size={14} className="flex-shrink-0 opacity-60" />
                        <span className="truncate" title={model.name}>{model.name}</span>
                        <span className="text-[10px] text-text-muted/70 truncate">{model.providerName}</span>
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
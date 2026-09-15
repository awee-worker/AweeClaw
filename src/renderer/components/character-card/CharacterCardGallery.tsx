/**
 * 角色卡画廊组件
 *
 * 功能：
 * 1. 显示所有已导入的角色卡
 * 2. 支持搜索、过滤、排序
 * 3. 角色卡详情预览
 * 4. 导入/导出/删除操作
 *
 * @module character-card/CharacterCardGallery
 */

import React, { useState, useCallback, useEffect, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Filter, Plus, Download, Trash2, Edit, MoreVertical,
  FileText, FileImage, Tag, User, Calendar, ChevronDown, X
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { OverlayDialog } from '../ui/OverlayDialog'
import { ActionButton } from '../ui/ActionButton'
import { toast } from '../foundation/NotificationProvider'
import { CharacterCardImporter } from './CharacterCardImporter'
import { CharacterCardExporter } from './CharacterCardExporter'
import type { AweeClawCharacterCard, CardQueryOptions } from '@main/modules/character-card/types'

interface CharacterCardGalleryProps {
  isOpen: boolean
  onClose: () => void
  language: Language
  onSelectCard?: (card: AweeClawCharacterCard) => void
}

interface GalleryState {
  cards: AweeClawCharacterCard[]
  filteredCards: AweeClawCharacterCard[]
  isLoading: boolean
  searchQuery: string
  selectedTags: string[]
  sortBy: CardQueryOptions['sortBy']
  sortOrder: CardQueryOptions['sortOrder']
  selectedCard: AweeClawCharacterCard | null
  showImporter: boolean
  showExporter: boolean
  showDeleteConfirm: boolean
  cardToDelete: AweeClawCharacterCard | null
  allTags: string[]
}

export const CharacterCardGallery: React.FC<CharacterCardGalleryProps> = memo(function CharacterCardGallery({
  isOpen,
  onClose,
  language,
  onSelectCard,
}) {
  const [state, setState] = useState<GalleryState>({
    cards: [],
    filteredCards: [],
    isLoading: false,
    searchQuery: '',
    selectedTags: [],
    sortBy: 'importedAt',
    sortOrder: 'desc',
    selectedCard: null,
    showImporter: false,
    showExporter: false,
    showDeleteConfirm: false,
    cardToDelete: null,
    allTags: [],
  })

  const isZh = language === 'zh-CN'

  // 加载角色卡列表
  const loadCards = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }))

    try {
      const result = await window.electronAPI.invoke('character-card:get-all-cards')
      if (result.success && result.data) {
        const cards = result.data as AweeClawCharacterCard[]
        const allTags = [...new Set(cards.flatMap(card => card.tags))].sort()

        setState(prev => ({
          ...prev,
          cards,
          filteredCards: cards,
          isLoading: false,
          allTags,
        }))
      } else {
        setState(prev => ({ ...prev, isLoading: false }))
        toast.error(
          isZh ? '加载失败' : 'Failed to load',
          result.error || (isZh ? '无法加载角色卡列表' : 'Failed to load character card list')
        )
      }
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }))
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error(
        isZh ? '加载失败' : 'Failed to load',
        errorMsg
      )
    }
  }, [isZh])

  // 初始化加载
  useEffect(() => {
    if (isOpen) {
      loadCards()
    }
  }, [isOpen, loadCards])

  // 过滤和排序
  useEffect(() => {
    let filtered = [...state.cards]

    // 搜索过滤
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase()
      filtered = filtered.filter(card =>
        card.name.toLowerCase().includes(query) ||
        card.description.toLowerCase().includes(query) ||
        card.creator.toLowerCase().includes(query) ||
        card.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }

    // 标签过滤
    if (state.selectedTags.length > 0) {
      filtered = filtered.filter(card =>
        state.selectedTags.some(tag => card.tags.includes(tag))
      )
    }

    // 排序
    filtered.sort((a, b) => {
      let valueA: string, valueB: string
      switch (state.sortBy) {
        case 'name':
          valueA = a.name
          valueB = b.name
          break
        case 'importedAt':
          valueA = a.metadata.importedAt
          valueB = b.metadata.importedAt
          break
        case 'modifiedAt':
          valueA = a.metadata.modifiedAt
          valueB = b.metadata.modifiedAt
          break
        default:
          valueA = a.name
          valueB = b.name
      }
      return state.sortOrder === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA)
    })

    setState(prev => ({ ...prev, filteredCards: filtered }))
  }, [state.cards, state.searchQuery, state.selectedTags, state.sortBy, state.sortOrder])

  // 处理搜索
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, searchQuery: e.target.value }))
  }, [])

  // 处理标签选择
  const handleTagToggle = useCallback((tag: string) => {
    setState(prev => ({
      ...prev,
      selectedTags: prev.selectedTags.includes(tag)
        ? prev.selectedTags.filter(t => t !== tag)
        : [...prev.selectedTags, tag],
    }))
  }, [])

  // 处理排序变化
  const handleSortChange = useCallback((sortBy: CardQueryOptions['sortBy']) => {
    setState(prev => ({
      ...prev,
      sortBy,
      sortOrder: prev.sortBy === sortBy && prev.sortOrder === 'asc' ? 'desc' : 'asc',
    }))
  }, [])

  // 处理角色卡选择
  const handleCardSelect = useCallback((card: AweeClawCharacterCard) => {
    setState(prev => ({ ...prev, selectedCard: card }))
  }, [])

  // 处理导入成功
  const handleImportSuccess = useCallback((card: AweeClawCharacterCard) => {
    setState(prev => ({
      ...prev,
      cards: [card, ...prev.cards],
      showImporter: false,
    }))
    loadCards() // 重新加载列表
  }, [loadCards])

  // 处理删除
  const handleDeleteCard = useCallback(async () => {
    if (!state.cardToDelete) return

    try {
      const result = await window.electronAPI.invoke('character-card:delete-card', {
        cardId: state.cardToDelete.id,
      })

      if (result.success) {
        setState(prev => ({
          ...prev,
          cards: prev.cards.filter(card => card.id !== state.cardToDelete?.id),
          showDeleteConfirm: false,
          cardToDelete: null,
          selectedCard: prev.selectedCard?.id === state.cardToDelete?.id ? null : prev.selectedCard,
        }))

        toast.success(
          isZh ? '删除成功' : 'Deleted successfully',
          isZh ? `角色卡 "${state.cardToDelete.name}" 已删除` : `Character card "${state.cardToDelete.name}" deleted`
        )
      } else {
        toast.error(
          isZh ? '删除失败' : 'Delete failed',
          result.error || (isZh ? '未知错误' : 'Unknown error')
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error(
        isZh ? '删除失败' : 'Delete failed',
        errorMsg
      )
    }
  }, [state.cardToDelete, isZh])

  // 处理导出
  const handleExportCard = useCallback((card: AweeClawCharacterCard) => {
    setState(prev => ({
      ...prev,
      selectedCard: card,
      showExporter: true,
    }))
  }, [])

  // 清除过滤器
  const handleClearFilters = useCallback(() => {
    setState(prev => ({
      ...prev,
      searchQuery: '',
      selectedTags: [],
    }))
  }, [])

  // 格式化日期
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }, [language])

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isZh ? '角色卡画廊' : 'Character Card Gallery'}
      size="xl"
    >
      <div className="flex flex-col h-[80vh]">
        {/* 工具栏 */}
        <div className="flex items-center gap-4 p-4 border-b border-border-secondary">
          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              placeholder={isZh ? '搜索角色卡...' : 'Search character cards...'}
              value={state.searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            />
            {state.searchQuery && (
              <button
                onClick={() => setState(prev => ({ ...prev, searchQuery: '' }))}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 rounded-full hover:bg-surface-secondary"
              >
                <X className="w-4 h-4 text-text-secondary" />
              </button>
            )}
          </div>

          {/* 操作按钮 */}
          <ActionButton
            variant="primary"
            size="sm"
            onClick={() => setState(prev => ({ ...prev, showImporter: true }))}
            icon={<Plus className="w-4 h-4" />}
          >
            {isZh ? '导入' : 'Import'}
          </ActionButton>
        </div>

        {/* 标签过滤器 */}
        <div className="px-4 py-3 border-b border-border-secondary">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              onClick={handleClearFilters}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                state.selectedTags.length === 0
                  ? 'bg-accent text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {isZh ? '全部' : 'All'}
            </button>
            {state.allTags.slice(0, 10).map(tag => (
              <button
                key={tag}
                onClick={() => handleTagToggle(tag)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  state.selectedTags.includes(tag)
                    ? 'bg-accent text-white'
                    : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {tag}
              </button>
            ))}
            {state.allTags.length > 10 && (
              <span className="px-3 py-1.5 text-sm text-text-secondary">
                +{state.allTags.length - 10}
              </span>
            )}
          </div>
        </div>

        {/* 排序选项 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-secondary">
          <span className="text-sm text-text-secondary">
            {isZh ? '排序:' : 'Sort:'}
          </span>
          {[
            { key: 'importedAt' as const, label: isZh ? '导入时间' : 'Import Date' },
            { key: 'modifiedAt' as const, label: isZh ? '修改时间' : 'Modified Date' },
            { key: 'name' as const, label: isZh ? '名称' : 'Name' },
          ].map(option => (
            <button
              key={option.key}
              onClick={() => handleSortChange(option.key)}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                state.sortBy === option.key
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-surface-secondary'
              }`}
            >
              {option.label}
              {state.sortBy === option.key && (
                <span className="ml-1">
                  {state.sortOrder === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 角色卡列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {state.isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : state.filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-secondary">
              <FileText className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">
                {state.cards.length === 0
                  ? (isZh ? '还没有角色卡' : 'No character cards yet')
                  : (isZh ? '没有匹配的角色卡' : 'No matching character cards')}
              </p>
              <p className="text-sm">
                {state.cards.length === 0
                  ? (isZh ? '点击导入按钮开始' : 'Click import button to start')
                  : (isZh ? '尝试调整搜索条件' : 'Try adjusting your search criteria')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {state.filteredCards.map(card => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                    state.selectedCard?.id === card.id
                      ? 'border-accent bg-accent/5 shadow-lg shadow-accent/10'
                      : 'border-border-secondary hover:border-accent/50 hover:shadow-md'
                  }`}
                  onClick={() => handleCardSelect(card)}
                >
                  {/* 卡片头部 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                        {card.assets.length > 0 ? (
                          <FileImage className="w-5 h-5 text-accent" />
                        ) : (
                          <FileText className="w-5 h-5 text-accent" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-text-primary line-clamp-1">
                          {card.name}
                        </h3>
                        <p className="text-xs text-text-secondary">
                          {card.creator} • v{card.version}
                        </p>
                      </div>
                    </div>

                    {/* 操作菜单 */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleExportCard(card)
                          }}
                          className="p-1.5 rounded-lg hover:bg-surface-secondary transition-colors"
                          title={isZh ? '导出' : 'Export'}
                        >
                          <Download className="w-4 h-4 text-text-secondary" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setState(prev => ({
                              ...prev,
                              showDeleteConfirm: true,
                              cardToDelete: card,
                            }))
                          }}
                          className="p-1.5 rounded-lg hover:bg-error/10 transition-colors"
                          title={isZh ? '删除' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 卡片描述 */}
                  {card.description && (
                    <p className="text-sm text-text-secondary line-clamp-2 mb-3">
                      {card.description}
                    </p>
                  )}

                  {/* 标签 */}
                  {card.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {card.tags.slice(0, 3).map((tag, index) => (
                        <span
                          key={index}
                          className="px-2 py-0.5 text-xs rounded-full bg-surface-secondary text-text-secondary border border-border-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                      {card.tags.length > 3 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-surface-secondary text-text-secondary">
                          +{card.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 元数据 */}
                  <div className="flex items-center gap-4 text-xs text-text-secondary">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDate(card.metadata.importedAt)}</span>
                    </div>
                    {card.assets.length > 0 && (
                      <div className="flex items-center gap-1">
                        <FileImage className="w-3 h-3" />
                        <span>{card.assets.length} {isZh ? '资产' : 'assets'}</span>
                      </div>
                    )}
                    {card.characterBook && (
                      <div className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        <span>{card.characterBook.entries.length} {isZh ? '条目' : 'entries'}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <div className="flex items-center justify-between p-4 border-t border-border-secondary">
          <p className="text-sm text-text-secondary">
            {isZh
              ? `共 ${state.filteredCards.length} 张角色卡`
              : `${state.filteredCards.length} character cards total`}
          </p>
          {state.selectedCard && (
            <ActionButton
              variant="primary"
              size="sm"
              onClick={() => {
                onSelectCard?.(state.selectedCard!)
                onClose()
              }}
            >
              {isZh ? '使用此角色卡' : 'Use This Card'}
            </ActionButton>
          )}
        </div>
      </div>

      {/* 导入对话框 */}
      <CharacterCardImporter
        isOpen={state.showImporter}
        onClose={() => setState(prev => ({ ...prev, showImporter: false }))}
        onImportSuccess={handleImportSuccess}
        language={language}
      />

      {/* 导出对话框 */}
      <CharacterCardExporter
        isOpen={state.showExporter}
        onClose={() => setState(prev => ({ ...prev, showExporter: false }))}
        card={state.selectedCard}
        language={language}
      />

      {/* 删除确认对话框 */}
      <OverlayDialog
        isOpen={state.showDeleteConfirm}
        onClose={() => setState(prev => ({ ...prev, showDeleteConfirm: false, cardToDelete: null }))}
        title={isZh ? '确认删除' : 'Confirm Delete'}
        size="sm"
      >
        <div className="p-4">
          <p className="text-text-primary mb-4">
            {isZh
              ? `确定要删除角色卡 "${state.cardToDelete?.name}" 吗？此操作不可撤销。`
              : `Are you sure you want to delete character card "${state.cardToDelete?.name}"? This action cannot be undone.`}
          </p>
          <div className="flex justify-end gap-3">
            <ActionButton
              variant="ghost"
              onClick={() => setState(prev => ({ ...prev, showDeleteConfirm: false, cardToDelete: null }))}
            >
              {isZh ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={handleDeleteCard}
            >
              {isZh ? '删除' : 'Delete'}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </OverlayDialog>
  )
})
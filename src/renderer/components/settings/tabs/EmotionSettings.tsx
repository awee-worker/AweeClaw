/**
 * 表情包设置面板
 *
 * 功能：
 * 1. 表情包管理
 * 2. 导入/导出表情包
 * 3. 表情包分类和标签
 * 4. 渲染设置
 *
 * @module settings/tabs/EmotionSettings
 */

import React, { useState, useCallback, useEffect, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smile, Upload, Trash2, Search, Plus, Edit, Settings,
  RefreshCw, AlertCircle, CheckCircle, Info, Image
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { pickConfigPatch } from '@utils/configValueGuard'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '../../ui/ActionButton'
import { ToggleSwitch } from '../../ui/ToggleSwitch'
import { toast } from '../../foundation/NotificationProvider'

interface EmotionSettingsProps {
  language: Language
}

interface EmotionAsset {
  id: string
  name: string
  file_path: string
  category?: string
  tags?: string[]
  created_at: string
}

interface SettingsState {
  // 表情包列表
  emotions: EmotionAsset[]
  isLoading: boolean
  
  // 配置选项
  enableEmotionRendering: boolean
  showEmotionName: boolean
  emotionSize: 'small' | 'medium' | 'large'
  autoLoadFromCharacterCards: boolean
  
  // UI 状态
  searchQuery: string
  selectedCategory: string
  showImportDialog: boolean
  showDeleteConfirm: boolean
  emotionToDelete: EmotionAsset | null
  isResetting: boolean
}

/** 需要落盘的配置字段（与 saveConfig 的写出范围保持一致） */
type EmotionConfigField = Pick<
  SettingsState,
  'enableEmotionRendering' | 'showEmotionName' | 'emotionSize' | 'autoLoadFromCharacterCards'
>

export const EmotionSettings: React.FC<EmotionSettingsProps> = memo(function EmotionSettings({
  language,
}) {
  const [state, setState] = useState<SettingsState>({
    emotions: [],
    isLoading: false,
    enableEmotionRendering: true,
    showEmotionName: true,
    emotionSize: 'medium',
    autoLoadFromCharacterCards: true,
    searchQuery: '',
    selectedCategory: 'all',
    showImportDialog: false,
    showDeleteConfirm: false,
    emotionToDelete: null,
    isResetting: false,
  })

  const isZh = language === 'zh-CN'

  // 加载表情包列表
  const loadEmotions = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }))
    try {
      const result = await window.electronAPI.invoke('emotion:get-all-emotions')
      if (result.success) {
        setState(prev => ({
          ...prev,
          emotions: result.data,
          isLoading: false,
        }))
      } else {
        setState(prev => ({ ...prev, isLoading: false }))
      }
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }))
      console.error('Failed to load emotions:', error)
    }
  }, [])

  // 初始化加载
  useEffect(() => {
    loadEmotions()
  }, [loadEmotions])

  // 加载配置
  useEffect(() => {
    const savedConfig = localStorage.getItem('emotion-settings')
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig)
        setState(prev => ({
          ...prev,
          ...config,
        }))
      } catch (error) {
        console.error('Failed to load emotion settings:', error)
      }
    }
  }, [])

  // 保存配置
  const saveConfig = useCallback(() => {
    const configToSave = {
      enableEmotionRendering: state.enableEmotionRendering,
      showEmotionName: state.showEmotionName,
      emotionSize: state.emotionSize,
      autoLoadFromCharacterCards: state.autoLoadFromCharacterCards,
    }
    localStorage.setItem('emotion-settings', JSON.stringify(configToSave))
    toast.success(
      isZh ? '保存成功' : 'Saved successfully',
      isZh ? '表情包设置已保存' : 'Emotion settings saved'
    )
  }, [state.enableEmotionRendering, state.showEmotionName, state.emotionSize, state.autoLoadFromCharacterCards, isZh])
  /**
   * 写入需要落盘的配置字段
   *
   * 非原始值防御：onChange 若误传事件对象，写进 state 后会被序列化成 {}，
   * 落盘即写坏配置（下次进来设置失效），这里先剪枝，字段全被拦下时直接中止。
   */
  const updateConfig = useCallback((patch: Partial<EmotionConfigField>) => {
    const clean = pickConfigPatch(patch, 'EmotionSettings')
    if (Object.keys(clean).length === 0) return
    setState(prev => ({ ...prev, ...clean }))
  }, [])


  // 重置设置
  const resetSettings = useCallback(async () => {
    setState(prev => ({ ...prev, isResetting: true }))
    try {
      // 重置为默认值
      setState(prev => ({
        ...prev,
        enableEmotionRendering: true,
        showEmotionName: true,
        emotionSize: 'medium',
        autoLoadFromCharacterCards: true,
        isResetting: false,
      }))
      
      localStorage.removeItem('emotion-settings')
      
      toast.success(
        isZh ? '重置成功' : 'Reset successfully',
        isZh ? '设置已重置为默认值' : 'Settings reset to defaults'
      )
    } catch (error) {
      setState(prev => ({ ...prev, isResetting: false }))
      toast.error(
        isZh ? '重置失败' : 'Reset failed',
        isZh ? '无法重置设置' : 'Failed to reset settings'
      )
    }
  }, [isZh])

  // 删除表情包
  const handleDeleteEmotion = useCallback(async () => {
    if (!state.emotionToDelete) return

    try {
      const result = await window.electronAPI.invoke('emotion:delete-emotion', {
        name: state.emotionToDelete.name,
      })

      if (result.success) {
        setState(prev => ({
          ...prev,
          emotions: prev.emotions.filter(e => e.id !== state.emotionToDelete?.id),
          showDeleteConfirm: false,
          emotionToDelete: null,
        }))

        toast.success(
          isZh ? '删除成功' : 'Deleted successfully',
          isZh ? `表情包 "${state.emotionToDelete.name}" 已删除` : `Emotion "${state.emotionToDelete.name}" deleted`
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
  }, [state.emotionToDelete, isZh])

  // 过滤表情包
  const filteredEmotions = state.emotions.filter(emotion => {
    const matchesSearch = !state.searchQuery || 
      emotion.name.toLowerCase().includes(state.searchQuery.toLowerCase())
    const matchesCategory = state.selectedCategory === 'all' || 
      emotion.category === state.selectedCategory
    return matchesSearch && matchesCategory
  })

  // 获取所有分类
  const categories = ['all', ...new Set(state.emotions.map(e => e.category).filter(Boolean))]

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
    <div className="flex flex-col gap-6 p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {isZh ? '表情包设置' : 'Emotion Settings'}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            {isZh
              ? '管理表情包，配置渲染选项和显示偏好'
              : 'Manage emotions, configure rendering options and display preferences'}
          </p>
        </div>
        <div className="flex gap-2">
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={resetSettings}
            loading={state.isResetting}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            {isZh ? '重置' : 'Reset'}
          </ActionButton>
          <ActionButton
            variant="primary"
            size="sm"
            onClick={saveConfig}
            icon={<Settings className="w-4 h-4" />}
          >
            {isZh ? '保存' : 'Save'}
          </ActionButton>
        </div>
      </div>

      {/* 渲染设置 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent/10">
            <Smile className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '渲染设置' : 'Rendering Settings'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '配置表情包的显示方式' : 'Configure how emotions are displayed'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* 启用表情渲染 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '启用表情渲染' : 'Enable Emotion Rendering'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '在聊天消息中渲染表情标记为图片' : 'Render emotion tags as images in chat messages'}
              </p>
            </div>
            <ToggleSwitch
              checked={state.enableEmotionRendering}
              onChange={(e) => updateConfig({ enableEmotionRendering: e.target.checked })}
            />
          </div>

          {/* 显示表情名称 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '显示表情名称' : 'Show Emotion Name'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '在表情图片旁边显示表情名称' : 'Show emotion name next to emotion image'}
              </p>
            </div>
            <ToggleSwitch
              checked={state.showEmotionName}
              onChange={(e) => updateConfig({ showEmotionName: e.target.checked })}
            />
          </div>

          {/* 表情大小 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '表情大小' : 'Emotion Size'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '表情图片的显示大小' : 'Display size of emotion images'}
              </p>
            </div>
            <select
              value={state.emotionSize}
              onChange={(e) => updateConfig({ emotionSize: e.target.value as 'small' | 'medium' | 'large' })}
              className="px-3 py-1.5 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
            >
              <option value="small">{isZh ? '小' : 'Small'}</option>
              <option value="medium">{isZh ? '中' : 'Medium'}</option>
              <option value="large">{isZh ? '大' : 'Large'}</option>
            </select>
          </div>

          {/* 从角色卡自动加载 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '从角色卡自动加载' : 'Auto-load from Character Cards'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '自动加载角色卡资产中的表情包' : 'Automatically load emotions from character card assets'}
              </p>
            </div>
            <ToggleSwitch
              checked={state.autoLoadFromCharacterCards}
              onChange={(e) => updateConfig({ autoLoadFromCharacterCards: e.target.checked })}
            />
          </div>
        </div>
      </div>

      {/* 表情包管理 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-success/10">
            <Image className="w-5 h-5 text-success" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '表情包管理' : 'Emotion Management'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '管理全局表情包库' : 'Manage global emotion library'}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={loadEmotions}
              loading={state.isLoading}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              {isZh ? '刷新' : 'Refresh'}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={() => setState(prev => ({ ...prev, showImportDialog: true }))}
              icon={<Plus className="w-4 h-4" />}
            >
              {isZh ? '导入' : 'Import'}
            </ActionButton>
          </div>
        </div>

        {/* 搜索和过滤 */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              placeholder={isZh ? '搜索表情包...' : 'Search emotions...'}
              value={state.searchQuery}
              onChange={(e) => setState(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
            />
          </div>
          <select
            value={state.selectedCategory}
            onChange={(e) => setState(prev => ({ ...prev, selectedCategory: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category === 'all' ? (isZh ? '全部分类' : 'All Categories') : category}
              </option>
            ))}
          </select>
        </div>

        {/* 表情包列表 */}
        {state.isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredEmotions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-secondary">
            <Smile className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">
              {state.emotions.length === 0
                ? (isZh ? '还没有表情包' : 'No emotions yet')
                : (isZh ? '没有匹配的表情包' : 'No matching emotions')}
            </p>
            <p className="text-sm">
              {state.emotions.length === 0
                ? (isZh ? '点击导入按钮开始' : 'Click import button to start')
                : (isZh ? '尝试调整搜索条件' : 'Try adjusting your search criteria')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredEmotions.map(emotion => (
              <motion.div
                key={emotion.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="group relative p-4 rounded-xl border border-border-secondary hover:border-accent/50 hover:shadow-md transition-all"
              >
                {/* 表情预览 */}
                <div className="flex items-center justify-center h-20 mb-3 rounded-lg bg-surface-secondary">
                  <img
                    src={`file://${emotion.file_path}`}
                    alt={emotion.name}
                    className="max-h-full max-w-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>

                {/* 表情信息 */}
                <div className="text-center">
                  <p className="font-medium text-text-primary truncate">
                    {emotion.name}
                  </p>
                  {emotion.category && (
                    <p className="text-xs text-text-secondary mt-1">
                      {emotion.category}
                    </p>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setState(prev => ({
                      ...prev,
                      showDeleteConfirm: true,
                      emotionToDelete: emotion,
                    }))}
                    className="p-1.5 rounded-lg bg-surface/80 hover:bg-error/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-error" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-info/10">
            <Info className="w-5 h-5 text-info" />
          </div>
          <h3 className="font-medium text-text-primary">
            {isZh ? '使用说明' : 'Usage Instructions'}
          </h3>
        </div>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '支持的表情标记格式：[emo:表情名] 或 :表情名:'
                : 'Supported emotion tag formats: [emo:emotion_name] or :emotion_name:'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '表情包可以来自全局表情包库或角色卡资产。'
                : 'Emotions can come from the global emotion library or character card assets.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '如果找不到对应的表情包，将保留原始标记文本。'
                : 'If the corresponding emotion is not found, the original tag text will be preserved.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '支持的图片格式：PNG, JPG, JPEG, GIF, WebP, SVG'
                : 'Supported image formats: PNG, JPG, JPEG, GIF, WebP, SVG'}
            </span>
          </li>
        </ul>
      </div>

      {/* 删除确认对话框 */}
      {state.showDeleteConfirm && state.emotionToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md p-6 rounded-2xl bg-surface border border-border-secondary shadow-xl"
          >
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              {isZh ? '确认删除' : 'Confirm Delete'}
            </h3>
            <p className="text-text-secondary mb-6">
              {isZh
                ? `确定要删除表情包 "${state.emotionToDelete.name}" 吗？此操作不可撤销。`
                : `Are you sure you want to delete emotion "${state.emotionToDelete.name}"? This action cannot be undone.`}
            </p>
            <div className="flex justify-end gap-3">
              <ActionButton
                variant="ghost"
                onClick={() => setState(prev => ({ ...prev, showDeleteConfirm: false, emotionToDelete: null }))}
              >
                {isZh ? '取消' : 'Cancel'}
              </ActionButton>
              <ActionButton
                variant="danger"
                onClick={handleDeleteEmotion}
              >
                {isZh ? '删除' : 'Delete'}
              </ActionButton>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
})
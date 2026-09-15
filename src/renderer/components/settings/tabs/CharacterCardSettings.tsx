/**
 * 角色卡设置面板
 *
 * 功能：
 * 1. 角色卡管理入口
 * 2. 导入/导出设置
 * 3. 存储统计
 * 4. 字段映射配置
 *
 * @module settings/tabs/CharacterCardSettings
 */

import React, { useState, useCallback, useEffect, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Upload, Download, Database, Settings, Trash2,
  RefreshCw, AlertCircle, CheckCircle, Info
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '../../ui/ActionButton'
import { ToggleSwitch } from '../../ui/ToggleSwitch'
import { toast } from '../../foundation/NotificationProvider'
import { CharacterCardGallery } from '../../character-card/CharacterCardGallery'
import { CharacterCardImporter } from '../../character-card/CharacterCardImporter'
import type { CardStorageStats } from '@main/modules/character-card/types'

interface CharacterCardSettingsProps {
  language: Language
}

interface SettingsState {
  // 存储统计
  stats: CardStorageStats | null
  isLoadingStats: boolean
  
  // 配置选项
  autoBackup: boolean
  maxBackupCount: number
  defaultExportFormat: 'json' | 'png'
  importValidation: boolean
  
  // UI 状态
  showGallery: boolean
  showImporter: boolean
  isResetting: boolean
}

export const CharacterCardSettings: React.FC<CharacterCardSettingsProps> = memo(function CharacterCardSettings({
  language,
}) {
  const [state, setState] = useState<SettingsState>({
    stats: null,
    isLoadingStats: false,
    autoBackup: true,
    maxBackupCount: 10,
    defaultExportFormat: 'json',
    importValidation: true,
    showGallery: false,
    showImporter: false,
    isResetting: false,
  })

  const isZh = language === 'zh-CN'

  // 加载存储统计
  const loadStats = useCallback(async () => {
    setState(prev => ({ ...prev, isLoadingStats: true }))
    try {
      const result = await window.electronAPI.invoke('character-card:get-storage-stats')
      if (result.success) {
        setState(prev => ({
          ...prev,
          stats: result.data,
          isLoadingStats: false,
        }))
      } else {
        setState(prev => ({ ...prev, isLoadingStats: false }))
      }
    } catch (error) {
      setState(prev => ({ ...prev, isLoadingStats: false }))
      console.error('Failed to load character card stats:', error)
    }
  }, [])

  // 初始化加载
  useEffect(() => {
    loadStats()
  }, [loadStats])

  // 加载配置
  useEffect(() => {
    const savedConfig = localStorage.getItem('character-card-settings')
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig)
        setState(prev => ({
          ...prev,
          ...config,
        }))
      } catch (error) {
        console.error('Failed to load character card settings:', error)
      }
    }
  }, [])

  // 保存配置
  const saveConfig = useCallback(() => {
    const configToSave = {
      autoBackup: state.autoBackup,
      maxBackupCount: state.maxBackupCount,
      defaultExportFormat: state.defaultExportFormat,
      importValidation: state.importValidation,
    }
    localStorage.setItem('character-card-settings', JSON.stringify(configToSave))
    toast.success(
      isZh ? '保存成功' : 'Saved successfully',
      isZh ? '角色卡设置已保存' : 'Character card settings saved'
    )
  }, [state.autoBackup, state.maxBackupCount, state.defaultExportFormat, state.importValidation, isZh])

  // 重置设置
  const resetSettings = useCallback(async () => {
    setState(prev => ({ ...prev, isResetting: true }))
    try {
      // 重置为默认值
      setState(prev => ({
        ...prev,
        autoBackup: true,
        maxBackupCount: 10,
        defaultExportFormat: 'json',
        importValidation: true,
        isResetting: false,
      }))
      
      localStorage.removeItem('character-card-settings')
      
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

  // 格式化文件大小
  const formatSize = useCallback((bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }, [])

  // 格式化日期
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [language])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {isZh ? '角色卡设置' : 'Character Card Settings'}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            {isZh
              ? '管理酒馆角色卡导入导出，配置字段映射和存储选项'
              : 'Manage SillyTavern character card import/export, configure field mapping and storage options'}
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

      {/* 存储统计 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent/10">
            <Database className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '存储统计' : 'Storage Statistics'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '角色卡存储使用情况' : 'Character card storage usage'}
            </p>
          </div>
          <div className="ml-auto">
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={loadStats}
              loading={state.isLoadingStats}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              {isZh ? '刷新' : 'Refresh'}
            </ActionButton>
          </div>
        </div>

        {state.stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-surface-secondary border border-border-secondary">
              <p className="text-sm text-text-secondary">
                {isZh ? '角色卡数量' : 'Total Cards'}
              </p>
              <p className="text-2xl font-bold text-text-primary">
                {state.stats.totalCards}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface-secondary border border-border-secondary">
              <p className="text-sm text-text-secondary">
                {isZh ? '存储大小' : 'Storage Size'}
              </p>
              <p className="text-2xl font-bold text-text-primary">
                {formatSize(state.stats.totalSize)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface-secondary border border-border-secondary">
              <p className="text-sm text-text-secondary">
                {isZh ? '最后修改' : 'Last Modified'}
              </p>
              <p className="text-sm font-medium text-text-primary">
                {state.stats.lastModified ? formatDate(state.stats.lastModified) : '-'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-surface-secondary border border-border-secondary">
              <p className="text-sm text-text-secondary">
                {isZh ? '标签分类' : 'Tag Categories'}
              </p>
              <p className="text-2xl font-bold text-text-primary">
                {Object.keys(state.stats.categories).length}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-20 text-text-secondary">
            {state.isLoadingStats ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span>{isZh ? '加载中...' : 'Loading...'}</span>
              </div>
            ) : (
              <span>{isZh ? '暂无数据' : 'No data available'}</span>
            )}
          </div>
        )}
      </div>

      {/* 快速操作 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-success/10">
            <FileText className="w-5 h-5 text-success" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '快速操作' : 'Quick Actions'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '常用操作入口' : 'Common action entry points'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ActionButton
            variant="secondary"
            className="justify-start h-auto p-4"
            onClick={() => setState(prev => ({ ...prev, showGallery: true }))}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <FileText className="w-5 h-5 text-accent" />
              </div>
              <div className="text-left">
                <p className="font-medium text-text-primary">
                  {isZh ? '角色卡画廊' : 'Character Card Gallery'}
                </p>
                <p className="text-sm text-text-secondary">
                  {isZh ? '查看和管理所有角色卡' : 'View and manage all character cards'}
                </p>
              </div>
            </div>
          </ActionButton>

          <ActionButton
            variant="secondary"
            className="justify-start h-auto p-4"
            onClick={() => setState(prev => ({ ...prev, showImporter: true }))}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Upload className="w-5 h-5 text-success" />
              </div>
              <div className="text-left">
                <p className="font-medium text-text-primary">
                  {isZh ? '导入角色卡' : 'Import Character Card'}
                </p>
                <p className="text-sm text-text-secondary">
                  {isZh ? '从文件导入酒馆角色卡' : 'Import SillyTavern character card from file'}
                </p>
              </div>
            </div>
          </ActionButton>
        </div>
      </div>

      {/* 导入导出设置 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-warning/10">
            <Settings className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '导入导出设置' : 'Import/Export Settings'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '配置导入导出行为' : 'Configure import/export behavior'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* 自动备份 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '自动备份' : 'Auto Backup'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '导入角色卡时自动创建备份' : 'Automatically create backup when importing character cards'}
              </p>
            </div>
            <ToggleSwitch
              checked={state.autoBackup}
              onChange={(checked) => setState(prev => ({ ...prev, autoBackup: checked }))}
            />
          </div>

          {/* 最大备份数量 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '最大备份数量' : 'Max Backup Count'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '每个角色卡保留的最大备份数量' : 'Maximum backup count per character card'}
              </p>
            </div>
            <select
              value={state.maxBackupCount}
              onChange={(e) => setState(prev => ({ ...prev, maxBackupCount: parseInt(e.target.value) }))}
              className="px-3 py-1.5 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>

          {/* 默认导出格式 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '默认导出格式' : 'Default Export Format'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '导出角色卡时的默认格式' : 'Default format when exporting character cards'}
              </p>
            </div>
            <select
              value={state.defaultExportFormat}
              onChange={(e) => setState(prev => ({ ...prev, defaultExportFormat: e.target.value as 'json' | 'png' }))}
              className="px-3 py-1.5 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
            >
              <option value="json">JSON</option>
              <option value="png">PNG</option>
            </select>
          </div>

          {/* 导入验证 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border-secondary">
            <div>
              <p className="font-medium text-text-primary">
                {isZh ? '导入验证' : 'Import Validation'}
              </p>
              <p className="text-sm text-text-secondary">
                {isZh ? '导入时验证角色卡数据完整性' : 'Validate character card data integrity during import'}
              </p>
            </div>
            <ToggleSwitch
              checked={state.importValidation}
              onChange={(checked) => setState(prev => ({ ...prev, importValidation: checked }))}
            />
          </div>
        </div>
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
                ? '支持导入 SillyTavern 角色卡（V2/V3 格式），包括 JSON 和 PNG 格式。'
                : 'Supports importing SillyTavern character cards (V2/V3 format), including JSON and PNG formats.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? 'PNG 格式角色卡会自动解析 tEXt chunk 中的角色卡数据。'
                : 'PNG format character cards will automatically parse character card data from tEXt chunks.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '导入的角色卡会自动映射到 AweeClaw 角色字段，包括系统提示词、人设描述、开场白等。'
                : 'Imported character cards are automatically mapped to AweeClaw character fields, including system prompts, persona descriptions, opening messages, etc.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '角色书（Character Book）条目可以按用户确认后写入知识库。'
                : 'Character Book entries can be written to the knowledge base after user confirmation.'}
            </span>
          </li>
        </ul>
      </div>

      {/* 角色卡画廊对话框 */}
      <CharacterCardGallery
        isOpen={state.showGallery}
        onClose={() => setState(prev => ({ ...prev, showGallery: false }))}
        language={language}
      />

      {/* 导入对话框 */}
      <CharacterCardImporter
        isOpen={state.showImporter}
        onClose={() => setState(prev => ({ ...prev, showImporter: false }))}
        onImportSuccess={() => {
          loadStats() // 刷新统计
          setState(prev => ({ ...prev, showImporter: false }))
        }}
        language={language}
      />
    </div>
  )
})
/**
 * 角色卡导出组件
 *
 * 支持：
 * 1. JSON 格式导出
 * 2. PNG 格式导出（需要模板）
 * 3. 批量导出
 * 4. 导出选项配置
 *
 * @module character-card/CharacterCardExporter
 */

import React, { useState, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, FileText, FileImage, Archive, AlertCircle, CheckCircle, Settings } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { OverlayDialog } from '../ui/OverlayDialog'
import { ActionButton } from '../ui/ActionButton'
import { toast } from '../foundation/NotificationProvider'
import type { AweeClawCharacterCard, CardExportOptions } from '@main/modules/character-card/types'

interface CharacterCardExporterProps {
  isOpen: boolean
  onClose: () => void
  card: AweeClawCharacterCard | null
  language: Language
}

interface ExportState {
  selectedFormat: CardExportOptions['format']
  includeAssets: boolean
  includeCharacterBook: boolean
  isExporting: boolean
  exportResult: { success: boolean; filePath?: string; error?: string } | null
}

export const CharacterCardExporter: React.FC<CharacterCardExporterProps> = memo(function CharacterCardExporter({
  isOpen,
  onClose,
  card,
  language,
}) {
  const [state, setState] = useState<ExportState>({
    selectedFormat: 'json',
    includeAssets: true,
    includeCharacterBook: true,
    isExporting: false,
    exportResult: null,
  })

  const isZh = language === 'zh-CN'

  // 处理格式选择
  const handleFormatChange = useCallback((format: CardExportOptions['format']) => {
    setState(prev => ({ ...prev, selectedFormat: format }))
  }, [])

  // 处理选项变化
  const handleOptionChange = useCallback((key: keyof ExportState, value: boolean) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  // 处理导出
  const handleExport = useCallback(async () => {
    if (!card) return

    setState(prev => ({ ...prev, isExporting: true, exportResult: null }))

    try {
      const options: CardExportOptions = {
        format: state.selectedFormat,
        includeAssets: state.includeAssets,
        includeCharacterBook: state.includeCharacterBook,
      }

      const result = await window.electronAPI.invoke('character-card:export-card', {
        cardId: card.id,
        options,
      })

      setState(prev => ({
        ...prev,
        isExporting: false,
        exportResult: result,
      }))

      if (result.success) {
        toast.success(
          isZh ? '导出成功' : 'Export successful',
          isZh ? `角色卡已导出到: ${result.filePath}` : `Character card exported to: ${result.filePath}`
        )
      } else {
        toast.error(
          isZh ? '导出失败' : 'Export failed',
          result.error || (isZh ? '未知错误' : 'Unknown error')
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      setState(prev => ({
        ...prev,
        isExporting: false,
        exportResult: { success: false, error: errorMsg },
      }))

      toast.error(
        isZh ? '导出失败' : 'Export failed',
        errorMsg
      )
    }
  }, [card, state.selectedFormat, state.includeAssets, state.includeCharacterBook, isZh])

  // 处理导出为压缩包
  const handleExportWithAssets = useCallback(async () => {
    if (!card) return

    setState(prev => ({ ...prev, isExporting: true, exportResult: null }))

    try {
      const result = await window.electronAPI.invoke('character-card:export-card-with-assets', {
        cardId: card.id,
      })

      setState(prev => ({
        ...prev,
        isExporting: false,
        exportResult: result,
      }))

      if (result.success) {
        toast.success(
          isZh ? '导出成功' : 'Export successful',
          isZh ? `角色卡及资产已导出到: ${result.zipPath}` : `Character card and assets exported to: ${result.zipPath}`
        )
      } else {
        toast.error(
          isZh ? '导出失败' : 'Export failed',
          result.error || (isZh ? '未知错误' : 'Unknown error')
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      setState(prev => ({
        ...prev,
        isExporting: false,
        exportResult: { success: false, error: errorMsg },
      }))

      toast.error(
        isZh ? '导出失败' : 'Export failed',
        errorMsg
      )
    }
  }, [card, isZh])

  // 重置状态
  const handleReset = useCallback(() => {
    setState({
      selectedFormat: 'json',
      includeAssets: true,
      includeCharacterBook: true,
      isExporting: false,
      exportResult: null,
    })
  }, [])

  if (!card) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isZh ? '导出角色卡' : 'Export Character Card'}
      size="md"
    >
      <div className="flex flex-col gap-6 p-4">
        {/* 角色卡信息 */}
        <div className="p-4 rounded-xl bg-surface border border-border-secondary">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <FileText className="w-6 h-6 text-accent" />
            </div>
            <div>
              <p className="font-medium text-text-primary">{card.name}</p>
              <p className="text-sm text-text-secondary">
                {card.creator} • v{card.version} • {card.tags.length} {isZh ? '个标签' : 'tags'}
              </p>
            </div>
          </div>
        </div>

        {/* 格式选择 */}
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            {isZh ? '导出格式' : 'Export Format'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleFormatChange('json')}
              className={`p-4 rounded-xl border transition-all duration-200 ${
                state.selectedFormat === 'json'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-secondary hover:border-accent/50 hover:bg-surface-hover'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <FileText className="w-8 h-8" />
                <div className="text-center">
                  <p className="font-medium">JSON</p>
                  <p className="text-xs text-text-secondary">
                    {isZh ? '通用格式，兼容性最好' : 'Universal format, best compatibility'}
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleFormatChange('png')}
              className={`p-4 rounded-xl border transition-all duration-200 ${
                state.selectedFormat === 'png'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-secondary hover:border-accent/50 hover:bg-surface-hover'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <FileImage className="w-8 h-8" />
                <div className="text-center">
                  <p className="font-medium">PNG</p>
                  <p className="text-xs text-text-secondary">
                    {isZh ? '图片格式，可直接分享' : 'Image format, shareable directly'}
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* 导出选项 */}
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            {isZh ? '导出选项' : 'Export Options'}
          </h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 p-3 rounded-xl border border-border-secondary hover:border-accent/50 hover:bg-surface-hover transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={state.includeAssets}
                onChange={(e) => handleOptionChange('includeAssets', e.target.checked)}
                className="w-4 h-4 rounded border-border-secondary text-accent focus:ring-accent"
              />
              <div>
                <p className="font-medium text-text-primary">
                  {isZh ? '包含资产' : 'Include Assets'}
                </p>
                <p className="text-xs text-text-secondary">
                  {isZh ? '表情包、图标等本地文件' : 'Emoticons, icons, and other local files'}
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border border-border-secondary hover:border-accent/50 hover:bg-surface-hover transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={state.includeCharacterBook}
                onChange={(e) => handleOptionChange('includeCharacterBook', e.target.checked)}
                className="w-4 h-4 rounded border-border-secondary text-accent focus:ring-accent"
              />
              <div>
                <p className="font-medium text-text-primary">
                  {isZh ? '包含角色书' : 'Include Character Book'}
                </p>
                <p className="text-xs text-text-secondary">
                  {isZh ? '知识库条目，可能较大' : 'Knowledge base entries, may be large'}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* 导出结果 */}
        {state.exportResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-xl border ${
              state.exportResult.success
                ? 'bg-success/10 border-success/20'
                : 'bg-error/10 border-error/20'
            }`}
          >
            <div className="flex items-start gap-3">
              {state.exportResult.success ? (
                <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-error mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${state.exportResult.success ? 'text-success' : 'text-error'}`}>
                  {state.exportResult.success
                    ? (isZh ? '导出成功' : 'Export successful')
                    : (isZh ? '导出失败' : 'Export failed')}
                </p>
                {state.exportResult.filePath && (
                  <p className="mt-1 text-sm text-text-secondary break-all">
                    {state.exportResult.filePath}
                  </p>
                )}
                {state.exportResult.error && (
                  <p className="mt-1 text-sm text-error/80">
                    {state.exportResult.error}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-between pt-4 border-t border-border-secondary">
          <div className="flex gap-2">
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={handleExportWithAssets}
              disabled={state.isExporting}
              icon={<Archive className="w-4 h-4" />}
            >
              {isZh ? '导出为压缩包' : 'Export as Archive'}
            </ActionButton>
          </div>

          <div className="flex gap-3">
            <ActionButton
              variant="ghost"
              onClick={onClose}
            >
              {isZh ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleExport}
              disabled={state.isExporting}
              loading={state.isExporting}
              icon={<Download className="w-4 h-4" />}
            >
              {isZh ? '导出' : 'Export'}
            </ActionButton>
          </div>
        </div>
      </div>
    </OverlayDialog>
  )
})
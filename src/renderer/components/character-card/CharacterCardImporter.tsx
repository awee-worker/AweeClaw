/**
 * 角色卡导入组件
 *
 * 支持：
 * 1. 拖拽导入（PNG/JSON 文件）
 * 2. 点击选择文件导入
 * 3. 导入前预览和字段确认
 * 4. 导入结果反馈
 *
 * @module character-card/CharacterCardImporter
 */

import React, { useState, useCallback, useRef, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileImage, FileText, AlertCircle, CheckCircle, X } from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { OverlayDialog } from '../ui/OverlayDialog'
import { ActionButton } from '../ui/ActionButton'
import { toast } from '../foundation/NotificationProvider'
import type { AweeClawCharacterCard, CardImportResult } from '@main/modules/character-card/types'

interface CharacterCardImporterProps {
  isOpen: boolean
  onClose: () => void
  onImportSuccess?: (card: AweeClawCharacterCard) => void
  language: Language
}

interface ImportState {
  isDragging: boolean
  isImporting: boolean
  importResult: CardImportResult | null
  previewCard: AweeClawCharacterCard | null
}

export const CharacterCardImporter: React.FC<CharacterCardImporterProps> = memo(function CharacterCardImporter({
  isOpen,
  onClose,
  onImportSuccess,
  language,
}) {
  const [state, setState] = useState<ImportState>({
    isDragging: false,
    isImporting: false,
    importResult: null,
    previewCard: null,
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  const isZh = language === 'zh'

  // 处理文件选择
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const file = files[0]
    const ext = file.name.toLowerCase().split('.').pop()

    // 验证文件类型
    if (ext !== 'json' && ext !== 'png') {
      toast.error(
        isZh ? '不支持的文件格式' : 'Unsupported file format',
        isZh ? '请选择 .json 或 .png 文件' : 'Please select a .json or .png file'
      )
      return
    }

    setState(prev => ({ ...prev, isImporting: true, importResult: null, previewCard: null }))

    try {
      // 获取文件路径（Electron 环境）
      const filePath = (file as any).path || file.name

      // 调用主进程导入
      const result = await api.characterCard.importCard({
        filePath,
      })

      if (result.success && result.data?.card) {
        setState(prev => ({
          ...prev,
          isImporting: false,
          importResult: result,
          previewCard: result.data.card,
        }))

        toast.success(
          isZh ? '导入成功' : 'Import successful',
          isZh ? `角色卡 "${result.data.card.name}" 已导入` : `Character card "${result.data.card.name}" imported`
        )
      } else {
        setState(prev => ({
          ...prev,
          isImporting: false,
          importResult: result,
        }))

        toast.error(
          isZh ? '导入失败' : 'Import failed',
          result.error || (isZh ? '未知错误' : 'Unknown error')
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      setState(prev => ({
        ...prev,
        isImporting: false,
        importResult: { success: false, warnings: [], errors: [errorMsg] },
      }))

      toast.error(
        isZh ? '导入失败' : 'Import failed',
        errorMsg
      )
    }
  }, [isZh])

  // 处理拖拽事件
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState(prev => ({ ...prev, isDragging: true }))
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState(prev => ({ ...prev, isDragging: false }))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState(prev => ({ ...prev, isDragging: false }))

    const files = e.dataTransfer.files
    handleFileSelect(files)
  }, [handleFileSelect])

  // 处理点击上传
  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files)
  }, [handleFileSelect])

  // 确认导入
  const handleConfirmImport = useCallback(() => {
    if (state.previewCard) {
      onImportSuccess?.(state.previewCard)
      onClose()
    }
  }, [state.previewCard, onImportSuccess, onClose])

  // 重置状态
  const handleReset = useCallback(() => {
    setState({
      isDragging: false,
      isImporting: false,
      importResult: null,
      previewCard: null,
    })
  }, [])

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isZh ? '导入角色卡' : 'Import Character Card'}
      size="lg"
    >
      <div className="flex flex-col gap-6 p-4">
        {/* 拖拽区域 */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 ${
            state.isDragging
              ? 'border-accent bg-accent/10 scale-[1.02]'
              : 'border-border-secondary hover:border-accent/50 hover:bg-surface-hover'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClickUpload}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.png"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <AnimatePresence>
            {state.isDragging ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="p-4 rounded-full bg-accent/20 border border-accent/30">
                  <Upload className="w-8 h-8 text-accent animate-bounce" />
                </div>
                <p className="text-lg font-medium text-accent">
                  {isZh ? '释放文件以导入' : 'Release to import'}
                </p>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="p-4 rounded-full bg-surface-secondary border border-border-secondary">
                  <Upload className="w-8 h-8 text-text-secondary" />
                </div>
                <div>
                  <p className="text-lg font-medium text-text-primary mb-2">
                    {isZh ? '拖拽角色卡文件到此处' : 'Drag character card files here'}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {isZh ? '支持 SillyTavern 角色卡（.json / .png）' : 'Supports SillyTavern character cards (.json / .png)'}
                  </p>
                </div>
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={handleClickUpload}
                  disabled={state.isImporting}
                >
                  {isZh ? '或点击选择文件' : 'Or click to select files'}
                </ActionButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 导入状态 */}
        {state.isImporting && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 p-4 rounded-xl bg-accent/10 border border-accent/20"
          >
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-accent font-medium">
              {isZh ? '正在导入...' : 'Importing...'}
            </p>
          </motion.div>
        )}

        {/* 导入结果 */}
        {state.importResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-xl border ${
              state.importResult.success
                ? 'bg-success/10 border-success/20'
                : 'bg-error/10 border-error/20'
            }`}
          >
            <div className="flex items-start gap-3">
              {state.importResult.success ? (
                <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-error mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${state.importResult.success ? 'text-success' : 'text-error'}`}>
                  {state.importResult.success
                    ? (isZh ? '导入成功' : 'Import successful')
                    : (isZh ? '导入失败' : 'Import failed')}
                </p>
                {state.importResult.errors && state.importResult.errors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {state.importResult.errors.map((error, index) => (
                      <li key={index} className="text-sm text-error/80">
                        • {error}
                      </li>
                    ))}
                  </ul>
                )}
                {state.importResult.warnings && state.importResult.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {state.importResult.warnings.map((warning, index) => (
                      <li key={index} className="text-sm text-warning/80">
                        ⚠ {warning}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* 预览卡片 */}
        {state.previewCard && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl bg-surface border border-border-secondary"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {isZh ? '导入预览' : 'Import Preview'}
              </h3>
              <button
                onClick={handleReset}
                className="p-1 rounded-lg hover:bg-surface-secondary transition-colors"
              >
                <X className="w-4 h-4 text-text-secondary" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  {state.previewCard.assets.length > 0 ? (
                    <FileImage className="w-6 h-6 text-accent" />
                  ) : (
                    <FileText className="w-6 h-6 text-accent" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-text-primary">{state.previewCard.name}</p>
                  <p className="text-sm text-text-secondary">
                    {state.previewCard.creator} • v{state.previewCard.version}
                  </p>
                </div>
              </div>

              {state.previewCard.description && (
                <p className="text-sm text-text-secondary line-clamp-3">
                  {state.previewCard.description}
                </p>
              )}

              {state.previewCard.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {state.previewCard.tags.slice(0, 5).map((tag, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 text-xs rounded-full bg-surface-secondary text-text-secondary border border-border-secondary"
                    >
                      {tag}
                    </span>
                  ))}
                  {state.previewCard.tags.length > 5 && (
                    <span className="px-2 py-1 text-xs rounded-full bg-surface-secondary text-text-secondary">
                      +{state.previewCard.tags.length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border-secondary">
          <ActionButton
            variant="ghost"
            onClick={onClose}
          >
            {isZh ? '取消' : 'Cancel'}
          </ActionButton>
          {state.previewCard && (
            <ActionButton
              variant="primary"
              onClick={handleConfirmImport}
              disabled={state.isImporting}
            >
              {isZh ? '确认导入' : 'Confirm Import'}
            </ActionButton>
          )}
        </div>
      </div>
    </OverlayDialog>
  )
})
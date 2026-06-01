/**
 * 文件保存相关 Hook
 * 统一处理保存、自动保存、关闭确认等逻辑
 */
import { useCallback, useRef, useEffect } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../adapters/electronBridge'
import { getFileName } from '@shared/toolkit/pathHelper'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { toast } from '@components/foundation/NotificationProvider'
import {t, type Language} from '@renderer/i18n'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { monaco } from '@renderer/monacoWorkerEntry'

/** 获取文件对应的 Monaco model 版本号 */
function getModelVersionId(filePath: string): number | undefined {
  const uri = monaco.Uri.file(filePath)
  const model = monaco.editor.getModel(uri)
  return model?.getAlternativeVersionId()
}

export function useFileSave() {
  const { openFiles, markFileSaved, closeFile, language } = useStore(useShallow(s => ({ openFiles: s.openFiles, markFileSaved: s.markFileSaved, closeFile: s.closeFile, language: s.language })))

  // 保存单个文件
  const saveFile = useCallback(async (filePath: string): Promise<boolean> => {
    const file = openFiles.find(f => f.path === filePath)
    if (!file) return false

    try {
      const success = await api.file.write(file.path, file.content)
      if (success) {
        // 获取当前版本号并保存
        const versionId = getModelVersionId(file.path)
        markFileSaved(file.path, versionId)
        // 如果文件之前被删除，现在已恢复
        if (file.isDeleted) {
          const { markFileRestored } = useStore.getState()
          markFileRestored(file.path)
        }
        toast.success(
          t('app.filesaved', language as Language),
          getFileName(file.path)
        )
      } else {
        toast.error(
          t('app.savefailed', language as Language),
          t('app.couldnotwritetofile', language as Language)
        )
      }
      return success
    } catch (error) {
      toast.error(
        t('app.savefailed2', language as Language),
        String(error)
      )
      return false
    }
  }, [openFiles, markFileSaved, language])

  // 关闭文件（带保存提示）
  const closeFileWithConfirm = useCallback(async (filePath: string) => {
    const file = openFiles.find(f => f.path === filePath)
    if (file?.isDirty) {
      const fileName = getFileName(filePath)
      const result = await globalConfirm({
        title: t('app.unsavedchanges', language as Language),
        message: t('confirmUnsavedChanges', language, { name: fileName }),
        confirmText: t('app.save', language as Language),
        cancelText: t('app.dontsave', language as Language),
        variant: 'warning',
      })
      if (result) {
        await saveFile(filePath)
      }
    }
    closeFile(filePath)
  }, [openFiles, closeFile, saveFile, language])

  // 关闭其他文件
  const closeOtherFiles = useCallback(async (keepPath: string) => {
    for (const file of openFiles) {
      if (file.path !== keepPath) {
        await closeFileWithConfirm(file.path)
      }
    }
  }, [openFiles, closeFileWithConfirm])

  // 关闭所有文件
  const closeAllFiles = useCallback(async () => {
    for (const file of [...openFiles]) {
      await closeFileWithConfirm(file.path)
    }
  }, [openFiles, closeFileWithConfirm])

  // 关闭右侧文件
  const closeFilesToRight = useCallback(async (filePath: string) => {
    const index = openFiles.findIndex(f => f.path === filePath)
    if (index >= 0) {
      for (let i = openFiles.length - 1; i > index; i--) {
        await closeFileWithConfirm(openFiles[i].path)
      }
    }
  }, [openFiles, closeFileWithConfirm])

  // 触发自动保存
  // 触发自动保存 (使用 debounce 重构)
  const debouncedAutoSave = useRef<{ func: (filePath: string) => void, cancel: () => void } | null>(null)

  const triggerAutoSave = useCallback((filePath: string) => {
    const config = getEditorConfig()
    if (config.autoSave === 'off') return

    if (config.autoSave === 'afterDelay') {
      if (!debouncedAutoSave.current) {
        const doSave = async (fPath: string) => {
          const { openFiles: currentFiles, markFileSaved: currentMarkSaved } = useStore.getState()
          const file = currentFiles.find(f => f.path === fPath)
          if (file?.isDirty) {
            const success = await api.file.write(file.path, file.content)
            if (success) {
              const versionId = getModelVersionId(file.path)
              currentMarkSaved(file.path, versionId)
            }
          }
        }

        // 创建带有取消方法的 debounce
        let timer: NodeJS.Timeout | null = null
        debouncedAutoSave.current = {
          func: (fPath: string) => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => doSave(fPath), config.autoSaveDelay)
          },
          cancel: () => {
            if (timer) clearTimeout(timer)
          }
        }
      }

      debouncedAutoSave.current.func(filePath)
    }
  }, [])

  // 失去焦点时自动保存
  useEffect(() => {
    const config = getEditorConfig()
    if (config.autoSave !== 'onFocusChange') return

    const handleBlur = async () => {
      for (const file of openFiles) {
        if (file.isDirty) {
          const success = await api.file.write(file.path, file.content)
          if (success) {
            const versionId = getModelVersionId(file.path)
            markFileSaved(file.path, versionId)
          }
        }
      }
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [openFiles, markFileSaved])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debouncedAutoSave.current) {
        debouncedAutoSave.current.cancel()
      }
    }
  }, [])

  return {
    saveFile,
    closeFileWithConfirm,
    closeOtherFiles,
    closeAllFiles,
    closeFilesToRight,
    triggerAutoSave,
  }
}

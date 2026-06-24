/**
 * 文件保存与关闭确认 Hook
 *
 * 提供手动保存、自动保存（延迟/失焦）以及多种关闭确认流程。
 */

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../adapters/electronBridge'
import { getFileName } from '@shared/toolkit/pathHelper'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { monaco } from '@renderer/monacoWorkerEntry'

/** 自动保存延迟模式下的默认等待时长 */
const DEFAULT_AUTOSAVE_DELAY = 1000

/* ------------------------------------------------------------------ */
/* Monaco model 版本号                                               */
/* ------------------------------------------------------------------ */

/** 读取文件对应 Monaco model 的版本号 */
function getModelVersionId(filePath: string): number | undefined {
  const uri = monaco.Uri.file(filePath)
  const model = monaco.editor.getModel(uri)
  return model?.getAlternativeVersionId()
}

/* ------------------------------------------------------------------ */
/* 自动保存调度器                                                    */
/* ------------------------------------------------------------------ */

/** 延迟自动保存调度器：同一文件重复触发会重置计时 */
class AutoSaveScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly delay: number

  constructor(delay: number) {
    this.delay = delay
  }

  /** 安排文件保存，若已有待执行任务则重置 */
  schedule(filePath: string, task: () => Promise<void>): void {
    this.cancel(filePath)
    const timer = setTimeout(() => {
      this.timers.delete(filePath)
      void task()
    }, this.delay)
    this.timers.set(filePath, timer)
  }

  /** 取消指定文件的待执行任务 */
  cancel(filePath: string): void {
    const timer = this.timers.get(filePath)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(filePath)
    }
  }

  /** 取消所有待执行任务 */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                              */
/* ------------------------------------------------------------------ */

export function useFileSave() {
  const { openFiles, markFileSaved, closeFile, language } = useStore(
    useShallow((s) => ({
      openFiles: s.openFiles,
      markFileSaved: s.markFileSaved,
      closeFile: s.closeFile,
      language: s.language,
    })),
  )

  const schedulerRef = useRef<AutoSaveScheduler | null>(null)

  /* ---------------- 手动保存 ---------------- */
  const saveFile = useCallback(
    async (filePath: string): Promise<boolean> => {
      const file = openFiles.find((f) => f.path === filePath)
      if (!file) return false

      try {
        const success = await api.file.write(file.path, file.content)
        if (success) {
          const versionId = getModelVersionId(file.path)
          markFileSaved(file.path, versionId)

          if (file.isDeleted) {
            useStore.getState().markFileRestored(file.path)
          }

          toast.success(t('app.filesaved', language as Language), getFileName(file.path))
        } else {
          toast.error(
            t('app.savefailed', language as Language),
            t('app.couldnotwritetofile', language as Language),
          )
        }
        return success
      } catch (error) {
        toast.error(t('app.savefailed2', language as Language), String(error))
        return false
      }
    },
    [openFiles, markFileSaved, language],
  )

  /* ---------------- 关闭确认 ---------------- */
  const closeFileWithConfirm = useCallback(
    async (filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath)
      if (file?.isDirty) {
        const fileName = getFileName(filePath)
        const result = await globalConfirm({
          title: t('app.unsavedchanges', language as Language),
          message: t('confirmUnsavedChanges', language, { name: fileName }),
          confirmText: t('app.save', language as Language),
          cancelText: t('app.dontsave', language as Language),
          variant: 'warning',
        })
        if (result) await saveFile(filePath)
      }
      closeFile(filePath)
    },
    [openFiles, closeFile, saveFile, language],
  )

  /* ---------------- 批量关闭 ---------------- */
  const closeOtherFiles = useCallback(
    async (keepPath: string) => {
      for (const file of openFiles) {
        if (file.path !== keepPath) await closeFileWithConfirm(file.path)
      }
    },
    [openFiles, closeFileWithConfirm],
  )

  const closeAllFiles = useCallback(async () => {
    for (const file of [...openFiles]) await closeFileWithConfirm(file.path)
  }, [openFiles, closeFileWithConfirm])

  const closeFilesToRight = useCallback(
    async (filePath: string) => {
      const index = openFiles.findIndex((f) => f.path === filePath)
      if (index < 0) return
      for (let i = openFiles.length - 1; i > index; i--) {
        await closeFileWithConfirm(openFiles[i].path)
      }
    },
    [openFiles, closeFileWithConfirm],
  )

  /* ---------------- 延迟自动保存 ---------------- */
  const triggerAutoSave = useCallback((filePath: string) => {
    const config = getEditorConfig()
    if (config.autoSave !== 'afterDelay') return

    if (!schedulerRef.current) {
      schedulerRef.current = new AutoSaveScheduler(config.autoSaveDelay || DEFAULT_AUTOSAVE_DELAY)
    }

    schedulerRef.current.schedule(filePath, async () => {
      const { openFiles: currentFiles, markFileSaved: currentMarkSaved } = useStore.getState()
      const file = currentFiles.find((f) => f.path === filePath)
      if (!file?.isDirty) return

      const success = await api.file.write(file.path, file.content)
      if (success) {
        currentMarkSaved(file.path, getModelVersionId(file.path))
      }
    })
  }, [])

  /* ---------------- 失焦自动保存 ---------------- */
  useEffect(() => {
    const config = getEditorConfig()
    if (config.autoSave !== 'onFocusChange') return

    const handleBlur = async () => {
      for (const file of openFiles) {
        if (!file.isDirty) continue
        const success = await api.file.write(file.path, file.content)
        if (success) markFileSaved(file.path, getModelVersionId(file.path))
      }
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [openFiles, markFileSaved])

  /* ---------------- 清理 ---------------- */
  useEffect(() => {
    return () => schedulerRef.current?.cancelAll()
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

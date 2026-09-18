/**
 * 文件保存与关闭确认 Hook
 *
 * 提供手动保存、自动保存（延迟/失焦）以及多种关闭确认流程。
 */

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '@store'
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
/* 磁盘写入                                                          */
/* ------------------------------------------------------------------ */

/** 单文件写盘结果 */
type WriteOutcome =
  | { status: 'missing' }
  | { status: 'failed'; error?: unknown }
  | { status: 'ok'; versionId?: number; wasDeleted: boolean }

/**
 * 把打开中的文件写入磁盘（不更新状态、不提示）
 *
 * 批量保存/关闭时先并行写盘，再统一提交一次状态更新与一次结果提示，
 * 避免逐文件保存造成的多次渲染与刷屏提示。
 */
async function writeFileToDisk(filePath: string): Promise<WriteOutcome> {
  const file = useStore.getState().openFiles.find((f) => f.path === filePath)
  if (!file) return { status: 'missing' }

  try {
    const success = await api.file.write(file.path, file.content)
    if (!success) return { status: 'failed' }
    return {
      status: 'ok',
      versionId: getModelVersionId(file.path),
      wasDeleted: Boolean(file.isDeleted),
    }
  } catch (error) {
    return { status: 'failed', error }
  }
}

/** 提交写盘结果（批量一次性标记，避免 N 次状态更新） */
function commitSavedFiles(saved: Array<{ path: string; versionId?: number; wasDeleted: boolean }>): void {
  if (saved.length === 0) return
  const state = useStore.getState()
  state.markFilesSaved(saved.map((item) => ({ path: item.path, versionId: item.versionId })))
  for (const item of saved) {
    if (item.wasDeleted) state.markFileRestored(item.path)
  }
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
  const language = useStore((s) => s.language)

  const schedulerRef = useRef<AutoSaveScheduler | null>(null)

  /* ---------------- 写盘 ---------------- */

  /** 批量写盘并提交状态（无提示），返回保存失败的路径 */
  const persistFiles = useCallback(async (paths: string[]): Promise<string[]> => {
    if (paths.length === 0) return []

    const results = await Promise.all(
      paths.map(async (path) => ({ path, outcome: await writeFileToDisk(path) })),
    )

    const saved: Array<{ path: string; versionId?: number; wasDeleted: boolean }> = []
    for (const item of results) {
      if (item.outcome.status === 'ok') {
        saved.push({
          path: item.path,
          versionId: item.outcome.versionId,
          wasDeleted: item.outcome.wasDeleted,
        })
      }
    }
    commitSavedFiles(saved)

    return results.filter((item) => item.outcome.status !== 'ok').map((item) => item.path)
  }, [])

  /* ---------------- 手动保存 ---------------- */
  const saveFile = useCallback(
    async (filePath: string): Promise<boolean> => {
      const outcome = await writeFileToDisk(filePath)
      if (outcome.status === 'missing') return false

      if (outcome.status === 'failed') {
        if (outcome.error !== undefined) {
          toast.error(t('app.savefailed2', language as Language), String(outcome.error))
        } else {
          toast.error(
            t('app.savefailed', language as Language),
            t('app.couldnotwritetofile', language as Language),
          )
        }
        return false
      }

      commitSavedFiles([
        { path: filePath, versionId: outcome.versionId, wasDeleted: outcome.wasDeleted },
      ])
      toast.success(t('app.filesaved', language as Language), getFileName(filePath))
      return true
    },
    [language],
  )

  /** 批量保存：并行写盘，只提示一次结果 */
  const saveFiles = useCallback(
    async (paths: string[]): Promise<string[]> => {
      const failed = await persistFiles(paths)
      const savedCount = paths.length - failed.length

      if (savedCount > 0) {
        toast.success(
          t('app.savedfiles', language as Language, { count: String(savedCount) }),
        )
      }
      if (failed.length > 0) {
        toast.error(
          t('app.savefailed', language as Language),
          failed.map((p) => getFileName(p)).join('、'),
        )
      }
      return failed
    },
    [language, persistFiles],
  )

  /* ---------------- 关闭确认 ---------------- */
  const closeFileWithConfirm = useCallback(
    async (filePath: string) => {
      const file = useStore.getState().openFiles.find((f) => f.path === filePath)
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
      useStore.getState().closeFile(filePath)
    },
    [saveFile, language],
  )

  /* ---------------- 批量关闭 ---------------- */
  /**
   * 批量关闭一组文件
   *
   * 未保存的文件只弹一次聚合确认，确认后所有 Tab 一次性关闭：
   * 逐个关闭会产生 N 次状态更新、N 次确认框与 N 次活跃文件切换，
   * 打开几十个 Tab 时就表现为「点关闭全部要等好几秒」。
   */
  const closeFilesWithConfirm = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return

      const state = useStore.getState()
      const targetSet = new Set(paths)
      const targets = state.openFiles.filter((f) => targetSet.has(f.path))
      if (targets.length === 0) return

      const dirtyFiles = targets.filter((f) => f.isDirty)

      // 没有未保存的更改：直接批量关闭
      if (dirtyFiles.length === 0) {
        state.closeFiles(targets.map((f) => f.path))
        return
      }

      // 只关一个未保存文件：沿用原有的单文件确认流程
      if (targets.length === 1) {
        await closeFileWithConfirm(targets[0].path)
        return
      }

      const action = await globalConfirm({
        title: t('app.unsavedchanges', language as Language),
        message: t('app.closefiles.unsaved', language, {
          count: String(targets.length),
          dirty: String(dirtyFiles.length),
        }),
        confirmText: t('app.closefiles.discard', language as Language),
        saveText: t('app.closefiles.saveall', language as Language),
        variant: 'warning',
      })

      // 取消：整体中止，不关闭任何 Tab
      if (action === false) return

      // 全部保存并关闭：写盘失败的文件保留下来，避免内容丢失
      if (action === 'save') {
        const failed = await saveFiles(dirtyFiles.map((f) => f.path))
        const failedSet = new Set(failed)
        const closable = targets.filter((f) => !failedSet.has(f.path)).map((f) => f.path)
        if (closable.length > 0) useStore.getState().closeFiles(closable)
        return
      }

      // 不保存：直接关闭
      useStore.getState().closeFiles(targets.map((f) => f.path))
    },
    [closeFileWithConfirm, saveFiles, language],
  )

  const closeOtherFiles = useCallback(
    async (keepPath: string) => {
      const paths = useStore
        .getState()
        .openFiles.filter((f) => f.path !== keepPath)
        .map((f) => f.path)
      await closeFilesWithConfirm(paths)
    },
    [closeFilesWithConfirm],
  )

  const closeAllFiles = useCallback(async () => {
    await closeFilesWithConfirm(useStore.getState().openFiles.map((f) => f.path))
  }, [closeFilesWithConfirm])

  const closeFilesToRight = useCallback(
    async (filePath: string) => {
      const files = useStore.getState().openFiles
      const index = files.findIndex((f) => f.path === filePath)
      if (index < 0) return
      await closeFilesWithConfirm(files.slice(index + 1).map((f) => f.path))
    },
    [closeFilesWithConfirm],
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

    const handleBlur = () => {
      const dirty = useStore
        .getState()
        .openFiles.filter((f) => f.isDirty)
        .map((f) => f.path)
      if (dirty.length === 0) return
      void persistFiles(dirty)
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [persistFiles])

  /* ---------------- 清理 ---------------- */
  useEffect(() => {
    return () => schedulerRef.current?.cancelAll()
  }, [])

  return {
    saveFile,
    saveFiles,
    closeFileWithConfirm,
    closeFilesWithConfirm,
    closeOtherFiles,
    closeAllFiles,
    closeFilesToRight,
    triggerAutoSave,
  }
}

/**
 * 文件变更监听 Hook
 *
 * 监听主进程的文件变更事件，同步更新已打开文件的状态：
 * 删除标记、外部修改重载、内部写入追踪。
 */

import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '../adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { getFileName, pathEquals } from '@shared/toolkit/pathHelper'
import { removeFileFromTypeService } from '@services/monacoTypeAdapter'
import { internalWriteTracker } from '@services/writeTracker'
import { scheduleSavedVersionSync } from '@services/fileVersionSync'

/** 文件变更事件 */
interface FileChangeEvent {
  event: string
  path: string
}

/** 已打开文件的最小结构（用于文件监听） */
interface OpenFileSnapshot {
  path: string
  content?: string
  isDirty?: boolean
  isDeleted?: boolean
}

/** 从已打开文件中查找匹配路径的文件 */
function findOpenFile(openFiles: OpenFileSnapshot[], target: string) {
  return openFiles.find((file) => pathEquals(file.path, target))
}

/** 重载文件内容并同步版本 */
function reloadAndSync(
  reload: (path: string, content: string) => void,
  path: string,
  content: string,
): void {
  reload(path, content)
  scheduleSavedVersionSync(path, content)
}

export function useFileWatcher(): void {
  useEffect(() => {
    const unsubscribe = api.file.onChanged(async (event: FileChangeEvent) => {
      const { openFiles, reloadFileFromDisk, markFileDeleted, markFileRestored, language } =
        useStore.getState()

      // 删除事件：移除类型服务缓存并标记
      if (event.event === 'delete') {
        removeFileFromTypeService(event.path)
        const openFile = findOpenFile(openFiles, event.path)
        if (openFile) markFileDeleted(openFile.path)
        return
      }

      // 创建事件：恢复已标记为删除的文件
      if (event.event === 'create') {
        const openFile = findOpenFile(openFiles, event.path)
        if (openFile?.isDeleted) {
          const newContent = await api.file.read(event.path)
          if (newContent !== null) {
            reloadAndSync(reloadFileFromDisk, openFile.path, newContent)
          } else {
            markFileRestored(openFile.path)
          }
        }
        return
      }

      // 仅处理 update 事件
      if (event.event !== 'update') return

      const openFile = findOpenFile(openFiles, event.path)
      if (!openFile) return

      const newContent = await api.file.read(event.path)
      if (newContent === null || newContent === openFile.content) return

      // 内部写入：静默重载
      if (internalWriteTracker.consume(event.path)) {
        reloadAndSync(reloadFileFromDisk, openFile.path, newContent)
        return
      }

      // 外部修改且文件有未保存改动：询问用户
      if (openFile.isDirty) {
        const fileName = getFileName(event.path)
        const confirmed = await globalConfirm({
          title: fileName,
          message: t('file.externalModifiedReload', language as Language, { name: fileName }),
          confirmText: t('app.reload', language as Language),
          cancelText: t('cancel', language as Language),
          variant: 'warning',
        })

        if (confirmed) {
          reloadAndSync(reloadFileFromDisk, openFile.path, newContent)
        }
        return
      }

      // 外部修改且文件无未保存改动：直接重载
      reloadAndSync(reloadFileFromDisk, openFile.path, newContent)
    })

    return unsubscribe
  }, [])
}

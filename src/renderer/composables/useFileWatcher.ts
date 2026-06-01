import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '../adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { getFileName, pathEquals } from '@shared/toolkit/pathHelper'
import { removeFileFromTypeService } from '@services/monacoTypeAdapter'
import { internalWriteTracker } from '@services/writeTracker'
import { scheduleSavedVersionSync } from '@services/fileVersionSync'

export function useFileWatcher() {
  useEffect(() => {
    const unsubscribe = api.file.onChanged(async (event: { event: string; path: string }) => {
      const { openFiles, reloadFileFromDisk, markFileDeleted, markFileRestored, language } = useStore.getState()

      if (event.event === 'delete') {
        removeFileFromTypeService(event.path)

        const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
        if (openFile) {
          markFileDeleted(openFile.path)
        }
        return
      }

      if (event.event === 'create') {
        const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
        if (openFile?.isDeleted) {
          const newContent = await api.file.read(event.path)
          if (newContent !== null) {
            reloadFileFromDisk(openFile.path, newContent)
            scheduleSavedVersionSync(openFile.path, newContent)
          } else {
            markFileRestored(openFile.path)
          }
        }
        return
      }

      if (event.event !== 'update') return

      const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
      if (!openFile) return

      const newContent = await api.file.read(event.path)
      if (newContent === null || newContent === openFile.content) return

      const isInternal = internalWriteTracker.consume(event.path)

      if (isInternal) {
        reloadFileFromDisk(openFile.path, newContent)
        scheduleSavedVersionSync(openFile.path, newContent)
        return
      }

      if (openFile.isDirty) {
        const confirmed = await globalConfirm({
          title: getFileName(event.path),
          message: t('file.externalModifiedReload', language as Language, { name: getFileName(event.path) }),
          confirmText: t('app.reload', language as Language),
          cancelText: t('cancel', language as Language),
          variant: 'warning',
        })

        if (confirmed) {
          reloadFileFromDisk(openFile.path, newContent)
          scheduleSavedVersionSync(openFile.path, newContent)
        }
        return
      }

      reloadFileFromDisk(openFile.path, newContent)
      scheduleSavedVersionSync(openFile.path, newContent)
    })

    return unsubscribe
  }, [])
}

/**
 * 文件事件桥接 Hook
 * 订阅 EventBus 的文件编写/流式内容/写入事件，自动打开文件预览
 */
import { useEffect } from 'react'
import { api } from '../../../adapters/electronBridge'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { useStore } from '@store'

interface UseFileEventBridgeParams {
  workspacePath: string | null
  activeFilePath: string | null
  openFile: (path: string, content: string, oldContent?: string) => void
  setActiveFile: (path: string) => void
  teamModeEnabled: boolean
}

export function useFileEventBridge({
  workspacePath,
  activeFilePath,
  openFile,
  setActiveFile,
  teamModeEnabled,
}: UseFileEventBridgeParams) {
  useEffect(() => {
    const unsubWriting = EventBus.on('file:writing', async event => {
      if (!event.filePath || !workspacePath) return
      if (teamModeEnabled) return
      const fullPath = event.filePath
      if (activeFilePath === fullPath) return
      const content = await api.file.read(fullPath)
      if (content !== null) {
        openFile(fullPath, content)
        setActiveFile(fullPath)
      }
    })

    const unsubStreamContent = EventBus.on('file:stream_content', async event => {
      if (!event.filePath || !workspacePath) return
      if (teamModeEnabled) return
      const fullPath = event.filePath
      const { openFiles } = useStore.getState()
      const isOpen = openFiles.some(f => f.path === fullPath)

      if (!isOpen) {
        openFile(fullPath, event.content)
        setActiveFile(fullPath)
      } else {
        const store = useStore.getState()
        const file = openFiles.find(f => f.path === fullPath)
        if (file && !file.isDirty) {
          store.updateFileContent(fullPath, event.content)
          if (activeFilePath !== fullPath) {
            setActiveFile(fullPath)
          }
        }
      }
    })

    const unsubWritten = EventBus.on('file:written', async event => {
      if (!event.filePath || !workspacePath) return
      if (teamModeEnabled) return
      const fullPath = event.filePath
      openFile(fullPath, event.content)
      setActiveFile(fullPath)
    })

    return () => {
      unsubWriting()
      unsubStreamContent()
      unsubWritten()
    }
  }, [workspacePath, openFile, setActiveFile, activeFilePath, teamModeEnabled])
}

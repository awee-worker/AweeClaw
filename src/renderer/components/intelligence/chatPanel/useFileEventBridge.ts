/**
 * 文件事件桥接 Hook
 * 订阅 EventBus 的文件编写/流式内容/写入事件，自动打开文件预览
 *
 * 支持文本文件、图片文件和视频文件：
 *   - 文本文件：通过 api.file.read 读取内容后打开预览
 *   - 图片文件：跳过文本读取（二进制），直接打开预览面板
 *     FilePreviewPanel 的 ImagePreview 组件会自行通过 Electron API 加载图片
 *   - 视频文件：跳过文本读取（二进制），直接打开预览面板
 *     FilePreviewPanel 的 VideoPreview 组件通过 local-preview:// 协议流式播放
 */
import { useEffect } from 'react'
import { api } from '../../../adapters/electronBridge'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { useStore } from '@store'

/** 图片文件扩展名（与 FilePreviewPanel.IMAGE_EXTENSIONS 保持一致） */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']

/** 视频文件扩展名（与 FilePreviewPanel.VIDEO_EXTENSIONS 保持一致） */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', '3gp']

/** 判断文件是否为图片（按扩展名） */
function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}

/** 判断文件是否为视频（按扩展名） */
function isVideoFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTENSIONS.includes(ext)
}

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
      if (!event.filePath) return
      if (teamModeEnabled) return
      const fullPath = event.filePath
      if (activeFilePath === fullPath) return

      // 图片文件：使用绝对路径，不依赖 workspacePath 是否存在
      // 直接打开预览面板，FilePreviewPanel 的 ImagePreview 组件会自行加载图片
      if (isImageFile(fullPath)) {
        openFile(fullPath, '')
        setActiveFile(fullPath)
        return
      }

      // 视频文件：使用绝对路径，不依赖 workspacePath 是否存在
      // 直接打开预览面板，FilePreviewPanel 的 VideoPreview 组件通过 local-preview:// 协议流式播放
      if (isVideoFile(fullPath)) {
        openFile(fullPath, '')
        setActiveFile(fullPath)
        return
      }

      // 文本文件：需要 workspacePath 才能判断文件位置
      if (!workspacePath) return
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

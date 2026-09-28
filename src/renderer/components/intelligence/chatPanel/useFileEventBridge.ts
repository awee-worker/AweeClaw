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
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { getFileName } from '@shared/toolkit/pathHelper'

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

/**
 * 二进制文档扩展名（与 FilePreviewPanel 的类型分派保持一致）
 *
 * 这些类型没有可读的文本内容，直接交给预览组件自行加载，
 * 否则读取文本会返回空值而被静默跳过，表现为「实时预览没反应」。
 */
const BINARY_DOC_EXTENSIONS = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'glb', 'gltf']

/** 判断文件是否为二进制文档（需要预览组件直接加载） */
function isBinaryDocFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return BINARY_DOC_EXTENSIONS.includes(ext)
}

interface UseFileEventBridgeParams {
  workspacePath: string | null
  activeFilePath: string | null
  openFile: (path: string, content: string, oldContent?: string) => void
  setActiveFile: (path: string) => void
  teamModeEnabled: boolean
}

/**
 * 是否需要在 AI 产出文件时自动打开编辑器预览
 *
 * 每次事件触发时实时读取，保证开关切换立即生效且不触发 effect 重订阅。
 * 关闭后不再打开/刷新标签页，也不会去读文件内容，产物改由「产物」面板按需查看。
 */
function isLiveFilePreviewEnabled(): boolean {
  return useStore.getState().agentConfig?.liveFilePreview !== false
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
      if (!isLiveFilePreviewEnabled()) return
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

      // 文档 / 二进制类型（Word、Excel、PPT、PDF、3D 模型等）：
      // 同样使用绝对路径直接打开预览面板，内容由对应预览组件自行加载
      if (isBinaryDocFile(fullPath)) {
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
      if (!isLiveFilePreviewEnabled()) return
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
      if (!isLiveFilePreviewEnabled()) return
      const fullPath = event.filePath
      const store = useStore.getState()
      const file = store.openFiles.find(f => f.path === fullPath)

      // 文件未打开：直接打开并展示写入结果
      if (!file) {
        openFile(fullPath, event.content)
        setActiveFile(fullPath)
        return
      }

      // 文件有未保存修改：保留编辑器里的内容，只把磁盘版本暂存下来并提示用户选择，
      // 否则 AI 的写入会静默丢掉用户尚未保存的改动（与 file:stream_content 分支的保护一致）
      if (file.isDirty) {
        // 内容未变时不重复提示：AI 可能对同一文件连续写入多次
        const changed = file.diskUpdatePending?.content !== event.content
        store.markDiskUpdatePending(fullPath, event.content)
        if (changed) {
          const language = useStore.getState().language as Language
          toast.warning(
            t('editor.diskupdatedbyai', language),
            t('editor.diskupdatedbyai2', language, { name: getFileName(fullPath) }),
          )
        }
        return
      }

      // 文件已打开且无未保存修改：同步磁盘上的最新内容，必要时切到该标签
      store.updateFileContent(fullPath, event.content)
      if (activeFilePath !== fullPath) {
        setActiveFile(fullPath)
      }
    })

    return () => {
      unsubWriting()
      unsubStreamContent()
      unsubWritten()
    }
  }, [workspacePath, openFile, setActiveFile, activeFilePath, teamModeEnabled])
}

/**
 * 产物记录 Hook
 *
 * 把 AI 执行任务时产出的文件沉淀到「产物」列表，供工作区的产物栏集中查看：
 *  - file:written —— 文本文件写入完成（新建 / 编辑 / 覆盖），事件自带 action 时按其标记
 *  - file:writing —— 图片、音视频类生成工具只发该事件，按媒体扩展名收录
 *
 * 与「实时预览文件」开关无关：预览关闭时依然记录，保证产物栏始终与任务产出同步。
 */
import { useEffect } from 'react'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { useStore } from '@store'
import { normalizePath } from '@shared/toolkit/pathHelper'

/** 媒体产物扩展名（与 FilePreviewPanel 的分类保持一致） */
const MEDIA_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', '3gp',
  'mp3', 'wav', 'flac', 'aac', 'ogg',
]

function isMediaFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return MEDIA_EXTENSIONS.includes(ext)
}

export function useArtifactRecorder(workspacePath: string | null) {
  useEffect(() => {
    const record = (filePath: string, action: 'create' | 'edit', pathWorkspace?: string) => {
      if (!filePath) return
      const store = useStore.getState()
      const target = normalizePath(filePath)
      const known = store.artifacts.some(item => normalizePath(item.path) === target)

      store.recordArtifact({
        path: filePath,
        workspacePath: pathWorkspace || workspacePath || '',
        // 首次出现即视作新建；已在列表中则沿用事件给出的操作类型，
        // 最终标识由 store 合并（新建过就不会因后续编辑退回「编辑」）
        action: known ? action : 'create',
      })
    }

    const unsubWritten = EventBus.on('file:written', event => {
      if (!event.filePath) return
      record(event.filePath, event.action ?? 'edit', event.workspacePath)
    })

    // 媒体产物（文生图 / 文生视频等）不会发 file:written，只能由写入事件收录
    const unsubWriting = EventBus.on('file:writing', event => {
      if (!event.filePath || !isMediaFile(event.filePath)) return
      record(event.filePath, 'create', event.workspacePath)
    })

    return () => {
      unsubWritten()
      unsubWriting()
    }
  }, [workspacePath])
}

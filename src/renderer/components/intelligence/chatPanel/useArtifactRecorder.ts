/**
 * 产物记录 Hook
 *
 * 把 AI 执行任务时产出的文件沉淀到「产物」列表，供工作区的产物栏集中查看：
 *  - file:written —— 文本文件写入完成（新建 / 编辑 / 覆盖），产物标识以事件携带的 action 为准
 *  - file:writing —— 图片、音视频类生成工具只发该事件，按媒体扩展名收录
 *
 * 与「实时预览文件」开关无关：预览关闭时依然记录，保证产物栏始终与任务产出同步。
 */
import { useEffect } from 'react'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { useStore } from '@store'

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

      useStore.getState().recordArtifact({
        path: filePath,
        workspacePath: pathWorkspace || workspacePath || '',
        // 产物标识直接采用写入事件给出的 action：写入通道在落盘前已经确认过目标文件是否存在，
        // 因此项目里原有的文件被编辑得到 edit，只有真正新建的文件才是 create。
        // 不能再按「是否已出现在产物列表」二次改写，否则老文件首次被 AI 编辑会被误标成新建。
        action,
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

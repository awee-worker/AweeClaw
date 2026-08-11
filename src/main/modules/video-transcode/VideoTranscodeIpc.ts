/**
 * 视频转码 IPC 注册
 *
 * 注册以下 IPC 通道：
 *   - video-transcode:probe     探测视频编码信息
 *   - video-transcode:isSupported 判断编码是否被 Chromium 支持
 *   - video-transcode:transcode  转码为 H.264（支持进度推送）
 *   - video-transcode:cancel     取消正在进行的转码
 *
 * 进度推送通过 webContents.send('video-transcode:progress', ...) 实现，
 * 渲染进程通过 onVideoTranscodeProgress 订阅。
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  probeVideo,
  isChromiumSupported,
  transcodeToH264,
  cleanTranscodeCache,
  type VideoProbeResult,
  type TranscodeProgress,
} from './VideoTranscodeService'

/** 当前活跃的转码任务（用于取消） */
const activeTranscodes = new Map<string, { aborted: boolean }>()

export function registerVideoTranscodeIpc(): void {
  // ── 探测视频编码 ──
  ipcMain.handle('video-transcode:probe', async (_event, filePath: string): Promise<VideoProbeResult> => {
    return probeVideo(filePath)
  })

  // ── 判断 Chromium 是否支持 ──
  ipcMain.handle(
    'video-transcode:isSupported',
    async (_event, probe: VideoProbeResult): Promise<{ supported: boolean; reason: string }> => {
      return isChromiumSupported(probe)
    },
  )

  // ── 转码为 H.264 ──
  ipcMain.handle(
    'video-transcode:transcode',
    async (event: IpcMainInvokeEvent, filePath: string): Promise<{ outputPath: string; fromCache: boolean; elapsedMs: number }> => {
      const taskId = filePath
      const signal = { aborted: false }
      activeTranscodes.set(taskId, signal)

      try {
        const result = await transcodeToH264(
          filePath,
          (progress: TranscodeProgress) => {
            // 通过 IPC 推送进度到渲染进程
            if (!event.sender.isDestroyed()) {
              event.sender.send('video-transcode:progress', { filePath, ...progress })
            }
          },
          signal,
        )
        return result
      } finally {
        activeTranscodes.delete(taskId)
      }
    },
  )

  // ── 取消转码 ──
  ipcMain.handle('video-transcode:cancel', async (_event, filePath: string): Promise<void> => {
    const signal = activeTranscodes.get(filePath)
    if (signal) {
      signal.aborted = true
      activeTranscodes.delete(filePath)
    }
  })

  // ── 清理缓存 ──
  ipcMain.handle('video-transcode:cleanCache', async (): Promise<void> => {
    cleanTranscodeCache()
  })
}

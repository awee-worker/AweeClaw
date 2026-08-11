/**
 * 视频转码 API（preload 侧）
 *
 * 暴露给渲染进程的视频转码接口：
 *   - probe(filePath): 探测视频编码
 *   - isSupported(probe): 判断 Chromium 是否支持
 *   - transcode(filePath): 转码为 H.264
 *   - cancel(filePath): 取消转码
 *   - onProgress(callback): 订阅转码进度
 */

import { invoke, on } from '../ipcHelpers'

export interface VideoProbeResult {
  videoCodec: string | null
  audioCodec: string | null
  width: number | null
  height: number | null
  duration: number | null
  fileSize: number | null
  fps: number | null
  bitrate: number | null
  format: string | null
}

export interface TranscodeProgress {
  filePath: string
  currentTime: number
  duration: number
  percent: number
  speed: string | null
}

export interface TranscodeResult {
  outputPath: string
  fromCache: boolean
  elapsedMs: number
}

export function createVideoTranscodeApi() {
  return {
    probe: (filePath: string) => invoke<VideoProbeResult>('video-transcode:probe')(filePath),
    isSupported: (probe: VideoProbeResult) =>
      invoke<{ supported: boolean; reason: string }>('video-transcode:isSupported')(probe),
    transcode: (filePath: string) => invoke<TranscodeResult>('video-transcode:transcode')(filePath),
    cancel: (filePath: string) => invoke<void>('video-transcode:cancel')(filePath),
    onProgress: on<TranscodeProgress>('video-transcode:progress'),
  }
}

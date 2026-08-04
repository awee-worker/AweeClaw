/**
 * 会议纪要录音编排 hook
 *
 * 职责：
 * 串联 VAD 分段器 → STT → 翻译 → store 写入的完整流程。
 *
 * 数据流：
 *   useVadSegmenter.onSegment(audioBlob, features)
 *     ↓
 *   store.addSegment（占位，状态 pending）
 *     ↓
 *   useTranscription.transcribe(audioBlob)
 *     ↓ (patchSegment: transcribing → done)
 *   useTranslation.translate(originalText, llmConfig)
 *     ↓ (patchSegment: translating → done)
 *   store.patchSegment(translatedText)
 *
 * 设计原则：
 * - 段处理独立并行：不同段的 STT/翻译互不阻塞
 * - 环境音段（isEnvironment）跳过 STT 和翻译，仅记录时长
 * - LLM 配置缺失时降级：只做 STT 不做翻译
 * - 错误降级：单段失败不影响其他段
 */

import { useCallback, useMemo } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import { useVadSegmenter, type SegmentFeatures } from './useVadSegmenter'
import { useTranscription } from './useTranscription'
import { useTranslation } from './useTranslation'
import {
  useMeetingNotesStore,
  generateSegmentId,
} from './useMeetingNotesStore'
import type { Segment } from '@shared/protocols/meetingNotes'
import type { LLMConfig } from '@shared/protocols/modelProtocol'

export interface UseMeetingRecorderOptions {
  /** LLM 配置（用于翻译） */
  llmConfig: LLMConfig | null
  /** 是否激活录音 */
  active: boolean
  /** 错误回调 */
  onError?: (msg: string) => void
}

export interface UseMeetingRecorderResult {
  /** VAD 状态 */
  vadRunning: boolean
  /** 是否正在说话 */
  speaking: boolean
  /** 实时音量 0-1 */
  volume: number
  /** VAD 错误 */
  vadError: string | null
}

export function useMeetingRecorder(options: UseMeetingRecorderOptions): UseMeetingRecorderResult {
  const { llmConfig, active, onError } = options
  const { transcribe } = useTranscription()
  const { translate } = useTranslation()

  // 用 ref 持有最新的 llmConfig，避免回调闭包旧值
  const llmConfigRef = useMemo(() => ({ current: llmConfig }), [])
  llmConfigRef.current = llmConfig

  /**
   * 处理单段音频
   *
   * 流程：
   * - 环境音段：直接丢弃，不记录到列表（用户要求不记录环境音）
   * - 人声段：添加占位段 → STT → 翻译 → 更新段
   */
  const processSegment = useCallback(
    async (audioBlob: Blob, features: SegmentFeatures): Promise<void> => {
      const store = useMeetingNotesStore.getState()

      // 环境音：不记录，直接丢弃
      if (features.isEnvironment) {
        logger.system.debug('[MeetingRecorder] Environment segment discarded', {
          duration: features.durationMs,
          rms: features.rms,
          voiceLikelihood: features.voiceLikelihood,
        })
        return
      }

      const segmentId = generateSegmentId()
      const now = Date.now()
      const duration = features.durationMs

      // 添加占位段（pending 状态）
      const segment: Segment = {
        id: segmentId,
        startTime: now - duration,
        endTime: now,
        durationMs: duration,
        speakerId: store.currentSpeakerId,
        rms: features.rms,
        voiceLikelihood: features.voiceLikelihood,
        isEnvironment: false,
        originalText: '',
        detectedLang: 'auto',
        translatedText: '',
        state: 'pending',
      }
      store.addSegment(segment)

      // STT 转写
      store.patchSegment(segmentId, { state: 'transcribing' })
      const sttResult = await transcribe(audioBlob, { language: 'auto' })

      if (!sttResult.success) {
        logger.system.warn('[MeetingRecorder] STT failed for segment:', segmentId, sttResult.error)
        store.patchSegment(segmentId, {
          state: 'failed',
          sttError: sttResult.error,
          originalText: '',
        })
        return
      }

      store.patchSegment(segmentId, {
        originalText: sttResult.text,
        detectedLang: sttResult.detectedLang,
        state: 'translating',
      })

      // 翻译
      if (!sttResult.text.trim()) {
        // 空文本直接完成
        store.patchSegment(segmentId, { state: 'done' })
        return
      }

      const trResult = await translate(sttResult.text, llmConfigRef.current)
      if (!trResult.success) {
        logger.system.warn('[MeetingRecorder] Translate failed for segment:', segmentId, trResult.error)
        store.patchSegment(segmentId, {
          state: 'done',
          translatedText: sttResult.text,
          translateError: trResult.error,
        })
        return
      }

      store.patchSegment(segmentId, {
        state: 'done',
        translatedText: trResult.translated,
        detectedLang: trResult.detectedLang,
      })
    },
    [transcribe, translate],
  )

  // VAD 分段器
  const vadState = useVadSegmenter({
    active,
    onSegment: processSegment,
    onError: (msg) => {
      useMeetingNotesStore.getState().setError(msg)
      onError?.(msg)
    },
  })

  return {
    vadRunning: vadState.running,
    speaking: vadState.speaking,
    volume: vadState.volume,
    vadError: vadState.error,
  }
}

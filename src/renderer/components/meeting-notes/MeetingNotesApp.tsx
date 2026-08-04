/**
 * MeetingNotesApp - 会议纪要窗口根组件
 *
 * 整合所有子模块，提供完整的会议纪要功能闭环：
 * - 顶部工具栏：开始/暂停/完成/整理
 * - 中间转写列表：实时显示各发言段（说话人/原文/译文）
 * - 底部状态栏：录音状态/工作区/段数
 * - 整理面板：弹出式，整理完成后展示结果与保存路径
 *
 * 数据流：
 *   useMeetingNotesConfig → 加载 LLM 配置/工作区
 *   useMeetingRecorder → VAD + STT + 翻译 → store.addSegment
 *   useMeetingNotesStore → 驱动 UI 渲染
 *   完成按钮 → saveTranscript（txt）
 *   整理按钮 → useMeetingNotesOrganize → generateDocx
 */

import { useEffect, useState, useCallback } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import { api } from '../../adapters/electronBridge'
import { useMeetingNotesStore } from '../../composables/meeting-notes/useMeetingNotesStore'
import { useMeetingNotesConfig } from '../../composables/meeting-notes/useMeetingNotesConfig'
import { useMeetingRecorder } from '../../composables/meeting-notes/useMeetingRecorder'
import { useMeetingNotesOrganize } from '../../composables/meeting-notes/useMeetingNotesOrganize'
import { MeetingToolbar } from './MeetingToolbar'
import { TranscriptList } from './TranscriptList'
import { StatusBar } from './StatusBar'
import { OrganizePanel } from './OrganizePanel'
import type { MeetingMinutes } from '@shared/protocols/meetingNotes'

export function MeetingNotesApp() {
  // ── 配置加载 ──
  const { ready, llmConfig, workspacePath, error: configError } = useMeetingNotesConfig()

  // ── Store ──
  const meetingState = useMeetingNotesStore((s) => s.meetingState)
  const segments = useMeetingNotesStore((s) => s.segments)
  const speakers = useMeetingNotesStore((s) => s.speakers)
  const currentSpeakerId = useMeetingNotesStore((s) => s.currentSpeakerId)
  const setCurrentSpeaker = useMeetingNotesStore((s) => s.setCurrentSpeaker)
  const renameSpeaker = useMeetingNotesStore((s) => s.renameSpeaker)
  const setSegmentSpeaker = useMeetingNotesStore((s) => s.setSegmentSpeaker)
  const setSegmentOriginalText = useMeetingNotesStore((s) => s.setSegmentOriginalText)
  const removeSegment = useMeetingNotesStore((s) => s.removeSegment)
  const startRecording = useMeetingNotesStore((s) => s.startRecording)
  const pauseRecording = useMeetingNotesStore((s) => s.pauseRecording)
  const finishRecording = useMeetingNotesStore((s) => s.finishRecording)
  const reset = useMeetingNotesStore((s) => s.reset)
  const setError = useMeetingNotesStore((s) => s.setError)
  const setWorkspacePath = useMeetingNotesStore((s) => s.setWorkspacePath)
  const setOrganizeProgress = useMeetingNotesStore((s) => s.setOrganizeProgress)
  const setSavedPaths = useMeetingNotesStore((s) => s.setSavedPaths)
  const startTime = useMeetingNotesStore((s) => s.startTime)
  const endTime = useMeetingNotesStore((s) => s.endTime)
  const organizeProgress = useMeetingNotesStore((s) => s.organizeProgress)
  const savedTranscriptPath = useMeetingNotesStore((s) => s.savedTranscriptPath)
  const savedDocxPath = useMeetingNotesStore((s) => s.savedDocxPath)
  const getSegmentSnapshots = useMeetingNotesStore((s) => s.getSegmentSnapshots)

  // ── 同步工作区路径到 store ──
  useEffect(() => {
    setWorkspacePath(workspacePath)
  }, [workspacePath, setWorkspacePath])

  // ── 录音编排 ──
  const isRecordingActive = meetingState === 'recording'
  const recorder = useMeetingRecorder({
    llmConfig,
    active: isRecordingActive,
    onError: (msg) => setError(msg),
  })

  // ── 整理 ──
  const { organize } = useMeetingNotesOrganize()
  const [showOrganizePanel, setShowOrganizePanel] = useState(false)
  const [organizeResult, setOrganizeResult] = useState<{
    minutes: MeetingMinutes | null
    error: string | null
    docxPath: string | null
  }>({ minutes: null, error: null, docxPath: null })

  // ── 工具栏事件处理 ──
  const handleStartOrPause = useCallback(() => {
    if (meetingState === 'idle') {
      if (!workspacePath) {
        setError('未检测到工作区，请先在主窗口打开一个文件夹')
        return
      }
      setError(null)
      startRecording()
    } else if (meetingState === 'recording') {
      pauseRecording()
    } else if (meetingState === 'paused') {
      startRecording() // resume
    } else if (meetingState === 'done' || meetingState === 'finishing') {
      // 重新开始新会议
      reset()
      setOrganizeResult({ minutes: null, error: null, docxPath: null })
      setSavedPaths(null, null)
      startRecording()
    }
  }, [meetingState, workspacePath, startRecording, pauseRecording, reset, setError, setSavedPaths])

  const handleFinish = useCallback(async () => {
    finishRecording()
    // 直接保存录音原文
    try {
      const snapshots = getSegmentSnapshots()
      if (snapshots.length === 0) {
        setError('没有可保存的发言段')
        return
      }
      const result = await api.meetingNotes.saveTranscript({
        date: formatDate(new Date(startTime)),
        startTime,
        endTime: Date.now(),
        segments: snapshots,
        speakers,
      })
      if (result.success && result.filePath) {
        setSavedPaths(result.filePath, undefined)
      } else {
        setError(result.error || '保存录音原文失败')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.system.error('[MeetingNotesApp] Save transcript failed:', err)
      setError(`保存失败：${msg}`)
    }
  }, [finishRecording, getSegmentSnapshots, startTime, speakers, setSavedPaths, setError])

  const handleOrganize = useCallback(async () => {
    if (segments.length === 0) {
      setError('没有可整理的发言内容')
      return
    }
    setShowOrganizePanel(true)
    setOrganizeResult({ minutes: null, error: null, docxPath: null })

    const result = await organize(segments, speakers, llmConfig, {
      onProgress: (progress) => setOrganizeProgress(progress),
    })

    if (result.success && result.minutes) {
      setOrganizeResult({ minutes: result.minutes, error: null, docxPath: null })

      // 生成并保存 docx
      try {
        const docxResult = await api.meetingNotes.generateDocx({
          minutes: result.minutes,
          date: result.minutes.date,
          startTime,
        })
        if (docxResult.success && docxResult.filePath) {
          setOrganizeResult((prev) => ({ ...prev, docxPath: docxResult.filePath! }))
          setSavedPaths(undefined, docxResult.filePath)
        } else {
          setOrganizeResult((prev) => ({
            ...prev,
            error: docxResult.error || 'Word 文档生成失败',
          }))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setOrganizeResult((prev) => ({ ...prev, error: `生成 Word 失败：${msg}` }))
      }
    } else {
      setOrganizeResult({ minutes: null, error: result.error || '整理失败', docxPath: null })
    }

    setOrganizeProgress(null)
  }, [segments, speakers, llmConfig, organize, setOrganizeProgress, startTime, setSavedPaths, setError])

  const handleCloseOrganizePanel = useCallback(() => {
    setShowOrganizePanel(false)
  }, [])

  // ── 加载状态 ──
  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-text-secondary">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-surface-muted border-t-accent" />
          <span className="text-sm">正在初始化会议纪要...</span>
        </div>
      </div>
    )
  }

  // ── 配置错误 ──
  if (configError && !llmConfig) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-8 text-center">
        <div className="max-w-md">
          <h2 className="mb-3 text-lg font-semibold text-status-error">配置加载失败</h2>
          <p className="text-sm text-text-secondary">{configError}</p>
          <p className="mt-4 text-xs text-text-muted">
            请在主窗口登录并配置 LLM 模型后，重新打开会议纪要窗口。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-text-primary">
      {/* 顶部工具栏 */}
      <MeetingToolbar
        meetingState={meetingState}
        speaking={recorder.speaking}
        volume={recorder.volume}
        currentSpeakerId={currentSpeakerId}
        speakers={speakers}
        segmentCount={segments.length}
        onSpeakerChange={setCurrentSpeaker}
        onSpeakerRename={renameSpeaker}
        onStartPause={handleStartOrPause}
        onFinish={handleFinish}
        onOrganize={handleOrganize}
        onReset={reset}
      />

      {/* 中间转写列表 */}
      <div className="flex-1 overflow-hidden">
        <TranscriptList
          segments={segments}
          speakers={speakers}
          onSegmentSpeakerChange={setSegmentSpeaker}
          onSegmentTextEdit={setSegmentOriginalText}
          onSegmentRemove={removeSegment}
        />
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        meetingState={meetingState}
        speaking={recorder.speaking}
        vadRunning={recorder.vadRunning}
        vadError={recorder.vadError}
        workspacePath={workspacePath}
        segmentCount={segments.length}
        startTime={startTime}
        endTime={endTime}
        savedTranscriptPath={savedTranscriptPath}
        savedDocxPath={savedDocxPath}
      />

      {/* 整理面板（弹出） */}
      {showOrganizePanel && (
        <OrganizePanel
          progress={organizeProgress}
          result={organizeResult}
          onClose={handleCloseOrganizePanel}
        />
      )}
    </div>
  )
}

// ============================================
// 辅助函数
// ============================================

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 会议纪要状态管理（zustand）
 *
 * 职责：
 * - 维护会议状态机：idle → recording ⇄ paused → finishing → done / organizing → done
 * - 维护发言段列表（按时间顺序，支持异步更新 STT/翻译结果）
 * - 维护说话人列表（预设：我/A/B/C/环境音/未知；用户可重命名）
 * - 维护工作区路径、当前说话人选择、错误信息
 * - 维护整理状态（organizing + 进度）
 *
 * 设计原则：
 * - Store 只负责状态与同步 actions，异步副作用（STT/翻译/整理/落盘）由 composables 调用后通过 actions 写入
 * - 段更新采用「合并式 patch」避免覆盖并发写入（STT 与翻译可能同时返回）
 * - 说话人列表支持运行时新增（自动聚类产生的未注册说话人）
 *
 * 不持久化：每次会议都是新会话，状态在窗口关闭后清空。
 */

import { create } from 'zustand'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  MeetingState,
  Segment,
  SegmentSnapshot,
  Speaker,
  SpeakerRole,
  OrganizeProgress,
} from '@shared/protocols/meetingNotes'

// ============================================
// 常量
// ============================================

/** 默认说话人预设（顺序即 UI 顺序，共 10 个用户位） */
const DEFAULT_SPEAKERS: Speaker[] = [
  {
    id: 'spk-me',
    role: 'me',
    name: '我',
    color: '#3b82f6',
    segmentCount: 0,
  },
  {
    id: 'spk-A',
    role: 'userA',
    name: '用户A',
    color: '#10b981',
    segmentCount: 0,
  },
  {
    id: 'spk-B',
    role: 'userB',
    name: '用户B',
    color: '#f59e0b',
    segmentCount: 0,
  },
  {
    id: 'spk-C',
    role: 'userC',
    name: '用户C',
    color: '#ef4444',
    segmentCount: 0,
  },
  {
    id: 'spk-D',
    role: 'userD',
    name: '用户D',
    color: '#8b5cf6',
    segmentCount: 0,
  },
  {
    id: 'spk-E',
    role: 'userE',
    name: '用户E',
    color: '#ec4899',
    segmentCount: 0,
  },
  {
    id: 'spk-F',
    role: 'userF',
    name: '用户F',
    color: '#14b8a6',
    segmentCount: 0,
  },
  {
    id: 'spk-G',
    role: 'userG',
    name: '用户G',
    color: '#f97316',
    segmentCount: 0,
  },
  {
    id: 'spk-H',
    role: 'userH',
    name: '用户H',
    color: '#6366f1',
    segmentCount: 0,
  },
  {
    id: 'spk-I',
    role: 'userI',
    name: '用户I',
    color: '#84cc16',
    segmentCount: 0,
  },
]

// ============================================
// 类型定义
// ============================================

export interface MeetingNotesState {
  // ── 状态 ──
  meetingState: MeetingState
  /** 会议开始时间戳 */
  startTime: number
  /** 会议结束时间戳 */
  endTime: number
  /** 工作区根路径（启动时从主进程获取） */
  workspacePath: string | null
  /** 当前选择的说话人 ID（用于手动标注新段） */
  currentSpeakerId: string
  /** 说话人列表（含预设 + 自动聚类产生的） */
  speakers: Speaker[]
  /** 发言段列表（按 startTime 升序） */
  segments: Segment[]
  /** 错误信息（用户可见） */
  error: string | null
  /** 整理进度 */
  organizeProgress: OrganizeProgress | null
  /** 整理后的结构化纪要 txt 路径 */
  savedTranscriptPath: string | null
  /** 整理后的 docx 路径 */
  savedDocxPath: string | null

  // ── Actions ──
  /** 重置到初始状态（开始新会议） */
  reset: () => void
  /** 设置工作区路径 */
  setWorkspacePath: (path: string | null) => void
  /** 设置当前说话人 */
  setCurrentSpeaker: (speakerId: string) => void
  /** 重命名说话人 */
  renameSpeaker: (speakerId: string, name: string) => void
  /** 添加新说话人（自动聚类时） */
  addSpeaker: (speaker: Speaker) => void

  /** 开始/恢复录音 */
  startRecording: () => void
  /** 暂停录音 */
  pauseRecording: () => void
  /** 完成录音（进入 finishing 状态） */
  finishRecording: () => void

  /** 添加新段（VAD 切割后调用） */
  addSegment: (segment: Segment) => void
  /** 局部更新段（STT/翻译/说话人变化） */
  patchSegment: (segmentId: string, patch: Partial<Segment>) => void
  /** 修改段的说话人（用户下拉切换） */
  setSegmentSpeaker: (segmentId: string, speakerId: string) => void
  /** 修改段的原文（用户手动编辑） */
  setSegmentOriginalText: (segmentId: string, text: string) => void
  /** 删除段 */
  removeSegment: (segmentId: string) => void

  /** 设置错误 */
  setError: (msg: string | null) => void
  /** 设置整理进度 */
  setOrganizeProgress: (progress: OrganizeProgress | null) => void
  /** 设置保存结果路径 */
  setSavedPaths: (transcript?: string | null, docx?: string | null) => void

  /** 获取发言段快照（保存时用，去掉 blob/embedding 等不可序列化字段） */
  getSegmentSnapshots: () => SegmentSnapshot[]
}

// ============================================
// 辅助
// ============================================

/** 计算各说话人的发言段数 */
function recountSpeakers(segments: Segment[], speakers: Speaker[]): Speaker[] {
  const counts = new Map<string, number>()
  for (const seg of segments) {
    counts.set(seg.speakerId, (counts.get(seg.speakerId) || 0) + 1)
  }
  return speakers.map((s) => ({
    ...s,
    segmentCount: counts.get(s.id) || 0,
  }))
}

/** 段 → 快照（保存到 txt 用） */
function toSnapshot(seg: Segment, speakers: Speaker[]): SegmentSnapshot {
  const speaker = speakers.find((s) => s.id === seg.speakerId)
  return {
    id: seg.id,
    startTime: seg.startTime,
    endTime: seg.endTime,
    speakerName: speaker?.name || '未知',
    speakerRole: speaker?.role || 'me',
    originalText: seg.originalText,
    translatedText: seg.translatedText,
    isEnvironment: seg.isEnvironment,
  }
}

// ============================================
// Store 创建
// ============================================

const initialState = {
  meetingState: 'idle' as MeetingState,
  startTime: 0,
  endTime: 0,
  workspacePath: null as string | null,
  currentSpeakerId: 'spk-me',
  speakers: DEFAULT_SPEAKERS.map((s) => ({ ...s })),
  segments: [] as Segment[],
  error: null as string | null,
  organizeProgress: null as OrganizeProgress | null,
  savedTranscriptPath: null as string | null,
  savedDocxPath: null as string | null,
}

export const useMeetingNotesStore = create<MeetingNotesState>((set, get) => ({
  ...initialState,

  reset: () => {
    set({
      ...initialState,
      speakers: DEFAULT_SPEAKERS.map((s) => ({ ...s })),
      // 工作区路径保留（同一会话内不变）
      workspacePath: get().workspacePath,
    })
  },

  setWorkspacePath: (path) => set({ workspacePath: path }),

  setCurrentSpeaker: (speakerId) => {
    if (!get().speakers.some((s) => s.id === speakerId)) {
      logger.system.warn('[MeetingNotesStore] Unknown speaker id:', speakerId)
      return
    }
    set({ currentSpeakerId: speakerId })
  },

  renameSpeaker: (speakerId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => ({
      speakers: state.speakers.map((s) => (s.id === speakerId ? { ...s, name: trimmed } : s)),
    }))
  },

  addSpeaker: (speaker) => {
    if (get().speakers.some((s) => s.id === speaker.id)) return
    set((state) => ({ speakers: [...state.speakers, speaker] }))
  },

  startRecording: () => {
    const state = get()
    if (state.meetingState === 'idle') {
      set({
        meetingState: 'recording',
        startTime: Date.now(),
        endTime: 0,
        error: null,
        savedTranscriptPath: null,
        savedDocxPath: null,
      })
    } else if (state.meetingState === 'paused') {
      set({ meetingState: 'recording', error: null })
    } else {
      logger.system.warn('[MeetingNotesStore] Cannot start from state:', state.meetingState)
    }
  },

  pauseRecording: () => {
    if (get().meetingState === 'recording') {
      set({ meetingState: 'paused' })
    }
  },

  finishRecording: () => {
    const state = get()
    if (state.meetingState === 'recording' || state.meetingState === 'paused') {
      set({ meetingState: 'finishing', endTime: Date.now() })
    }
  },

  addSegment: (segment) => {
    set((state) => {
      const segments = [...state.segments, segment]
      return {
        segments,
        speakers: recountSpeakers(segments, state.speakers),
      }
    })
  },

  patchSegment: (segmentId, patch) => {
    set((state) => ({
      segments: state.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, ...patch, manuallyEdited: patch.manuallyEdited ?? seg.manuallyEdited } : seg,
      ),
    }))
  },

  setSegmentSpeaker: (segmentId, speakerId) => {
    if (!get().speakers.some((s) => s.id === speakerId)) return
    set((state) => {
      const segments = state.segments.map((seg) =>
        seg.id === segmentId
          ? { ...seg, speakerId, manuallyEdited: true }
          : seg,
      )
      return {
        segments,
        speakers: recountSpeakers(segments, state.speakers),
      }
    })
  },

  setSegmentOriginalText: (segmentId, text) => {
    set((state) => ({
      segments: state.segments.map((seg) =>
        seg.id === segmentId
          ? { ...seg, originalText: text, manuallyEdited: true }
          : seg,
      ),
    }))
  },

  removeSegment: (segmentId) => {
    set((state) => {
      const segments = state.segments.filter((seg) => seg.id !== segmentId)
      return {
        segments,
        speakers: recountSpeakers(segments, state.speakers),
      }
    })
  },

  setError: (msg) => set({ error: msg }),

  setOrganizeProgress: (progress) => set({ organizeProgress: progress }),

  setSavedPaths: (transcript, docx) => {
    const patch: Partial<MeetingNotesState> = {}
    if (transcript !== undefined) patch.savedTranscriptPath = transcript
    if (docx !== undefined) patch.savedDocxPath = docx
    set(patch as MeetingNotesState)
  },

  getSegmentSnapshots: () => {
    const state = get()
    return state.segments
      .filter((s) => !s.isEnvironment || s.originalText)
      .map((seg) => toSnapshot(seg, state.speakers))
  },
}))

// ============================================
// 导出常量与辅助
// ============================================

export { DEFAULT_SPEAKERS }

/** 生成新段 ID */
export function generateSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 生成新说话人 ID（自动聚类用） */
export function generateSpeakerId(): string {
  return `spk-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** SpeakerRole 类型导出（供组件使用） */
export type { SpeakerRole }

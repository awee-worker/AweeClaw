/**
 * 会议纪要主进程侧类型定义
 *
 * 仅主进程使用的类型；跨进程共享类型见 @shared/protocols/meetingNotes
 */

import type { MeetingMinutes, SegmentSnapshot, Speaker } from '@shared/protocols/meetingNotes'

/** 工作区路径获取函数（由外部注入，避免循环依赖） */
export type WorkspacePathGetter = () => string | null

/** 会议纪要文件夹信息 */
export interface MeetingNotesDirInfo {
  /** 工作区根目录 */
  workspaceRoot: string
  /** 当天文件夹绝对路径 */
  dayDir: string
  /** 日期 YYYY-MM-DD */
  date: string
}

/** txt 文件内容构建结果 */
export interface TranscriptFileContent {
  /** 文件名（含扩展名） */
  fileName: string
  /** 文件内容 */
  content: string
}

/** docx 生成入参（主进程内部） */
export interface DocxGenerateInput {
  minutes: MeetingMinutes
}

/** 重新导出共享类型，便于主进程统一引用 */
export type {
  MeetingMinutes,
  SegmentSnapshot,
  Speaker,
}

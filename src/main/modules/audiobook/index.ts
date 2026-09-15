/**
 * Audiobook 模块导出
 *
 * @module audiobook
 */

export { AudiobookStore } from './AudiobookStore'
export type {
  AudiobookConfig,
  TaskMetadata,
  TaskStatus,
  DocumentStructure,
  Chapter,
  TextSegment,
  SegmentStatus,
  TaskManifest,
} from './AudiobookStore'

export { parseDocument, estimateTask } from './DocumentParser'

export { segmentText, segmentChapter, segmentDocument } from './TextSegmenter'

export { BatchTtsRunner, createBatchSynthesizeTask } from './BatchTtsRunner'
export type { TtsSynthesizeFn, BatchSynthesizeOptions, ProgressCallback } from './BatchTtsRunner'

export { AudioAssembler } from './AudioAssembler'
export type { AssembleOptions, AssembleResult } from './AudioAssembler'

export { AudiobookManager } from './AudiobookManager'
export type { TaskProgressEvent, TaskProgressCallback } from './AudiobookManager'

export { registerAudiobookIpcHandlers, cleanupAudiobookIpcHandlers } from './AudiobookIpc'
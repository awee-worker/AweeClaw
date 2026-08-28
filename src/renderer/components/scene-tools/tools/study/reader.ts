import { listDS } from '../../factory'
import { useReadingStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'study-reader',
  '阅读助手',
  'study',
  '阅读清单、摘要与进度',
  'add: { title: string(必填), url?: string, summary?: string, progress?: number(0-100), status?: "wish"|"reading"|"done" }；update 支持 progress/status/summary',
  () => useReadingStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.title ?? (i as any)?.id ?? ''

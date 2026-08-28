import { listDS } from '../../factory'
import { useMeetingStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'work-meeting',
  '会议助手',
  'work',
  '会议：会前准备（目标/议程）、纪要、行动项',
  'add: { title: string(必填), date?: "YYYY-MM-DD", goal?, agenda?, notes?, actionItems?: string[] }；update 支持 status(pending/done)/goal/agenda/notes/actionItems',
  () => useMeetingStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.title ?? (i as any)?.id ?? ''

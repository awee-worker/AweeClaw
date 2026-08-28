import { listDS } from '../../factory'
import { useWorkHourStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'work-hours',
  '工时记录',
  'work',
  '上下班打卡、加班统计',
  'add: { date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM", note?: string }',
  () => useWorkHourStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => `工时 ${(i as any)?.date ?? ''}`

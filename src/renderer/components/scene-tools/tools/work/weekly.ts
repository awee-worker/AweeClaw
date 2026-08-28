import { listDS } from '../../factory'
import { useWeeklyReportStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'work-weekly',
  '周报生成器',
  'work',
  '周报：按周保存的周报内容',
  'add: { weekStart: "YYYY-MM-DD"(周一), content: string }',
  () => useWeeklyReportStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => `周报 ${(i as any)?.weekStart ?? ''}`

import { listDS } from '../../factory'
import { usePlanStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'study-planner',
  '学习计划表',
  'study',
  '周计划排布与完成统计',
  'add: { date: "YYYY-MM-DD"(必填), subject: string(必填), task: string(必填), done?: boolean, timeSlot?: string }；update 支持 done/subject/task/timeSlot',
  () => usePlanStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => `${(i as any)?.subject ?? ''} ${(i as any)?.task ?? ''}`

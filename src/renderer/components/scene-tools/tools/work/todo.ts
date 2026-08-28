import { listDS } from '../../factory'
import { useTodoStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'work-todo',
  '待办清单',
  'work',
  '任务管理：优先级、截止日期、AI 执行',
  'add: { text: string(必填), status: "pending"(默认), priority: "high"|"medium"|"low"(默认medium), dueDate?: "YYYY-MM-DD" }；update 支持 status(pending/executing/done)/aiNote/dueDate',
  () => useTodoStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.text ?? (i as any)?.id ?? ''

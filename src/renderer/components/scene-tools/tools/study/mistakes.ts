import { listDS } from '../../factory'
import { useMistakeStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'study-mistakes',
  '错题本',
  'study',
  '错题记录与定期重做',
  'add: { subject: string(必填), question: string(必填), answer: string(必填), reason?: string, status?: "open"|"mastered" }；update 支持 status/reason/answer',
  () => useMistakeStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => `${(i as any)?.question?.slice(0, 20) ?? ''} ${(i as any)?.id ?? ''}`

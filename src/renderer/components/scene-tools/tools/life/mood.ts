import { listDS } from '../../factory'
import { useMoodStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'life-mood',
  '心情日记',
  'life',
  '情绪打卡（1-5）+ 一句话日记',
  'add: { mood: number(1-5, 必填), text?: string, date?: "YYYY-MM-DD" }',
  () => useMoodStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.id ?? ''

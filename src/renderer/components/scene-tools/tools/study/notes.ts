import { listDS } from '../../factory'
import { useNoteStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'study-notes',
  '笔记库',
  'study',
  'Markdown 笔记与标签',
  'add: { title: string(必填), content: string, tags?: string[] }',
  () => useNoteStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.title ?? (i as any)?.id ?? ''

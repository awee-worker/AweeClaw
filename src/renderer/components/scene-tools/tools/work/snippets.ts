import { listDS } from '../../factory'
import { useSnippetStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'work-snippets',
  '快捷话术库',
  'work',
  '常用邮件模板与回复话术',
  'add: { title: string, content: string, category: string }',
  () => useSnippetStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.title ?? (i as any)?.id ?? ''

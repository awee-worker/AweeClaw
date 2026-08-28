import { listDS } from '../../factory'
import { useFileRuleStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'work-files',
  '文件整理助手',
  'work',
  '文件整理规则：按关键词归类文件',
  'add: { name: string, keywords: string[], targetDir: string }',
  () => useFileRuleStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.name ?? (i as any)?.id ?? ''

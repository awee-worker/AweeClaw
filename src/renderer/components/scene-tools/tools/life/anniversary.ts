import { listDS } from '../../factory'
import { useAnniversaryStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'life-anniversary',
  '纪念日提醒',
  'life',
  '生日与纪念日倒计时',
  'add: { name: string(必填), date: string(必填, 如 "1990-05-20" 或 "05-20"), type?: "birthday"|"anniversary"|"custom", repeatYearly?: boolean }',
  () => useAnniversaryStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.name ?? (i as any)?.id ?? ''

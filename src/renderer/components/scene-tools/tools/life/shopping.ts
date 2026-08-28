import { listDS } from '../../factory'
import { useShoppingStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'life-shopping',
  '购物清单',
  'life',
  '可勾选的采购清单',
  'add: { name: string(必填), note?: string }；update 支持 done(boolean)',
  () => useShoppingStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.name ?? (i as any)?.id ?? ''

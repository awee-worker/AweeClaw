import { listDS } from '../../factory'
import { useRecipeStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'life-recipe',
  '菜谱推荐',
  'life',
  '家常菜谱收藏与做法',
  'add: { name: string(必填), ingredients: string[], steps: string, favorite?: boolean }',
  () => useRecipeStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => (i as any)?.name ?? (i as any)?.id ?? ''

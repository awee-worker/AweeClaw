import { DS as DS_ledger, trackKey as trackKey_ledger } from './ledger'
import { DS as DS_water, trackKey as trackKey_water } from './water'
import { DS as DS_mood, trackKey as trackKey_mood } from './mood'
import { DS as DS_shopping, trackKey as trackKey_shopping } from './shopping'
import { DS as DS_anniversary, trackKey as trackKey_anniversary } from './anniversary'
import { DS as DS_recipe, trackKey as trackKey_recipe } from './recipe'

// 对外导出
export { DS_ledger, trackKey_ledger }
export { DS_water, trackKey_water }
export { DS_mood, trackKey_mood }
export { DS_shopping, trackKey_shopping }
export { DS_anniversary, trackKey_anniversary }
export { DS_recipe, trackKey_recipe }

import type { SceneToolDS, TrackKeyFn } from '../../factory'

export const ALL_DS: SceneToolDS[] = [
  DS_ledger,
  DS_water,
  DS_mood,
  DS_shopping,
  DS_anniversary,
  DS_recipe,
]

export const TRACK_KEYS: Record<string, TrackKeyFn> = {
  'life-ledger': trackKey_ledger,
  'life-water': trackKey_water,
  'life-mood': trackKey_mood,
  'life-shopping': trackKey_shopping,
  'life-anniversary': trackKey_anniversary,
  'life-recipe': trackKey_recipe,
}

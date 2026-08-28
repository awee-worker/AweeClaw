import { DS as DS_flashcards, trackKey as trackKey_flashcards } from './flashcards'
import { DS as DS_pomodoro, trackKey as trackKey_pomodoro } from './pomodoro'
import { DS as DS_mistakes, trackKey as trackKey_mistakes } from './mistakes'
import { DS as DS_notes, trackKey as trackKey_notes } from './notes'
import { DS as DS_reader, trackKey as trackKey_reader } from './reader'
import { DS as DS_planner, trackKey as trackKey_planner } from './planner'

// 对外导出
export { DS_flashcards, trackKey_flashcards }
export { DS_pomodoro, trackKey_pomodoro }
export { DS_mistakes, trackKey_mistakes }
export { DS_notes, trackKey_notes }
export { DS_reader, trackKey_reader }
export { DS_planner, trackKey_planner }

import type { SceneToolDS, TrackKeyFn } from '../../factory'

export const ALL_DS: SceneToolDS[] = [
  DS_flashcards,
  DS_pomodoro,
  DS_mistakes,
  DS_notes,
  DS_reader,
  DS_planner,
]

export const TRACK_KEYS: Record<string, TrackKeyFn> = {
  'study-flashcards': trackKey_flashcards,
  'study-pomodoro': trackKey_pomodoro,
  'study-mistakes': trackKey_mistakes,
  'study-notes': trackKey_notes,
  'study-reader': trackKey_reader,
  'study-planner': trackKey_planner,
}

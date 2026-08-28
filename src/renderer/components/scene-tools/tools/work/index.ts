import { DS, trackKey } from './pomodoro'
import { DS as DS_todo, trackKey as trackKey_todo } from './todo'
import { DS as DS_meeting, trackKey as trackKey_meeting } from './meeting'
import { DS as DS_weekly, trackKey as trackKey_weekly } from './weekly'
import { DS as DS_files, trackKey as trackKey_files } from './files'
import { DS as DS_hours, trackKey as trackKey_hours } from './hours'
import { DS as DS_snippets, trackKey as trackKey_snippets } from './snippets'
import { DS as DS_plan, trackKey as trackKey_plan } from './plan'

// 对外导出（别名形式，保持 API 一致性）
export { DS as DS_pomodoro, trackKey as trackKey_pomodoro }
export { DS_todo, trackKey_todo }
export { DS_meeting, trackKey_meeting }
export { DS_weekly, trackKey_weekly }
export { DS_files, trackKey_files }
export { DS_hours, trackKey_hours }
export { DS_snippets, trackKey_snippets }
export { DS_plan, trackKey_plan }

import type { SceneToolDS, TrackKeyFn } from '../../factory'

export const ALL_DS: SceneToolDS[] = [
  DS,
  DS_todo,
  DS_meeting,
  DS_weekly,
  DS_files,
  DS_hours,
  DS_snippets,
  DS_plan,
]

export const TRACK_KEYS: Record<string, TrackKeyFn> = {
  'work-todo': trackKey_todo,
  'work-meeting': trackKey_meeting,
  'work-weekly': trackKey_weekly,
  'work-files': trackKey_files,
  'work-hours': trackKey_hours,
  'work-snippets': trackKey_snippets,
  'work-plan': trackKey_plan,
  'work-pomodoro': trackKey,
}

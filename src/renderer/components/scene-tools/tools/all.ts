/**
 * 汇总所有场景工具的数据域和事件追踪 key。
 * 由各模式 index.ts 聚合导出。
 */
import { ALL_DS as workDS, TRACK_KEYS as workTrack } from './work'
import { ALL_DS as lifeDS, TRACK_KEYS as lifeTrack } from './life'
import { ALL_DS as studyDS, TRACK_KEYS as studyTrack } from './study'
// 通讯录：通用工具，仅提供给 AI（不在场景工具面板宫格注册）
import { DS as DS_contacts, trackKey as trackKey_contacts } from './contacts'
import type { SceneToolDS, TrackKeyFn } from '../factory'

export const allDS: SceneToolDS[] = [...workDS, ...lifeDS, ...studyDS, DS_contacts]

export const allTrackKeys: Record<string, TrackKeyFn> = {
  ...workTrack,
  ...lifeTrack,
  ...studyTrack,
  contacts: trackKey_contacts,
}

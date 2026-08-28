/**
 * 汇总所有场景工具的数据域和事件追踪 key。
 * 由各模式 index.ts 聚合导出。
 */
import { ALL_DS as workDS, TRACK_KEYS as workTrack } from './work'
import { ALL_DS as lifeDS, TRACK_KEYS as lifeTrack } from './life'
import { ALL_DS as studyDS, TRACK_KEYS as studyTrack } from './study'
import type { SceneToolDS, TrackKeyFn } from '../factory'

export const allDS: SceneToolDS[] = [...workDS, ...lifeDS, ...studyDS]

export const allTrackKeys: Record<string, TrackKeyFn> = {
  ...workTrack,
  ...lifeTrack,
  ...studyTrack,
}

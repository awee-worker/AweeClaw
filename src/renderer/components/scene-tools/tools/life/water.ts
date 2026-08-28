import { useWaterStore } from '../../stores'
import { todayStr } from '../../stores'
import type { SceneToolDS, TrackKeyFn } from '../../factory'

export const DS: SceneToolDS = {
  id: 'life-water',
  name: '喝水打卡',
  mode: 'life',
  description: '喝水打卡：每日饮水目标与进度',
  itemSchema: 'add: { count?: number(默认 1) } 给今天加杯数；update: { id: "target", patch { target: number } } 修改每日目标；remove: { id: "YYYY-MM-DD" } 重置某天进度',
  read: () => {
    const s = useWaterStore.getState()
    const today = todayStr()
    return { today, cupsToday: s.cups[today] ?? 0, target: s.target, recent: s.cups }
  },
  add: (item) => {
    useWaterStore.getState().add(Number(item.count) || 1)
    return { ok: true }
  },
  update: (id, patch) => {
    if (id === 'target' && patch.target !== undefined) {
      useWaterStore.getState().setTarget(Math.max(1, Number(patch.target) || 8))
      return { ok: true }
    }
    return { ok: false, error: '仅支持 id="target" + patch.target' }
  },
  remove: (id) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(id)) {
      useWaterStore.getState().resetDay(id)
      return { ok: true }
    }
    return { ok: false, error: 'id 应为日期 YYYY-MM-DD' }
  },
}

export const trackKey: TrackKeyFn = (i) => {
  const item = i as Record<string, unknown>
  return item.count !== undefined ? `喝水 +${item.count} 杯` : '喝水打卡'
}

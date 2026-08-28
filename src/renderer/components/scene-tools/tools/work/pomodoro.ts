import { usePomodoroStore } from '../../stores'
import { todayStr } from '../../stores'
import type { SceneToolDS, TrackKeyFn } from '../../factory'

export const DS: SceneToolDS = {
  id: 'work-pomodoro',
  name: '番茄专注钟',
  mode: 'work',
  description: '番茄专注钟：专注/休息循环计时，专注记录自动沉淀',
  itemSchema: 'add: { minutes: number, date?: "YYYY-MM-DD"(默认今天), subject?: string } 直接补记一条专注记录；update: { id: "settings", patch 字段 focusMin/breakMin/longBreakMin/roundsBeforeLongBreak }',
  read: () => {
    const s = usePomodoroStore.getState()
    const records = s.records.filter((r) => r.kind === 'work')
    return {
      settings: s.settings,
      phase: s.phase,
      running: s.running,
      remainingSec: s.remainingSec,
      records: records.slice(-30).reverse(),
    }
  },
  add: (item) => {
    try {
      const minutes = Number(item.minutes)
      if (!minutes || minutes <= 0) return { ok: false, error: 'minutes 必须为正数' }
      const date = (item.date as string) || todayStr()
      const st = usePomodoroStore.getState()
      const rec = {
        id: `ai_${Date.now().toString(36)}`,
        createdAt: Date.now(),
        date,
        minutes,
        kind: 'work' as const,
        subject: (item.subject as string) || undefined,
      }
      usePomodoroStore.setState({ records: [...st.records, rec] })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  update: (id, patch) => {
    try {
      if (id === 'settings') {
        const cur = usePomodoroStore.getState().settings
        const next = { ...cur }
        for (const k of ['focusMin', 'breakMin', 'longBreakMin', 'roundsBeforeLongBreak'] as const) {
          if (patch[k] !== undefined) next[k] = Math.max(1, Number(patch[k]) || cur[k])
        }
        usePomodoroStore.setState({ settings: next })
        return { ok: true }
      }
      return { ok: false, error: `id "${id}" 不是 "settings"` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  remove: (id) => {
    try {
      const st = usePomodoroStore.getState()
      usePomodoroStore.setState({ records: st.records.filter((r) => r.id !== id) })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const trackKey: TrackKeyFn = () => ''

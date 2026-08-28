/**
 * 场景模式内置工具数据层
 *
 * 每个工具一个持久化 store（zustand + SQLite）。
 * 通用列表 store 由 createListStore 工厂生成，特殊状态（番茄钟计时、喝水、闪卡调度）单独定义。
 *
 * 持久化说明：
 * - 数据统一存储在单个 SQLite 数据库文件（主进程 scene-tools.db），
 *   通过 IPC（window.electronAPI.sceneToolsDb*）读写，key 为 store 名称。
 * - 兼容旧数据：SQLite 无数据时自动回退读取 localStorage 并写回 SQLite（首次迁移）。
 * - SQLite 不可用（如 IPC 异常）时兜底写 localStorage，保证数据不丢失。
 */

import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

// ============================================
// SQLite 持久化 storage（替代 localStorage）
// ============================================

const sqliteSceneToolsStorage: StateStorage = {
  getItem: async (name) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    // 优先 SQLite
    if (api?.sceneToolsDbGet) {
      try {
        const v = await api.sceneToolsDbGet(name)
        if (v != null) return v
      } catch (err) {
        console.error('[SceneToolsDb] get failed, fallback to localStorage:', err)
      }
    }
    // 兜底：localStorage 旧数据（首次迁移，读后异步写回 SQLite）
    try {
      const legacy = localStorage.getItem(name)
      if (legacy != null && api?.sceneToolsDbSet) {
        api.sceneToolsDbSet(name, legacy).catch(() => {})
      }
      return legacy
    } catch {
      return null
    }
  },
  setItem: async (name, value) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (api?.sceneToolsDbSet) {
      try {
        await api.sceneToolsDbSet(name, value)
        return
      } catch (err) {
        console.error('[SceneToolsDb] set failed, fallback to localStorage:', err)
      }
    }
    try {
      localStorage.setItem(name, value)
    } catch {
      /* ignore */
    }
  },
  removeItem: async (name) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (api?.sceneToolsDbRemove) {
      try {
        await api.sceneToolsDbRemove(name)
        return
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

/** 供 persist 使用的 storage 配置 */
const sceneToolsPersistStorage = createJSONStorage(() => sqliteSceneToolsStorage)

// ============================================
// 持久化 store 预热（等待 SQLite hydration 完成）
// ============================================

/** 持久化 store 的 hydration 句柄（最小接口） */
interface PersistHydrateHandle {
  persist: {
    hasHydrated: () => boolean
    onFinishHydration: (cb: () => void) => () => void
  }
}

/** 所有使用 persist 的场景工具 store */
const persistedStores: PersistHydrateHandle[] = []

function registerPersistedStore(store: unknown): void {
  const handle = store as PersistHydrateHandle
  if (handle?.persist) persistedStores.push(handle)
}

/**
 * 等待所有场景工具 store 完成 SQLite hydration（最长 timeoutMs）。
 *
 * persist 的异步 hydration 意味着应用启动早期 store 可能还是空数据，
 * AI Agent（agentBridge）与工具面板在数据就绪前读取会拿到空值。
 * 应在应用启动时调用本函数预热，保证后续读取到完整数据。
 */
export async function warmupSceneToolsStores(timeoutMs = 4000): Promise<void> {
  await Promise.all(
    persistedStores.map((s) => {
      if (s.persist.hasHydrated()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const off = s.persist.onFinishHydration(() => {
          off()
          resolve()
        })
        setTimeout(resolve, timeoutMs)
      })
    }),
  )
}

// ============================================
// 通用工具函数
// ============================================

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ============================================
// 通用列表 store 工厂
// ============================================

export interface BaseItem {
  id: string
  createdAt: number
}

export interface ListStore<T extends BaseItem> {
  items: T[]
  add: (item: Omit<T, 'id' | 'createdAt'>) => T
  update: (id: string, patch: Partial<T>) => void
  remove: (id: string) => void
  reset: () => void
}

function createListStore<T extends BaseItem>(key: string) {
  const store = create<ListStore<T>>()(
    persist(
      (set) => ({
        items: [] as T[],
        add: (item) => {
          const full = { ...item, id: uid(key), createdAt: Date.now() } as T
          set((s) => ({ items: [full, ...s.items] }))
          return full
        },
        update: (id, patch) =>
          set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
        remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
        reset: () => set({ items: [] }),
      }),
      { name: `scene-tools:${key}`, storage: sceneToolsPersistStorage },
    ),
  )
  registerPersistedStore(store)
  return store
}

// ============================================
// 工作模式 · 数据模型
// ============================================

export interface WorkTodoItem extends BaseItem {
  text: string
  /** pending | executing | done */
  status: 'pending' | 'executing' | 'done'
  /** high / medium / low */
  priority: 'high' | 'medium' | 'low'
  dueDate?: string
  source?: string
  /** AI 完成后的摘要/备注 */
  aiNote?: string
  /** 执行完成时间 */
  executedAt?: number
}

export interface PomodoroRecord extends BaseItem {
  date: string
  minutes: number
  kind: 'work' | 'study'
  subject?: string
}

export interface MeetingItem extends BaseItem {
  title: string
  date: string
  /** 会前准备：目标 / 议题 / 待确认问题 */
  goal?: string
  agenda?: string
  notes?: string
  /** 行动项 */
  actionItems: string[]
  /** pending / done */
  status: 'pending' | 'done'
}

export interface WeeklyReport extends BaseItem {
  weekStart: string
  content: string
}

export interface FileOrganizeRule extends BaseItem {
  name: string
  /** 文件名/路径匹配关键词 */
  keywords: string[]
  targetDir: string
}

export interface WorkHourItem extends BaseItem {
  date: string
  start: string
  end: string
  note?: string
}

export interface SnippetItem extends BaseItem {
  title: string
  content: string
  category: string
}

/** 工作计划项 */
export interface WorkPlanItem extends BaseItem {
  /** 计划类型：week / month / day */
  planType: 'week' | 'month' | 'day'
  /** 计划标题，如 "本周计划" */
  title: string
  /** 计划的基准日期（周一/月初/具体日期） */
  baseDate: string
  /** 日程条目列表 */
  entries: WorkPlanEntry[]
  /** 已提醒的日期集合 */
  remindedDates: string[]
}

/** 单个日程条目 */
export interface WorkPlanEntry {
  id: string
  /** 日期 YYYY-MM-DD */
  date: string
  /** 任务描述 */
  task: string
  /** 优先级：high / medium / low */
  priority: 'high' | 'medium' | 'low'
  /** 完成状态 */
  done: boolean
  /** 预计耗时（分钟） */
  estimatedMin?: number
}

// ============================================
// 工作模式 · Stores
// ============================================

export const useTodoStore = createListStore<WorkTodoItem>('work-todo')
export const useWorkPlanStore = createListStore<WorkPlanItem>('work-plan')

export interface PomodoroSettings {
  focusMin: number
  breakMin: number
  longBreakMin: number
  roundsBeforeLongBreak: number
}
export interface PomodoroState {
  running: boolean
  remainingSec: number
  phase: 'focus' | 'break' | 'longBreak' | 'idle'
  round: number
  kind: 'work' | 'study'
  subject?: string
  settings: PomodoroSettings
  records: PomodoroRecord[]
  start: (kind: 'work' | 'study', subject?: string) => void
  pause: () => void
  resume: () => void
  tick: () => void
  complete: () => void
  skipBreak: () => void
  setSettings: (patch: Partial<PomodoroSettings>) => void
  reset: () => void
}
const pomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      running: false,
      remainingSec: 25 * 60,
      phase: 'idle',
      round: 0,
      kind: 'work',
      settings: { focusMin: 25, breakMin: 5, longBreakMin: 15, roundsBeforeLongBreak: 4 },
      records: [],
      start: (kind, subject) => {
        const { settings } = get()
        set({ running: true, phase: 'focus', remainingSec: settings.focusMin * 60, round: 0, kind, subject })
      },
      pause: () => set({ running: false }),
      resume: () => set({ running: true }),
      tick: () => {
        const s = get()
        if (!s.running) return
        if (s.remainingSec > 1) {
          set({ remainingSec: s.remainingSec - 1 })
        } else {
          // 当前阶段结束
          if (s.phase === 'focus') {
            const round = s.round + 1
            const isLong = round % s.settings.roundsBeforeLongBreak === 0
            const rec: PomodoroRecord = {
              id: uid('pomo'),
              createdAt: Date.now(),
              date: todayStr(),
              minutes: s.settings.focusMin,
              kind: s.kind,
              subject: s.subject,
            }
            set({
              records: [...s.records, rec],
              phase: isLong ? 'longBreak' : 'break',
              remainingSec: (isLong ? s.settings.longBreakMin : s.settings.breakMin) * 60,
              round,
            })
          } else {
            set({ phase: 'idle', remainingSec: s.settings.focusMin * 60, running: false })
          }
        }
      },
      complete: () => {
        const s = get()
        if (s.phase === 'focus') {
          const rec: PomodoroRecord = {
            id: uid('pomo'),
            createdAt: Date.now(),
            date: todayStr(),
            minutes: s.settings.focusMin,
            kind: s.kind,
            subject: s.subject,
          }
          set({ records: [...s.records, rec] })
        }
        set({ phase: 'idle', running: false, remainingSec: s.settings.focusMin * 60 })
      },
      skipBreak: () => {
        const s = get()
        set({ phase: 'idle', running: false, remainingSec: s.settings.focusMin * 60, round: 0 })
      },
      setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      reset: () => set({ running: false, phase: 'idle', round: 0, remainingSec: get().settings.focusMin * 60, records: [] }),
    }),
    { name: 'scene-tools:work-pomodoro', storage: sceneToolsPersistStorage },
  ),
)
registerPersistedStore(pomodoroStore)
export const usePomodoroStore = pomodoroStore

export const useMeetingStore = createListStore<MeetingItem>('work-meeting')

export const useWeeklyReportStore = createListStore<WeeklyReport>('work-weekly')

export const useFileRuleStore = createListStore<FileOrganizeRule>('work-file-rules')

export const useWorkHourStore = createListStore<WorkHourItem>('work-hours')

export const useSnippetStore = createListStore<SnippetItem>('work-snippets')

// ============================================
// 生活模式 · 数据模型
// ============================================

export interface LedgerItem extends BaseItem {
  amount: number
  /** 收入 / 支出 */
  type: 'income' | 'expense'
  category: string
  note?: string
  date: string
}

export interface WaterState {
  /** date -> 杯数 */
  cups: Record<string, number>
  target: number
  add: (count?: number) => void
  setTarget: (n: number) => void
  resetDay: (date: string) => void
}
const waterStore = create<WaterState>()(
  persist(
    (set, get) => ({
      cups: {},
      target: 8,
      add: (count = 1) => {
        const date = todayStr()
        const cur = get().cups[date] ?? 0
        set({ cups: { ...get().cups, [date]: Math.max(0, cur + count) } })
      },
      setTarget: (n) => set({ target: Math.max(1, n) }),
      resetDay: (date) => {
        const cups = { ...get().cups }
        delete cups[date]
        set({ cups })
      },
    }),
    { name: 'scene-tools:life-water', storage: sceneToolsPersistStorage },
  ),
)
registerPersistedStore(waterStore)
export const useWaterStore = waterStore

export interface MoodEntry extends BaseItem {
  /** 1-5 */
  mood: number
  text?: string
  date: string
}
export const useMoodStore = createListStore<MoodEntry>('life-mood')

export interface ShoppingItem extends BaseItem {
  name: string
  done: boolean
  note?: string
}
export const useShoppingStore = createListStore<ShoppingItem>('life-shopping')

export interface AnniversaryItem extends BaseItem {
  name: string
  date: string
  /** birthday / anniversary / custom */
  type: 'birthday' | 'anniversary' | 'custom'
  repeatYearly: boolean
}
export const useAnniversaryStore = createListStore<AnniversaryItem>('life-anniversary')

export interface RecipeItem extends BaseItem {
  name: string
  ingredients: string[]
  steps: string
  favorite: boolean
}
export const useRecipeStore = createListStore<RecipeItem>('life-recipe')

export interface WeatherPref {
  city: string
}
const weatherPrefStore = create<WeatherPref>()(
  persist(() => ({ city: '' }), { name: 'scene-tools:life-weather-pref', storage: sceneToolsPersistStorage }),
)
registerPersistedStore(weatherPrefStore)
export const useWeatherPrefStore = weatherPrefStore

export const useLedgerStore = createListStore<LedgerItem>('life-ledger')

// ============================================
// 学习模式 · 数据模型
// ============================================

export interface Flashcard extends BaseItem {
  front: string
  back: string
  deck: string
  /** Leitner 盒子 1-5，越大越熟 */
  box: number
  /** 下次复习时间戳 */
  nextReview: number
  wrongCount: number
  rightCount: number
}
export interface FlashcardState {
  cards: Flashcard[]
  decks: string[]
  addCard: (front: string, back: string, deck: string) => void
  addDeck: (name: string) => void
  removeDeck: (name: string) => void
  updateCard: (id: string, patch: Partial<Flashcard>) => void
  removeCard: (id: string) => void
  /** 复习结果：对 → box+1 且推迟复习；错 → box=1 且今日再复习 */
  review: (id: string, correct: boolean) => void
  importCards: (cards: { front: string; back: string }[], deck: string) => void
}
function leitnerInterval(box: number): number {
  // 1->1天 2->2天 3->4天 4->7天 5->15天
  const days = [1, 2, 4, 7, 15][Math.min(box - 1, 4)]
  return days * 24 * 3600 * 1000
}
const flashcardStore = create<FlashcardState>()(
  persist(
    (set, get) => ({
      cards: [],
      decks: ['默认'],
      addCard: (front, back, deck) =>
        set((s) => ({
          cards: [
            ...s.cards,
            { id: uid('fc'), createdAt: Date.now(), front, back, deck, box: 1, nextReview: Date.now(), wrongCount: 0, rightCount: 0 },
          ],
        })),
      addDeck: (name) => {
        if (get().decks.includes(name)) return
        set({ decks: [...get().decks, name] })
      },
      removeDeck: (name) => set((s) => ({ decks: s.decks.filter((d) => d !== name), cards: s.cards.filter((c) => c.deck !== name) })),
      updateCard: (id, patch) => set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeCard: (id) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),
      review: (id, correct) =>
        set((s) => ({
          cards: s.cards.map((c) => {
            if (c.id !== id) return c
            if (correct) {
              const box = Math.min(5, c.box + 1)
              return { ...c, box, rightCount: c.rightCount + 1, nextReview: Date.now() + leitnerInterval(box) }
            }
            return { ...c, box: 1, wrongCount: c.wrongCount + 1, nextReview: Date.now() + 30 * 60 * 1000 }
          }),
        })),
      importCards: (cards, deck) => {
        get().addDeck(deck)
        set((s) => ({
          cards: [
            ...s.cards,
            ...cards.map((c) => ({ id: uid('fc'), createdAt: Date.now(), front: c.front, back: c.back, deck, box: 1, nextReview: Date.now(), wrongCount: 0, rightCount: 0 })),
          ],
        }))
      },
    }),
    { name: 'scene-tools:study-flashcards', storage: sceneToolsPersistStorage },
  ),
)
registerPersistedStore(flashcardStore)
export const useFlashcardStore = flashcardStore

export interface MistakeItem extends BaseItem {
  subject: string
  question: string
  answer: string
  reason?: string
  /** 待复习 / 已掌握 */
  status: 'open' | 'mastered'
  reviewedAt?: number
}
export const useMistakeStore = createListStore<MistakeItem>('study-mistakes')

export interface StudyNote extends BaseItem {
  title: string
  content: string
  tags: string[]
  updatedAt: number
}
export const useNoteStore = createListStore<StudyNote>('study-notes')

export interface ReadingItem extends BaseItem {
  title: string
  url?: string
  summary?: string
  progress: number
  status: 'reading' | 'done' | 'wish'
}
export const useReadingStore = createListStore<ReadingItem>('study-reading')

export interface PlanTask extends BaseItem {
  /** YYYY-MM-DD */
  date: string
  subject: string
  task: string
  done: boolean
  timeSlot?: string
}
export const usePlanStore = createListStore<PlanTask>('study-plan')

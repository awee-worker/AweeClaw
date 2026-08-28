/**
 * 场景工具 AI 桥接层
 *
 * 将 scene-tools 的 19 个内置工具数据域统一暴露给 AI Agent，
 * 注册 6 个 AI 可调用工具（scene_tools_*）到 toolRegistry。
 *
 * 各工具的 DS 定义和 trackKey 已迁移到 tools/{work,life,study}/ 目录下，
 * 本文件仅负责：事件日志、AI 提示词注入、注册入口。
 */

import type { ToolDefinition, ToolExecutor } from '@shared/protocols/modelGateway'
import { toolRegistry } from '@intelligence/toolkit/toolRegistry'
import {
  useTodoStore,
  usePomodoroStore,
  useMeetingStore,
  useWeeklyReportStore,
  useWorkHourStore,
  useSnippetStore,
  useWaterStore,
  useShoppingStore,
  useLedgerStore,
  useFlashcardStore,
  useMistakeStore,
  useNoteStore,
  useReadingStore,
  usePlanStore,
  todayStr,
} from './stores'
import { allDS, allTrackKeys } from './tools/all'
import type { SceneToolDS } from './factory'

// ============================================
// 注册（幂等）
// ============================================

let registered = false

/** 将场景工具 AI 桥接注册到 toolRegistry（幂等，可重复调用） */
export function registerSceneToolsAgent(): void {
  if (registered) return
  registered = true
  for (const def of SCENE_TOOLS_DEFINITIONS) {
    toolRegistry.registerScenarioTool(def.name, def, EXECUTORS[def.name], { override: true })
  }
}

/** 获取全部 AI 工具定义（供 UI 展示/测试） */
export function getSceneToolsAgentDefinitions(): ToolDefinition[] {
  return SCENE_TOOLS_DEFINITIONS
}

// ============================================
// 场景工具事件日志（AI ⇄ UI 联动）
// ============================================

export interface SceneToolEvent {
  id: string
  ts: number
  tool: string
  toolName: string
  action: 'add' | 'update' | 'delete'
  summary: string
  /** ai = AI Agent 调用；ui = 用户在工具面板操作 */
  source: 'ai' | 'ui'
  /** 去重键（AI 调用与 UI 操作落到同一 store 时避免重复记录） */
  dedupeKey: string
}

const EVT_KEY = 'scene-tools:agent-events'
const EVT_MAX = 50

function readEvents(): SceneToolEvent[] {
  try {
    const raw = localStorage.getItem(EVT_KEY)
    return raw ? (JSON.parse(raw) as SceneToolEvent[]) : []
  } catch {
    return []
  }
}

function pushEvent(evt: Omit<SceneToolEvent, 'id' | 'ts'>): void {
  const list = readEvents()
  list.push({ ...evt, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ts: Date.now() })
  try {
    localStorage.setItem(EVT_KEY, JSON.stringify(list.slice(-EVT_MAX)))
  } catch {
    /* ignore */
  }
}

/** 提取新增条目的摘要文本 */
function summarizeItem(tool: string, item: Record<string, unknown>): string {
  const pick = (keys: string[]) => keys.map((k) => item[k]).find((v) => v !== undefined && v !== '')
  switch (tool) {
    case 'work-todo': {
      const text = pick(['text', 'title'])
      const p = item.priority ? `（${item.priority}）` : ''
      return text ? `新增待办「${text}」${p}` : '新增待办'
    }
    case 'work-meeting': {
      const t = pick(['title'])
      return t ? `新增会议「${t}」` : '新增会议'
    }
    case 'life-ledger': {
      const amount = pick(['amount'])
      const category = item.category ? ` ${item.category}` : ''
      const type = item.type === 'income' ? '收入' : item.type === 'expense' ? '支出' : ''
      return amount !== undefined ? `${type}${category} ¥${amount}` : '新增账单'
    }
    case 'life-water':
      return item.count ? `喝水 +${item.count} 杯` : '喝水打卡'
    case 'study-flashcards': {
      const f = pick(['front'])
      return f ? `新增闪卡「${f}」` : '新增闪卡'
    }
    case 'work-hours': {
      const date = pick(['date'])
      const t = pick(['start', 'end'])
      return date ? `记录工时 ${date}${t ? ` ${t}` : ''}` : '记录工时'
    }
    default: {
      const name = pick(['name', 'title', 'text', 'front', 'content'])
      return name ? `新增「${name}」` : `新增 ${tool}`
    }
  }
}

/** 提取更新 patch 的摘要文本 */
function summarizePatch(_tool: string, patch: Record<string, unknown>): string {
  const flags: string[] = []
  if (patch.status === 'done') flags.push('完成')
  if (patch.status === 'executing') flags.push('执行中')
  if (patch.status === 'mastered') flags.push('已掌握')
  if (patch.correct !== undefined) flags.push(patch.correct ? '复习答对' : '复习答错')
  if (patch.progress !== undefined) flags.push(`进度 ${patch.progress}%`)
  if (patch.amount !== undefined) flags.push(`金额 ${patch.amount}`)
  if (patch.target !== undefined) flags.push(`目标 ${patch.target}`)
  if (flags.length > 0) return flags.join('，')
  const keys = Object.keys(patch).filter((k) => !['id'].includes(k))
  return keys.length > 0 ? `更新 ${keys.slice(0, 3).join('/')}` : '更新条目'
}

// ============================================
// AI 提示词注入辅助（供 PromptComposer 使用）
// ============================================

/** 场景工具使用指南：注入系统提示词，让 AI 知道工具存在与使用时机 */
export function getSceneToolsGuide(mode?: SceneToolDS['mode']): string {
  const list = allDS.filter((d) => !mode || d.mode === mode)
  const modeName = mode ? { work: '工作', life: '生活', study: '学习' }[mode] : '全部'
  const now = new Date()
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  const lines = list.map((d) => `- ${d.id}（${d.name}）：${d.description}`)

  return [
    `\n## 当前时间\n${dateStr}\n用户提到"今天""明天""下周"等相对日期时，请基于上述时间计算。`,
    `## 场景工具（${modeName}）`,
    `你拥有 6 个场景工具操作能力，可读写用户的本地个人数据（免审批）：`,
    `- scene_tools_list：列出所有工具及条目数（探索用）`,
    `- scene_tools_read：读取某工具全部数据`,
    `- scene_tools_add：新增条目`,
    `- scene_tools_update：更新条目（勾选完成、改状态等）`,
    `- scene_tools_delete：删除条目`,
    `- scene_tools_stats：统计（今日专注、待办完成率、收支等）`,
    ``,
    `当用户表达以下意图时，应主动调用对应工具完成，并简短告知结果（如「已添加到待办清单 ✅」）：`,
    `- 记录/查询/修改待办、任务、提醒、今天要做什么 → 操作 work-todo`,
    `- 开会/会议纪要与行动项 → 操作 work-meeting`,
    `- 写周报 → 操作 work-weekly`,
    `- 上下班打卡/工时 → 操作 work-hours`,
    `- 记账/收入/支出/花了多少钱 → 操作 life-ledger`,
    `- 喝水打卡/喝了多少水 → 操作 life-water`,
    `- 购物清单/要买什么 → 操作 life-shopping`,
    `- 记单词/背闪卡 → 操作 study-flashcards`,
    `- 错题记录 → 操作 study-mistakes`,
    `- 学习计划/复习安排 → 操作 study-planner`,
    `- 创建/记录工作计划（周/月/日计划）→ 操作 work-plan`,
    `  work-plan 创建示例（scene_tools_add，tool="work-plan"）：`,
    `  item={planType:"week", title:"下周开发计划", baseDate:"<下周一日期>", entries:[{date:"<下周一>",task:"完成登录模块",priority:"high"},{date:"<下周二>",task:"代码Review",priority:"medium"}]}`,
    `  baseDate 规则：本周→本周一日期；下周→下周一日期；本月→本月1日；下月→下月1日。entries 每条必须有 date 和 task，task 不能为空。`,
    `- 用户的记录类请求（帮我把……记下来/存一下/记一笔）都应落到对应工具`,
    ``,
    `## 任务执行（work-todo）`,
    `当用户在场景工具面板中点击任务的「执行」按钮时，AI 应当：`,
    `1. 先 scene_tools_read 读取 work-todo 的全部待办，找到状态为「executing」的任务`,
    `2. 根据任务文本判断需要执行的操作（搜索信息、写代码、整理文件等）`,
    `3. 调用合适的工具完成实际操作`,
    `4. 完成后调用 scene_tools_update 将任务标记为 done，并在 aiNote 中填写完成摘要`,
    ``,
    `操作原则：\n1. 调用 scene_tools_add 前，必须先调用 scene_tools_read 获取 itemSchema，确认必填字段后再构造 item 对象。\n2. 绝不允许传空对象 {} 或省略必填字段，否则会导致调用失败。\n3. 完成类操作（勾选待办）用 update 传 status:done 字段。`,
    ``,
    `当前可用工具：`,
    ...lines,
  ].join('\n')
}

/** 今日状态快照：注入系统提示词，让 AI 主动感知用户"今天" */
export function getSceneToolsSnapshot(mode?: SceneToolDS['mode']): string {
  const date = todayStr()
  const parts: string[] = []

  if (!mode || mode === 'work') {
    const todos = useTodoStore.getState().items
    const active = todos.filter((i) => i.status !== 'done')
    const overdue = active.filter((i) => i.dueDate && i.dueDate < date)
    const pomos = usePomodoroStore.getState().records.filter((r) => r.kind === 'work' && r.date === date)
    const meetings = useMeetingStore.getState().items.filter((m) => m.date === date && m.status !== 'done')
    const hours = useWorkHourStore.getState().items.filter((h) => h.date === date)
    const bits: string[] = []
    if (todos.length) bits.push(`待办${active.length}/${todos.length}未完成${overdue.length ? `（${overdue.length}逾期）` : ''}`)
    if (pomos.length) bits.push(`专注${pomos.length}次${pomos.reduce((s, r) => s + r.minutes, 0)}分钟`)
    if (meetings.length) bits.push(`会议${meetings.length}个`)
    if (hours.length) bits.push(`工时${hours.length}条`)
    if (bits.length) parts.push(`[工作] ${bits.join('；')}`)
  }

  if (!mode || mode === 'life') {
    const s = useWaterStore.getState()
    const cups = s.cups[date] ?? 0
    const ledger = useLedgerStore.getState().items.filter((i) => i.date === date)
    const expense = ledger.filter((i) => i.type === 'expense').reduce((sum, i) => sum + i.amount, 0)
    const income = ledger.filter((i) => i.type === 'income').reduce((sum, i) => sum + i.amount, 0)
    const shopping = useShoppingStore.getState().items.filter((i) => !i.done)
    const bits: string[] = []
    if (cups > 0) bits.push(`喝水${cups}/${s.target}杯`)
    if (ledger.length) bits.push(`支出¥${expense}${income ? `收入¥${income}` : ''}`)
    if (shopping.length) bits.push(`购物清单${shopping.length}项待买`)
    if (bits.length) parts.push(`[生活] ${bits.join('；')}`)
  }

  if (!mode || mode === 'study') {
    const pomos = usePomodoroStore.getState().records.filter((r) => r.kind === 'study' && r.date === date)
    const fc = useFlashcardStore.getState()
    const dueCards = fc.cards.filter((c) => c.nextReview <= Date.now())
    const mistakes = useMistakeStore.getState().items.filter((i) => i.status === 'open')
    const plans = usePlanStore.getState().items.filter((p) => p.date === date && !p.done)
    const bits: string[] = []
    if (pomos.length) bits.push(`学习${pomos.length}次${pomos.reduce((s, r) => s + r.minutes, 0)}分钟`)
    if (dueCards.length) bits.push(`闪卡${dueCards.length}张待复习`)
    if (mistakes.length) bits.push(`错题${mistakes.length}道未掌握`)
    if (plans.length) bits.push(`计划${plans.length}项未完成`)
    if (bits.length) parts.push(`[学习] ${bits.join('；')}`)
  }

  if (parts.length === 0) return ''
  return `## 今日数据速览（${date}）\n${parts.join('\n')}\n（数据来自本地场景工具，仅作参考，回答时结合用户当前问题使用）`
}

/** 最近工具动态：注入系统提示词，让 AI 衔接用户刚在工具里的操作 */
export function getSceneToolsRecentEvents(limit = 5): string {
  const events = readEvents().slice(-limit).reverse()
  if (events.length === 0) return ''
  const lines = events.map((e) => {
    const hhmm = new Date(e.ts).toTimeString().slice(0, 5)
    const tag = e.source === 'ai' ? 'AI' : '用户'
    return `- [${hhmm}][${tag}] ${e.toolName}：${e.summary}`
  })
  return `## 场景工具最近动态\n${lines.join('\n')}`
}

/**
 * 订阅各场景工具 store，将用户在 UI 上的操作记录为事件（供 AI 感知）。
 * 返回取消订阅函数。AI 调用产生的 store 变化会通过 dedupeKey 去重跳过。
 */
export function initSceneToolEventTracking(): () => void {
  const unsubs: Array<() => void> = []

  const track = <T extends { items: unknown[] }>(
    store: { getState: () => T; subscribe: (fn: (state: T) => void) => () => void },
    tool: string,
    toolName: string,
    keyOf: (item: any) => string,
  ): void => {
    let prev = new Map<string, any>()
    try {
      prev = new Map((store.getState().items as any[]).map((i) => [i.id, i]))
    } catch {
      /* store 无 items，跳过 */
    }

    const unsub = store.subscribe((state) => {
      const nextItems = (state as { items?: unknown[] }).items ?? []
      const next = new Map<string, any>(nextItems.map((i: any) => [i.id, i]))

      for (const [id, item] of next) {
        if (!prev.has(id)) {
          emitUI(tool, toolName, 'add', summarizeItem(tool, item ?? {}), id)
        }
      }
      for (const [id, oldItem] of prev) {
        if (!next.has(id)) {
          emitUI(tool, toolName, 'delete', `删除「${keyOf(oldItem)}」`, id)
        }
      }
      for (const [id, item] of next) {
        const p = prev.get(id)
        if (p) {
          const changed = Object.keys(item).filter((k) => item[k] !== p[k])
          if (changed.length > 0) {
            const patch: Record<string, unknown> = {}
            for (const k of changed) patch[k] = item[k]
            const summary = summarizePatch(tool, patch)
            if (summary !== '更新条目') {
              emitUI(tool, toolName, 'update', `「${keyOf(item)}」${summary}`, id)
            }
          }
        }
      }
      prev = next
    })
    unsubs.push(unsub)
  }

  const emitUI = (tool: string, toolName: string, action: SceneToolEvent['action'], summary: string, id: string): void => {
    const key = `${tool}:${action}:${id}`
    // 2 分钟内 AI 已记录过同 key 事件（AI 调用触发的 store 变化）则跳过，避免重复
    const dup = readEvents().some((e) => e.source === 'ai' && e.dedupeKey === key && Date.now() - e.ts < 120000)
    if (dup) return
    pushEvent({ tool, toolName, action, summary, source: 'ui', dedupeKey: key })
  }

  // 工作
  track(useTodoStore, 'work-todo', '待办清单', allTrackKeys['work-todo'])
  track(useMeetingStore, 'work-meeting', '会议助手', allTrackKeys['work-meeting'])
  track(useWeeklyReportStore, 'work-weekly', '周报生成器', allTrackKeys['work-weekly'])
  track(useWorkHourStore, 'work-hours', '工时记录', allTrackKeys['work-hours'])
  track(useSnippetStore, 'work-snippets', '快捷话术库', allTrackKeys['work-snippets'])
  // 生活
  track(useLedgerStore, 'life-ledger', '记账本', allTrackKeys['life-ledger'])
  track(useShoppingStore, 'life-shopping', '购物清单', allTrackKeys['life-shopping'])
  // 学习
  track(useMistakeStore, 'study-mistakes', '错题本', allTrackKeys['study-mistakes'])
  track(useNoteStore, 'study-notes', '笔记库', allTrackKeys['study-notes'])
  track(useReadingStore, 'study-reader', '阅读助手', allTrackKeys['study-reader'])
  track(usePlanStore, 'study-planner', '学习计划表', allTrackKeys['study-planner'])

  return () => unsubs.forEach((u) => u())
}

// ============================================
// 工具定义与执行器
// ============================================

function okResult(data: unknown): { success: boolean; result: string } {
  return { success: true, result: JSON.stringify(data, null, 2) }
}

function failResult(error: string): { success: boolean; result: string; error: string } {
  return { success: false, result: '', error }
}

function getDS(toolId: string): SceneToolDS | undefined {
  return allDS.find((d) => d.id === toolId)
}

const EXECUTORS: Record<string, ToolExecutor> = {
  /** 列出所有场景工具及其摘要 */
  scene_tools_list: async (args) => {
    const mode = args.mode as string | undefined
    const tools = allDS.filter((d) => !mode || d.mode === mode)
    return okResult({
      total: tools.length,
      tools: tools.map((d) => {
        const data = d.read()
        const count = Array.isArray(data) ? data.length : (data as { records?: unknown[] })?.records?.length
        return {
          id: d.id,
          name: d.name,
          mode: d.mode,
          description: d.description,
          itemCount: count ?? '—',
        }
      }),
    })
  },

  /** 读取指定工具数据 */
  scene_tools_read: async (args) => {
    const ds = getDS(String(args.tool ?? ''))
    if (!ds) return failResult(`未知工具 "${args.tool}"。可用：${allDS.map((d) => d.id).join(', ')}`)
    const data = ds.read()
    return okResult({ tool: ds.id, name: ds.name, data, itemSchema: ds.itemSchema })
  },

  /** 新增条目 */
  scene_tools_add: async (args) => {
    const ds = getDS(String(args.tool ?? ''))
    if (!ds) return failResult(`未知工具 "${args.tool}"`)
    if (!ds.add) return failResult(`工具 "${ds.name}" 不支持新增`)
    const item = (args.item as Record<string, unknown>) || {}
    if (typeof item !== 'object' || Array.isArray(item)) return failResult('item 必须为对象')
    const res = ds.add(item)
    if (!res.ok) return failResult(res.error || '新增失败')
    const data = ds.read()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aweeclaw:scene-tool-open', { detail: ds.id }))
      window.dispatchEvent(new CustomEvent('aweeclaw:scene-panel-open', { detail: ds.id }))
    }
    pushEvent({
      tool: ds.id,
      toolName: ds.name,
      action: 'add',
      summary: summarizeItem(ds.id, item),
      source: 'ai',
      dedupeKey: `${ds.id}:add:${res.id ?? ''}`,
    })
    return okResult({ tool: ds.id, added: true, id: res.id, data })
  },

  /** 更新条目 */
  scene_tools_update: async (args) => {
    const ds = getDS(String(args.tool ?? ''))
    if (!ds) return failResult(`未知工具 "${args.tool}"`)
    if (!ds.update) return failResult(`工具 "${ds.name}" 不支持更新`)
    const id = String(args.id ?? '')
    if (!id) return failResult('缺少 id')
    const patch = (args.patch as Record<string, unknown>) || {}
    const res = ds.update(id, patch)
    if (!res.ok) return failResult(res.error || '更新失败')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aweeclaw:scene-tool-open', { detail: ds.id }))
      window.dispatchEvent(new CustomEvent('aweeclaw:scene-panel-open', { detail: ds.id }))
    }
    pushEvent({
      tool: ds.id,
      toolName: ds.name,
      action: 'update',
      summary: summarizePatch(ds.id, patch),
      source: 'ai',
      dedupeKey: `${ds.id}:update:${id}`,
    })
    return okResult({ tool: ds.id, updated: true, id })
  },

  /** 删除条目 */
  scene_tools_delete: async (args) => {
    const ds = getDS(String(args.tool ?? ''))
    if (!ds) return failResult(`未知工具 "${args.tool}"`)
    if (!ds.remove) return failResult(`工具 "${ds.name}" 不支持删除`)
    const id = String(args.id ?? '')
    if (!id) return failResult('缺少 id')
    const res = ds.remove(id)
    if (!res.ok) return failResult(res.error || '删除失败')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aweeclaw:scene-tool-open', { detail: ds.id }))
      window.dispatchEvent(new CustomEvent('aweeclaw:scene-panel-open', { detail: ds.id }))
    }
    pushEvent({
      tool: ds.id,
      toolName: ds.name,
      action: 'delete',
      summary: `删除条目 ${id.slice(0, 8)}…`,
      source: 'ai',
      dedupeKey: `${ds.id}:delete:${id}`,
    })
    return okResult({ tool: ds.id, deleted: true, id })
  },

  /** 统计 */
  scene_tools_stats: async (args) => {
    const tool = args.tool as string | undefined
    const date = (args.date as string) || todayStr()
    const stats: Record<string, unknown> = {}

    if (!tool || tool === 'work-todo') {
      const items = useTodoStore.getState().items
      const active = items.filter((i) => i.status !== 'done')
      stats['work-todo'] = {
        total: items.length,
        active: active.length,
        done: items.length - active.length,
        executing: items.filter((i) => i.status === 'executing').length,
        overdue: active.filter((i) => i.dueDate && i.dueDate < date).length,
        completionRate: items.length ? Math.round((items.length - active.length) / items.length * 100) : 0,
      }
    }
    if (!tool || tool === 'work-pomodoro') {
      const records = usePomodoroStore.getState().records.filter((r) => r.kind === 'work' && r.date === date)
      stats['work-pomodoro'] = { date, count: records.length, minutes: records.reduce((s, r) => s + r.minutes, 0) }
    }
    if (!tool || tool === 'study-pomodoro') {
      const records = usePomodoroStore.getState().records.filter((r) => r.kind === 'study' && r.date === date)
      stats['study-pomodoro'] = { date, count: records.length, minutes: records.reduce((s, r) => s + r.minutes, 0) }
    }
    if (!tool || tool === 'life-ledger') {
      const items = useLedgerStore.getState().items.filter((i) => i.date === date)
      const income = items.filter((i) => i.type === 'income').reduce((s, i) => s + i.amount, 0)
      const expense = items.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amount, 0)
      stats['life-ledger'] = { date, income, expense, balance: income - expense }
    }
    if (!tool || tool === 'life-water') {
      const s = useWaterStore.getState()
      stats['life-water'] = { date, cups: s.cups[date] ?? 0, target: s.target, progress: s.target ? Math.round((s.cups[date] ?? 0) / s.target * 100) : 0 }
    }
    if (!tool || tool === 'study-mistakes') {
      const items = useMistakeStore.getState().items
      stats['study-mistakes'] = { open: items.filter((i) => i.status === 'open').length, mastered: items.filter((i) => i.status === 'mastered').length }
    }
    if (!tool || tool === 'study-flashcards') {
      const s = useFlashcardStore.getState()
      const due = s.cards.filter((c) => c.nextReview <= Date.now()).length
      stats['study-flashcards'] = { total: s.cards.length, dueNow: due, decks: s.decks.length }
    }

    return okResult({ date, stats })
  },
}

const SCENE_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'scene_tools_list',
    description: 'List all scene tools (todo list, pomodoro, ledger, flashcards, etc.) with their item counts. Use this first to discover what data is available. Optionally filter by mode: work/life/study.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'Filter by scene mode: work / life / study', enum: ['work', 'life', 'study'] },
      },
    },
  },
  {
    name: 'scene_tools_read',
    description: 'Read full data of a scene tool, including all entries and the item schema for adding. Use the returned id values for later update/delete. Tools: work-todo, work-pomodoro, work-meeting, work-weekly, work-files, work-hours, work-snippets, life-ledger, life-water, life-mood, life-shopping, life-anniversary, life-recipe, study-flashcards, study-pomodoro, study-mistakes, study-notes, study-reader, study-planner.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id (e.g. work-todo, life-ledger)', enum: allDS.map((d) => d.id) },
      },
      required: ['tool'],
    },
  },
  {
    name: 'scene_tools_add',
    description: 'Add a new entry to a scene tool. ⚠️ IMPORTANT: You MUST call scene_tools_read FIRST to get the itemSchema for the specific tool, then construct the item object with all required fields. Never pass an empty object {}. Examples: {tool:"work-todo", item:{text:"完成登录",priority:"high",dueDate:"2026-09-01"}}, {tool:"life-ledger", item:{amount:50,type:"expense",category:"餐饮"}}, {tool:"study-flashcards", item:{front:"什么是闭包",back:"函数可以引用其外部作用域的变量"}}.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id', enum: allDS.map((d) => d.id) },
        item: {
          type: 'object',
          description: `⚠️ 必须先调用 scene_tools_read 获取该工具的 itemSchema，再按 schema 构造 item 对象。不允许传空对象 {}。各工具字段如下：\n${allDS.map((d) => `[${d.id}] ${d.itemSchema}`).join('\n')}`,
        },
      },
      required: ['tool', 'item'],
    },
  },
  {
    name: 'scene_tools_update',
    description: 'Update an existing entry by id. Get the id from scene_tools_read. Examples: mark todo done {status:"done"}, change meeting status, update flashcard review {review:true, correct:false}. Some tools have special ids (e.g. pomodoro "settings", water "target").',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id', enum: allDS.map((d) => d.id) },
        id: { type: 'string', description: 'Entry id (or special id like "settings")' },
        patch: { type: 'object', description: 'Fields to update' },
      },
      required: ['tool', 'id', 'patch'],
    },
  },
  {
    name: 'scene_tools_delete',
    description: 'Delete an entry by id. For water tool, id is the date string YYYY-MM-DD to reset that day.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id', enum: allDS.map((d) => d.id) },
        id: { type: 'string', description: 'Entry id to delete' },
      },
      required: ['tool', 'id'],
    },
  },
  {
    name: 'scene_tools_stats',
    description: 'Get statistics for a scene tool (or all tools if omitted): todo completion rate, today pomodoro count/minutes, today ledger income/expense, water progress, mistake book counts, flashcards due. Pass date as YYYY-MM-DD to query a specific day.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id (optional — omit for all)', enum: allDS.map((d) => d.id) },
        date: { type: 'string', description: 'Date YYYY-MM-DD (default today)' },
      },
    },
  },
]

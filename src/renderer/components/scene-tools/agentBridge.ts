/**
 * 场景工具 AI 桥接层
 *
 * 将 scene-tools 的 21 个内置工具数据域统一暴露给 AI Agent，
 * 注册 6 个 AI 可调用工具（scene_tools_*）到 toolRegistry。
 *
 * 设计原则：
 * - 不按工具拆 21 个工具（避免模型选择困难），而是按「数据域操作」暴露通用 CRUD
 * - 全部 approvalType='none'：纯本地数据操作，无外部副作用，无需审批
 * - 幂等注册：registerSceneToolsAgent() 可重复调用
 *
 * AI 联动链路（AI ⇄ 场景工具双向紧密联动）：
 * 1. 工具可见性：toolCategoryDefs.SCENE_TOOL_NAMES 将 scene_tools_* 加入
 *    getToolsForContext 白名单 → BuiltinToolProvider.getToolDefinitions() 会把
 *    这 6 个工具定义注入 LLM 的 tools 参数（AI 真正可调用）。
 * 2. 使用指南：getSceneToolsGuide() 注入 Agent/Plan 系统提示词，
 *    告诉 AI 工具存在、何时主动调用（记录待办/记账/会议等意图）。
 * 3. 今日快照：getSceneToolsSnapshot() 注入今日数据速览，
 *    让 AI 主动感知用户"今天"的状态（未完成待办、喝水进度、待复习闪卡等）。
 * 4. 最近动态：事件日志（localStorage）记录 AI/UI 两侧的工具操作，
 *    getSceneToolsRecentEvents() 让 AI 衔接用户刚在工具面板里的操作。
 * 5. UI 事件跟踪：initSceneToolEventTracking() 订阅各 store，
 *    用户 UI 操作自动记录事件（AI 调用触发的变化通过 dedupeKey 去重）。
 *
 * 使用方式（对 AI 的提示）：
 * - scene_tools_list    → 查看有哪些工具、各自条目数
 * - scene_tools_read    → 读取某工具数据（含全部字段样例）
 * - scene_tools_add     → 新增条目
 * - scene_tools_update  → 更新条目（含勾选完成、改状态）
 * - scene_tools_delete  → 删除条目
 * - scene_tools_stats   → 统计（今日专注、待办完成率、收支等）
 */

import type { ToolDefinition, ToolExecutor } from '@shared/protocols/modelGateway'
import { toolRegistry } from '@intelligence/toolkit/toolRegistry'
import {
  useTodoStore,
  usePomodoroStore,
  useMeetingStore,
  useWeeklyReportStore,
  useFileRuleStore,
  useWorkHourStore,
  useSnippetStore,
  useWaterStore,
  useMoodStore,
  useShoppingStore,
  useAnniversaryStore,
  useRecipeStore,
  useLedgerStore,
  useFlashcardStore,
  useMistakeStore,
  useNoteStore,
  useReadingStore,
  usePlanStore,
  todayStr,
} from './stores'

// ============================================
// 数据域注册表
// ============================================

type OpResult = { ok: boolean; id?: string; error?: string }

interface SceneToolDS {
  id: string
  name: string
  mode: 'work' | 'life' | 'study'
  description: string
  /** 新增条目时接受的字段说明（给 LLM 看） */
  itemSchema: string
  read: () => unknown
  add?: (item: Record<string, unknown>) => OpResult
  update?: (id: string, patch: Record<string, unknown>) => OpResult
  remove?: (id: string) => OpResult
}

/** 通用 list store 适配器（any 规避具体 Omit 类型的逆变不兼容） */
interface ListStoreLike {
  items: unknown[]
  add: (item: any) => { id?: string }
  update: (id: string, patch: any) => void
  remove: (id: string) => void
}

function listDS(
  id: string,
  name: string,
  mode: SceneToolDS['mode'],
  description: string,
  itemSchema: string,
  getStore: () => ListStoreLike,
  opts?: { readTransform?: (items: unknown[]) => unknown },
): SceneToolDS {
  return {
    id,
    name,
    mode,
    description,
    itemSchema,
    read: () => {
      const items = getStore().items
      return opts?.readTransform ? opts.readTransform(items) : items
    },
    add: (item) => {
      try {
        const created = getStore().add(item)
        return { ok: true, id: created?.id }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    update: (id2, patch) => {
      try {
        getStore().update(id2, patch)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    remove: (id2) => {
      try {
        getStore().remove(id2)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}

/** 番茄钟（工作/学习共用一套 store，kind 区分） */
function pomodoroDS(kind: 'work' | 'study'): SceneToolDS {
  return {
    id: kind === 'work' ? 'work-pomodoro' : 'study-pomodoro',
    name: kind === 'work' ? '番茄专注钟' : '学习番茄钟',
    mode: kind === 'work' ? 'work' : 'study',
    description: kind === 'work'
      ? '番茄专注钟：专注/休息循环计时，专注记录自动沉淀'
      : '学习番茄钟：分科目专注计时，进入学习时长统计',
    itemSchema: 'add: { minutes: number, date?: "YYYY-MM-DD"(默认今天), subject?: string } 直接补记一条专注记录；update: { id: "settings", patch 字段 focusMin/breakMin/longBreakMin/roundsBeforeLongBreak }',
    read: () => {
      const s = usePomodoroStore.getState()
      const records = s.records.filter((r) => r.kind === kind)
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
        // 直接写入 records（通过 setState 追加，避免启动计时器）
        const st = usePomodoroStore.getState()
        const rec = {
          id: `ai_${Date.now().toString(36)}`,
          createdAt: Date.now(),
          date,
          minutes,
          kind,
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
          const next: typeof cur = { ...cur }
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
}

/** 喝水打卡（特殊状态 store） */
const waterDS: SceneToolDS = {
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

/** 闪卡（特殊状态 store） */
const flashcardDS: SceneToolDS = {
  id: 'study-flashcards',
  name: '闪卡复习',
  mode: 'study',
  description: '闪卡复习：间隔重复记忆（Leitner 盒子 1-5）',
  itemSchema: 'add: { front: string, back: string, deck?: string(默认"默认") }；update: { id: 卡片id, patch { front/back/deck } } 或 { id: 卡片id, patch { review: true, correct: boolean } } 记录复习结果',
  read: () => {
    const s = useFlashcardStore.getState()
    return {
      decks: s.decks,
      cards: s.cards.map((c) => ({
        id: c.id,
        front: c.front,
        back: c.back,
        deck: c.deck,
        box: c.box,
        nextReview: new Date(c.nextReview).toISOString().slice(0, 10),
        wrongCount: c.wrongCount,
        rightCount: c.rightCount,
      })),
    }
  },
  add: (item) => {
    const front = String(item.front ?? '').trim()
    const back = String(item.back ?? '').trim()
    if (!front || !back) return { ok: false, error: 'front 和 back 均必填' }
    const deck = String(item.deck ?? '默认').trim() || '默认'
    useFlashcardStore.getState().addCard(front, back, deck)
    return { ok: true }
  },
  update: (id, patch) => {
    const s = useFlashcardStore.getState()
    const card = s.cards.find((c) => c.id === id)
    if (!card) return { ok: false, error: `未找到卡片 ${id}` }
    if (patch.review !== undefined) {
      s.review(id, Boolean(patch.correct))
      return { ok: true }
    }
    const clean: Partial<{ front: string; back: string; deck: string }> = {}
    if (typeof patch.front === 'string') clean.front = patch.front
    if (typeof patch.back === 'string') clean.back = patch.back
    if (typeof patch.deck === 'string') clean.deck = patch.deck
    s.updateCard(id, clean)
    return { ok: true }
  },
  remove: (id) => {
    useFlashcardStore.getState().removeCard(id)
    return { ok: true }
  },
}

/** 全部数据域 */
const SCENE_TOOL_DS: SceneToolDS[] = [
  // ---- 工作 ----
// ============================================
// 工具定义与执行器
// ============================================
  pomodoroDS('work'),
  listDS('work-meeting', '会议助手', 'work', '会议：会前准备（目标/议程）、纪要、行动项',
    'add: { title: string(必填), date?: "YYYY-MM-DD", goal?, agenda?, notes?, actionItems?: string[] }；update 支持 status(pending/done)/goal/agenda/notes/actionItems',
    () => useMeetingStore.getState()),
  listDS('work-weekly', '周报生成器', 'work', '周报：按周保存的周报内容',
    'add: { weekStart: "YYYY-MM-DD"(周一), content: string }',
    () => useWeeklyReportStore.getState()),
  listDS('work-files', '文件整理助手', 'work', '文件整理规则：按关键词归类文件',
    'add: { name: string, keywords: string[], targetDir: string }',
    () => useFileRuleStore.getState()),
  listDS('work-hours', '工时记录', 'work', '上下班打卡、加班统计',
    'add: { date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM", note?: string }',
    () => useWorkHourStore.getState()),
  listDS('work-snippets', '快捷话术库', 'work', '常用邮件模板与回复话术',
    'add: { title: string, content: string, category: string }',
    () => useSnippetStore.getState()),
  // ---- 生活 ----
  listDS('life-ledger', '记账本', 'life', '收支记录、分类统计',
    'add: { amount: number(必填, 正数), type: "income"|"expense"(必填), category: string(必填), date?: "YYYY-MM-DD", note?: string }；update 支持 amount/type/category/note',
    () => useLedgerStore.getState()),
  waterDS,
  listDS('life-mood', '心情日记', 'life', '情绪打卡（1-5）+ 一句话日记',
    'add: { mood: number(1-5, 必填), text?: string, date?: "YYYY-MM-DD" }',
    () => useMoodStore.getState()),
  listDS('life-shopping', '购物清单', 'life', '可勾选的采购清单',
    'add: { name: string(必填), note?: string }；update 支持 done(boolean)',
    () => useShoppingStore.getState()),
  listDS('life-anniversary', '纪念日提醒', 'life', '生日与纪念日倒计时',
    'add: { name: string(必填), date: string(必填, 如 "1990-05-20" 或 "05-20"), type?: "birthday"|"anniversary"|"custom", repeatYearly?: boolean }',
    () => useAnniversaryStore.getState()),
  listDS('life-recipe', '菜谱推荐', 'life', '家常菜谱收藏与做法',
    'add: { name: string(必填), ingredients: string[], steps: string, favorite?: boolean }',
    () => useRecipeStore.getState()),
  // ---- 学习 ----
  flashcardDS,
  pomodoroDS('study'),
  listDS('study-mistakes', '错题本', 'study', '错题记录与定期重做',
    'add: { subject: string(必填), question: string(必填), answer: string(必填), reason?: string, status?: "open"|"mastered" }；update 支持 status/reason/answer',
    () => useMistakeStore.getState()),
  listDS('study-notes', '笔记库', 'study', 'Markdown 笔记与标签',
    'add: { title: string(必填), content: string, tags?: string[] }',
    () => useNoteStore.getState()),
  listDS('study-reader', '阅读助手', 'study', '阅读清单、摘要与进度',
    'add: { title: string(必填), url?: string, summary?: string, progress?: number(0-100), status?: "wish"|"reading"|"done" }；update 支持 progress/status/summary',
    () => useReadingStore.getState()),
  listDS('study-planner', '学习计划表', 'study', '周计划排布与完成统计',
    'add: { date: "YYYY-MM-DD"(必填), subject: string(必填), task: string(必填), done?: boolean, timeSlot?: string }；update 支持 done/subject/task/timeSlot',
    () => usePlanStore.getState()),
]

function getDS(toolId: string): SceneToolDS | undefined {
  return SCENE_TOOL_DS.find((d) => d.id === toolId)
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

const EXECUTORS: Record<string, ToolExecutor> = {
  /** 列出所有场景工具及其摘要 */
  scene_tools_list: async (args) => {
    const mode = args.mode as string | undefined
    const tools = SCENE_TOOL_DS.filter((d) => !mode || d.mode === mode)
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
    if (!ds) return failResult(`未知工具 "${args.tool}"。可用：${SCENE_TOOL_DS.map((d) => d.id).join(', ')}`)
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
    pushEvent({
      tool: ds.id,
      toolName: ds.name,
      action: 'add',
      summary: summarizeItem(ds.id, item),
      source: 'ai',
      dedupeKey: `${ds.id}:add:${res.id ?? ''}`,
    })
    return okResult({ tool: ds.id, added: true, id: res.id, itemSchema: ds.itemSchema, current: data })
  },

  /** 更新条目 */
  scene_tools_update: async (args) => {
    const ds = getDS(String(args.tool ?? ''))
    if (!ds) return failResult(`未知工具 "${args.tool}"`)
    if (!ds.update) return failResult(`工具 "${ds.name}" 不支持更新`)
    const id = String(args.id ?? '')
    const patch = (args.patch as Record<string, unknown>) || {}
    if (!id) return failResult('缺少 id')
    if (typeof patch !== 'object' || Array.isArray(patch)) return failResult('patch 必须为对象')
    const res = ds.update(id, patch)
    if (!res.ok) return failResult(res.error || '更新失败')
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
    pushEvent({
      tool: ds.id,
      toolName: ds.name,
      action: 'delete',
      summary: `删除条目 ${id}`,
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
      const active = items.filter((i) => !i.done)
      stats['work-todo'] = {
        total: items.length,
        active: active.length,
        done: items.length - active.length,
        overdue: active.filter((i) => i.dueDate && i.dueDate < date).length,
        completionRate: items.length ? Math.round((items.length - active.length) / items.length * 100) : 0,
      }
    }
    if (!tool || tool === 'work-pomodoro') {
      const records = usePomodoroStore.getState().records.filter((r) => r.kind === 'work' && r.date === date)
      stats['work-pomodoro'] = {
        date,
        count: records.length,
        minutes: records.reduce((s, r) => s + r.minutes, 0),
      }
    }
    if (!tool || tool === 'study-pomodoro') {
      const records = usePomodoroStore.getState().records.filter((r) => r.kind === 'study' && r.date === date)
      stats['study-pomodoro'] = {
        date,
        count: records.length,
        minutes: records.reduce((s, r) => s + r.minutes, 0),
      }
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
        tool: { type: 'string', description: 'Scene tool id (e.g. work-todo, life-ledger)', enum: SCENE_TOOL_DS.map((d) => d.id) },
      },
      required: ['tool'],
    },
  },
  {
    name: 'scene_tools_add',
    description: 'Add a new entry to a scene tool. The item object fields depend on the tool — call scene_tools_read first to get the itemSchema. Examples: add a todo {text, priority, dueDate}, record an expense {amount, type:"expense", category}, add a flashcard {front, back}.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id', enum: SCENE_TOOL_DS.map((d) => d.id) },
        item: { type: 'object', description: 'Entry fields (see itemSchema from scene_tools_read)' },
      },
      required: ['tool', 'item'],
    },
  },
  {
    name: 'scene_tools_update',
    description: 'Update an existing entry by id. Get the id from scene_tools_read. Examples: mark todo done {done:true}, change meeting status, update flashcard review {review:true, correct:false}. Some tools have special ids (e.g. pomodoro "settings", water "target").',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Scene tool id', enum: SCENE_TOOL_DS.map((d) => d.id) },
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
        tool: { type: 'string', description: 'Scene tool id', enum: SCENE_TOOL_DS.map((d) => d.id) },
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
        tool: { type: 'string', description: 'Scene tool id (optional — omit for all)', enum: SCENE_TOOL_DS.map((d) => d.id) },
        date: { type: 'string', description: 'Date YYYY-MM-DD (default today)' },
      },
    },
  },
]

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
  list.push({ ...evt, id: uid('evt'), ts: Date.now() })
  try {
    localStorage.setItem(EVT_KEY, JSON.stringify(list.slice(-EVT_MAX)))
  } catch {
    // 存储失败静默
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
function summarizePatch(tool: string, patch: Record<string, unknown>): string {
  const flags: string[] = []
  if (patch.done === true) flags.push('完成')
  if (patch.done === false) flags.push('标记未完成')
  if (patch.status === 'done') flags.push('状态→完成')
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
  const list = SCENE_TOOL_DS.filter((d) => !mode || d.mode === mode)
  const modeName = mode ? { work: '工作', life: '生活', study: '学习' }[mode] : '全部'
  const lines = list.map((d) => `- ${d.id}（${d.name}）：${d.description}`)

  return [
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
    `- 用户的记录类请求（帮我把……记下来/存一下/记一笔）都应落到对应工具`,
    ``,
    `操作原则：先 scene_tools_read 看数据再增改；add 时按 itemSchema 提供完整字段；完成类操作（勾选待办）用 update 传 done/status 字段。`,
    ``,
    `当前可用工具：`,
    ...lines,
  ].join('\n')
}

/** 今日状态快照：注入系统提示词，让 AI 主动感知用户"今天" */
export function getSceneToolsSnapshot(mode?: SceneToolDS['mode']): string {
  const date = todayStr()
  const parts: string[] = []
  const today = () => date

  if (!mode || mode === 'work') {
    const todos = useTodoStore.getState().items
    const active = todos.filter((i) => !i.done)
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
  track(useTodoStore, 'work-todo', '待办清单', (i) => i?.text ?? i?.id ?? '')
  track(useMeetingStore, 'work-meeting', '会议助手', (i) => i?.title ?? i?.id ?? '')
  track(useWeeklyReportStore, 'work-weekly', '周报生成器', (i) => `周报 ${i?.weekStart ?? ''}`)
  track(useWorkHourStore, 'work-hours', '工时记录', (i) => `工时 ${i?.date ?? ''}`)
  track(useSnippetStore, 'work-snippets', '快捷话术库', (i) => i?.title ?? i?.id ?? '')
  // 生活
  track(useLedgerStore, 'life-ledger', '记账本', (i) => `${i?.category ?? ''} ¥${i?.amount ?? ''}`)
  track(useShoppingStore, 'life-shopping', '购物清单', (i) => i?.name ?? i?.id ?? '')
  track(useAnniversaryStore, 'life-anniversary', '纪念日提醒', (i) => i?.name ?? i?.id ?? '')
  track(useRecipeStore, 'life-recipe', '菜谱推荐', (i) => i?.name ?? i?.id ?? '')
  // 学习
  track(useMistakeStore, 'study-mistakes', '错题本', (i) => i?.question?.slice(0, 20) ?? i?.id ?? '')
  track(useNoteStore, 'study-notes', '笔记库', (i) => i?.title ?? i?.id ?? '')
  track(useReadingStore, 'study-reader', '阅读助手', (i) => i?.title ?? i?.id ?? '')
  track(usePlanStore, 'study-planner', '学习计划表', (i) => `${i?.subject ?? ''} ${i?.task ?? ''}`)

  return () => unsubs.forEach((u) => u())
}

/**
 * 周报生成器 — 工作模式增强工具
 *
 * 功能：选择周 → 自动汇总该周完成待办 + 专注时长 → 生成周报草稿 → 手动编辑/复制
 */

import { useMemo, useState } from 'react'
import { FileText, CalendarRange, Copy, Check, Sparkles, Save, Loader2 } from 'lucide-react'
import { useTodoStore, usePomodoroStore, useWeeklyReportStore } from '../stores'
import { runLlmText, isLlmConfigured } from '../sceneToolsLlm'

function mondayOf(date: Date): string {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // 周一=0
  d.setDate(d.getDate() - day)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day2 = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day2}`
}

export default function WorkWeeklyReport() {
  const todos = useTodoStore((s) => s.items)
  const pomoRecords = usePomodoroStore((s) => s.records)
  const { items: reports, add } = useWeeklyReportStore()

  const [weekStart, setWeekStart] = useState(mondayOf(new Date()))
  const [editing, setEditing] = useState('')
  const [copied, setCopied] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  // 本周范围
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [weekStart])

  const inWeek = (ts: number) => {
    const day = new Date(ts)
    const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return ds >= weekStart && ds <= weekEnd
  }

  const weekTodos = useMemo(() => todos.filter((t) => inWeek(t.createdAt)), [todos, weekStart])
  const doneTodos = weekTodos.filter((t) => t.status === 'done')
  const weekPomos = useMemo(() => pomoRecords.filter((r) => inWeek(r.createdAt) && r.kind === 'work'), [pomoRecords, weekStart])
  const totalFocusMin = weekPomos.reduce((s, r) => s + r.minutes, 0)

  const generate = () => {
    const lines: string[] = []
    lines.push(`# 本周工作周报（${weekStart} ~ ${weekEnd}）`)
    lines.push('')
    lines.push('## 一、本周完成')
    if (doneTodos.length === 0) lines.push('- （暂无已完成任务）')
    else doneTodos.forEach((t) => lines.push(`- ${t.text}`))
    lines.push('')
    lines.push('## 二、专注投入')
    lines.push(`- 完成 ${weekPomos.length} 个番茄专注，合计约 ${totalFocusMin} 分钟`)
    lines.push('')
    lines.push('## 三、进行中')
    weekTodos.filter((t) => t.status !== 'done').forEach((t) => lines.push(`- [ ] ${t.text}`))
    lines.push('')
    lines.push('## 四、下周计划')
    lines.push('- ')
    lines.push('')
    lines.push('## 五、问题与风险')
    lines.push('- ')
    setEditing(lines.join('\n'))
  }

  /** AI 生成周报：基于本周待办与专注数据，生成正式工作周报 */
  const aiGenerate = async () => {
    if (!isLlmConfigured()) {
      setAiError('未配置 LLM：请在设置中填写 API Key 或开启云模式')
      return
    }
    setAiLoading(true)
    setAiError('')
    try {
      const data = {
        weekRange: `${weekStart} ~ ${weekEnd}`,
        doneTodos: doneTodos.map((t) => t.text),
        pendingTodos: weekTodos.filter((t) => t.status !== 'done').map((t) => t.text),
        focusSessions: weekPomos.length,
        focusMinutes: totalFocusMin,
      }
      const system =
        '你是资深研发团队周报助手。根据用户提供的本周数据生成正式工作周报，格式：\n' +
        '# 本周工作周报（周范围）\n\n## 一、本周完成\n（条目式，将完成事项归类归纳为 2-4 条有信息量的总结）\n\n## 二、专注投入\n（一句话概括专注时长与节奏）\n\n## 三、进行中\n（条目式）\n\n## 四、下周计划\n（条目式，具体可执行）\n\n## 五、问题与风险\n（如无则写「无」）\n\n' +
        '要求：基于数据事实，不要虚构；语言简洁专业；只输出周报正文。'
      const user = `本周数据：\n${JSON.stringify(data, null, 2)}`
      const report = await runLlmText({ systemPrompt: system, userPrompt: user })
      if (!report) {
        setAiError('AI 未返回内容，请重试')
        return
      }
      setEditing(report)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(editing)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用时忽略 */ }
  }

  const save = () => {
    if (!editing.trim()) return
    add({ weekStart, content: editing.trim() })
  }

  const existing = reports.find((r) => r.weekStart === weekStart)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <FileText className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">周报生成器</span>
      </div>

      {/* 周选择 */}
      <div className="flex items-center gap-2 mb-3">
        <CalendarRange className="w-4 h-4 text-text-muted flex-shrink-0" />
        <input
          type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)}
          className="flex-1 text-[12px] px-2 py-1 rounded-md bg-surface border border-border/50 text-text-muted focus:outline-none"
        />
        <button
          onClick={generate}
          title="本地模板快速生成"
          className="px-2.5 py-1 rounded-md border border-border/60 text-[12px] text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
        >
          模板生成
        </button>
        <button
          onClick={aiGenerate}
          disabled={aiLoading}
          title="AI 基于本周数据生成正式周报"
          className="px-2.5 py-1 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI 生成
        </button>
      </div>

      {/* 数据概览 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="px-2 py-1.5 rounded-lg bg-surface/70 border border-border/40 text-center">
          <div className="text-[15px] font-semibold text-accent">{doneTodos.length}</div>
          <div className="text-[12px] text-text-muted">完成待办</div>
        </div>
        <div className="px-2 py-1.5 rounded-lg bg-surface/70 border border-border/40 text-center">
          <div className="text-[15px] font-semibold text-emerald-500">{weekPomos.length}</div>
          <div className="text-[12px] text-text-muted">专注番茄</div>
        </div>
        <div className="px-2 py-1.5 rounded-lg bg-surface/70 border border-border/40 text-center">
          <div className="text-[15px] font-semibold text-sky-500">{Math.round(totalFocusMin / 60 * 10) / 10}h</div>
          <div className="text-[12px] text-text-muted">专注时长</div>
        </div>
      </div>

      {/* 编辑区 */}
      <textarea
        value={editing || existing?.content || ''}
        onChange={(e) => setEditing(e.target.value)}
        placeholder="点击「生成」自动汇总本周数据，也可手动编辑…"
        rows={14}
        className="flex-1 w-full text-[12px] px-2.5 py-2 rounded-lg bg-surface border border-border/50 focus:outline-none focus:border-accent/60 resize-none leading-relaxed font-mono"
      />

      {/* 操作 */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={copy}
          className="px-2.5 py-1 rounded-md border border-border/60 text-[12px] text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />} 复制
        </button>
        <button
          onClick={save}
          className="px-2.5 py-1 rounded-md bg-accent/10 text-accent text-[12px] hover:bg-accent/20 transition-colors flex items-center gap-1"
        >
          <Save className="w-3 h-3" /> 保存
        </button>
        {existing && <span className="text-[12px] text-emerald-500">已保存 · 重新生成会覆盖</span>}
        {aiError && <span className="text-[12px] text-red-500">{aiError}</span>}
      </div>
    </div>
  )
}

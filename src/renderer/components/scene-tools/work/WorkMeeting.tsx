/**
 * 会议助手 — 工作模式核心工具
 *
 * 功能：会前准备卡片（目标/议程）、会中要点记录、会后行动项管理
 * 数据：行动项可导出供待办清单使用（source 标记）
 */

import { useState } from 'react'
import { Users, Plus, CheckCircle2, Circle, ListChecks, Target, CalendarDays, Trash2, ChevronRight, ClipboardList, Sparkles, Loader2 } from 'lucide-react'
import { useMeetingStore, useTodoStore, todayStr } from '../stores'
import { runLlmText, isLlmConfigured } from '../sceneToolsLlm'

export default function WorkMeeting() {
  const { items, add, update, remove } = useMeetingStore()
  const addTodo = useTodoStore((s) => s.add)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayStr())
  const [goal, setGoal] = useState('')
  const [agenda, setAgenda] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : -1))
  const selected = items.find((i) => i.id === selectedId) ?? null

  const handleCreate = () => {
    if (!title.trim()) return
    const item = add({
      title: title.trim(),
      date,
      goal: goal.trim() || undefined,
      agenda: agenda.trim() || undefined,
      notes: '',
      actionItems: [],
      status: 'pending',
    })
    setTitle('')
    setGoal('')
    setAgenda('')
    setShowForm(false)
    setSelectedId(item.id)
  }

  const selectMeeting = (id: string) => {
    setSelectedId(id)
    const m = items.find((i) => i.id === id)
    setNoteDraft(m?.notes ?? '')
    setActionDraft('')
  }

  const saveNotes = () => {
    if (selected) update(selected.id, { notes: noteDraft })
  }

  const addAction = () => {
    if (!selected || !actionDraft.trim()) return
    update(selected.id, { actionItems: [...selected.actionItems, actionDraft.trim()] })
    setActionDraft('')
  }

  const toggleAction = (idx: number) => {
    if (!selected) return
    const next = selected.actionItems.map((a, i) => (i === idx ? `✅ ${a.replace(/^✅ /, '')}` : a.replace(/^✅ /, '')))
    update(selected.id, { actionItems: next })
  }

  const exportActions = () => {
    if (!selected) return
    selected.actionItems.filter((a) => !a.startsWith('✅')).forEach((a) => {
      addTodo({ text: `[会议] ${selected.title}：${a}`, status: 'pending', priority: 'medium', source: 'meeting' })
    })
    update(selected.id, { actionItems: selected.actionItems.map((a) => `✅ ${a.replace(/^✅ /, '')}`) })
  }

  /** AI 生成会议纪要：基于会前准备信息 + 现有草稿，生成结构化纪要并提取行动项 */
  const aiGenerateNotes = async () => {
    if (!selected) return
    if (!isLlmConfigured()) {
      setAiError('未配置 LLM：请在设置中填写 API Key 或开启云模式')
      return
    }
    setAiLoading(true)
    setAiError('')
    try {
      const context = {
        title: selected.title,
        date: selected.date,
        goal: selected.goal || '',
        agenda: selected.agenda || '',
        draftNotes: noteDraft || selected.notes || '',
      }
      const system =
        '你是专业的会议纪要助手。根据提供的会议信息生成结构化中文会议纪要，格式：\n' +
        '## 会议结论\n（要点列表）\n\n## 关键讨论\n（要点列表）\n\n## 行动项\n' +
        '（每人一项，格式：- [ ] 负责人：任务内容（截止 月/日））\n\n' +
        '要求：结论和讨论来自会前准备信息与草稿的合理推断；行动项必须具体可执行；只输出纪要正文，不要解释。'
      const user = `会议信息：\n${JSON.stringify(context, null, 2)}`
      const generated = await runLlmText({ systemPrompt: system, userPrompt: user })
      if (!generated) {
        setAiError('AI 未返回内容，请重试')
        return
      }
      update(selected.id, { notes: generated })
      setNoteDraft(generated)
      // 从纪要中提取行动项并合并（去重）
      const items = Array.from(generated.matchAll(/^[-*]\s*\[[ .xX]?]\s*(.+)$/gm)).map((m) => m[1].trim())
      if (items.length > 0) {
        const existing = selected.actionItems.map((a) => a.replace(/^✅ /, ''))
        const fresh = items.filter((t) => !existing.includes(t))
        if (fresh.length > 0) update(selected.id, { actionItems: [...selected.actionItems, ...fresh] })
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Users className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">会议助手</span>
        <span className="text-[12px] text-text-muted">{items.length} 场</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* 新增表单 */}
      {showForm && (
        <div className="space-y-2 mb-3 p-2.5 rounded-lg bg-surface border border-border/50">
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="会议标题 *"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none focus:border-accent/60"
          />
          <div className="flex gap-2">
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="flex-1 text-[12px] px-2 py-1 rounded-md bg-background border border-border/60 text-text-muted"
            />
            <input
              value={goal} onChange={(e) => setGoal(e.target.value)}
              placeholder="会议目标（会前准备）"
              className="flex-1 text-[12px] px-2 py-1 rounded-md bg-background border border-border/60 focus:outline-none"
            />
          </div>
          <textarea
            value={agenda} onChange={(e) => setAgenda(e.target.value)}
            placeholder="议程（一行一个议题）"
            rows={2}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none"
          />
          <button
            onClick={handleCreate}
            className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity"
          >
            创建会议
          </button>
        </div>
      )}

      {/* 会议列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-1">
        {sorted.length === 0 && !showForm && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">暂无会议记录</div>
        )}
        {sorted.map((m) => (
          <button
            key={m.id}
            onClick={() => selectMeeting(m.id)}
            className={`w-full text-left px-2 py-2 rounded-lg border transition-colors ${
              selectedId === m.id ? 'border-accent/40 bg-accent/5' : 'border-border/40 hover:bg-surface/60'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.status === 'done' ? 'bg-emerald-500' : 'bg-accent'}`} />
              <span className="flex-1 text-[12px] font-medium truncate">{m.title}</span>
              <ChevronRight className={`w-3 h-3 text-text-muted flex-shrink-0 ${selectedId === m.id ? 'rotate-90' : ''}`} />
            </div>
            <div className="flex items-center gap-2 mt-1 text-[12px] text-text-muted">
              <CalendarDays className="w-3 h-3" /> {m.date}
              {m.actionItems.length > 0 && (
                <span className="flex items-center gap-0.5">
                  <ListChecks className="w-3 h-3" /> {m.actionItems.filter((a) => !a.startsWith('✅')).length} 待办
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* 详情区 */}
      {selected && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-2">
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-accent" />
            <span className="text-[12px] font-medium">会议目标</span>
            <button
              onClick={() => update(selected.id, { status: selected.status === 'done' ? 'pending' : 'done' })}
              className={`ml-auto text-[12px] px-1.5 py-0.5 rounded-full border ${
                selected.status === 'done' ? 'text-emerald-500 border-emerald-500/40' : 'text-text-muted border-border/60'
              }`}
            >
              {selected.status === 'done' ? '已完成' : '进行中'}
            </button>
          </div>
          <p className="text-[12px] text-text-muted leading-relaxed">{selected.goal || '未填写'}</p>
          {selected.agenda && (
            <>
              <div className="text-[12px] font-medium">议程</div>
              <div className="text-[12px] text-text-muted whitespace-pre-line leading-relaxed">{selected.agenda}</div>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="记录会议要点…"
              rows={3}
              className="flex-1 w-full text-[12px] px-2 py-1.5 rounded-md bg-surface border border-border/50 focus:outline-none focus:border-accent/60 resize-none"
            />
            <button
              onClick={aiGenerateNotes}
              disabled={aiLoading}
              title="基于会前准备与草稿，AI 生成结构化纪要 + 行动项"
              className="self-stretch px-2 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[12px] flex flex-col items-center justify-center gap-0.5 hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>AI 纪要</span>
            </button>
          </div>
          {aiError && <div className="text-[12px] text-red-500">{aiError}</div>}
          {/* 行动项 */}
          <div className="flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5 text-accent" />
            <span className="text-[12px] font-medium">行动项</span>
            <button
              onClick={exportActions}
              className="ml-auto text-[12px] px-1.5 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors flex items-center gap-0.5"
            >
              <ClipboardList className="w-2.5 h-2.5" /> 全部加入待办
            </button>
            <button onClick={() => remove(selected.id)} className="text-text-muted hover:text-red-500 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1">
            {selected.actionItems.map((a, idx) => {
              const done = a.startsWith('✅')
              return (
                <div key={idx} className="flex items-center gap-1.5 px-1 text-[12px]">
                  <button onClick={() => toggleAction(idx)} className="text-text-muted hover:text-accent transition-colors">
                    {done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Circle className="w-3.5 h-3.5" />}
                  </button>
                  <span className={done ? 'line-through text-text-muted' : ''}>{a.replace(/^✅ /, '')}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-1.5">
            <input
              value={actionDraft} onChange={(e) => setActionDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAction()}
              placeholder="添加行动项…"
              className="flex-1 text-[12px] px-2 py-1 rounded-md bg-surface border border-border/50 focus:outline-none focus:border-accent/60"
            />
            <button onClick={addAction} className="px-2 py-1 rounded-md bg-accent/10 text-accent text-[12px] hover:bg-accent/20 transition-colors">
              添加
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

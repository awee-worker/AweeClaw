/**
 * 工时记录 — 工作模式增强工具
 *
 * 功能：上班/下班打卡、点击时间弹出选择器手动修正、补录历史记录、工时统计
 */

import { useMemo, useState } from 'react'
import { Clock, LogIn, LogOut, Trash2, Plus, Check, X } from 'lucide-react'
import { useWorkHourStore, todayStr, type WorkHourItem } from '../stores'

function nowHM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function diffMin(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, eh * 60 + em - sh * 60 - sm)
}

/** 正在编辑的时间字段 */
interface EditingField {
  id: string
  field: 'start' | 'end'
}

export default function WorkHours() {
  const { items, add, remove, update } = useWorkHourStore()
  const [note, setNote] = useState('')
  const today = todayStr()
  const todayRecord = items.find((i) => i.date === today)

  // 时间选择器状态：点击开始/结束时间 → 进入编辑态 → 弹出原生时间选择器
  const [editing, setEditing] = useState<EditingField | null>(null)
  const [draftTime, setDraftTime] = useState('')

  // 补录表单状态
  const [showBackfill, setShowBackfill] = useState(false)
  const [bfDate, setBfDate] = useState(today)
  const [bfStart, setBfStart] = useState('09:00')
  const [bfEnd, setBfEnd] = useState('18:00')
  const [bfNote, setBfNote] = useState('')
  const [bfError, setBfError] = useState('')

  const clockIn = () => {
    if (todayRecord) return
    add({ date: today, start: nowHM(), end: '', note: note.trim() || undefined })
    setNote('')
  }

  const clockOut = () => {
    if (!todayRecord) return
    update(todayRecord.id, { end: nowHM() })
  }

  // 开始编辑某个时间字段
  const openEditor = (id: string, field: 'start' | 'end', current: string) => {
    setEditing({ id, field })
    setDraftTime(current || nowHM())
  }

  // 确认时间修改
  const commitTime = () => {
    if (!editing) return
    const item = items.find((i) => i.id === editing.id)
    if (!item) {
      setEditing(null)
      return
    }
    const nextStart = editing.field === 'start' ? draftTime : item.start
    const nextEnd = editing.field === 'end' ? draftTime : item.end
    update(item.id, { start: nextStart, end: nextEnd })
    setEditing(null)
  }

  const cancelEdit = () => setEditing(null)

  // 补录一条历史记录
  const handleBackfill = () => {
    if (!bfDate) {
      setBfError('请选择日期')
      return
    }
    if (!bfStart) {
      setBfError('请选择开始时间')
      return
    }
    if (bfEnd && bfStart >= bfEnd) {
      setBfError('结束时间需晚于开始时间')
      return
    }
    if (items.some((i) => i.date === bfDate)) {
      setBfError(`${bfDate} 已有记录，可在列表中点时间修正`)
      return
    }
    add({ date: bfDate, start: bfStart, end: bfEnd || '', note: bfNote.trim() || undefined })
    setBfNote('')
    setBfError('')
    setShowBackfill(false)
  }

  const totalMin = useMemo(() => {
    return items.filter((i) => i.end).reduce((s, i) => s + diffMin(i.start, i.end), 0)
  }, [items])

  const fmtHours = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`

  // 可点击的时间块（显示态或编辑态）
  const TimeBlock = ({ item, field }: { item?: WorkHourItem; field: 'start' | 'end' }) => {
    const isEditing = !!editing && editing.id === item?.id && editing.field === field
    const value = item?.[field] || '--:--'
    if (isEditing) {
      return (
        <div className="flex items-center gap-1 justify-center">
          <input
            type="time"
            autoFocus
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            onBlur={commitTime}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTime()
              if (e.key === 'Escape') cancelEdit()
            }}
            className="w-[86px] text-[14px] font-semibold tabular-nums bg-transparent text-accent focus:outline-none [color-scheme:dark]"
          />
          <Check className="w-3.5 h-3.5 text-emerald-500 cursor-pointer" onMouseDown={(e) => e.preventDefault()} onClick={commitTime} />
          <X className="w-3.5 h-3.5 text-text-muted hover:text-red-500 cursor-pointer" onMouseDown={(e) => e.preventDefault()} onClick={cancelEdit} />
        </div>
      )
    }
    return (
      <button
        onClick={() => item && openEditor(item.id, field, item[field])}
        title="点击修正时间"
        className={`${item ? 'hover:text-accent cursor-pointer' : 'cursor-default'} transition-colors`}
      >
        {value}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Clock className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">工时记录</span>
        <span className="text-[12px] text-text-muted">累计 {fmtHours(totalMin)}</span>
        <button
          onClick={() => setShowBackfill((v) => !v)}
          className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[12px] hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> 补录
        </button>
      </div>

      {/* 今日打卡 */}
      <div className="p-3 rounded-xl bg-surface/70 border border-border/40 mb-3">
        <div className="text-[12px] text-text-muted mb-2">今日 · {today}</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="px-2 py-1.5 rounded-lg bg-background border border-border/40 text-center">
            <div className="text-[12px] text-text-muted">上班</div>
            <div className="text-[16px] font-semibold tabular-nums">
              <TimeBlock item={todayRecord} field="start" />
            </div>
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-background border border-border/40 text-center">
            <div className="text-[12px] text-text-muted">下班</div>
            <div className="text-[16px] font-semibold tabular-nums">
              <TimeBlock item={todayRecord} field="end" />
            </div>
          </div>
        </div>
        {todayRecord?.end && (
          <div className="text-center text-[12px] text-emerald-500 mb-2">
            今日工时 {fmtHours(diffMin(todayRecord.start, todayRecord.end))}
          </div>
        )}
        <div className="flex gap-2">
          {!todayRecord && (
            <>
              <input
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="备注（可选）"
                className="flex-1 text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/50 focus:outline-none"
              />
              <button onClick={clockIn} className="px-3 py-1.5 rounded-md bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity">
                <LogIn className="w-3 h-3" /> 上班打卡
              </button>
            </>
          )}
          {todayRecord && !todayRecord.end && (
            <button onClick={clockOut} className="w-full py-1.5 rounded-md bg-emerald-500 text-white text-[12px] flex items-center justify-center gap-1 hover:opacity-90 transition-opacity">
              <LogOut className="w-3 h-3" /> 下班打卡
            </button>
          )}
          {todayRecord?.end && (
            <div className="w-full text-center text-[12px] text-text-muted/70 py-1">今日已打卡，点击时间可修正</div>
          )}
        </div>
      </div>

      {/* 补录表单 */}
      {showBackfill && (
        <div className="space-y-2 mb-3 p-2.5 rounded-xl bg-surface/70 border border-border/40">
          <input
            type="date" value={bfDate} onChange={(e) => setBfDate(e.target.value)}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/50 text-text-muted [color-scheme:dark]"
          />
          <div className="flex items-center gap-2">
            <label className="text-[12px] text-text-muted flex-1 flex items-center justify-between gap-1">
              开始
              <input
                type="time" value={bfStart} onChange={(e) => setBfStart(e.target.value)}
                className="text-[12px] px-2 py-1 rounded-md bg-background border border-border/50 tabular-nums [color-scheme:dark]"
              />
            </label>
            <label className="text-[12px] text-text-muted flex-1 flex items-center justify-between gap-1">
              结束
              <input
                type="time" value={bfEnd} onChange={(e) => setBfEnd(e.target.value)}
                className="text-[12px] px-2 py-1 rounded-md bg-background border border-border/50 tabular-nums [color-scheme:dark]"
              />
            </label>
          </div>
          <input
            value={bfNote} onChange={(e) => setBfNote(e.target.value)}
            placeholder="备注（可选）"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/50 focus:outline-none"
          />
          {bfError && <div className="text-[12px] text-red-500">{bfError}</div>}
          <button
            onClick={handleBackfill}
            className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity"
          >
            保存补录
          </button>
        </div>
      )}

      {/* 历史 */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        <div className="text-[12px] text-text-muted mb-1">历史记录（点击时间可修正）</div>
        {items.length === 0 && <div className="text-center text-[12px] text-text-muted/60 py-6">暂无记录</div>}
        {[...items].sort((a, b) => (a.date < b.date ? 1 : -1)).map((i) => (
          <div key={i.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/40">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] tabular-nums">{i.date}</div>
              <div className="text-[12px] text-text-muted">
                <button
                  onClick={() => openEditor(i.id, 'start', i.start)}
                  className="tabular-nums hover:text-accent transition-colors"
                >
                  {i.start}
                </button>
                {' - '}
                <button
                  onClick={() => openEditor(i.id, 'end', i.end)}
                  className={`tabular-nums transition-colors ${i.end ? 'hover:text-accent' : ''}`}
                >
                  {i.end || '未下班'}
                </button>
                {i.end && ` · ${fmtHours(diffMin(i.start, i.end))}`}
                {i.note && ` · ${i.note}`}
              </div>
            </div>
            <button onClick={() => remove(i.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}


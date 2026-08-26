/**
 * 记账本 — 生活模式核心工具
 *
 * 功能：收支记录、分类管理、月度统计与占比
 */

import { useMemo, useState } from 'react'
import { Wallet, Plus, Trash2, TrendingUp, TrendingDown, PieChart } from 'lucide-react'
import { useLedgerStore, todayStr } from '../stores'

const EXPENSE_CATS = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '其他']
const INCOME_CATS = ['工资', '奖金', '理财', '其他']

export default function LifeLedger() {
  const { items, add, remove } = useLedgerStore()
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [category, setCategory] = useState('餐饮')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayStr())
  const [month, setMonth] = useState(todayStr().slice(0, 7))

  const cats = type === 'expense' ? EXPENSE_CATS : INCOME_CATS

  const handleAdd = () => {
    const n = Number(amount)
    if (!n || n <= 0) return
    add({ amount: Math.round(n * 100) / 100, type, category, note: note.trim() || undefined, date })
    setAmount('')
    setNote('')
  }

  const monthItems = useMemo(() => items.filter((i) => i.date.startsWith(month)), [items, month])
  const expense = monthItems.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amount, 0)
  const income = monthItems.filter((i) => i.type === 'income').reduce((s, i) => s + i.amount, 0)

  const catStats = useMemo(() => {
    const map = new Map<string, number>()
    monthItems.filter((i) => i.type === 'expense').forEach((i) => map.set(i.category, (map.get(i.category) ?? 0) + i.amount))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [monthItems])

  const sorted = useMemo(() => [...items].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30), [items])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Wallet className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">记账本</span>
      </div>

      {/* 月度统计 */}
      <div className="p-3 rounded-xl bg-surface/70 border border-border/40 mb-3">
        <input
          type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="text-[11px] px-2 py-0.5 rounded-md bg-background border border-border/50 text-text-muted mb-2"
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[10px] text-text-muted flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" /> 收入</div>
            <div className="text-[15px] font-semibold text-emerald-500">¥{income.toFixed(0)}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted flex items-center gap-0.5"><TrendingDown className="w-2.5 h-2.5" /> 支出</div>
            <div className="text-[15px] font-semibold text-red-500">¥{expense.toFixed(0)}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted flex items-center gap-0.5"><PieChart className="w-2.5 h-2.5" /> 结余</div>
            <div className="text-[15px] font-semibold text-accent">¥{(income - expense).toFixed(0)}</div>
          </div>
        </div>
        {catStats.length > 0 && (
          <div className="mt-2 space-y-1">
            {catStats.slice(0, 4).map(([c, v]) => (
              <div key={c} className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted w-8 flex-shrink-0">{c}</span>
                <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
                  <div className="h-full rounded-full bg-accent/70" style={{ width: `${expense > 0 ? (v / expense) * 100 : 0}%` }} />
                </div>
                <span className="text-[10px] text-text-muted w-12 text-right flex-shrink-0">¥{v.toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新增 */}
      <div className="p-2.5 rounded-xl bg-surface/70 border border-border/40 mb-3 space-y-2">
        <div className="flex gap-1">
          <button onClick={() => { setType('expense'); setCategory('餐饮') }}
            className={`flex-1 py-1 rounded-md text-[12px] transition-colors ${type === 'expense' ? 'bg-red-500/10 text-red-500' : 'text-text-muted hover:text-text-primary'}`}>
            支出
          </button>
          <button onClick={() => { setType('income'); setCategory('工资') }}
            className={`flex-1 py-1 rounded-md text-[12px] transition-colors ${type === 'income' ? 'bg-emerald-500/10 text-emerald-500' : 'text-text-muted hover:text-text-primary'}`}>
            收入
          </button>
        </div>
        <div className="flex gap-2">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金额"
            className="w-24 text-[13px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="flex-1 text-[11px] px-1.5 py-1.5 rounded-md bg-background border border-border/60 text-text-muted focus:outline-none">
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="text-[11px] px-1.5 py-1.5 rounded-md bg-background border border-border/60 text-text-muted" />
        </div>
        <div className="flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）"
            className="flex-1 text-[11px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <button onClick={handleAdd} className="px-3 py-1.5 rounded-md bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity">
            <Plus className="w-3 h-3" /> 记一笔
          </button>
        </div>
      </div>

      {/* 最近记录 */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        <div className="text-[11px] text-text-muted mb-1">最近记录</div>
        {sorted.length === 0 && <div className="text-center text-[12px] text-text-muted/60 py-6">还没有记账记录</div>}
        {sorted.map((i) => (
          <div key={i.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/40">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i.type === 'expense' ? 'bg-red-500' : 'bg-emerald-500'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] truncate">{i.category}{i.note ? ` · ${i.note}` : ''}</div>
              <div className="text-[10px] text-text-muted">{i.date}</div>
            </div>
            <span className={`text-[12px] font-medium tabular-nums ${i.type === 'expense' ? 'text-red-500' : 'text-emerald-500'}`}>
              {i.type === 'expense' ? '-' : '+'}¥{i.amount.toFixed(2)}
            </span>
            <button onClick={() => remove(i.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 购物清单 — 生活模式增强工具
 *
 * 功能：新增采购项、勾选完成、按分类统计
 */

import { useState } from 'react'
import { ShoppingCart, Plus, Check, Trash2, ShoppingBasket } from 'lucide-react'
import { useShoppingStore } from '../stores'

export default function LifeShopping() {
  const { items, add, update, remove, reset } = useShoppingStore()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')

  const active = items.filter((i) => !i.done)
  const done = items.filter((i) => i.done)

  const handleAdd = () => {
    if (!name.trim()) return
    add({ name: name.trim(), done: false, note: note.trim() || undefined })
    setName('')
    setNote('')
  }

  const renderItem = (item: { id: string; name: string; done: boolean; note?: string }) => (
    <div key={item.id} className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/40 ${item.done ? 'opacity-50' : ''}`}>
      <button
        onClick={() => update(item.id, { done: !item.done })}
        className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
          item.done ? 'bg-accent border-accent text-white' : 'border-border hover:border-accent/60'
        }`}
      >
        {item.done && <Check className="w-2.5 h-2.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[12px] truncate ${item.done ? 'line-through text-text-muted' : ''}`}>{item.name}</div>
        {item.note && <div className="text-[10px] text-text-muted truncate">{item.note}</div>}
      </div>
      <button onClick={() => remove(item.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <ShoppingCart className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">购物清单</span>
        <span className="text-[11px] text-text-muted">{active.length} 待购 · {done.length} 已购</span>
        {items.length > 0 && (
          <button onClick={reset} className="ml-auto text-[10px] text-text-muted hover:text-red-500 transition-colors">
            清空
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="要买什么？"
          className="flex-1 text-[12px] px-2.5 py-1.5 rounded-lg bg-surface border border-border/60 focus:outline-none"
        />
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="备注"
          className="w-20 text-[11px] px-2 py-1.5 rounded-lg bg-surface border border-border/60 focus:outline-none"
        />
        <button onClick={handleAdd} className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {items.length === 0 && (
          <div className="text-center text-[12px] text-text-muted/60 py-8 flex flex-col items-center gap-2">
            <ShoppingBasket className="w-8 h-8 opacity-40" />
            清单是空的
          </div>
        )}
        {active.map(renderItem)}
        {done.length > 0 && (
          <>
            <div className="text-[10px] text-text-muted mt-3 mb-1">已购 ({done.length})</div>
            {done.map(renderItem)}
          </>
        )}
      </div>
    </div>
  )
}

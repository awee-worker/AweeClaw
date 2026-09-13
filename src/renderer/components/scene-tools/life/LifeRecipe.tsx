/**
 * 菜谱推荐 — 生活模式增强工具
 *
 * 功能：菜谱收藏、食材列表、做法步骤、收藏切换
 */

import { useState } from 'react'
import { ChefHat, Plus, Trash2, Heart, ListChecks, BookOpen } from 'lucide-react'
import { useRecipeStore } from '../stores'

export default function LifeRecipe() {
  const { items, add, update, remove } = useRecipeStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [ingredients, setIngredients] = useState('')
  const [steps, setSteps] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const favCount = items.filter((i) => i.favorite).length

  const handleAdd = () => {
    if (!name.trim()) return
    const item = add({
      name: name.trim(),
      ingredients: ingredients.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      steps: steps.trim(),
      favorite: false,
    })
    setName('')
    setIngredients('')
    setSteps('')
    setShowForm(false)
    setSelectedId(item.id)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <ChefHat className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">菜谱推荐</span>
        <span className="text-[12px] text-text-muted">{items.length} 道 · {favCount} 收藏</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 mb-3 p-2.5 rounded-lg bg-surface border border-border/50">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="菜名，如：番茄炒蛋"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <input value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="食材，逗号分隔：番茄, 鸡蛋, 葱"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="做法步骤…" rows={3}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            保存菜谱
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {items.length === 0 && !showForm && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">收藏你的拿手菜与心仪菜谱</div>
        )}
        {items.map((r) => (
          <div key={r.id} className={`px-2 py-2 rounded-lg border transition-colors ${selectedId === r.id ? 'border-accent/40 bg-accent/5' : 'border-border/40'}`}>
            <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setSelectedId(r.id)}>
              <span className="flex-1 text-[12px] font-medium truncate">{r.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); update(r.id, { favorite: !r.favorite }) }}
                className={`transition-colors ${r.favorite ? 'text-rose-500' : 'text-text-muted hover:text-rose-500'}`}
              >
                <Heart className={`w-3.5 h-3.5 ${r.favorite ? 'fill-current' : ''}`} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); remove(r.id) }} className="opacity-0 hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {selectedId === r.id && (
              <div className="mt-2 space-y-2">
                <div>
                  <div className="text-[12px] text-text-muted flex items-center gap-1 mb-1"><ListChecks className="w-3 h-3" /> 食材</div>
                  <div className="flex gap-1 flex-wrap">
                    {r.ingredients.map((ing, i) => (
                      <span key={i} className="text-[12px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">{ing}</span>
                    ))}
                  </div>
                </div>
                {r.steps && (
                  <div>
                    <div className="text-[12px] text-text-muted flex items-center gap-1 mb-1"><BookOpen className="w-3 h-3" /> 做法</div>
                    <div className="text-[12px] text-text-muted whitespace-pre-line leading-relaxed">{r.steps}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

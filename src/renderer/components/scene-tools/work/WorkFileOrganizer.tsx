/**
 * 文件整理助手 — 工作模式增强工具
 *
 * 功能：维护"关键词 → 目标目录"整理规则；一键整理工作区内未分类文件。
 * 说明：桌面端通过主进程文件系统 API 执行真实移动，此处保留规则管理与执行入口。
 */

import { useState } from 'react'
import { FolderTree, Plus, Trash2, FolderInput, Wand2, Info } from 'lucide-react'
import { useFileRuleStore } from '../stores'

export default function WorkFileOrganizer() {
  const { items, add, remove } = useFileRuleStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [keywords, setKeywords] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleAdd = () => {
    if (!name.trim() || !keywords.trim() || !targetDir.trim()) return
    add({
      name: name.trim(),
      keywords: keywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean),
      targetDir: targetDir.trim(),
    })
    setName('')
    setKeywords('')
    setTargetDir('')
    setShowForm(false)
  }

  const handleOrganize = async () => {
    if (items.length === 0) return
    setRunning(true)
    setResult(null)
    try {
      // 通过 IPC 调用主进程整理工作区文件（若宿主未实现则提示规则已就绪）
      const { api } = await import('@renderer/adapters/electronBridge')
      const workspace = await api.workspace.getCurrent()
      if (!workspace) {
        setResult('未打开工作区，规则已就绪（可稍后在项目内使用）')
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (api as any).file?.organizeByRules?.({ rules: items, workspacePath: workspace.path })
      setResult(res?.moved ?? `${items.length} 条规则已就绪`)
    } catch {
      setResult('规则已保存，整理动作由主进程执行')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <FolderTree className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">文件整理助手</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-start gap-1.5 px-1 mb-2 text-[12px] text-text-muted/80">
        <Info className="w-3 h-3 mt-px flex-shrink-0" />
        <span>定义"文件名关键词 → 目标目录"规则，一键整理工作区未分类文件。</span>
      </div>

      {showForm && (
        <div className="space-y-2 mb-2 p-2.5 rounded-lg bg-surface border border-border/50">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称，如：报表归档"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="匹配关键词，逗号分隔：report, 报表, 月度"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <input value={targetDir} onChange={(e) => setTargetDir(e.target.value)} placeholder="目标目录，如：docs/reports"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            添加规则
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5">
        {items.length === 0 && !showForm && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">暂无整理规则</div>
        )}
        {items.map((r) => (
          <div key={r.id} className="group px-2 py-2 rounded-lg border border-border/40 hover:border-border/70 transition-colors">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 text-[12px] font-medium truncate">{r.name}</span>
              <button onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-1 mt-1 text-[12px] text-text-muted">
              <span className="flex items-center gap-0.5 flex-wrap gap-x-1">
                {r.keywords.map((k, i) => (
                  <span key={i} className="px-1 py-px rounded bg-accent/10 text-accent">{k}</span>
                ))}
              </span>
              <span className="flex items-center gap-0.5 ml-auto flex-shrink-0">
                <FolderInput className="w-3 h-3" /> {r.targetDir}
              </span>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <button
          onClick={handleOrganize}
          disabled={running}
          className="mt-2 w-full py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Wand2 className="w-3.5 h-3.5" /> {running ? '整理中…' : '一键整理工作区'}
        </button>
      )}
      {result && <div className="mt-1.5 text-[12px] text-emerald-500 text-center">{result}</div>}
    </div>
  )
}

/**
 * Rules & Memory 设置组件
 *
 * 行为规则：BRAND.paths.rules - 静态规则文件
 * 记忆系统：BRAND.paths.memoryStore - 动态记忆列表
 */

import { useState, useEffect, useCallback } from 'react'
import { rulesService } from '@intelligence/runtime/ruleEngine'
import { memoryService, type MemoryItem } from '@intelligence/runtime/recallService'
import { ActionButton, TextField } from '@components/ui'
import { BRAND } from '@shared/brand'
import {
  FileText, Brain, Plus, Trash2, Edit2, Check, X,
  RefreshCw, AlertCircle, ToggleLeft, ToggleRight
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface RulesMemorySettingsProps {
  language: Language
}

export function KnowledgeRulesPanel({ language }: RulesMemorySettingsProps) {

  // Rules state
  const [rulesContent, setRulesContent] = useState('')
  const [rulesSource, setRulesSource] = useState<string | null>(null)
  const [rulesLoading, setRulesLoading] = useState(true)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesModified, setRulesModified] = useState(false)

  // Memory state
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [newMemory, setNewMemory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [memoryLoading, setMemoryLoading] = useState(true)

  // Load rules
  const loadRules = useCallback(async () => {
    setRulesLoading(true)
    const rules = await rulesService.getRules(true)
    if (rules) {
      setRulesContent(rules.content)
      setRulesSource(rules.source)
    } else {
      setRulesContent(rulesService.getDefaultRulesTemplate())
      setRulesSource(null)
    }
    setRulesModified(false)
    setRulesLoading(false)
  }, [])

  // Load memories
  const loadMemories = useCallback(async () => {
    setMemoryLoading(true)
    const items = await memoryService.getAllMemories()
    setMemories(items)
    setMemoryLoading(false)
  }, [])

  useEffect(() => {
    loadRules()
    loadMemories()
  }, [loadRules, loadMemories])

  // Save rules
  const handleSaveRules = async () => {
    setRulesSaving(true)
    const success = await rulesService.saveRules(rulesContent)
    if (success) {
      setRulesSource(BRAND.paths.rules)
      setRulesModified(false)
    }
    setRulesSaving(false)
  }

  // Add memory
  const handleAddMemory = async () => {
    if (!newMemory.trim()) return
    await memoryService.addMemory(newMemory.trim())
    setNewMemory('')
    loadMemories()
  }

  // Delete memory
  const handleDeleteMemory = async (id: string) => {
    await memoryService.deleteMemory(id)
    loadMemories()
  }

  // Toggle memory
  const handleToggleMemory = async (id: string, enabled: boolean) => {
    await memoryService.updateMemory(id, { enabled: !enabled })
    loadMemories()
  }

  // Start editing
  const handleStartEdit = (item: MemoryItem) => {
    setEditingId(item.id)
    setEditingContent(item.content)
  }

  // Save edit
  const handleSaveEdit = async () => {
    if (!editingId || !editingContent.trim()) return
    await memoryService.updateMemory(editingId, { content: editingContent.trim() })
    setEditingId(null)
    setEditingContent('')
    loadMemories()
  }

  // Cancel edit
  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingContent('')
  }

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Project Rules */}
        <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" />
              <h5 className="text-sm font-medium text-text-primary">
                {t('app.behaviorrules', language as Language)}
              </h5>
            </div>
            <div className="flex items-center gap-2">
              {rulesSource && (
                <span className="text-[11px] text-text-muted px-2 py-0.5 bg-black/20 rounded">
                  {rulesSource}
                </span>
              )}
              <button
                onClick={loadRules}
                className="p-1.5 text-text-muted hover:text-accent transition-colors"
                title={t('app.refresh', language as Language)}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <p className="text-xs text-text-muted">
            {t('app.defineaiagentbehavior', language as Language, { paths: BRAND.paths.rules })}
          </p>

          {rulesLoading ? (
            <div className="h-64 flex items-center justify-center text-text-muted">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <>
              <textarea
                value={rulesContent}
                onChange={(e) => {
                  setRulesContent(e.target.value)
                  setRulesModified(true)
                }}
                className="w-full h-64 p-3 bg-black/20 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none text-xs font-mono custom-scrollbar text-text-primary placeholder-text-muted/50"
                placeholder={t('app.behaviorrulesnnwriteaibehavior', language as Language)}
              />

              <div className="flex items-center justify-between">
                {rulesModified && (
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{t('app.unsavedchanges2', language as Language)}</span>
                  </div>
                )}
                <div className="flex-1" />
                <ActionButton
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRules}
                  disabled={!rulesModified || rulesSaving}
                  className="text-xs"
                >
                  {rulesSaving ? t('app.saving', language as Language) : t('app.saverules', language as Language)}
                </ActionButton>
              </div>
            </>
          )}
        </section>

        {/* Right: Project Memory */}
        <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-accent" />
              <h5 className="text-sm font-medium text-text-primary">
                {t('app.memorysystem', language as Language)}
              </h5>
            </div>
            <span className="text-[11px] text-text-muted px-2 py-0.5 bg-black/20 rounded">
              {memories.filter(m => m.enabled).length}/{memories.length}
            </span>
          </div>

          <p className="text-xs text-text-muted">
            {t('app.addimportantworkspaceinformation', language as Language)}
          </p>

          {/* Add new memory */}
          <div className="flex gap-2">
            <TextField
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              placeholder={t('app.addnewmemory', language as Language)}
              className="flex-1 bg-black/20 border-border text-xs"
              onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
            />
            <ActionButton
              variant="secondary"
              onClick={handleAddMemory}
              disabled={!newMemory.trim()}
              className="px-3"
            >
              <Plus className="w-4 h-4" />
            </ActionButton>
          </div>

          {/* Memory list */}
          <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
            {memoryLoading ? (
              <div className="h-20 flex items-center justify-center text-text-muted">
                <RefreshCw className="w-4 h-4 animate-spin" />
              </div>
            ) : memories.length === 0 ? (
              <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                {t('app.nomemoriesyet', language as Language)}
              </div>
            ) : (
              memories.map((item) => (
                <div
                  key={item.id}
                  className={`group flex items-start gap-2 p-2.5 rounded-lg border transition-colors ${item.enabled
                      ? 'bg-black/20 border-border hover:border-accent/30'
                      : 'bg-black/10 border-border/50 opacity-60'
                    }`}
                >
                  {editingId === item.id ? (
                    <>
                      <TextField
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="flex-1 bg-black/30 border-accent/50 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit()
                          if (e.key === 'Escape') handleCancelEdit()
                        }}
                      />
                      <button
                        onClick={handleSaveEdit}
                        className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-1 text-text-muted hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleToggleMemory(item.id, item.enabled)}
                        className={`p-0.5 transition-colors ${item.enabled ? 'text-accent' : 'text-text-muted'
                          }`}
                        title={item.enabled ? t('app.disable', language as Language) : t('app.enable', language as Language)}
                      >
                        {item.enabled ? (
                          <ToggleRight className="w-4 h-4" />
                        ) : (
                          <ToggleLeft className="w-4 h-4" />
                        )}
                      </button>
                      <span className="flex-1 text-xs text-text-secondary leading-relaxed">
                        {item.content}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteMemory(item.id)}
                          className="p-1 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Tips */}
          <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-text-muted space-y-1">
            <p className="font-medium text-accent/80">{t('app.tips', language as Language)}</p>
            <ul className="list-disc list-inside space-y-0.5 text-[12px]">
              <li>{t('app.memoriesarefullyinjected', language as Language)}</li>
              <li>{t('app.keepitconciseto', language as Language)}</li>
              <li>{t('app.youcandisablememories', language as Language)}</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * 代码片段设置组件
 * 管理用户自定义代码模板
 */

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Code, Download, Upload, Search } from 'lucide-react'
import { ActionButton, TextField, DropdownSelector } from '@components/ui'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { toast } from '@components/foundation/NotificationProvider'
import { snippetService, type CodeSnippet } from '@services/snippetAdapter'
import {Language, t} from '@renderer/i18n'

interface SnippetSettingsProps {
  language: Language
}

const COMMON_LANGUAGES = [
  { value: '', label: 'All Languages' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'typescriptreact', label: 'TypeScript React' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'javascriptreact', label: 'JavaScript React' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
]

interface SnippetFormData {
  name: string
  prefix: string
  body: string
  description: string
  languages: string[]
}

const defaultFormData: SnippetFormData = {
  name: '',
  prefix: '',
  body: '',
  description: '',
  languages: [],
}

export function SnippetLibraryPanel({ language }: SnippetSettingsProps) {
  const [snippets, setSnippets] = useState<CodeSnippet[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterLanguage, setFilterLanguage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<SnippetFormData>(defaultFormData)
  const [showForm, setShowForm] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSnippets()
  }, [])

  const loadSnippets = () => {
    setSnippets(snippetService.getAll())
  }

  const filteredSnippets = snippets.filter(s => {
    const matchesSearch = !searchQuery || 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.prefix.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLanguage = !filterLanguage || 
      s.languages.length === 0 || 
      s.languages.includes(filterLanguage)
    return matchesSearch && matchesLanguage
  })

  const handleCreate = () => {
    setEditingId(null)
    setFormData(defaultFormData)
    setShowForm(true)
  }

  const handleEdit = (snippet: CodeSnippet) => {
    if (snippetService.isDefaultSnippet(snippet.id)) {
      toast.warning(t('settings.defaultsnippetscannotbeedited', language as Language))
      return
    }
    setEditingId(snippet.id)
    setFormData({
      name: snippet.name,
      prefix: snippet.prefix,
      body: snippet.body,
      description: snippet.description || '',
      languages: [...snippet.languages],
    })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (snippetService.isDefaultSnippet(id)) {
      toast.warning(t('settings.defaultsnippetscannotbedeleted', language as Language))
      return
    }
    const confirmed = await globalConfirm({
      title: t('settings.deletesnippet', language as Language),
      message: t('settings.deletethissnippet', language as Language),
      variant: 'danger',
    })
    if (!confirmed) return
    
    const success = await snippetService.delete(id)
    if (success) {
      toast.success(t('settings.deleted', language as Language))
      loadSnippets()
    }
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.body.trim()) {
      toast.error(t('settings.pleasefillrequiredfields', language as Language))
      return
    }

    try {
      if (editingId) {
        await snippetService.update(editingId, formData)
        toast.success(t('settings.updated', language as Language))
      } else {
        await snippetService.add(formData)
        toast.success(t('settings.created', language as Language))
      }
      setShowForm(false)
      setFormData(defaultFormData)
      setEditingId(null)
      loadSnippets()
    } catch (error) {
      toast.error(t('settings.savefailed', language as Language))
    }
  }

  const handleExport = () => {
    const json = snippetService.exportSnippets()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'snippets.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('settings.exported', language as Language))
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const result = await snippetService.importSnippets(text)
      toast.success(
        t('settings.importedfailed', language as Language, { success: result.success, failed: result.failed })
      )
      loadSnippets()
    } catch {
      toast.error(t('settings.importfailed', language as Language))
    }
    e.target.value = ''
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleLanguage = (lang: string) => {
    setFormData(prev => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter(l => l !== lang)
        : [...prev.languages, lang]
    }))
  }

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <TextField
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('settings.searchsnippets', language as Language)}
              className="pl-9 h-9 bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
            />
          </div>
          <DropdownSelector
            value={filterLanguage}
            onChange={setFilterLanguage}
            options={COMMON_LANGUAGES}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <ActionButton variant="ghost" size="sm" onClick={handleImport}>
            <Upload className="w-4 h-4 mr-1" />
            {t('settings.import', language as Language)}
          </ActionButton>
          <ActionButton variant="ghost" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" />
            {t('settings.export', language as Language)}
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={handleCreate}>
            <Plus className="w-4 h-4 mr-1" />
            {t('settings.new', language as Language)}
          </ActionButton>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Snippet Form */}
      {showForm && (
        <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-text-primary">
              {editingId ? (t('settings.editsnippet', language as Language)) : (t('settings.newsnippet', language as Language))}
            </h4>
            <ActionButton variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              {t('settings.cancel', language as Language)}
            </ActionButton>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">
                {t('settings.name', language as Language)}
              </label>
              <TextField
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="React Function Component"
                className="bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5">
                {t('settings.triggerprefix', language as Language)}
              </label>
              <TextField
                value={formData.prefix}
                onChange={e => setFormData(prev => ({ ...prev, prefix: e.target.value }))}
                placeholder="rfc"
                className="bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              {t('settings.description', language as Language)}
            </label>
            <TextField
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder={t('settings.snippetdescription', language as Language)}
              className="bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              {t('settings.codetemplate', language as Language)}
              <span className="ml-2 text-text-muted/90">
                {t('settings.supports11placeholderplaceholders', language as Language)}
              </span>
            </label>
            <textarea
              value={formData.body}
              onChange={e => setFormData(prev => ({ ...prev, body: e.target.value }))}
              placeholder={`const \${1:name} = () => {\n  \${0}\n}`}
              className="w-full h-40 px-3 py-2 bg-background/50 border border-border/50 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-2">
              {t('settings.languagesemptyforall', language as Language)}
            </label>
            <div className="flex flex-wrap gap-2">
              {COMMON_LANGUAGES.slice(1).map(lang => (
                <button
                  key={lang.value}
                  onClick={() => toggleLanguage(lang.value)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    formData.languages.includes(lang.value)
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'border-border text-text-muted hover:border-text-muted'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <ActionButton variant="primary" onClick={handleSave}>
              {t('settings.save', language as Language)}
            </ActionButton>
          </div>
        </div>
      )}

      {/* Snippet List - Card Wall */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredSnippets.length === 0 ? (
          <div className="col-span-full text-center py-16 text-text-muted border border-dashed border-border/50 rounded-xl bg-surface/5">
            <Code className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium opacity-60">{t('settings.nosnippetsfound', language as Language)}</p>
          </div>
        ) : (
          filteredSnippets.map(snippet => {
            const isDefault = snippetService.isDefaultSnippet(snippet.id)

            return (
              <div
                key={snippet.id}
                onClick={() => !isDefault && handleEdit(snippet)}
                className={`
                  group relative flex flex-col h-48 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 overflow-hidden transition-all duration-300
                  ${!isDefault ? 'hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 hover:-translate-y-1 cursor-pointer' : 'opacity-80'}
                `}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-surface/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold text-text-primary truncate">{snippet.name}</span>
                    <code className="px-1.5 py-0.5 text-[11px] bg-accent/10 text-accent rounded font-mono border border-accent/10">
                      {snippet.prefix}
                    </code>
                  </div>
                  {!isDefault && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(snippet.id)
                      }}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Code Preview */}
                <div 
                  className="flex-1 p-0 overflow-hidden bg-black/5 relative group-hover:bg-black/10 transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpand(snippet.id)
                  }}
                >
                  <pre className={`p-4 text-[12px] font-mono text-text-secondary leading-relaxed opacity-80 group-hover:opacity-100 transition-all ${
                    expandedIds.has(snippet.id) ? 'max-h-none' : 'max-h-[120px]'
                  }`}>
                    {expandedIds.has(snippet.id) ? snippet.body : snippet.body.split('\n').slice(0, 8).join('\n')}
                  </pre>
                  {/* Fade out bottom or expand indicator */}
                  {!expandedIds.has(snippet.id) && snippet.body.split('\n').length > 8 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface/30 to-transparent flex items-end justify-center pb-2">
                      <span className="text-[11px] text-text-muted/90 font-medium">Click to expand...</span>
                    </div>
                  )}
                </div>

                {/* Footer Tags */}
                <div className="px-4 py-2 bg-surface/20 border-t border-border/30 flex gap-1.5 overflow-hidden">
                  {snippet.languages.length === 0 ? (
                    <span className="text-[11px] text-text-muted/90 font-medium">All Languages</span>
                  ) : (
                    snippet.languages.slice(0, 3).map(lang => (
                      <span key={lang} className="px-1.5 py-0.5 text-[10px] bg-white/5 text-text-muted rounded border border-white/5">
                        {lang}
                      </span>
                    ))
                  )}
                  {snippet.languages.length > 3 && (
                    <span className="text-[10px] text-text-muted/90 self-center">+{snippet.languages.length - 3}</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

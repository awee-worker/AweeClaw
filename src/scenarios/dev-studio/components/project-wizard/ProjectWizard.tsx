import { useState, useCallback } from 'react'
import type React from 'react'
import { scaffoldService } from '../../services'
import type { ProjectTemplate, TemplateCategory, CreateProjectOptions } from '../../types'

interface ProjectWizardProps {
  onComplete?: (options: CreateProjectOptions) => void
  onCancel?: () => void
}

type WizardStep = 'template' | 'configure' | 'creating'

const ProjectWizard: React.FC<ProjectWizardProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<WizardStep>('template')
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [description, setDescription] = useState('')
  const [variables, setVariables] = useState<Record<string, string | number | boolean>>({})
  const [error, setError] = useState('')
  const [, setCreating] = useState(false)

  const categories = scaffoldService.getCategories()
  const templates = searchQuery
    ? scaffoldService.searchTemplates(searchQuery)
    : scaffoldService.getTemplates(selectedCategory ?? undefined)

  const handleTemplateSelect = useCallback((template: ProjectTemplate) => {
    setSelectedTemplate(template)
    setError('')
    const defaults: Record<string, string | number | boolean> = {}
    for (const v of template.variables) {
      if (v.default !== undefined) {
        defaults[v.key] = v.default
      }
    }
    setVariables(defaults)
    setProjectName(String(template.variables.find(v => v.key === 'projectName')?.default ?? ''))
    setStep('configure')
  }, [])

  const handleBack = useCallback(() => {
    setStep('template')
    setError('')
  }, [])

  const handleCreate = useCallback(async () => {
    if (!selectedTemplate) return
    if (!projectName.trim()) {
      setError('请输入项目名称')
      return
    }
    if (!projectPath.trim()) {
      setError('请选择项目保存路径')
      return
    }

    setError('')
    setCreating(true)
    setStep('creating')

    const options: CreateProjectOptions = {
      name: projectName.trim(),
      templateId: selectedTemplate.id,
      localPath: projectPath.trim(),
      description: description.trim() || undefined,
      variables,
    }

    try {
      await scaffoldService.scaffold(options)
      onComplete?.(options)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败')
      setStep('configure')
    } finally {
      setCreating(false)
    }
  }, [selectedTemplate, projectName, projectPath, description, variables, onComplete])

  const handleBrowse = useCallback(async () => {
    try {
      const path = await (window as any).__aweeclaw?.showOpenDialog?.({
        properties: ['openDirectory', 'createDirectory'],
      })
      if (path && path[0]) {
        setProjectPath(path[0])
      }
    } catch {
      // 回退到手动输入
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-lg font-semibold">Create New Project</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {step === 'template' && 'Choose a template to get started'}
            {step === 'configure' && 'Configure your project settings'}
            {step === 'creating' && 'Setting up your project...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {step !== 'creating' && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* 步骤指示器 */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/30">
        {(['template', 'configure', 'creating'] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                step === s
                  ? 'bg-accent text-white'
                  : step === 'creating' || (i < ['template', 'configure', 'creating'].indexOf(step))
                    ? 'bg-accent/20 text-accent'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-xs ${step === s ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {s === 'template' ? 'Template' : s === 'configure' ? 'Configure' : 'Create'}
            </span>
            {i < 2 && <div className="w-8 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-6">
        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            {error}
          </div>
        )}

        {/* 步骤 1: 选择模板 */}
        {step === 'template' && (
          <div className="space-y-4">
            {/* 搜索栏 */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search templates..."
                className="w-full px-4 py-2.5 pl-10 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* 分类筛选 */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  !selectedCategory
                    ? 'bg-accent text-white border-accent'
                    : 'border-border hover:bg-muted'
                }`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                    selectedCategory === cat.key
                      ? 'bg-accent text-white border-accent'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* 模板列表 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map(template => (
                <button
                  key={template.id}
                  onClick={() => handleTemplateSelect(template)}
                  className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{template.name}</span>
                      {template.featured && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded-full bg-accent/10 text-accent font-medium">
                          Featured
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.description}</p>
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {template.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {templates.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">No templates found</p>
              </div>
            )}
          </div>
        )}

        {/* 步骤 2: 配置项目 */}
        {step === 'configure' && selectedTemplate && (
          <div className="max-w-lg space-y-5">
            {/* 项目名称 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Enter project name..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            {/* 项目路径 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Project Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={projectPath}
                  onChange={e => setProjectPath(e.target.value)}
                  placeholder="Choose project location..."
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <button
                  onClick={handleBrowse}
                  className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                >
                  Browse
                </button>
              </div>
            </div>

            {/* 描述 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Briefly describe your project..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
              />
            </div>

            {/* 模板变量 */}
            {selectedTemplate.variables.filter(v => v.key !== 'projectName').length > 0 && (
              <div className="pt-2 border-t border-border">
                <h3 className="text-sm font-medium mb-3">Configuration</h3>
                <div className="space-y-3">
                  {selectedTemplate.variables
                    .filter(v => v.key !== 'projectName')
                    .map(v => (
                      <div key={v.key} className="flex items-center justify-between">
                        <label className="text-sm text-muted-foreground">{v.label}</label>
                        {v.type === 'boolean' ? (
                          <button
                            onClick={() =>
                              setVariables(prev => ({ ...prev, [v.key]: !prev[v.key] }))
                            }
                            className={`relative w-9 h-5 rounded-full transition-colors ${
                              variables[v.key] ? 'bg-accent' : 'bg-muted'
                            }`}
                          >
                            <div
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                variables[v.key] ? 'translate-x-4.5' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        ) : v.type === 'select' && v.options ? (
                          <select
                            value={String(variables[v.key] ?? v.default ?? '')}
                            onChange={e =>
                              setVariables(prev => ({ ...prev, [v.key]: e.target.value }))
                            }
                            className="px-2 py-1 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                          >
                            {v.options.map(o => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={String(variables[v.key] ?? v.default ?? '')}
                            onChange={e =>
                              setVariables(prev => ({ ...prev, [v.key]: e.target.value }))
                            }
                            className="w-32 px-2 py-1 rounded border border-border bg-background text-sm text-right focus:outline-none focus:ring-2 focus:ring-accent/50"
                          />
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-3">
              <button
                onClick={handleBack}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={!projectName.trim() || !projectPath.trim()}
                className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Project
              </button>
            </div>
          </div>
        )}

        {/* 步骤 3: 创建中 */}
        {step === 'creating' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">
              Creating project <span className="font-medium text-foreground">{projectName}</span>...
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This may take a few moments
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProjectWizard
/**
 * 示例场景网格（ExampleScenariosGrid）
 *
 * 独立组件，被欢迎页 / 侧边栏模板选择面板复用：
 *  - 展示内置示例场景卡片（按难度色块区分）
 *  - 点击卡片弹出克隆对话框（确认 scenarioId / name）
 *  - 克隆成功后通过 onCloned 回调通知父组件
 *
 * 设计要点：
 *  - 单列网格适配欢迎页（移动端单列，PC 三列）
 *  - 字体 ≥ 12px
 *  - 克隆过程显示 loading + 结果反馈
 *  - 卡片显示难度徽章、亮点列表、文件数
 */
import { useState, useMemo, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { listExampleMetas, getExampleById } from '../../examples'
import type { ExampleScenarioMeta } from '../../examples'
import { projectService } from '../../services'
import {
  Sparkles,
  Languages,
  FileText,
  BookOpen,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Copy,
} from 'lucide-react'

// ==========================================
// 类型与常量
// ==========================================

interface ExampleScenariosGridProps {
  /** 克隆成功后回调（用于触发项目列表刷新等） */
  onCloned?: (projectId: string, localPath: string) => void
  /** 网格列数（默认 3，移动端自动单列） */
  columns?: 2 | 3 | 4
  /** 是否显示标题区（嵌入欢迎页时为 true，嵌入其他面板时为 false） */
  showHeader?: boolean
}

/** 难度样式映射 */
const DIFFICULTY_STYLE: Record<ExampleScenarioMeta['difficulty'], { badge: string; label: string; labelZh: string }> = {
  beginner: {
    badge: 'bg-emerald-500/10 text-emerald-600',
    label: 'Beginner',
    labelZh: '入门',
  },
  intermediate: {
    badge: 'bg-sky-500/10 text-sky-600',
    label: 'Intermediate',
    labelZh: '进阶',
  },
  advanced: {
    badge: 'bg-pink-500/10 text-pink-600',
    label: 'Advanced',
    labelZh: '高级',
  },
}

/** 从 lucide-react 动态获取图标的辅助（部分场景无对应图标时回退到 Sparkles） */
function getExampleIcon(iconName: string): React.ComponentType<{ className?: string }> {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    Languages,
    FileText,
    BookOpen,
    Sparkles,
  }
  return map[iconName] || Sparkles
}

// ==========================================
// 克隆对话框（简化为内联确认）
// ==========================================

interface CloneDialogState {
  open: boolean
  example: ExampleScenarioMeta | null
  scenarioId: string
  name: string
  loading: boolean
  error: string
  success: { projectId: string; localPath: string } | null
}

// ==========================================
// 主组件
// ==========================================

const ExampleScenariosGrid: React.FC<ExampleScenariosGridProps> = ({
  onCloned,
  columns = 3,
  showHeader = true,
}) => {
  const { language } = useI18n()
  const isZh = language === 'zh'

  // 示例列表
  const examples = useMemo(() => listExampleMetas(), [])

  // 克隆对话框状态
  const [dialog, setDialog] = useState<CloneDialogState>({
    open: false,
    example: null,
    scenarioId: '',
    name: '',
    loading: false,
    error: '',
    success: null,
  })

  // ==========================================
  // 打开克隆对话框
  // ==========================================

  const openCloneDialog = useCallback((ex: ExampleScenarioMeta) => {
    setDialog({
      open: true,
      example: ex,
      scenarioId: `${ex.id}-copy`,
      name: isZh ? ex.nameZh : ex.name,
      loading: false,
      error: '',
      success: null,
    })
  }, [isZh])

  const closeCloneDialog = useCallback(() => {
    setDialog((prev) => ({ ...prev, open: false, example: null, error: '', success: null }))
  }, [])

  // ==========================================
  // 执行克隆
  // ==========================================

  const handleClone = useCallback(async () => {
    if (!dialog.example) return
    setDialog((prev) => ({ ...prev, loading: true, error: '', success: null }))
    try {
      const example = getExampleById(dialog.example.id)
      if (!example) {
        setDialog((prev) => ({ ...prev, loading: false, error: 'Example not found' }))
        return
      }
      const result = await projectService.cloneExample(example, {
        scenarioId: dialog.scenarioId,
        name: dialog.name,
      })
      if (!result.success || !result.projectId || !result.localPath) {
        setDialog((prev) => ({ ...prev, loading: false, error: result.error || '克隆失败' }))
        return
      }
      setDialog((prev) => ({
        ...prev,
        loading: false,
        success: { projectId: result.projectId!, localPath: result.localPath! },
      }))
      onCloned?.(result.projectId!, result.localPath!)
    } catch (err) {
      setDialog((prev) => ({
        ...prev,
        loading: false,
        error: (err as Error).message,
      }))
    }
  }, [dialog, onCloned])

  // ==========================================
  // 渲染
  // ==========================================

  const gridCols = columns === 4 ? 'lg:grid-cols-4' : columns === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'

  return (
    <div>
      {showHeader && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              {isZh ? '示例场景' : 'Example Scenarios'}
            </h2>
          </div>
          <p className="text-xs text-text-muted">
            {isZh ? '完整的可运行场景，一键克隆到本地学习' : 'Complete runnable scenarios, clone to local for learning'}
          </p>
        </div>
      )}

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridCols} gap-3`}>
        {examples.map((ex) => {
          const Icon = getExampleIcon(ex.icon)
          const diff = DIFFICULTY_STYLE[ex.difficulty]
          return (
            <div
              key={ex.id}
              className="flex flex-col rounded-xl border border-border bg-surface/30 p-4 hover:border-accent/40 hover:bg-accent/5 transition-all"
            >
              {/* 头部：图标 + 难度 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="w-4 h-4" />
                </div>
                <span className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${diff.badge}`}>
                  {isZh ? diff.labelZh : diff.label}
                </span>
              </div>

              {/* 标题与描述 */}
              <div className="text-sm font-medium text-text-primary">
                {isZh ? ex.nameZh : ex.name}
              </div>
              <div className="mt-1 text-[12px] text-text-muted leading-relaxed line-clamp-2">
                {isZh ? ex.descriptionZh : ex.description}
              </div>

              {/* 亮点列表（前 2 条） */}
              <ul className="mt-3 space-y-1">
                {(isZh ? ex.highlightsZh : ex.highlights).slice(0, 2).map((h, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[12px] text-text-secondary">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    <span className="leading-snug">{h}</span>
                  </li>
                ))}
              </ul>

              {/* 底部：类型徽章 + 克隆按钮 */}
              <div className="mt-auto pt-3 flex items-center justify-between">
                <span className="text-[12px] text-text-muted">
                  {ex.type === 'declarative' ? (isZh ? '声明式' : 'Declarative') : (isZh ? '编程式' : 'Programmatic')}
                </span>
                <button
                  onClick={() => openCloneDialog(ex)}
                  className="flex items-center gap-1 rounded border border-border bg-surface/40 px-2 py-1 text-[12px] text-text-secondary hover:text-accent hover:border-accent/40 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {isZh ? '克隆' : 'Clone'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 克隆对话框 */}
      {dialog.open && dialog.example && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeCloneDialog}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-background-editor shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题 */}
            <div className="border-b border-border p-3">
              <h3 className="text-sm font-medium text-text-primary">
                {isZh ? '克隆示例场景' : 'Clone Example Scenario'}
              </h3>
              <p className="text-[12px] text-text-muted mt-0.5">
                {isZh ? dialog.example.nameZh : dialog.example.name}
              </p>
            </div>

            {/* 成功状态 */}
            {dialog.success ? (
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-2 rounded bg-emerald-500/10 p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[12px] font-medium text-emerald-600">
                      {isZh ? '克隆成功' : 'Cloned successfully'}
                    </div>
                    <div className="mt-1 text-[12px] text-text-secondary font-mono break-all">
                      {dialog.success.localPath}
                    </div>
                  </div>
                </div>
                <button
                  onClick={closeCloneDialog}
                  className="w-full rounded bg-accent px-3 py-1.5 text-[12px] text-accent-foreground hover:bg-accent/90"
                >
                  {isZh ? '完成' : 'Done'}
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {/* 名称输入 */}
                <div>
                  <label className="mb-1 block text-[12px] text-text-muted">
                    {isZh ? '项目名称' : 'Project Name'}
                  </label>
                  <input
                    type="text"
                    value={dialog.name}
                    onChange={(e) => setDialog((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={dialog.loading}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] disabled:opacity-50"
                  />
                </div>

                {/* 场景 ID 输入 */}
                <div>
                  <label className="mb-1 block text-[12px] text-text-muted">
                    {isZh ? '场景 ID' : 'Scenario ID'}
                  </label>
                  <input
                    type="text"
                    value={dialog.scenarioId}
                    onChange={(e) => setDialog((prev) => ({ ...prev, scenarioId: e.target.value }))}
                    disabled={dialog.loading}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] font-mono disabled:opacity-50"
                  />
                  <p className="mt-1 text-[12px] text-text-muted">
                    {isZh ? '小写字母+数字+连字符，字母开头' : 'Lowercase letters, digits, hyphens; start with a letter'}
                  </p>
                </div>

                {/* 错误 */}
                {dialog.error && (
                  <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-[12px] text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{dialog.error}</span>
                  </div>
                )}

                {/* 按钮 */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={closeCloneDialog}
                    disabled={dialog.loading}
                    className="flex-1 rounded border border-border bg-surface/40 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                  >
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleClone}
                    disabled={dialog.loading || !dialog.name.trim() || !dialog.scenarioId.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded bg-accent px-3 py-1.5 text-[12px] text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
                  >
                    {dialog.loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    {isZh ? '克隆' : 'Clone'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ExampleScenariosGrid

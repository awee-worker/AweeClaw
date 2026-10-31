/**
 * 场景工具面板 — 宫格首页 + 工具详情
 *
 * 结构：
 * - 默认：宫格列表（全部场景工具，不随当前场景模式过滤），显示图标 + 名称 + 描述
 * - 点击宫格：进入工具详情页，顶部显示返回按钮 + 工具名
 * - 仪表盘卡片 / AI 调用直接打开某个工具时不显示返回按钮（用户并未经过宫格）
 */

import { Suspense, useEffect, useState } from 'react'
import { Blocks, Layers, ChevronLeft, X } from 'lucide-react'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { getLucideIcon } from '@components/foundation/IconMap'
import { SCENE_TOOLS, type SceneToolMeta } from './registry'
import { useStore } from '@store'

/** 各模式的品牌色与渐变 */
const MODE_META: Record<string, { accent: string; gradient: string }> = {
  work: {
    accent: 'rgb(var(--accent))',
    gradient: 'linear-gradient(135deg, rgb(var(--accent)) 0%, color-mix(in srgb, rgb(var(--accent)) 60%, #ffffff 40%) 100%)',
  },
  life: {
    accent: '#F97316',
    gradient: 'linear-gradient(135deg, #F97316 0%, #FBBF24 100%)',
  },
  study: {
    accent: '#10B981',
    gradient: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
  },
}

export interface SceneToolsPanelProps {
  /**
   * 指定直接打开的工具 id（null 或省略 = 宫格首页）。
   * 抽屉场景下由抽屉状态驱动，变化时面板同步切换。
   */
  initialToolId?: string | null
  /** 传入时在头部右侧渲染关闭按钮（抽屉场景） */
  onClose?: () => void
}

export function SceneToolsPanel({ initialToolId = null, onClose }: SceneToolsPanelProps = {}) {
  const currentSceneMode = useSceneModeStore((s) => s.currentSceneMode)
  const pendingSceneToolId = useStore((s) => s.pendingSceneToolId)
  const setPendingSceneToolId = useStore((s) => s.setPendingSceneToolId)
  // 工具列表跨场景通用：任意场景下打开抽屉都能看到并使用全部内置工具
  const tools: SceneToolMeta[] = SCENE_TOOLS
  const [activeToolId, setActiveToolId] = useState<string | null>(initialToolId)
  const [pendingToolId, setPendingToolId] = useState<string | null>(null)
  /**
   * 是否从外部直接进入某个工具（仪表盘卡片 / AI 调用）。
   * 直接进入时用户没经过工具宫格，详情页不提供返回按钮。
   */
  const [enteredDirectly, setEnteredDirectly] = useState(initialToolId !== null)

  // 外部指定工具变化（例如从卡片点开另一个工具）时同步当前工具
  useEffect(() => {
    setActiveToolId(initialToolId)
    setEnteredDirectly(initialToolId !== null)
  }, [initialToolId])

  // 当 pendingToolId 变化时，延迟切换到对应工具（等首页渲染完毕）
  useEffect(() => {
    if (!pendingToolId) return
    const timer = setTimeout(() => {
      setActiveToolId(pendingToolId)
      setEnteredDirectly(true)
      setPendingToolId(null)
    }, 50)
    return () => clearTimeout(timer)
  }, [pendingToolId])

  // 监听 store 中的 pendingSceneToolId：打开后自动跳转到对应工具
  useEffect(() => {
    if (!pendingSceneToolId || !tools.length) return
    const timer = setTimeout(() => {
      if (tools.some((t) => t.id === pendingSceneToolId)) {
        setActiveToolId(pendingSceneToolId)
        setEnteredDirectly(true)
        setPendingSceneToolId(null)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [pendingSceneToolId, tools, setPendingSceneToolId])

  /** 从宫格进入工具：保留返回入口 */
  const handleOpenFromGrid = (toolId: string) => {
    setActiveToolId(toolId)
    setEnteredDirectly(false)
  }

  // 监听来自 AI Agent 的工具打开请求（保留事件方式，兼容已有调用）
  useEffect(() => {
    const handler = (e: Event) => {
      const toolId = (e as CustomEvent).detail as string
      if (toolId) {
        setPendingToolId(toolId)
      }
    }
    window.addEventListener('aweeclaw:scene-tool-open', handler)
    return () => window.removeEventListener('aweeclaw:scene-tool-open', handler)
  }, [])

  const activeTool: SceneToolMeta | undefined = tools.find((t) => t.id === activeToolId)
  const meta = MODE_META[currentSceneMode] ?? MODE_META.work
  const ToolComponent = activeTool?.component
  const IconComp = activeTool ? getLucideIcon(activeTool.icon) : Blocks

  // ─── 宫格首页 ────────────────────────────────────────────────────────
  const renderGrid = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部头部 */}
      <header className="flex items-center gap-2.5 select-none shrink-0 px-5 py-4 pb-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ background: meta.gradient, boxShadow: `0 2px 10px ${meta.accent}40` }}
        >
          <Blocks className="w-[17px] h-[17px]" strokeWidth={2} />
        </div>
        <div className="flex flex-col min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold tracking-tight">场景工具</span>
            <span className="text-[12px] px-1.5 py-px rounded-full border border-border/60 text-text-muted/70">
              {tools.length} 个
            </span>
          </div>
          <span className="text-[12px] text-text-muted/70 truncate">
            工作 / 生活 / 学习通用，随时取用
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            className="ml-auto shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </header>

      {tools.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 text-text-muted/50 px-4">
          <Layers className="w-7 h-7" strokeWidth={1.5} />
          <span className="text-[12px]">暂无内置工具</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {tools.map((tool) => {
              const TC = getLucideIcon(tool.icon)
              return (
                <button
                  key={tool.id}
                  onClick={() => handleOpenFromGrid(tool.id)}
                  title={tool.description}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border/40 bg-surface/40 hover:bg-surface/80 hover:border-accent/30 transition-all duration-150 text-center group"
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
                    style={{ background: `color-mix(in srgb, ${meta.accent} 12%, transparent)` }}
                  >
                    <TC className="w-[17px] h-[17px]" style={{ color: meta.accent }} strokeWidth={1.8} />
                  </div>
                  <span className="text-[12px] font-medium text-text-primary truncate w-full group-hover:text-accent transition-colors">
                    {tool.name}
                  </span>
                  {tool.tier === 'enhanced' && (
                    <span className="text-[12px] text-text-muted/50">增强</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  // ─── 工具详情 ────────────────────────────────────────────────────────
  const renderDetail = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 详情头部：工具图标 + 名称（+ 描述）；仅从宫格进入时才提供返回入口 */}
      <header className="flex items-center gap-3 shrink-0 px-5 py-3.5 border-b border-border/30 select-none">
        {!enteredDirectly && (
          <button
            type="button"
            onClick={() => setActiveToolId(null)}
            aria-label="返回工具列表"
            title="返回工具列表"
            className="flex items-center justify-center w-7 h-7 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-all shrink-0"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${meta.accent} 15%, transparent)` }}
        >
          <IconComp className="w-4 h-4" strokeWidth={2} style={{ color: meta.accent }} />
        </div>
        <div className="flex flex-col min-w-0 leading-tight">
          <span className="text-[13px] font-semibold text-text-primary truncate">
            {activeTool?.name}
          </span>
          {activeTool?.description && (
            <span className="text-[11px] text-text-muted/70 truncate">
              {activeTool.description}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            className="ml-auto shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </header>

      {/* 工具内容 */}
      <div className="flex-1 min-h-0 overflow-hidden px-5 pb-5">
        {ToolComponent ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-[12px] text-text-muted/60">
                加载中…
              </div>
            }
          >
            <ToolComponent />
          </Suspense>
        ) : (
          <div className="flex items-center justify-center h-full text-[12px] text-text-muted/60">
            请选择一个工具
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ '--scene-tool-accent': meta.accent } as React.CSSProperties}
    >
      {activeTool ? renderDetail() : renderGrid()}
    </div>
  )
}


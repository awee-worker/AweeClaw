/**
 * 场景工具面板 — 宫格首页 + 工具详情
 *
 * 结构：
 * - 默认：宫格列表（按当前场景模式过滤），显示图标 + 名称 + 描述
 * - 点击宫格：进入工具详情页，顶部显示返回按钮 + 工具名
 * - AI 调用 scene_tools_add/update 时自动打开面板并跳转到对应工具
 */

import { Suspense, useEffect, useMemo, useState } from 'react'
import { Blocks, Layers, ChevronLeft } from 'lucide-react'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { getLucideIcon } from '@components/foundation/IconMap'
import { getToolsByMode, type SceneToolMeta } from './registry'

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

export function SceneToolsPanel() {
  const currentSceneMode = useSceneModeStore((s) => s.currentSceneMode)
  const activeProfile = useSceneModeStore((s) => s.activeProfile)
  const tools = useMemo(() => getToolsByMode(currentSceneMode), [currentSceneMode])
  const [activeToolId, setActiveToolId] = useState<string | null>(null)
  const [pendingToolId, setPendingToolId] = useState<string | null>(null)

  // 模式切换时重置到首页
  useEffect(() => {
    setActiveToolId(null)
    setPendingToolId(null)
  }, [currentSceneMode])

  // 当 pendingToolId 变化时，延迟切换到对应工具（等首页渲染完毕）
  useEffect(() => {
    if (!pendingToolId) return
    const timer = setTimeout(() => {
      setActiveToolId(pendingToolId)
      setPendingToolId(null)
    }, 50)
    return () => clearTimeout(timer)
  }, [pendingToolId])

  // 监听来自欢迎页和 AI Agent 的工具打开请求
  useEffect(() => {
    const handler = (e: Event) => {
      const toolId = (e as CustomEvent).detail as string
      if (toolId && tools.some((t) => t.id === toolId)) {
        setPendingToolId(toolId)
      }
    }
    window.addEventListener('aweeclaw:scene-tool-open', handler)
    return () => window.removeEventListener('aweeclaw:scene-tool-open', handler)
  }, [tools])

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
            <span className="text-[13px] font-semibold tracking-tight">
              {activeProfile.displayNameZh}助手
            </span>
            <span className="text-[12px] px-1.5 py-px rounded-full border border-border/60 text-text-muted/70">
              {tools.length} 个
            </span>
          </div>
          <span className="text-[12px] text-text-muted/70 truncate">
            随当前场景模式自动切换
          </span>
        </div>
      </header>

      {tools.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 text-text-muted/50 px-4">
          <Layers className="w-7 h-7" strokeWidth={1.5} />
          <span className="text-[12px]">当前模式暂无内置工具</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {tools.map((tool) => {
              const TC = getLucideIcon(tool.icon)
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveToolId(tool.id)}
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
      {/* 详情头部：返回按钮 + 工具名 */}
      <header className="flex items-center gap-2 shrink-0 px-5 py-4 pb-3 border-b border-border/30">
        <button
          onClick={() => setActiveToolId(null)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />
          <span>返回</span>
        </button>
        <div className="flex-1" />
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${meta.accent} 15%, transparent)` }}
        >
          <IconComp className="w-3.5 h-3.5" strokeWidth={2} style={{ color: meta.accent }} />
        </div>
        <span className="text-[13px] font-semibold text-text-primary truncate">
          {activeTool?.name}
        </span>
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


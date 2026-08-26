/**
 * 场景工具面板 — 三种场景模式内置工具的挂载容器
 *
 * 结构：模式头部 → 工具切换条（按当前模式过滤）→ 工具内容卡片
 * 挂载：PanelRegistry 注册为 scene-tools 面板，NavigationRail 提供入口
 */

import { Suspense, useEffect, useMemo, useState } from 'react'
import { Blocks, Layers } from 'lucide-react'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { getLucideIcon } from '@components/foundation/IconMap'
import { getToolsByMode, type SceneToolMeta } from './registry'

/** 各模式的品牌色与渐变（贯穿头部徽章、切换条选中态） */
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

  // 模式切换时自动选中第一个工具
  useEffect(() => {
    if (tools.length > 0 && (!activeToolId || !tools.some((t) => t.id === activeToolId))) {
      setActiveToolId(tools[0].id)
    }
  }, [tools, activeToolId])

  const activeTool: SceneToolMeta | undefined = tools.find((t) => t.id === activeToolId)
  const meta = MODE_META[currentSceneMode] ?? MODE_META.work
  const ToolComponent = activeTool?.component
  const IconComp = activeTool ? getLucideIcon(activeTool.icon) : Blocks

  return (
    <div
      className="flex flex-col h-full overflow-hidden p-3 gap-3"
      style={{ '--scene-tool-accent': meta.accent } as React.CSSProperties}
    >
      {/* 模式头部 */}
      <header className="flex items-center gap-2.5 select-none shrink-0">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ background: meta.gradient, boxShadow: `0 2px 10px ${meta.accent}40` }}
        >
          <Blocks className="w-[17px] h-[17px]" strokeWidth={2} />
        </div>
        <div className="flex flex-col min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold tracking-tight">
              {activeProfile.displayNameZh}助手
            </span>
            <span className="text-[10px] px-1.5 py-px rounded-full border border-border/60 text-text-muted/70">
              {tools.length} 个
            </span>
          </div>
          <span className="text-[10.5px] text-text-muted/70 truncate">
            随当前场景模式自动切换
          </span>
        </div>
      </header>

      {tools.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 text-text-muted/50">
          <Layers className="w-7 h-7" strokeWidth={1.5} />
          <span className="text-[12px]">当前模式暂无内置工具</span>
        </div>
      ) : (
        <>
          {/* 工具切换条 */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            {tools.map((tool) => {
              const IC = getLucideIcon(tool.icon)
              const active = tool.id === activeToolId
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveToolId(tool.id)}
                  title={tool.description}
                  className={`relative flex-shrink-0 flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-lg text-[11.5px] transition-all duration-150 ${
                    active
                      ? 'text-white font-medium'
                      : 'text-text-muted/80 hover:text-text-primary hover:bg-text-primary/[0.05]'
                  }`}
                  style={active ? { background: meta.gradient, boxShadow: `0 2px 8px ${meta.accent}3d` } : undefined}
                >
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                      active ? 'bg-white/20' : 'bg-text-primary/[0.06]'
                    }`}
                  >
                    <IC className="w-3 h-3" strokeWidth={active ? 2.2 : 1.8} />
                  </span>
                  {tool.name}
                  {/* 增强工具用低调小圆点标记，替代原 Sparkles */}
                  {tool.tier === 'enhanced' && (
                    <span className={`w-1 h-1 rounded-full ${active ? 'bg-white/80' : 'bg-text-muted/40'}`} />
                  )}
                </button>
              )
            })}
          </div>

          {/* 工具内容卡片：统一内间距，工具内容不再贴边 */}
          <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-surface/40 overflow-hidden p-2.5">
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
        </>
      )}
    </div>
  )
}


/**
 * 场景模式切换器 — 工作 / 生活 / 学习
 *
 * Tab 按钮切换方式：3 个并排的小按钮，当前模式高亮，点击直接切换，无下拉弹窗。
 * 放在 AppTitleBar 中场景切换（ScenarioSelector）前面。
 *
 * 与 WorkModeSelector（chat/agent/plan 推理深度）正交，
 * 控制使用场景：切换人设、技能集、记忆域、感知策略等。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/README.md} 设计文档
 */

import { Briefcase, Heart, GraduationCap } from 'lucide-react'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { useModeStore } from '@/renderer/modes/workModeStore'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { useStore } from '@store'

/** 三种场景模式的展示配置 */
const SCENE_MODES: Array<{
  id: SceneMode
  icon: typeof Briefcase
  color: string
}> = [
  { id: 'work', icon: Briefcase, color: '#3B82F6' },
  { id: 'life', icon: Heart, color: '#F97316' },
  { id: 'study', icon: GraduationCap, color: '#10B981' },
]

interface SceneModeSelectorProps {
  className?: string
}

export default function SceneModeSelector({ className = '' }: SceneModeSelectorProps) {
  const { currentSceneMode, setSceneMode } = useSceneModeStore()
  const { setMode: setWorkMode } = useModeStore()
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const handleSelect = async (mode: SceneMode) => {
    if (mode === currentSceneMode) return
    // 切换场景模式
    await setSceneMode(mode)
    // 联动设置推荐的 WorkMode（推理深度），用户可后续独立调整
    const newProfile = sceneModeRegistry.getOrDefault(mode)
    setWorkMode(newProfile.defaultWorkMode)
  }

  return (
    <div className={`flex items-center gap-1 bg-surface-hover/60 rounded-lg p-1 ${className}`}>
      {SCENE_MODES.map((m) => {
        const ModeIcon = m.icon
        const isSelected = currentSceneMode === m.id
        const mProfile = sceneModeRegistry.getOrDefault(m.id)
        const label = isZh ? mProfile.displayNameZh : mProfile.displayName

        return (
          <button
            key={m.id}
            onClick={() => void handleSelect(m.id)}
            title={label}
            className={`
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
              transition-all duration-200
              ${isSelected
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
              }
            `}
          >
            <ModeIcon
              className="w-3.5 h-3.5 flex-shrink-0"
              strokeWidth={1.5}
              style={{ color: isSelected ? m.color : undefined }}
            />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

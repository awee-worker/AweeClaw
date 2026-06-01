import { useState, useCallback, useEffect, useRef } from 'react'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

const STORAGE_KEY = 'aweeclaw-workflow-tour-completed'

interface TourStep {
  targetSelector: string
  title: string
  titleZh: string
  content: string
  contentZh: string
  placement: 'top' | 'bottom' | 'left' | 'right'
}

const TOUR_STEPS: TourStep[] = [
  {
    targetSelector: '.node-palette',
    title: 'Node Palette',
    titleZh: '节点面板',
    content: 'Drag and drop nodes from here to build your workflow. Each node represents a different action or step.',
    contentZh: '从这里拖拽节点来构建工作流。每个节点代表不同的操作或步骤。',
    placement: 'right',
  },
  {
    targetSelector: '.flow-canvas',
    title: 'Canvas',
    titleZh: '画布',
    content: 'This is your workflow canvas. Connect nodes by dragging from output handles to input handles. Scroll to zoom, drag to pan.',
    contentZh: '这是你的工作流画布。从输出端点拖拽到输入端点来连接节点。滚轮缩放，拖拽平移。',
    placement: 'top',
  },
  {
    targetSelector: '.property-panel',
    title: 'Property Panel',
    titleZh: '属性面板',
    content: 'Click any node to edit its settings here. Configure the node type, name, parameters and more.',
    contentZh: '点击任意节点来编辑其设置。可配置节点类型、名称、参数等。',
    placement: 'left',
  },
  {
    targetSelector: '.workflow-toolbar',
    title: 'Toolbar',
    titleZh: '工具栏',
    content: 'Save your workflow, run a test, access version history, share with your team, or monitor execution in real-time.',
    contentZh: '保存工作流、运行测试、查看版本历史、分享给团队、或实时监控执行。',
    placement: 'bottom',
  },
]

export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function setTourCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true')
  } catch {
    // Ignore
  }
}

interface WorkflowTourProps {
  visible: boolean
  onClose: () => void
  language: 'en' | 'zh'
}

export default function WorkflowTour({ visible, onClose, language }: WorkflowTourProps) {
  const [step, setStep] = useState(0)
  const [spotPosition, setSpotPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const tourRef = useRef<HTMLDivElement>(null)

  const computeSpot = useCallback((index: number) => {
    const stepData = TOUR_STEPS[index]
    if (!stepData) return

    const el = document.querySelector(stepData.targetSelector)
    if (!el) return

    const rect = el.getBoundingClientRect()
    setSpotPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  }, [])

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => computeSpot(step), 100)
      return () => clearTimeout(timer)
    }
  }, [visible, step, computeSpot])

  useEffect(() => {
    if (!visible) return

    const onResize = () => computeSpot(step)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible, step, computeSpot])

  const next = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) {
      const nextStep = step + 1
      setStep(nextStep)
      setTimeout(() => computeSpot(nextStep), 50)
    } else {
      setTourCompleted()
      onClose()
    }
  }, [step, onClose, computeSpot])

  const prev = useCallback(() => {
    if (step > 0) {
      const prevStep = step - 1
      setStep(prevStep)
      setTimeout(() => computeSpot(prevStep), 50)
    }
  }, [step, computeSpot])

  const skip = useCallback(() => {
    setTourCompleted()
    onClose()
  }, [onClose])

  if (!visible) return null

  const current = TOUR_STEPS[step]
  const isLast = step === TOUR_STEPS.length - 1

  const title = language === 'zh' ? current.titleZh : current.title
  const content = language === 'zh' ? current.contentZh : current.content

  return (
    <div ref={tourRef} className="fixed inset-0 z-[100]" style={{ pointerEvents: 'none' }}>
      {/* Spotlight overlay */}
      {spotPosition && (
        <>
          <div
            className="absolute bg-black/40 transition-all duration-300"
            style={{
              top: 0,
              left: 0,
              width: spotPosition.left,
              height: '100%',
            }}
          />
          <div
            className="absolute bg-black/40 transition-all duration-300"
            style={{
              top: 0,
              left: spotPosition.left + spotPosition.width,
              width: `calc(100% - ${spotPosition.left + spotPosition.width}px)`,
              height: '100%',
            }}
          />
          <div
            className="absolute bg-black/40 transition-all duration-300"
            style={{
              top: 0,
              left: spotPosition.left,
              width: spotPosition.width,
              height: spotPosition.top,
            }}
          />
          <div
            className="absolute bg-black/40 transition-all duration-300"
            style={{
              top: spotPosition.top + spotPosition.height,
              left: spotPosition.left,
              width: spotPosition.width,
              height: `calc(100% - ${spotPosition.top + spotPosition.height}px)`,
            }}
          />
          <div
            className="absolute rounded-lg ring-2 ring-blue-400 ring-offset-2 transition-all duration-300"
            style={{
              top: spotPosition.top,
              left: spotPosition.left,
              width: spotPosition.width,
              height: spotPosition.height,
            }}
          />
        </>
      )}

      {/* Tooltip card */}
      <div
        className="absolute bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5 max-w-sm transition-all duration-300"
        style={{
          pointerEvents: 'auto',
          ...(spotPosition
            ? {
                top: current.placement === 'top'
                  ? spotPosition.top - 16
                  : current.placement === 'bottom'
                    ? spotPosition.top + spotPosition.height + 16
                    : spotPosition.top + spotPosition.height / 2,
                left: current.placement === 'right'
                  ? spotPosition.left + spotPosition.width + 16
                  : current.placement === 'left'
                    ? spotPosition.left - 16
                    : spotPosition.left + spotPosition.width / 2,
                transform:
                  current.placement === 'top'
                    ? 'translate(-50%, -100%)'
                    : current.placement === 'bottom'
                      ? 'translate(-50%, 0)'
                      : current.placement === 'left'
                        ? 'translate(-100%, -50%)'
                        : 'translate(0, -50%)',
              }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{title}</h3>
          <button
            onClick={skip}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 ml-2 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">{content}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft size={14} />
                {t('wf.back', language as Language)}
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600"
            >
              {isLast ? (t('wf.finish', language as Language)) : (t('wf.next', language as Language))}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
        <button
          onClick={skip}
          className="mt-3 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 w-full text-center"
        >
          {t('wf.skiptour', language as Language)}
        </button>
      </div>
    </div>
  )
}
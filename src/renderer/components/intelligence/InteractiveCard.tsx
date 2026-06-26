/**
 * 交互式选项卡片
 * 用于 ask_user 工具引导用户选择，采用「状态机 + 子组件」架构：
 *  - 交互状态机：将选择/提交/展开抽象为有限状态机，避免散布的布尔标志
 *  - 选项策略：单选与多选走不同策略，自定义选项检测独立为纯函数
 *  - 子组件拆分：头部、选项行、自定义输入、提交栏各自独立
 */
import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { Check, ChevronDown, CheckCircle2, ArrowRight, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { InteractiveContent } from '@intelligence/providerTypes'
import { useStore } from '@store'
import { playNotificationSound } from '@utils/notificationSound'
import { t, type Language } from '@renderer/i18n'

interface InteractiveCardProps {
  content: InteractiveContent
  onSelect: (selectedIds: string[], customText?: string) => void
  disabled?: boolean
}

/** 选项基础结构 */
interface OptionItem {
  id: string
  label: string
  description?: string
}

/** 自定义选项关键词，用于识别「其他/自定义」类选项 */
const CUSTOM_KEYWORDS = ['custom', 'other', '其他', '自定义']

/** 判定选项是否为自定义类型 */
function detectCustomOption(option: OptionItem): boolean {
  const id = option.id.toLowerCase()
  const label = option.label.toLowerCase()
  return CUSTOM_KEYWORDS.some((kw) => id.includes(kw) || label.includes(kw))
}

/** 交互阶段：待选择 → 已提交 */
type InteractionPhase = 'selecting' | 'submitted'

/** 选择策略接口 */
interface SelectionStrategy {
  /** 切换某选项的选中状态，返回新的选中集合与是否需要展开自定义输入 */
  toggle: (current: Set<string>, optionId: string) => { next: Set<string>; revealCustom: boolean }
  /** 是否在选中后立即提交 */
  shouldAutoSubmit: boolean
}

/** 单选策略：清空后选中新项，非自定义时立即提交 */
function createSingleStrategy(options: OptionItem[]): SelectionStrategy {
  return {
    toggle: (_current, optionId) => {
      const option = options.find((o) => o.id === optionId)
      const isCustom = option ? detectCustomOption(option) : false
      const next = new Set([optionId])
      return { next, revealCustom: isCustom }
    },
    shouldAutoSubmit: true,
  }
}

/** 多选策略：切换选中态，自定义项联动输入框 */
function createMultiStrategy(options: OptionItem[]): SelectionStrategy {
  return {
    toggle: (current, optionId) => {
      const option = options.find((o) => o.id === optionId)
      const isCustom = option ? detectCustomOption(option) : false
      const next = new Set(current)
      let revealCustom = false
      if (next.has(optionId)) {
        next.delete(optionId)
        if (isCustom) revealCustom = false
      } else {
        next.add(optionId)
        if (isCustom) revealCustom = true
      }
      return { next, revealCustom }
    },
    shouldAutoSubmit: false,
  }
}

/** 根据多选标志构建策略 */
function resolveStrategy(multiSelect: boolean, options: OptionItem[]): SelectionStrategy {
  return multiSelect ? createMultiStrategy(options) : createSingleStrategy(options)
}

/** 交互状态机 Hook */
function useInteractionState(content: InteractiveContent, disabled?: boolean) {
  const hasExistingSelection = !!content.selectedIds?.length
  const [selected, setSelected] = useState<Set<string>>(new Set(content.selectedIds || []))
  const [phase, setPhase] = useState<InteractionPhase>(hasExistingSelection ? 'submitted' : 'selecting')
  const [expanded, setExpanded] = useState(!hasExistingSelection)
  const [customText, setCustomText] = useState('')
  const [customRevealed, setCustomRevealed] = useState(false)

  const strategy = useMemo(
    () => resolveStrategy(content.multiSelect ?? false, content.options),
    [content.multiSelect, content.options],
  )

  // 同步外部已选状态
  useEffect(() => {
    if (content.selectedIds?.length) {
      setSelected(new Set(content.selectedIds))
      setPhase('submitted')
      setExpanded(false)
    }
  }, [content.selectedIds])

  // 禁用时收起
  useEffect(() => {
    if (disabled && phase === 'submitted') setExpanded(false)
  }, [disabled, phase])

  const toggleOption = useCallback(
    (optionId: string, onSelect: (ids: string[], text?: string) => void) => {
      if (disabled || phase === 'submitted') return
      const option = content.options.find((o) => o.id === optionId)
      const isCustom = option ? detectCustomOption(option) : false
      const { next, revealCustom } = strategy.toggle(selected, optionId)
      setSelected(next)
      setCustomRevealed(revealCustom)

      // 单选且非自定义：延迟自动提交
      if (strategy.shouldAutoSubmit && !isCustom) {
        setTimeout(() => {
          setPhase('submitted')
          onSelect([optionId])
          setExpanded(false)
        }, 300)
      }
    },
    [disabled, phase, content.options, strategy, selected],
  )

  const submitMulti = useCallback(
    (onSelect: (ids: string[], text?: string) => void) => {
      if (selected.size === 0 || phase === 'submitted') return
      const selectedArr = Array.from(selected)
      const hasCustom = selectedArr.some((id) => {
        const opt = content.options.find((o) => o.id === id)
        return opt ? detectCustomOption(opt) : false
      })
      const text = hasCustom && customText.trim() ? customText.trim() : undefined
      setPhase('submitted')
      onSelect(selectedArr, text)
      setExpanded(false)
    },
    [selected, phase, content.options, customText],
  )

  const submitCustom = useCallback(
    (onSelect: (ids: string[], text?: string) => void) => {
      if (!customText.trim() || phase === 'submitted') return
      setPhase('submitted')
      onSelect(Array.from(selected), customText.trim())
      setExpanded(false)
    },
    [customText, phase, selected],
  )

  return {
    selected,
    phase,
    expanded,
    customText,
    customRevealed,
    setCustomText,
    setExpanded,
    toggleOption,
    submitMulti,
    submitCustom,
  }
}

/** 状态指示器：待选择/已提交 */
function StatusIndicator({ submitted }: { submitted: boolean }) {
  if (submitted) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-status-success/10 flex items-center justify-center">
        <CheckCircle2 className="w-2.5 h-2.5 text-status-success" />
      </div>
    )
  }
  return (
    <div className="w-3.5 h-3.5 rounded-full bg-status-warning/20 flex items-center justify-center border border-status-warning/30">
      <div className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
    </div>
  )
}

/** 卡片头部 */
function CardHeader({
  question,
  submitted,
  expanded,
  selectedLabels,
  onToggle,
}: {
  question: string
  submitted: boolean
  expanded: boolean
  selectedLabels: string
  onToggle: () => void
}) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 cursor-pointer select-none"
      onClick={onToggle}
    >
      <motion.div
        animate={{ rotate: expanded ? 90 : 0 }}
        transition={{ duration: 0.15 }}
        className="shrink-0 text-text-muted/85 hover:text-text-muted"
      >
        <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
      </motion.div>

      <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
        <StatusIndicator submitted={submitted} />
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
        <span
          className={`text-[12px] ${submitted && !expanded ? 'truncate' : ''} ${
            submitted
              ? 'text-text-secondary group-hover:text-text-primary transition-colors'
              : 'text-text-primary'
          }`}
        >
          {question}
        </span>
        {!expanded && submitted && (
          <span className="text-[12px] text-text-muted/85 truncate">— {selectedLabels}</span>
        )}
      </div>
    </div>
  )
}

/** 单个选项行 */
function OptionRow({
  option,
  index,
  isSelected,
  isDisabled,
  onToggle,
}: {
  option: OptionItem
  index: number
  isSelected: boolean
  isDisabled: boolean
  onToggle: () => void
}) {
  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onToggle}
      disabled={isDisabled}
      className={`
        w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left
        transition-all duration-150
        ${isSelected ? 'bg-accent/10 text-text-primary' : 'hover:bg-surface-hover/50 text-text-secondary'}
        ${isDisabled ? 'opacity-50 cursor-default' : 'cursor-pointer'}
      `}
    >
      <div
        className={`
          w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-all
          ${isSelected ? 'bg-accent border-accent' : 'border-text-muted/30 group-hover:border-accent/50'}
        `}
      >
        {isSelected && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
      </div>

      <div className="flex-1 min-w-0">
        <span className={`text-[12px] font-medium block ${isSelected ? 'text-text-primary' : ''}`}>
          {option.label}
        </span>
        {option.description && (
          <span className="text-[11px] text-text-muted block mt-0.5">{option.description}</span>
        )}
      </div>
    </motion.button>
  )
}

/** 自定义文本输入 */
function CustomTextInput({
  value,
  onChange,
  onSubmit,
  language,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  language: Language
  inputRef: React.RefObject<HTMLTextAreaElement>
}) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="relative z-10 mt-2"
    >
      <div className="relative">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder={t('ai.typeyourcustomresponse', language)}
          rows={2}
          className="w-full px-3 py-2 pr-10 text-[12px] text-text-primary bg-surface/60 border border-border/50 rounded-lg resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 placeholder:text-text-muted/85 transition-all custom-scrollbar"
        />
        <button
          onClick={onSubmit}
          disabled={!value.trim()}
          className={`absolute right-2 bottom-2 p-1 rounded-md transition-all ${
            value.trim() ? 'text-accent hover:bg-accent/10 active:scale-90' : 'text-text-muted/75 cursor-not-allowed'
          }`}
          title={t('ai.send', language)}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  )
}

/** 提交按钮 */
function SubmitButton({
  count,
  language,
  onSubmit,
  labelKey,
}: {
  count: number
  language: Language
  onSubmit: () => void
  labelKey: 'ai.confirm' | 'ai.confirm2'
}) {
  return (
    <div className="mt-2 flex justify-end relative z-10">
      <button
        onClick={onSubmit}
        disabled={count === 0}
        className={`
          flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-md transition-all
          ${count > 0 ? 'bg-accent text-accent-foreground hover:bg-accent-hover active:scale-95' : 'bg-surface/50 text-text-muted cursor-not-allowed'}
        `}
      >
        <span>{t(labelKey, language, { size: count })}</span>
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  )
}

/** 折叠动画容器 */
function ExpandPanel({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function InteractiveCard({ content, onSelect, disabled }: InteractiveCardProps) {
  const language = useStore((s) => s.language)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const state = useInteractionState(content, disabled)

  // 首次出现播放提示音
  useEffect(() => {
    if (!content.selectedIds?.length) playNotificationSound('interaction')
  }, [])

  // 自定义输入框聚焦
  useEffect(() => {
    if (state.customRevealed && inputRef.current) inputRef.current.focus()
  }, [state.customRevealed])

  const isSubmitted = state.phase === 'submitted'
  const isDisabled = disabled || isSubmitted

  const selectedLabels = useMemo(
    () => content.options.filter((o) => state.selected.has(o.id)).map((o) => o.label).join(', '),
    [content.options, state.selected],
  )

  return (
    <div
      className={`group my-0.5 relative rounded-lg overflow-hidden transition-colors ${
        isSubmitted ? 'hover:bg-text-primary/[0.02]' : 'bg-status-warning/5 border border-status-warning/15'
      }`}
    >
      <CardHeader
        question={content.question}
        submitted={isSubmitted}
        expanded={state.expanded}
        selectedLabels={selectedLabels}
        onToggle={() => state.setExpanded((v) => !v)}
      />

      <ExpandPanel expanded={state.expanded}>
        <div className="pl-[26px] pr-3 pb-2 pt-0 relative border-t-0">
          <div className="absolute left-[13.5px] top-0 bottom-2 w-[1.5px] bg-border/40 rounded-full" />

          <div className="relative z-10 mt-1 space-y-0.5">
            {content.options.map((option, index) => (
              <OptionRow
                key={option.id}
                option={option}
                index={index}
                isSelected={state.selected.has(option.id)}
                isDisabled={isDisabled}
                onToggle={() => state.toggleOption(option.id, onSelect)}
              />
            ))}
          </div>

          <AnimatePresence>
            {state.customRevealed && !isSubmitted && (
              <CustomTextInput
                value={state.customText}
                onChange={state.setCustomText}
                onSubmit={() => state.submitCustom(onSelect)}
                language={language}
                inputRef={inputRef}
              />
            )}
          </AnimatePresence>

          {content.multiSelect && !isSubmitted && !state.customRevealed && (
            <SubmitButton
              count={state.selected.size}
              language={language}
              onSubmit={() => state.submitMulti(onSelect)}
              labelKey="ai.confirm"
            />
          )}

          {content.multiSelect && !isSubmitted && state.customRevealed && (
            <SubmitButton
              count={state.selected.size}
              language={language}
              onSubmit={() => state.submitMulti(onSelect)}
              labelKey="ai.confirm2"
            />
          )}
        </div>
      </ExpandPanel>
    </div>
  )
}

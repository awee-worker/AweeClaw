/**
 * 输入模拟面板
 * 支持鼠标点击、移动、滚动、拖拽
 * 支持键盘文本输入、单键、组合键
 */

import { useState, useCallback } from 'react'
import { MousePointer, Move, ScrollText, Hand, Type, KeySquare, Keyboard } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

type MouseButton = 'left' | 'right' | 'middle'
type ClickType = 'single' | 'double'

interface InputSimulatorPanelProps {
  language: Language
}

export function InputSimulatorPanel({ language }: InputSimulatorPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 鼠标点击参数
  const [clickX, setClickX] = useState(100)
  const [clickY, setClickY] = useState(100)
  const [clickButton, setClickButton] = useState<MouseButton>('left')
  const [clickType, setClickType] = useState<ClickType>('single')

  // 鼠标移动参数
  const [moveX, setMoveX] = useState(100)
  const [moveY, setMoveY] = useState(100)
  const [moveSmooth, setMoveSmooth] = useState(true)
  const [moveDuration, setMoveDuration] = useState(300)

  // 鼠标滚动参数
  const [scrollX, setScrollX] = useState(100)
  const [scrollY, setScrollY] = useState(100)
  const [scrollAmount, setScrollAmount] = useState(3)

  // 鼠标拖拽参数
  const [dragFromX, setDragFromX] = useState(100)
  const [dragFromY, setDragFromY] = useState(100)
  const [dragToX, setDragToX] = useState(300)
  const [dragToY, setDragToY] = useState(300)
  const [dragButton, setDragButton] = useState<MouseButton>('left')
  const [dragDuration, setDragDuration] = useState(500)

  // 文本输入参数
  const [textInput, setTextInput] = useState('')
  const [textDelay, setTextDelay] = useState(0)

  // 单键参数
  const [singleKey, setSingleKey] = useState('Return')

  // 组合键参数
  const [comboKeys, setComboKeys] = useState('Control+c')

  const runAction = useCallback(async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      const result = (await action()) as { success: boolean; data?: { error?: string } }
      if (!result.success) {
        setError(result.data?.error || t('desktop.actionFailed', language) || '操作失败')
      }
    } catch (err) {
      logger.desktop?.error?.(`[InputSimulatorPanel] ${key} error:`, err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [language])

  const handleMouseClick = useCallback(() => {
    void runAction('click', () =>
      window.electronAPI.desktopMouseClick({ x: clickX, y: clickY, button: clickButton, clickType }),
    )
  }, [clickX, clickY, clickButton, clickType, runAction])

  const handleMouseMove = useCallback(() => {
    void runAction('move', () =>
      window.electronAPI.desktopMouseMove({ x: moveX, y: moveY, smooth: moveSmooth, duration: moveDuration }),
    )
  }, [moveX, moveY, moveSmooth, moveDuration, runAction])

  const handleMouseScroll = useCallback(() => {
    void runAction('scroll', () =>
      window.electronAPI.desktopMouseScroll({ x: scrollX, y: scrollY, amount: scrollAmount }),
    )
  }, [scrollX, scrollY, scrollAmount, runAction])

  const handleMouseDrag = useCallback(() => {
    void runAction('drag', () =>
      window.electronAPI.desktopMouseDrag({
        fromX: dragFromX,
        fromY: dragFromY,
        toX: dragToX,
        toY: dragToY,
        button: dragButton,
        duration: dragDuration,
      }),
    )
  }, [dragFromX, dragFromY, dragToX, dragToY, dragButton, dragDuration, runAction])

  const handleTypeText = useCallback(() => {
    if (!textInput.trim()) {
      setError(t('desktop.textEmpty', language) || '文本不能为空')
      return
    }
    void runAction('type', () => window.electronAPI.desktopTypeText(textInput, textDelay))
  }, [textInput, textDelay, language, runAction])

  const handlePressKey = useCallback(() => {
    if (!singleKey.trim()) {
      setError(t('desktop.keyEmpty', language) || '按键不能为空')
      return
    }
    void runAction('press', () => window.electronAPI.desktopPressKey(singleKey.trim()))
  }, [singleKey, language, runAction])

  const handleKeyCombo = useCallback(() => {
    const keys = comboKeys
      .split('+')
      .map(k => k.trim())
      .filter(Boolean)
    if (keys.length < 2) {
      setError(t('desktop.comboInvalid', language) || '组合键至少需要两个按键，用 + 分隔')
      return
    }
    void runAction('combo', () => window.electronAPI.desktopKeyCombo(keys))
  }, [comboKeys, language, runAction])

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-700 text-xs">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 鼠标点击 */}
        <ActionCard
          icon={<MousePointer className="w-4 h-4" />}
          title={t('desktop.mouseClick', language) || '鼠标点击'}
          busy={busy === 'click'}
          onRun={handleMouseClick}
          runLabel={t('desktop.click', language) || '点击'}
          language={language}
        >
          <NumberInput label="X" value={clickX} onChange={setClickX} />
          <NumberInput label="Y" value={clickY} onChange={setClickY} />
          <SelectInput
            label={t('desktop.button', language) || '按键'}
            value={clickButton}
            onChange={v => setClickButton(v as MouseButton)}
            options={[
              { value: 'left', label: t('desktop.leftButton', language) || '左键' },
              { value: 'right', label: t('desktop.rightButton', language) || '右键' },
              { value: 'middle', label: t('desktop.middleButton', language) || '中键' },
            ]}
          />
          <SelectInput
            label={t('desktop.clickType', language) || '点击类型'}
            value={clickType}
            onChange={v => setClickType(v as ClickType)}
            options={[
              { value: 'single', label: t('desktop.singleClick', language) || '单击' },
              { value: 'double', label: t('desktop.doubleClick', language) || '双击' },
            ]}
          />
        </ActionCard>

        {/* 鼠标移动 */}
        <ActionCard
          icon={<Move className="w-4 h-4" />}
          title={t('desktop.mouseMove', language) || '鼠标移动'}
          busy={busy === 'move'}
          onRun={handleMouseMove}
          runLabel={t('desktop.move', language) || '移动'}
          language={language}
        >
          <NumberInput label="X" value={moveX} onChange={setMoveX} />
          <NumberInput label="Y" value={moveY} onChange={setMoveY} />
          <CheckboxInput
            label={t('desktop.smoothMove', language) || '平滑移动'}
            checked={moveSmooth}
            onChange={setMoveSmooth}
          />
          <NumberInput
            label={t('desktop.durationMs', language) || '时长(ms)'}
            value={moveDuration}
            onChange={setMoveDuration}
            min={0}
          />
        </ActionCard>

        {/* 鼠标滚动 */}
        <ActionCard
          icon={<ScrollText className="w-4 h-4" />}
          title={t('desktop.mouseScroll', language) || '鼠标滚动'}
          busy={busy === 'scroll'}
          onRun={handleMouseScroll}
          runLabel={t('desktop.scroll', language) || '滚动'}
          language={language}
        >
          <NumberInput label="X" value={scrollX} onChange={setScrollX} />
          <NumberInput label="Y" value={scrollY} onChange={setScrollY} />
          <NumberInput
            label={t('desktop.scrollAmount', language) || '滚动量'}
            value={scrollAmount}
            onChange={setScrollAmount}
            min={-100}
          />
        </ActionCard>

        {/* 鼠标拖拽 */}
        <ActionCard
          icon={<Hand className="w-4 h-4" />}
          title={t('desktop.mouseDrag', language) || '鼠标拖拽'}
          busy={busy === 'drag'}
          onRun={handleMouseDrag}
          runLabel={t('desktop.drag', language) || '拖拽'}
          language={language}
        >
          <NumberInput label={t('desktop.fromX', language) || '起点X'} value={dragFromX} onChange={setDragFromX} />
          <NumberInput label={t('desktop.fromY', language) || '起点Y'} value={dragFromY} onChange={setDragFromY} />
          <NumberInput label={t('desktop.toX', language) || '终点X'} value={dragToX} onChange={setDragToX} />
          <NumberInput label={t('desktop.toY', language) || '终点Y'} value={dragToY} onChange={setDragToY} />
          <SelectInput
            label={t('desktop.button', language) || '按键'}
            value={dragButton}
            onChange={v => setDragButton(v as MouseButton)}
            options={[
              { value: 'left', label: t('desktop.leftButton', language) || '左键' },
              { value: 'right', label: t('desktop.rightButton', language) || '右键' },
              { value: 'middle', label: t('desktop.middleButton', language) || '中键' },
            ]}
          />
          <NumberInput
            label={t('desktop.durationMs', language) || '时长(ms)'}
            value={dragDuration}
            onChange={setDragDuration}
            min={0}
          />
        </ActionCard>

        {/* 文本输入 */}
        <ActionCard
          icon={<Type className="w-4 h-4" />}
          title={t('desktop.typeText', language) || '文本输入'}
          busy={busy === 'type'}
          onRun={handleTypeText}
          runLabel={t('desktop.type', language) || '输入'}
          language={language}
          fullWidth
        >
          <textarea
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder={t('desktop.textPlaceholder', language) || '请输入要模拟的文本...'}
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 resize-none"
          />
          <NumberInput
            label={t('desktop.delayMs', language) || '延迟(ms)'}
            value={textDelay}
            onChange={setTextDelay}
            min={0}
          />
        </ActionCard>

        {/* 单键 */}
        <ActionCard
          icon={<KeySquare className="w-4 h-4" />}
          title={t('desktop.pressKey', language) || '单键按下'}
          busy={busy === 'press'}
          onRun={handlePressKey}
          runLabel={t('desktop.press', language) || '按下'}
          language={language}
        >
          <input
            type="text"
            value={singleKey}
            onChange={e => setSingleKey(e.target.value)}
            placeholder={t('desktop.keyPlaceholder', language) || '如: Return, Tab, Escape'}
            className="w-full px-3 py-2 rounded-md bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
          <p className="text-xs text-text-muted col-span-2">
            {t('desktop.keyHint', language) || '常用键: Return, Tab, Escape, Space, Delete, Backspace, Up/Down/Left/Right'}
          </p>
        </ActionCard>

        {/* 组合键 */}
        <ActionCard
          icon={<Keyboard className="w-4 h-4" />}
          title={t('desktop.keyCombo', language) || '组合键'}
          busy={busy === 'combo'}
          onRun={handleKeyCombo}
          runLabel={t('desktop.combo', language) || '执行'}
          language={language}
          fullWidth
        >
          <input
            type="text"
            value={comboKeys}
            onChange={e => setComboKeys(e.target.value)}
            placeholder={t('desktop.comboPlaceholder', language) || '如: Control+c, Command+Shift+a'}
            className="w-full px-3 py-2 rounded-md bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
          <p className="text-xs text-text-muted col-span-2">
            {t('desktop.comboHint', language) || '修饰键: Control, Alt, Shift, Command, Meta, Super；用 + 连接'}
          </p>
        </ActionCard>
      </div>
    </div>
  )
}

/** 操作卡片容器 */
function ActionCard({
  icon,
  title,
  busy,
  onRun,
  runLabel,
  language,
  fullWidth = false,
  children,
}: {
  icon: React.ReactNode
  title: string
  busy: boolean
  onRun: () => void
  runLabel: string
  language: Language
  fullWidth?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`p-4 rounded-xl border border-border/40 bg-surface/50 ${fullWidth ? 'md:col-span-2' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-accent/10 text-accent">{icon}</div>
        <span className="text-sm font-medium text-text-primary">{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">{children}</div>
      <ActionButton onClick={onRun} variant="primary" size="sm" disabled={busy} className="w-full">
        {busy ? (t('desktop.executing', language) || '执行中...') : runLabel}
      </ActionButton>
    </div>
  )
}

/** 数字输入 */
function NumberInput({
  label,
  value,
  onChange,
  min,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
      />
    </div>
  )
}

/** 选择输入 */
function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** 复选框 */
function CheckboxInput({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 col-span-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-accent"
      />
      <span className="text-xs text-text-muted">{label}</span>
    </label>
  )
}

export default InputSimulatorPanel

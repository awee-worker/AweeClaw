/**
 * VrmCompanionSettings — 桌面伴侣（VRM 3D 角色悬浮窗）设置面板
 *
 * 能力：
 * - 开关伴侣窗口、随应用启动自动显示
 * - 窗口表现：置顶、锁定位置、不透明度、尺寸、复位到右下角
 * - 角色表现：待机动作（呼吸/摇摆/眨眼）、视线跟随鼠标、角色缩放
 * - 模型管理：选择 / 导入（文件对话框）/ 删除用户模型
 * - 鼠标穿透开关（穿透后窗口不遮挡桌面操作，需回到此处关闭）
 * - 好感度数据查看（由 AI 回复中的 `<user=名称 love=数值>` 标签驱动）
 *
 * 数据来源：全部经 window.electronAPI.vrmCompanion.* 与主进程通信。
 * 状态同步：`clickThrough` 等运行时状态只存在于主进程内存，需经 `getState` 读取并轮询同步，
 * 否则会出现「开关点了没反应」的假象（历史 bug）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, Plus, Trash2, Upload } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  VrmAffectionData,
  VrmCompanionConfig,
  VrmModelInfo,
} from '@renderer/types/electronBridge'

/**
 * 伴侣窗口默认宽高比（高 / 宽 = 480 / 320）。
 *
 * 尺寸调整一律按此比例同比缩放，理由见「窗口尺寸」滑块处的注释。
 */
const WINDOW_ASPECT = 1.5
/** 宽度可调范围，与主进程 VrmCompanionManager 的 MIN_WIDTH / MAX_WIDTH 保持一致 */
const MIN_WINDOW_WIDTH = 200
const MAX_WINDOW_WIDTH = 720
/** 默认宽度，与主进程 DEFAULT_COMPANION_WIDTH 保持一致 */
const DEFAULT_WINDOW_WIDTH = 320

interface VrmCompanionSettingsProps {
  language: Language
}

/** 面板内的通用卡片容器 */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
      {children}
    </section>
  )
}

/** 通用开关行 */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-text-muted">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export function VrmCompanionSettings({ language }: VrmCompanionSettingsProps) {
  const zh = language === 'zh'

  const [config, setConfig] = useState<VrmCompanionConfig | null>(null)
  const [models, setModels] = useState<VrmModelInfo[]>([])
  const [affection, setAffection] = useState<VrmAffectionData>({})
  const [visible, setVisible] = useState(false)
  const [clickThrough, setClickThrough] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)


  /** 尺寸滑块位置（真实宽度收敛到可调范围，避免历史越界值让滑块错位） */
  const sliderWidth = Math.min(
    MAX_WINDOW_WIDTH,
    Math.max(MIN_WINDOW_WIDTH, Math.round(config?.width ?? DEFAULT_WINDOW_WIDTH)),
  )
  /** 面板展示的当前尺寸（取真实值：用户直接拖动窗口边界后也能如实反映） */
  const showWidth = Math.round(config?.width ?? DEFAULT_WINDOW_WIDTH)
  const showHeight = Math.round(config?.height ?? showWidth * WINDOW_ASPECT)
  // --------------------------------------------
  // 初始化 / 状态同步
  // --------------------------------------------
  /**
   * 拉取配置与运行时状态。
   *
   * 关键修正：`clickThrough` 只存在于主进程内存（不落盘），必须通过 `getState` 读取。
   * 早期版本没有这个接口，面板里穿透开关永远显示「关闭」，
   * 用户点击时既看不到变化也无法确认是否生效 —— 这是「开关设置项无效」的主因。
   */
  const refresh = useCallback(async () => {
    try {
      const [configRes, modelsRes, stateRes, affectionRes] = await Promise.all([
        api.vrmCompanion.getConfig(),
        api.vrmCompanion.listModels(),
        api.vrmCompanion.getState(),
        api.vrmCompanion.getAffection(),
      ])
      if (configRes.success && configRes.data) setConfig(configRes.data)
      if (modelsRes.success && modelsRes.data) setModels(modelsRes.data)
      if (stateRes.success && stateRes.data) {
        setVisible(stateRes.data.visible)
        setClickThrough(stateRes.data.clickThrough)
      }
      if (affectionRes.success && affectionRes.data) setAffection(affectionRes.data)
      setError(null)
    } catch (err) {
      logger.system.warn('[VrmCompanionSettings] Load failed:', err)
      setError(zh ? '读取配置失败' : 'Failed to load settings')
    }
  }, [zh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * 定时同步运行时状态。
   *
   * 伴侣窗口自带控制栏（穿透 / 锁定 / 隐藏），用户可能在那边改动，
   * 而主进程不会向主窗口广播这些事件；轮询保证本面板开关始终反映真实值，
   * 避免出现「面板显示关闭、实际已穿透」这类状态漂移。
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.vrmCompanion
        .getState()
        .then((res) => {
          if (res.success && res.data) {
            setVisible(res.data.visible)
            setClickThrough(res.data.clickThrough)
          }
        })
        .catch(() => {})
    }, 2500)
    return () => window.clearInterval(timer)
  }, [])

  // --------------------------------------------
  // 操作
  // --------------------------------------------
  const updateConfig = useCallback(
    async (partial: Partial<VrmCompanionConfig>) => {
      // 乐观更新：先落本地状态，避免滑动条 / 开关看起来「卡住不响应」
      setConfig((prev) => (prev ? { ...prev, ...partial } : prev))
      try {
        const res = await api.vrmCompanion.updateConfig(partial)
        if (res.success && res.data) setConfig(res.data)
        else if (!res.success) setError(res.error ?? 'UPDATE_FAILED')
      } catch (err) {
        logger.system.warn('[VrmCompanionSettings] updateConfig failed:', err)
        setError(zh ? '保存失败' : 'Failed to save')
        // 失败时回滚为真实状态
        await refresh()
      }
    },
    [refresh, zh],
  )

  /**
   * 调整窗口尺寸（同比）。
   *
   * 只传宽度，高度按固定比例同步 —— 宽高各自独立时用户常常只改一边，
   * 窗口比例被破坏后角色在取景框里被裁；同比缩放则渲染比例不变，只是整体变大。
   */
  const handleResizeWindow = useCallback(
    (width: number) => {
      const w = Math.min(MAX_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, Math.round(width)))
      void updateConfig({ width: w, height: Math.round(w * WINDOW_ASPECT) })
    },
    [updateConfig],
  )

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      setBusy(true)
      setError(null)
      try {
        if (next) await api.vrmCompanion.show()
        else await api.vrmCompanion.hide()
        await updateConfig({ enabled: next })
        const stateRes = await api.vrmCompanion.getState()
        setVisible(stateRes.success ? !!stateRes.data?.visible : next)
      } catch (err) {
        logger.system.warn('[VrmCompanionSettings] toggle enabled failed:', err)
        setError(zh ? '操作失败' : 'Action failed')
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh, updateConfig, zh],
  )

  const handleImport = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.vrmCompanion.importModel()
      if (!res.success) {
        if (res.error !== 'CANCELED') setError(zh ? '导入失败' : 'Import failed')
        return
      }
      if (res.data?.id) {
        const selRes = await api.vrmCompanion.selectModel(res.data.id)
        if (selRes.success && selRes.data) setConfig(selRes.data)
      }
      await refresh()
    } catch (err) {
      logger.system.warn('[VrmCompanionSettings] import failed:', err)
      setError(zh ? '导入失败' : 'Import failed')
    } finally {
      setBusy(false)
    }
  }, [refresh, zh])

  const handleSelect = useCallback(
    async (id: string) => {
      try {
        const res = await api.vrmCompanion.selectModel(id)
        if (res.success && res.data) setConfig(res.data)
        setModels((prev) => prev.map((m) => ({ ...m, selected: m.id === id })))
      } catch (err) {
        logger.system.warn('[VrmCompanionSettings] select model failed:', err)
        setError(zh ? '切换模型失败' : 'Failed to select model')
      }
    },
    [zh],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await api.vrmCompanion.deleteModel(id)
        if (!res.success) {
          setError(zh ? '删除失败' : 'Delete failed')
          return
        }
        await refresh()
      } catch (err) {
        logger.system.warn('[VrmCompanionSettings] delete failed:', err)
        setError(zh ? '删除失败' : 'Delete failed')
      }
    },
    [refresh, zh],
  )

  const handleToggleClickThrough = useCallback(
    async (next: boolean) => {
      // 乐观更新开关位置（穿透只影响伴侣窗口，本面板仍可操作）
      setClickThrough(next)
      setError(null)
      try {
        const res = await api.vrmCompanion.setClickThrough(next)
        if (res.success && res.data) setClickThrough(res.data.clickThrough)
      } catch (err) {
        logger.system.warn('[VrmCompanionSettings] click-through failed:', err)
        setClickThrough(!next)
        setError(zh ? '操作失败' : 'Action failed')
      }
    },
    [zh],
  )

  /** 复位窗口到默认位置（右下角），解决拖到屏幕外后无法找回 */
  const handleResetPosition = useCallback(async () => {
    setError(null)
    try {
      const res = await api.vrmCompanion.resetPosition()
      if (!res.success) {
        setError(
          res.error === 'WINDOW_NOT_CREATED'
            ? zh
              ? '请先启用桌面伴侣'
              : 'Enable the companion first'
            : zh
              ? '复位失败'
              : 'Reset failed',
        )
      }
    } catch (err) {
      logger.system.warn('[VrmCompanionSettings] reset position failed:', err)
      setError(zh ? '复位失败' : 'Reset failed')
    }
  }, [zh])

  const formatSize = (bytes: number): string => {
    if (!bytes) return '-'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  return (
    <div className="space-y-4 animate-fade-in">
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      ) : null}

      {/* 基础开关 */}
      <Card>
        <div className="text-sm font-semibold text-text-primary">
          {zh ? '桌面伴侣' : 'Desktop Companion'}
        </div>
        <div className="text-xs text-text-muted">
          {zh
            ? '在桌面显示一个独立的 3D 角色（VRM）悬浮窗，可与语音对话、好感度系统联动。'
            : 'Show a standalone 3D VRM character overlay on your desktop.'}
        </div>
        <ToggleRow
          label={zh ? '启用桌面伴侣' : 'Enable companion'}
          hint={zh ? '开启后在桌面右下角显示角色窗口' : 'Show the character window at bottom-right'}
          checked={visible}
          disabled={busy}
          onChange={(next) => void handleToggleEnabled(next)}
        />
        <ToggleRow
          label={zh ? '随应用启动' : 'Show on startup'}
          hint={zh ? '应用启动时自动显示角色窗口' : 'Automatically show when app starts'}
          checked={config?.showOnStartup ?? false}
          onChange={(next) => void updateConfig({ showOnStartup: next })}
        />
        <ToggleRow
          label={zh ? '鼠标穿透' : 'Click-through'}
          hint={
            zh
              ? '默认开启：点击直接落到桌面上，不遮挡桌面操作。穿透状态下鼠标移到角色上仍会浮出操作栏（含关闭穿透的按钮），因此不会失去操作入口。'
              : 'On by default: clicks pass through to the desktop. Hovering the character still reveals the control bar, so the window never becomes unreachable.'
          }
          checked={clickThrough}
          onChange={(next) => void handleToggleClickThrough(next)}
        />
      </Card>

      {/* 窗口表现 */}
      <Card>
        <div className="text-sm font-semibold text-text-primary">
          {zh ? '窗口表现' : 'Window'}
        </div>
        <ToggleRow
          label={zh ? '置顶显示' : 'Always on top'}
          hint={zh ? '角色窗口始终浮在其他应用之上' : 'Keep the character above other windows'}
          checked={config?.alwaysOnTop ?? true}
          onChange={(next) => void updateConfig({ alwaysOnTop: next })}
        />
        <ToggleRow
          label={zh ? '锁定位置' : 'Lock position'}
          hint={zh ? '锁定后无法拖动窗口，避免误触移动' : 'Prevent accidental drags'}
          checked={config?.locked ?? false}
          onChange={(next) => void updateConfig({ locked: next })}
        />

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-text-primary">
              {zh ? '不透明度' : 'Opacity'}
            </div>
            <div className="text-xs text-text-muted">
              {Math.round((config?.opacity ?? 1) * 100)}%
            </div>
          </div>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={config?.opacity ?? 1}
            onChange={(e) => void updateConfig({ opacity: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        {/*
          窗口尺寸：单一滑块，宽高按固定比例同比缩放。

          早期版本拆成「宽度」「高度」两个独立滑块，用户往往只拉一边：
          窗口比例被破坏后取景框与窗口边界不再匹配，角色看起来被裁；
          同比缩放则宽高一起涨、渲染比例不变，只是整体变大。
        */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-text-primary">
              {zh ? '窗口尺寸' : 'Window size'}
            </div>
            <div className="text-xs text-text-muted">
              {showWidth} × {showHeight} px
            </div>
          </div>
          <input
            type="range"
            min={MIN_WINDOW_WIDTH}
            max={MAX_WINDOW_WIDTH}
            step={20}
            value={sliderWidth}
            onChange={(e) => handleResizeWindow(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[11px] text-text-muted">
            <span>{zh ? '小' : 'Small'}</span>
            <span>{zh ? '大' : 'Large'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleResetPosition()}
          className="w-full rounded-xl border border-border/40 bg-surface-active/60 px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-active"
        >
          {zh ? '重置到右下角' : 'Reset to bottom-right'}
        </button>
      </Card>

      {/* 角色表现 */}
      <Card>
        <div className="text-sm font-semibold text-text-primary">
          {zh ? '角色表现' : 'Character'}
        </div>
        <ToggleRow
          label={zh ? '待机动作' : 'Idle animation'}
          hint={
            zh
              ? '呼吸、身体摇摆、手臂摆动与自动眨眼'
              : 'Breathing, body sway, arm swing and blinking'
          }
          checked={config?.idleAnimation ?? true}
          onChange={(next) => void updateConfig({ idleAnimation: next })}
        />
        <ToggleRow
          label={zh ? '视线跟随鼠标' : 'Look at cursor'}
          hint={zh ? '角色视线跟随鼠标位置移动' : 'Character eyes and head follow the cursor'}
          checked={config?.lookAtCursor ?? true}
          onChange={(next) => void updateConfig({ lookAtCursor: next })}
        />
        <ToggleRow
          label={zh ? '自动隐藏' : 'Auto hide'}
          hint={
            zh
              ? '鼠标移到角色身上时角色淡出并让开点击，移开后自动恢复'
              : 'Fade out and step aside when the cursor touches the character'
          }
          checked={config?.autoHide ?? false}
          onChange={(next) => void updateConfig({ autoHide: next })}
        />

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-text-primary">
              {zh ? '角色大小' : 'Character scale'}
            </div>
            <div className="text-xs text-text-muted">{(config?.scale ?? 1).toFixed(2)}×</div>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={config?.scale ?? 1}
            onChange={(e) => void updateConfig({ scale: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[11px] text-text-muted">
            <span>0.5×</span>
            <span>1.0×</span>
            <span>2.0×</span>
          </div>
        </div>
      </Card>

      {/* 模型管理 */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {zh ? '角色模型' : 'Character models'}
            </div>
            <div className="mt-0.5 text-xs text-text-muted">
              {zh
                ? '内置模型随应用分发；用户导入的模型保存在用户数据目录，不随卸载删除。'
                : 'Built-in models ship with the app; imported models are kept in user data.'}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleImport()}
            className="flex items-center gap-1.5 rounded-xl border border-border/40 bg-surface-active/60 px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-active disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {zh ? '导入模型' : 'Import'}
          </button>
        </div>

        {models.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 px-3 py-6 text-center text-xs text-text-muted">
            {zh
              ? '暂无可用模型。点击「导入模型」添加 .vrm 文件，或将模型放入内置 models 目录。'
              : 'No models available. Import a .vrm file to get started.'}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {models.map((model) => (
              <li
                key={model.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                  model.selected
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-border/40 bg-surface/60 hover:bg-surface-active/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void handleSelect(model.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      model.selected ? 'bg-accent' : 'bg-border'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">
                      {model.name}
                    </span>
                    <span className="block text-[11px] text-text-muted">
                      {model.source === 'builtin' ? (zh ? '内置' : 'Built-in') : zh ? '用户导入' : 'Imported'}
                      {' · '}
                      {formatSize(model.size)}
                    </span>
                  </span>
                </button>
                {model.source === 'user' ? (
                  <button
                    type="button"
                    title={zh ? '删除模型' : 'Delete model'}
                    onClick={() => void handleDelete(model.id)}
                    className="flex-shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <Plus className="h-3 w-3" />
          {zh
            ? '支持 VRM 0.x / 1.0 与 .glb；单模型建议不超过 30MB'
            : 'Supports VRM 0.x / 1.0 and .glb; keep each model under 30MB'}
        </div>
      </Card>

      {/* 好感度 */}
      <Card>
        <div className="text-sm font-semibold text-text-primary">
          {zh ? '好感度' : 'Affection'}
        </div>
        <div className="text-xs text-text-muted">
          {zh
            ? 'AI 回复中出现 <user=名称 love=数值> 形式的标签时会自动记录，用于角色表现。'
            : 'Recorded automatically when AI replies contain <user=name love=value> tags.'}
        </div>
        {Object.keys(affection).length === 0 ? (
          <div className="text-xs text-text-muted">{zh ? '暂无记录' : 'No records yet'}</div>
        ) : (
          <ul className="space-y-1">
            {Object.entries(affection).map(([userName, stats]) => (
              <li
                key={userName}
                className="flex items-center justify-between rounded-xl border border-border/40 bg-surface/60 px-3 py-2"
              >
                <span className="text-xs font-medium text-text-primary">{userName}</span>
                <span className="flex flex-wrap justify-end gap-2">
                  {Object.entries(stats).map(([key, value]) => (
                    <span key={key} className="text-[11px] text-text-muted">
                      {key}
                      <span className="ml-1 font-semibold text-accent">{value}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 当前状态 */}
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        {visible
          ? zh
            ? '伴侣窗口当前显示中'
            : 'Companion window is visible'
          : zh
            ? '伴侣窗口当前隐藏'
            : 'Companion window is hidden'}
      </div>
    </div>
  )
}

export default VrmCompanionSettings

/**
 * 设置页统一保存栏
 *
 * 全站设置页共用同一个底部浮动保存栏：由 PreferencesDialog 统一渲染在内容区底部，
 * 保证位置、样式与交互完全一致。各子面板通过 useSettingsSaveSlot 上报自身的
 * 脏状态与保存动作，保存栏的渲染与定位由父级负责；未上报的页面回落到全局偏好状态。
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Check, Loader2 } from 'lucide-react'

/** 子面板上报给保存栏的槽位状态 */
export interface SettingsSaveSlot {
  /** 是否存在未保存改动（保存栏的显示条件） */
  isDirty: boolean
  /** 是否正在保存 */
  isSaving?: boolean
  /** 是否允许保存（必填项缺失等情况下为 false） */
  canSave?: boolean
  /** 保存动作 */
  onSave: () => void | Promise<void>
  /** 放弃改动并恢复到已保存状态 */
  onReset?: () => void
}

/** 子面板向父级注册保存槽位的 setter */
export const SettingsSaveSlotContext =
  createContext<Dispatch<SetStateAction<SettingsSaveSlot | null>> | null>(null)

/**
 * 在当前设置页注册保存槽位：挂载时上报，卸载时清除，脏状态变化时同步给父级。
 * 子面板只需关心自己的脏状态与保存动作，无需再自行渲染保存栏。
 */
export function useSettingsSaveSlot(slot: SettingsSaveSlot): void {
  const setSlot = useContext(SettingsSaveSlotContext)
  const { isDirty, isSaving = false, canSave = true, onSave, onReset } = slot

  // 动作引用经 ref 转存：避免子面板每次渲染重建回调而反复触发重注册
  const latest = useRef({ onSave, onReset })
  latest.current = { onSave, onReset }

  useEffect(() => {
    if (!setSlot) return
    setSlot({
      isDirty,
      isSaving,
      canSave,
      onSave: () => latest.current.onSave(),
      onReset: latest.current.onReset ? () => latest.current.onReset?.() : undefined,
    })
    return () => setSlot(null)
  }, [setSlot, isDirty, isSaving, canSave])
}

export interface SettingsSaveBarProps {
  /** 左侧提示文案 */
  hint: string
  /** 保存按钮文案 */
  saveLabel: string
  /** 保存中按钮文案 */
  savingLabel: string
  /** 取消按钮文案（与 onCancel 同时提供时才显示） */
  cancelLabel?: string
  onSave: () => void
  onCancel?: () => void
  isSaving?: boolean
  canSave?: boolean
}

/**
 * 底部浮动保存栏（纯展示组件）。
 *
 * 需放置在一个 relative 的内容容器内，以固定在内容区底部。
 */
export function SettingsSaveBar({
  hint,
  saveLabel,
  savingLabel,
  cancelLabel,
  onSave,
  onCancel,
  isSaving = false,
  canSave = true,
}: SettingsSaveBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-8 bottom-6 z-20 animate-slide-up">
        <div className="pointer-events-auto relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border/60 bg-popover px-5 py-3.5 shadow-xl shadow-black/25 backdrop-blur-xl">
        {/* 顶部高光描边 */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-warning/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-status-warning" />
          </span>
          <span className="truncate text-xs font-medium text-text-secondary">{hint}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {onCancel && cancelLabel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="inline-flex items-center rounded-xl border border-transparent px-3.5 py-2 text-[13px] font-medium text-text-secondary transition-all duration-200 hover:border-border/60 hover:bg-text-primary/[0.05] hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || !canSave}
            className="group inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl border border-accent/20 bg-accent px-5 py-2 text-[13px] font-semibold text-white shadow-lg shadow-accent/25 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {savingLabel}
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
                {saveLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

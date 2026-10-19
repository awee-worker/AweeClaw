/**
 * 设备模拟选择器
 *
 * 挂在内置浏览器工具栏：选设备档位、自定义尺寸、横竖屏旋转。
 *
 * 只负责「选择」——实际状态由 previewSessionService 持有，本组件通过 onChange
 * 回传意图。这样用户手点与 AI 的 browser_set_device 工具最终落到同一份状态。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Monitor, RotateCw, Smartphone } from 'lucide-react'
import {
  DESKTOP_PROFILE,
  DEVICE_PRESETS,
  resolveDevice,
  type PreviewSession,
} from '@shared/protocols/previewProtocol'
import { ActionButton, HintOverlay } from '@components/ui'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface BrowserDeviceSelectorProps {
  /** 当前预览会话（提供设备档位信息） */
  session?: PreviewSession | null
  /** 切换设备档位；自定义或横竖屏时带上实际宽高 */
  onChange: (deviceId: string, width?: number, height?: number) => void
}

export default function BrowserDeviceSelector({ session, onChange }: BrowserDeviceSelectorProps) {
  const language = useStore((state) => state.language) as Language
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const device = useMemo(
    () => resolveDevice(session ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.deviceId, session?.deviceViewport?.width, session?.deviceViewport?.height],
  )
  const isDesktop = device.isDesktop

  const [customWidth, setCustomWidth] = useState(String(device.width || 390))
  const [customHeight, setCustomHeight] = useState(String(device.height || 844))

  // 打开菜单时把当前尺寸同步进自定义输入，方便在其基础上微调
  useEffect(() => {
    if (!open) return
    setCustomWidth(String(device.width || 390))
    setCustomHeight(String(device.height || 844))
  }, [open, device.width, device.height])

  // 点击组件外部关闭菜单
  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const title = isDesktop
    ? t('editor.browser.device', language)
    : t('editor.browser.deviceTitle', language, { name: `${device.name} ${device.width}×${device.height}` })

  const selectPreset = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const applyCustom = () => {
    const width = Number.parseInt(customWidth, 10)
    const height = Number.parseInt(customHeight, 10)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
      return
    }
    onChange('custom', width, height)
    setOpen(false)
  }

  const rotate = () => {
    if (isDesktop) return
    // 交换宽高即横竖屏切换；预设档位也用显式宽高覆盖，保证自定义与预设一致
    onChange(device.id, device.height, device.width)
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <HintOverlay content={title}>
        <ActionButton
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${!isDesktop ? 'text-accent ring-2 ring-accent/30' : ''}`}
          onClick={() => setOpen((value) => !value)}
          aria-label={t('editor.browser.device', language)}
          aria-pressed={!isDesktop}
        >
          {isDesktop ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
        </ActionButton>
      </HintOverlay>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 z-50 rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/25 overflow-hidden">
          <div className="max-h-72 overflow-auto custom-scrollbar py-1">
            {DEVICE_PRESETS.map((preset) => {
              const active =
                preset.id === DESKTOP_PROFILE.id ? isDesktop : session?.deviceId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-text-primary/[0.05] transition-colors"
                >
                  {preset.id === DESKTOP_PROFILE.id ? (
                    <Monitor className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                  ) : (
                    <Smartphone className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                  )}
                  <span className="flex-1 min-w-0 text-[12px] text-text-primary truncate">
                    {preset.id === DESKTOP_PROFILE.id
                      ? t('editor.browser.deviceDesktop', language)
                      : preset.name}
                  </span>
                  {preset.id !== DESKTOP_PROFILE.id && (
                    <span className="shrink-0 text-[10.5px] text-text-muted tabular-nums">
                      {preset.width}×{preset.height}
                    </span>
                  )}
                  {active && <Check className="w-3.5 h-3.5 shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>

          <div className="border-t border-border/50 px-3 py-2 space-y-2">
            <div className="text-[10.5px] font-medium text-text-muted uppercase tracking-wider">
              {t('editor.browser.deviceCustom', language)}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={customWidth}
                onChange={(event) => setCustomWidth(event.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(event) => event.key === 'Enter' && applyCustom()}
                inputMode="numeric"
                className="w-full min-w-0 h-7 px-2 rounded-md bg-text-primary/[0.05] border border-border/40 focus:border-accent/50 outline-none text-[11px] text-text-primary tabular-nums"
                aria-label={t('editor.browser.deviceWidth', language)}
                placeholder={t('editor.browser.deviceWidth', language)}
              />
              <span className="text-text-muted text-[11px] shrink-0">×</span>
              <input
                value={customHeight}
                onChange={(event) => setCustomHeight(event.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(event) => event.key === 'Enter' && applyCustom()}
                inputMode="numeric"
                className="w-full min-w-0 h-7 px-2 rounded-md bg-text-primary/[0.05] border border-border/40 focus:border-accent/50 outline-none text-[11px] text-text-primary tabular-nums"
                aria-label={t('editor.browser.deviceHeight', language)}
                placeholder={t('editor.browser.deviceHeight', language)}
              />
              <button
                type="button"
                onClick={applyCustom}
                className="shrink-0 h-7 px-2.5 rounded-md text-[11px] text-accent hover:bg-accent/10 transition-colors"
              >
                {t('editor.browser.deviceApply', language)}
              </button>
            </div>

            <button
              type="button"
              onClick={rotate}
              disabled={isDesktop}
              className="w-full flex items-center justify-center gap-1.5 h-7 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-text-primary/[0.05] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {t('editor.browser.deviceRotate', language)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

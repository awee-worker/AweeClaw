/**
 * OverlaySettings — 字幕 / 弹幕悬浮层设置面板
 *
 * 两种使用方式（面板内都能配）：
 * 1. **外部模式（OBS）**：开启内置 HTTP + WS 服务，把面板里给出的地址填进
 *    OBS 的「浏览器源」即可显示字幕/弹幕。OBS 是独立浏览器环境，因此这条
 *    链路必须走网络，不能用 IPC。
 * 2. **应用内模式**：开一个透明悬浮窗口（可拖动 / 点击穿透），用于桌面常驻字幕。
 *
 * 数据来源：全部经 window.electronAPI.overlay.*（API 层 api.overlay）与主进程通信。
 * 状态同步：服务端口可能因占用而上浮，必须以 getStatus 返回的实际端口为准展示地址，
 * 否则用户复制到 OBS 里的 URL 会连不上。
 */

import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Eye, EyeOff, Send, Square } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  OverlayConfig,
  OverlayConfigPatch,
  OverlayStatus,
} from '@renderer/types/electronBridge'

interface OverlaySettingsProps {
  language: Language
}

/** 面板内的通用卡片容器 */
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
      {title ? <div className="text-sm font-medium text-text-primary">{title}</div> : null}
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

/** 滑块行 */
function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-primary">{label}</span>
        <span className="text-text-muted tabular-nums">
          {value}
          {suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full accent-[var(--accent)] ${disabled ? 'opacity-50' : ''}`}
      />
    </div>
  )
}

export function OverlaySettings({ language }: OverlaySettingsProps) {
  const zh = language === 'zh'

  const [config, setConfig] = useState<OverlayConfig | null>(null)
  const [status, setStatus] = useState<OverlayStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testText, setTestText] = useState('')

  // --------------------------------------------
  // 初始化 / 状态同步
  // --------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        api.overlay.getConfig(),
        api.overlay.getStatus(),
      ])
      if (configRes.success && configRes.data) setConfig(configRes.data)
      if (statusRes.success && statusRes.data) setStatus(statusRes.data)
      setError(null)
    } catch (err) {
      logger.system.warn('[OverlaySettings] Load failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    // 连接数 / 端口属于运行时状态，需要轮询才准确
    const timer = setInterval(() => {
      void refresh()
    }, 2000)
    return () => clearInterval(timer)
  }, [refresh])

  /** 更新配置（主进程按需启停服务与窗口） */
  const patchConfig = useCallback(
    async (patch: OverlayConfigPatch) => {
      try {
        const res = await api.overlay.updateConfig(patch)
        if (res.success && res.data) setConfig(res.data)
        else if (!res.success) setError(res.error ?? 'update failed')
        void refresh()
      } catch (err) {
        logger.system.warn('[OverlaySettings] updateConfig failed:', err)
      }
    },
    [refresh],
  )

  const handleCopy = useCallback(async (text: string) => {
    if (!text) return
    try {
      await api.overlay.copyText(text)
    } catch (err) {
      logger.system.warn('[OverlaySettings] copy failed:', err)
    }
  }, [])

  const handleOpen = useCallback(async (url: string) => {
    if (!url) return
    try {
      await api.overlay.openExternalUrl(url)
    } catch (err) {
      logger.system.warn('[OverlaySettings] open failed:', err)
    }
  }, [])

  /** 推送测试内容，验证 OBS / 悬浮窗链路 */
  const handleSendTest = useCallback(async () => {
    const text = testText.trim() || (zh ? '这是一条测试字幕' : 'This is a test subtitle')
    try {
      if (config?.windowMode === 'danmaku') {
        await api.overlay.pushDanmaku({ content: text, danmu_type: 'danmaku' })
      } else {
        await api.overlay.showSubtitle(text)
      }
      setTestText('')
    } catch (err) {
      logger.system.warn('[OverlaySettings] send test failed:', err)
    }
  }, [testText, config?.windowMode, zh])

  if (!config) {
    return (
      <div className="p-4 text-sm text-text-muted">
        {zh ? '加载中…' : 'Loading…'}
        {error ? <div className="mt-2 text-xs text-red-400">{error}</div> : null}
      </div>
    )
  }

  const port = status?.port || config.port
  const subtitleUrl = status?.urls.subtitle || `http://127.0.0.1:${port}/overlay.html?mode=subtitle`
  const danmakuUrl = status?.urls.danmaku || `http://127.0.0.1:${port}/overlay.html?mode=danmaku`

  return (
    <div className="space-y-4 p-1">
      {/* ============================================
       * 总开关
       * ============================================ */}
      <Card>
        <ToggleRow
          label={zh ? '启用悬浮层' : 'Enable overlay'}
          hint={
            zh
              ? '开启后才启动本地服务与应用内悬浮窗口'
              : 'Starts the local server and in-app overlay window'
          }
          checked={config.enabled}
          onChange={next => void patchConfig({ enabled: next })}
        />
        {status ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              {zh ? '服务' : 'Server'}：
              {status.serverRunning ? `${zh ? '运行中' : 'running'} :${status.port}` : zh ? '未启动' : 'stopped'}
            </span>
            <span>
              {zh ? '已连接页面' : 'Clients'}：{status.wsClients}
            </span>
            <span>
              {zh ? '悬浮窗口' : 'Window'}：
              {status.windowCreated
                ? status.windowVisible
                  ? zh
                    ? '显示中'
                    : 'visible'
                  : zh
                    ? '已隐藏'
                    : 'hidden'
                : zh
                  ? '未创建'
                  : 'not created'}
            </span>
          </div>
        ) : null}
      </Card>

      {/* ============================================
       * 外部模式（OBS）
       * ============================================ */}
      <Card title={zh ? 'OBS 浏览器源' : 'OBS browser source'}>
        <ToggleRow
          label={zh ? '开启本地服务' : 'Local server'}
          hint={
            zh
              ? '仅监听 127.0.0.1。OBS 是独立浏览器，必须通过该地址访问页面'
              : 'Binds to 127.0.0.1 only. OBS is a separate browser and needs this URL'
          }
          checked={config.serverEnabled}
          disabled={!config.enabled}
          onChange={next => void patchConfig({ serverEnabled: next })}
        />

        <div className="space-y-2">
          {[
            { label: zh ? '字幕源地址' : 'Subtitle URL', url: subtitleUrl },
            { label: zh ? '弹幕源地址' : 'Danmaku URL', url: danmakuUrl },
          ].map(item => (
            <div key={item.url} className="space-y-1">
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={item.url}
                  className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs text-text-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleCopy(item.url)}
                  disabled={!config.serverEnabled}
                  className="rounded-lg border border-border/50 p-1.5 text-text-muted hover:text-text-primary disabled:opacity-40"
                  title={zh ? '复制' : 'Copy'}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpen(item.url)}
                  disabled={!config.serverEnabled}
                  className="rounded-lg border border-border/50 p-1.5 text-text-muted hover:text-text-primary disabled:opacity-40"
                  title={zh ? '在浏览器中打开' : 'Open in browser'}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-text-muted leading-relaxed">
          {zh
            ? '在 OBS 中添加「浏览器源」，把上面的地址粘贴进去即可（宽高建议 1920×1080，勾选「关闭源时关闭浏览器」）。'
            : 'Add a Browser Source in OBS and paste the URL above (1920×1080 recommended).'}
        </div>

        <SliderRow
          label={zh ? '服务端口' : 'Port'}
          value={config.port}
          min={1024}
          max={65535}
          disabled={!config.serverEnabled}
          onChange={next => {
            // 端口改动才提交，避免拖动滑块过程中反复重启服务
            setConfig(prev => (prev ? { ...prev, port: next } : prev))
          }}
        />
        <button
          type="button"
          onClick={() => void patchConfig({ port: config.port })}
          disabled={!config.serverEnabled || config.port === port}
          className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
        >
          {zh ? '应用端口' : 'Apply port'}
        </button>
      </Card>

      {/* ============================================
       * 应用内悬浮窗口
       * ============================================ */}
      <Card title={zh ? '应用内悬浮窗口' : 'In-app overlay window'}>
        <ToggleRow
          label={zh ? '启用悬浮窗口' : 'Enable window'}
          hint={zh ? '透明置顶窗口，可拖动、可点击穿透' : 'Transparent always-on-top window'}
          checked={config.windowEnabled}
          disabled={!config.enabled}
          onChange={next => void patchConfig({ windowEnabled: next })}
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void api.overlay.showWindow()}
            disabled={!config.windowEnabled}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
          >
            <Eye className="h-3.5 w-3.5" />
            {zh ? '显示' : 'Show'}
          </button>
          <button
            type="button"
            onClick={() => void api.overlay.hideWindow()}
            disabled={!config.windowEnabled}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
          >
            <EyeOff className="h-3.5 w-3.5" />
            {zh ? '隐藏' : 'Hide'}
          </button>
        </div>

        <div className="space-y-1">
          <div className="text-sm text-text-primary">{zh ? '形态' : 'Mode'}</div>
          <div className="flex gap-2">
            {(
              [
                { id: 'subtitle' as const, label: zh ? '底部字幕条' : 'Subtitle bar' },
                { id: 'danmaku' as const, label: zh ? '滚动弹幕' : 'Danmaku' },
              ]
            ).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => void patchConfig({ windowMode: item.id })}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  config.windowMode === item.id
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-border/50 text-text-muted hover:text-text-primary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <ToggleRow
          label={zh ? '点击穿透' : 'Click through'}
          hint={
            zh
              ? '开启后鼠标可穿透窗口操作桌面；需要拖动时先关闭'
              : 'Mouse passes through; turn off to drag the window'
          }
          checked={config.window.clickThrough}
          disabled={!config.windowEnabled}
          onChange={next => void patchConfig({ window: { clickThrough: next } })}
        />

        <ToggleRow
          label={zh ? '窗口置顶' : 'Always on top'}
          checked={config.window.alwaysOnTop}
          disabled={!config.windowEnabled}
          onChange={next => void patchConfig({ window: { alwaysOnTop: next } })}
        />

        <SliderRow
          label={zh ? '窗口不透明度' : 'Opacity'}
          value={Math.round(config.window.opacity * 100)}
          min={20}
          max={100}
          suffix="%"
          disabled={!config.windowEnabled}
          onChange={next => void patchConfig({ window: { opacity: next / 100 } })}
        />
      </Card>

      {/* ============================================
       * 样式
       * ============================================ */}
      <Card title={zh ? '样式' : 'Appearance'}>
        <SliderRow
          label={zh ? '字号' : 'Font size'}
          value={
            config.windowMode === 'danmaku' ? config.danmaku.fontSize : config.subtitle.fontSize
          }
          min={14}
          max={80}
          suffix="px"
          onChange={next =>
            void patchConfig(
              config.windowMode === 'danmaku'
                ? { danmaku: { ...config.danmaku, fontSize: next } }
                : { subtitle: { ...config.subtitle, fontSize: next } },
            )
          }
        />

        {config.windowMode === 'subtitle' ? (
          <>
            <SliderRow
              label={zh ? '停留时长' : 'Hold duration'}
              value={Math.round(config.subtitle.durationMs / 1000)}
              min={2}
              max={30}
              suffix="s"
              onChange={next => void patchConfig({ subtitle: { ...config.subtitle, durationMs: next * 1000 } })}
            />
            <SliderRow
              label={zh ? '最多显示行数' : 'Max lines'}
              value={config.subtitle.maxLines}
              min={1}
              max={8}
              onChange={next => void patchConfig({ subtitle: { ...config.subtitle, maxLines: next } })}
            />
            <SliderRow
              label={zh ? '背景不透明度' : 'Background opacity'}
              value={Math.round(config.subtitle.bgOpacity * 100)}
              min={0}
              max={100}
              suffix="%"
              onChange={next => void patchConfig({ subtitle: { ...config.subtitle, bgOpacity: next / 100 } })}
            />
          </>
        ) : (
          <>
            <SliderRow
              label={zh ? '滚动速度' : 'Speed'}
              value={config.danmaku.speed}
              min={40}
              max={600}
              step={10}
              suffix="px/s"
              onChange={next => void patchConfig({ danmaku: { ...config.danmaku, speed: next } })}
            />
            <SliderRow
              label={zh ? '轨道数' : 'Tracks'}
              value={config.danmaku.tracks}
              min={1}
              max={20}
              onChange={next => void patchConfig({ danmaku: { ...config.danmaku, tracks: next } })}
            />
            <ToggleRow
              label={zh ? '过滤低优先级消息' : 'Filter low priority'}
              hint={zh ? '过滤进场、关注、点赞，保留弹幕/礼物/醒目留言' : 'Drop enter/follow/like events'}
              checked={config.danmaku.filterLowPriority}
              onChange={next => void patchConfig({ danmaku: { ...config.danmaku, filterLowPriority: next } })}
            />
          </>
        )}
      </Card>

      {/* ============================================
       * 测试
       * ============================================ */}
      <Card title={zh ? '测试' : 'Test'}>
        <div className="flex items-center gap-2">
          <input
            value={testText}
            onChange={e => setTestText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSendTest()
            }}
            placeholder={zh ? '输入测试内容后回车' : 'Type and press Enter'}
            className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs text-text-primary"
          />
          <button
            type="button"
            onClick={() => void handleSendTest()}
            disabled={!config.enabled}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {zh ? '推送' : 'Send'}
          </button>
          <button
            type="button"
            onClick={() => void api.overlay.clear()}
            disabled={!config.enabled}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
            title={zh ? '清空' : 'Clear'}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        </div>

        {status && status.recentEvents.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs text-text-muted">{zh ? '最近事件' : 'Recent events'}</div>
            <div className="max-h-28 overflow-auto rounded-lg border border-border/40 bg-background/40 p-2 space-y-1">
              {status.recentEvents.map(evt => (
                <div key={evt.id || evt.ts} className="text-xs text-text-muted truncate">
                  <span className="text-text-primary">[{evt.danmu_type}]</span> {evt.content}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div className="text-xs text-red-400">{error}</div> : null}
      </Card>
    </div>
  )
}

export default OverlaySettings

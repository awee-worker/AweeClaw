/**
 * 添加自定义菜单对话框
 *
 * 字段：菜单名称、菜单图标、URL 地址。
 * - URL 必须以 http:// 或 https:// 开头（提交时校验）
 * - 图标从 IconMap 内置图标集中选择（支持搜索）
 */
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { LUCIDE_ICON_MAP } from '@components/foundation/IconMap'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'

interface AddCustomMenuDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function AddCustomMenuDialog({ isOpen, onClose }: AddCustomMenuDialogProps) {
  const { addCustomMenu, language } = useStore(
    useShallow((s) => ({
      addCustomMenu: s.addCustomMenu,
      language: s.language,
    })),
  )

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('Globe')
  const [url, setUrl] = useState('')
  const [iconQuery, setIconQuery] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; url?: string }>({})

  // 每次打开时重置表单
  useEffect(() => {
    if (isOpen) {
      setName('')
      setIcon('Globe')
      setUrl('')
      setIconQuery('')
      setFieldErrors({})
    }
  }, [isOpen])

  const iconNames = useMemo(() => {
    const keys = Object.keys(LUCIDE_ICON_MAP)
    const q = iconQuery.trim().toLowerCase()
    if (!q) return keys.slice(0, 60)
    return keys.filter(k => k.toLowerCase().includes(q)).slice(0, 60)
  }, [iconQuery])

  const handleSubmit = () => {
    const errors: { name?: string; url?: string } = {}
    if (!name.trim()) {
      errors.name = t('layout.menunamerequired', language as Language)
    }
    if (!/^https?:\/\/.+/i.test(url.trim())) {
      errors.url = t('layout.menuurlinvalid', language as Language)
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    addCustomMenu({ name: name.trim(), icon, url: url.trim() })
    onClose()
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('layout.addcustommenu', language as Language)}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {/* 菜单名称 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-primary">
            {t('layout.menuname', language as Language)}
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }))
            }}
            placeholder={t('layout.menunameplaceholder', language as Language)}
            className={`h-9 px-3 rounded-lg bg-text-primary/[0.04] border text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted/40 ${
              fieldErrors.name ? 'border-red-500/60' : 'border-border/50 focus:border-accent/60'
            }`}
          />
          {fieldErrors.name && <span className="text-[11px] text-red-500">{fieldErrors.name}</span>}
        </div>

        {/* 菜单图标 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-primary">
            {t('layout.menuicon', language as Language)}
          </label>
          <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-text-primary/[0.04] border border-border/50">
            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              value={iconQuery}
              onChange={(e) => setIconQuery(e.target.value)}
              placeholder={t('layout.searchicon', language as Language)}
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-text-primary placeholder:text-text-muted/40"
            />
          </div>
          <div className="grid grid-cols-10 gap-1 max-h-32 overflow-y-auto custom-scrollbar p-1 rounded-lg border border-border/30 bg-text-primary/[0.02]">
            {iconNames.map((nameKey) => {
              const Icon = LUCIDE_ICON_MAP[nameKey]
              const selected = icon === nameKey
              return (
                <button
                  key={nameKey}
                  onClick={() => setIcon(nameKey)}
                  title={nameKey}
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                    selected
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/50'
                      : 'text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]'
                  }`}
                >
                  <Icon className="w-4 h-4" strokeWidth={1.75} />
                </button>
              )
            })}
          </div>
        </div>

        {/* URL 地址 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-primary">
            {t('layout.menuurl', language as Language)}
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (fieldErrors.url) setFieldErrors((prev) => ({ ...prev, url: undefined }))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
            placeholder={t('layout.menuurlplaceholder', language as Language)}
            className={`h-9 px-3 rounded-lg bg-text-primary/[0.04] border text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted/40 ${
              fieldErrors.url ? 'border-red-500/60' : 'border-border/50 focus:border-accent/60'
            }`}
          />
          {fieldErrors.url && <span className="text-[11px] text-red-500">{fieldErrors.url}</span>}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-lg text-[13px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            {t('layout.cancel', language as Language)}
          </button>
          <button
            onClick={handleSubmit}
            className="h-8 px-4 rounded-lg text-[13px] font-medium bg-accent text-white hover:opacity-90 active:scale-[0.98] transition-all shadow-sm shadow-accent/25"
          >
            {t('layout.confirm', language as Language)}
          </button>
        </div>
      </div>
    </OverlayDialog>
  )
}

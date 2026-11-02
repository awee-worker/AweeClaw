/**
 * 自定义菜单对话框
 *
 * 两个 Tab：
 * - 添加菜单：名称、图标、URL 地址。URL 必须以 http:// 或 https:// 开头（提交时校验），
 *   图标从 IconMap 内置图标集中选择（支持搜索）。
 * - 菜单显示：用穿梭框调整左侧导航栏入口（场景菜单 / 插件菜单 / 自定义菜单）的显隐。
 *   该 Tab 只改本地草稿，点「保存」才写回 store，避免边调边生效。
 */
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { LUCIDE_ICON_MAP } from '@components/foundation/IconMap'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'
import { useNavMenuCatalog } from '../layout/navMenuCatalog'
import MenuVisibilityTransfer from '../layout/MenuVisibilityTransfer'

interface AddCustomMenuDialogProps {
  isOpen: boolean
  onClose: () => void
}

type DialogTab = 'add' | 'display'

export default function AddCustomMenuDialog({ isOpen, onClose }: AddCustomMenuDialogProps) {
  const { addCustomMenu, language, setHiddenNavItems, setNavMenuOrder } = useStore(
    useShallow((s) => ({
      addCustomMenu: s.addCustomMenu,
      language: s.language,
      setHiddenNavItems: s.setHiddenNavItems,
      setNavMenuOrder: s.setNavMenuOrder,
    })),
  )

  // 默认停在「菜单显示」：调整顺序与显隐是高频动作，添加菜单的人多半是点完进来的
  const [tab, setTab] = useState<DialogTab>('display')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('Globe')
  const [url, setUrl] = useState('')
  const [iconQuery, setIconQuery] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; url?: string }>({})
  /** 显示设置草稿：保存前不写回 store */
  const [draftHidden, setDraftHidden] = useState<string[]>([])
  /** 菜单顺序草稿：拖曳结果同样等「保存」才落盘 */
  const [draftOrder, setDraftOrder] = useState<string[]>([])

  // 可管理的菜单清单（场景 / 插件 / 自定义 / 用户菜单），与导航栏渲染同源
  const { items: catalogItems } = useNavMenuCatalog()

  // 每次打开时重置表单与草稿
  useEffect(() => {
    if (isOpen) {
      setTab('display')
      setName('')
      setIcon('Globe')
      setUrl('')
      setIconQuery('')
      setFieldErrors({})
      // 直接读 store 的最新值：放进依赖会在保存后把草稿又刷回默认态
      setDraftHidden(useStore.getState().hiddenNavItems)
      setDraftOrder(useStore.getState().navMenuOrder)
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

  const handleSaveDisplay = () => {
    setHiddenNavItems(draftHidden)
    setNavMenuOrder(draftOrder)
    onClose()
  }

  const handleConfirm = tab === 'add' ? handleSubmit : handleSaveDisplay

  const tabLabel = (value: DialogTab) =>
    value === 'add'
      ? t('layout.menutabadd', language as Language)
      : t('layout.menutabdisplay', language as Language)

  /** 可管理的菜单总数：贴在「菜单显示」标签上，提示这里一共能管多少入口 */
  const menuCount = catalogItems.length

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('layout.custommenu', language as Language)}
      size="2xl"
    >
      <div className="flex flex-col gap-4">
        {/* Tab 切换 */}
        <div role="tablist" className="flex items-center gap-1 p-1 rounded-lg bg-text-primary/[0.04] w-fit">
          {/* 两个 Tab 的顺序：菜单显示在前，添加菜单在后 */}
          {(['display', 'add'] as DialogTab[]).map((value) => {
            const active = tab === value
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(value)}
                className={`h-7 px-3 rounded-md text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  active
                    ? 'bg-popover text-text-primary shadow-sm shadow-black/10'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {tabLabel(value)}
                {value === 'display' && menuCount > 0 && (
                  <span className="ml-1 text-[10px] text-accent">{menuCount}</span>
                )}
              </button>
            )
          })}
        </div>

        {tab === 'add' ? (
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
        </div>
        ) : (
          <MenuVisibilityTransfer
            items={catalogItems}
            hiddenIds={draftHidden}
            onChange={setDraftHidden}
            order={draftOrder}
            onOrderChange={setDraftOrder}
            language={language as Language}
          />
        )}

        {/* 操作按钮：Tab 不同，确认按钮语义不同（新增 / 保存） */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-lg text-[13px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            {t('layout.cancel', language as Language)}
          </button>
          <button
            onClick={handleConfirm}
            className="h-8 px-4 rounded-lg text-[13px] font-medium bg-accent text-white hover:opacity-90 active:scale-[0.98] transition-all shadow-sm shadow-accent/25"
          >
            {tab === 'add'
              ? t('layout.confirm', language as Language)
              : t('layout.save', language as Language)}
          </button>
        </div>
      </div>
    </OverlayDialog>
  )
}

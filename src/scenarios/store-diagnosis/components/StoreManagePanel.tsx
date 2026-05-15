import { useState, useCallback, useEffect } from 'react'
import { Building2, Plus, RefreshCw, ChevronDown, Trash2, Pencil, MapPin, Clock, Users, Ruler, DollarSign, Stethoscope, Tag, Store } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface StoreRecord {
  id: string
  name: string
  type: string
  area: number
  business_hours: string
  employee_count: number
  avg_transaction_value: number
  main_categories: string
  rent_cost: number
  region: string
  notes: string
  created_at: string
}

const TYPE_CONFIG: Record<string, { zh: string; en: string; color: string; bg: string; border: string; dot: string }> = {
  retail: { zh: '零售', en: 'Retail', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', dot: 'bg-blue-400' },
  restaurant: { zh: '餐饮', en: 'Restaurant', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', dot: 'bg-orange-400' },
  service: { zh: '服务', en: 'Service', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  other: { zh: '其他', en: 'Other', color: 'text-text-muted', bg: 'bg-surface-hover', border: 'border-border/30', dot: 'bg-text-muted' },
}

const EMPTY_FORM = {
  name: '',
  type: 'retail',
  area: '',
  business_hours: '',
  employee_count: '',
  rent_cost: '',
  region: '',
  notes: '',
}

function formFromStore(store: StoreRecord) {
  return {
    name: store.name,
    type: store.type || 'other',
    area: store.area ? String(store.area) : '',
    business_hours: store.business_hours || '',
    employee_count: store.employee_count ? String(store.employee_count) : '',
    rent_cost: store.rent_cost ? String(store.rent_cost) : '',
    region: store.region || '',
    notes: store.notes || '',
  }
}

function MetricCard({ icon: Icon, label, value, iconColor, iconBg }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  iconColor: string
  iconBg: string
}) {
  return (
    <div className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-background/50 border border-border/10">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text-muted leading-tight">{label}</div>
        <div className="text-sm font-medium text-text-primary leading-tight mt-0.5">{value}</div>
      </div>
    </div>
  )
}

export function StoreManagePanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [stores, setStores] = useState<StoreRecord[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [editStore, setEditStore] = useState<StoreRecord | null>(null)
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM })

  const [saving, setSaving] = useState(false)

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  const sendToChat = useCallback(async (prompt: string) => {
    try {
      const agentConfig = getAgentConfig()
      await Agent.send(
        prompt,
        { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
        workspacePath,
        'agent',
      )
    } catch {}
  }, [llmConfig, workspacePath])

  const loadStores = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('store-diagnosis', 'SELECT * FROM stores ORDER BY created_at DESC')
      if (result.success && result.rows) {
        setStores(result.rows as unknown as StoreRecord[])
      }
    } catch {
      setStores([])
    }
    setLoading(false)
  }, [getDb])

  useEffect(() => { loadStores() }, [loadStores])

  const handleAddStore = useCallback(async () => {
    if (!addForm.name.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `store_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const esc = (v: string) => v.replace(/'/g, "''")
      const sql = `INSERT INTO stores (id, name, type, area, business_hours, employee_count, rent_cost, region, notes, created_at) VALUES ('${id}', '${esc(addForm.name.trim())}', '${addForm.type}', ${Number(addForm.area) || 0}, '${esc(addForm.business_hours)}', ${Number(addForm.employee_count) || 0}, ${Number(addForm.rent_cost) || 0}, '${esc(addForm.region)}', '${esc(addForm.notes)}', datetime('now'))`
      await db.executeSql('store-diagnosis', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadStores()
    } catch {}
    setSaving(false)
  }, [addForm, getDb, loadStores])

  const handleEditStore = useCallback(async () => {
    if (!editStore || !editForm.name.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const esc = (v: string) => v.replace(/'/g, "''")
      const sql = `UPDATE stores SET name='${esc(editForm.name.trim())}', type='${editForm.type}', area=${Number(editForm.area) || 0}, business_hours='${esc(editForm.business_hours)}', employee_count=${Number(editForm.employee_count) || 0}, rent_cost=${Number(editForm.rent_cost) || 0}, region='${esc(editForm.region)}', notes='${esc(editForm.notes)}' WHERE id='${editStore.id}'`
      await db.executeSql('store-diagnosis', sql)
      setEditStore(null)
      setEditForm({ ...EMPTY_FORM })
      await loadStores()
    } catch {}
    setSaving(false)
  }, [editStore, editForm, getDb, loadStores])

  const handleDiagnose = useCallback((store: StoreRecord) => {
    const prompt = language === 'zh'
      ? `请对门店「${store.name}」进行全面诊断分析`
      : `Please run a full diagnosis for store "${store.name}"`
    sendToChat(prompt)
  }, [language, sendToChat])

  const handleDelete = useCallback(async (store: StoreRecord) => {
    try {
      const db = await getDb()
      await db.executeSql('store-diagnosis', `DELETE FROM stores WHERE id='${store.id}'`)
      if (expandedId === store.id) setExpandedId(null)
      await loadStores()
    } catch {}
  }, [getDb, loadStores, expandedId])

  const openEditModal = useCallback((store: StoreRecord) => {
    setEditStore(store)
    setEditForm(formFromStore(store))
  }, [])

  const renderForm = (form: typeof EMPTY_FORM, setForm: (f: typeof EMPTY_FORM) => void, onSubmit: () => void, submitLabel: string) => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5">
          {language === 'zh' ? '门店名称' : 'Store Name'} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder={language === 'zh' ? '请输入门店名称' : 'Enter store name'}
          className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5">
          {language === 'zh' ? '门店类型' : 'Store Type'}
        </label>
        <div className="flex gap-2">
          {(['retail', 'restaurant', 'service', 'other'] as const).map(t => (
            <button
              key={t}
              onClick={() => setForm({ ...form, type: t })}
              className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${form.type === t ? 'bg-accent/20 text-accent border-accent/30' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover border-border/30'}`}
            >
              {TYPE_CONFIG[t]?.[language === 'zh' ? 'zh' : 'en'] || t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            {language === 'zh' ? '面积 (㎡)' : 'Area (sqm)'}
          </label>
          <input
            type="number"
            value={form.area}
            onChange={e => setForm({ ...form, area: e.target.value })}
            placeholder={language === 'zh' ? '如 120' : 'e.g. 120'}
            className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            {language === 'zh' ? '员工数' : 'Employees'}
          </label>
          <input
            type="number"
            value={form.employee_count}
            onChange={e => setForm({ ...form, employee_count: e.target.value })}
            placeholder={language === 'zh' ? '如 8' : 'e.g. 8'}
            className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5">
          {language === 'zh' ? '营业时间' : 'Business Hours'}
        </label>
        <input
          type="text"
          value={form.business_hours}
          onChange={e => setForm({ ...form, business_hours: e.target.value })}
          placeholder={language === 'zh' ? '如 09:00-22:00' : 'e.g. 09:00-22:00'}
          className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            {language === 'zh' ? '月租金 (元)' : 'Rent/month'}
          </label>
          <input
            type="number"
            value={form.rent_cost}
            onChange={e => setForm({ ...form, rent_cost: e.target.value })}
            placeholder={language === 'zh' ? '如 15000' : 'e.g. 15000'}
            className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            {language === 'zh' ? '区域' : 'Region'}
          </label>
          <input
            type="text"
            value={form.region}
            onChange={e => setForm({ ...form, region: e.target.value })}
            placeholder={language === 'zh' ? '如 朝阳区' : 'e.g. Downtown'}
            className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5">
          {language === 'zh' ? '备注' : 'Notes'}
        </label>
        <textarea
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder={language === 'zh' ? '可选备注信息' : 'Optional notes'}
          rows={2}
          className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <ActionButton
          variant="ghost"
          size="sm"
          className="h-9 flex-1 text-sm"
          onClick={() => {
            if (editStore) { setEditStore(null); setEditForm({ ...EMPTY_FORM }) }
            else { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }
          }}
        >
          {language === 'zh' ? '取消' : 'Cancel'}
        </ActionButton>
        <ActionButton
          variant="secondary"
          size="sm"
          className="h-9 flex-1 text-sm"
          onClick={onSubmit}
          disabled={!form.name.trim() || saving}
        >
          {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : submitLabel}
        </ActionButton>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '门店管理' : 'STORES'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadStores} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '添加门店' : 'Add Store'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {stores.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <Store className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无门店' : 'No stores yet'}</p>
            <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '点击右上角 + 添加门店' : 'Click + to add a store'}</p>
          </div>
        )}

        {stores.map((store) => {
          const tc = TYPE_CONFIG[store.type] || TYPE_CONFIG.other
          const isExpanded = expandedId === store.id
          return (
            <div key={store.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : store.id)}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.bg} border ${tc.border}`}>
                  <Building2 className={`w-4 h-4 ${tc.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{store.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${tc.dot} flex-shrink-0`} />
                    <span className={`text-xs ${tc.color}`}>{tc[language === 'zh' ? 'zh' : 'en']}</span>
                    {store.region && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted truncate">{store.region}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                  <ChevronDown className="w-3.5 h-3.5 text-text-muted/60" />
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in">
                  <div className={`rounded-xl border ${tc.border} overflow-hidden`}>
                    <div className={`px-3 py-2.5 ${tc.bg}/50 flex items-center gap-2 border-b ${tc.border}`}>
                      <Building2 className={`w-4 h-4 ${tc.color}`} />
                      <span className="text-sm font-medium text-text-primary">{store.name}</span>
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${tc.bg} ${tc.color} border ${tc.border}`}>
                        {tc[language === 'zh' ? 'zh' : 'en']}
                      </span>
                    </div>

                    <div className="p-3 space-y-3 bg-background/30">
                      <div className="grid grid-cols-2 gap-2">
                        {store.area > 0 && (
                          <MetricCard
                            icon={Ruler}
                            label={language === 'zh' ? '面积' : 'Area'}
                            value={`${store.area}㎡`}
                            iconColor="text-blue-400"
                            iconBg="bg-blue-500/10"
                          />
                        )}
                        {store.employee_count > 0 && (
                          <MetricCard
                            icon={Users}
                            label={language === 'zh' ? '员工' : 'Staff'}
                            value={`${store.employee_count}${language === 'zh' ? '人' : ''}`}
                            iconColor="text-emerald-400"
                            iconBg="bg-emerald-500/10"
                          />
                        )}
                        {store.rent_cost > 0 && (
                          <MetricCard
                            icon={DollarSign}
                            label={language === 'zh' ? '月租' : 'Rent'}
                            value={`¥${store.rent_cost.toLocaleString()}`}
                            iconColor="text-amber-400"
                            iconBg="bg-amber-500/10"
                          />
                        )}
                        {store.avg_transaction_value > 0 && (
                          <MetricCard
                            icon={Tag}
                            label={language === 'zh' ? '客单价' : 'Avg Txn'}
                            value={`¥${store.avg_transaction_value}`}
                            iconColor="text-purple-400"
                            iconBg="bg-purple-500/10"
                          />
                        )}
                      </div>

                      {(store.region || store.business_hours) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-1.5 px-1">
                          {store.region && (
                            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                              <MapPin className="w-3 h-3 text-rose-400/70 flex-shrink-0" />
                              <span>{store.region}</span>
                            </div>
                          )}
                          {store.business_hours && (
                            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                              <Clock className="w-3 h-3 text-sky-400/70 flex-shrink-0" />
                              <span>{store.business_hours}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {store.notes && (
                        <div className="text-xs text-text-muted/80 bg-background/50 rounded-lg px-2.5 py-2 leading-relaxed border border-border/5">
                          {store.notes}
                        </div>
                      )}
                    </div>

                    <div className="px-3 py-2.5 border-t border-border/10 bg-background/20 flex items-center gap-2">
                      <button
                        onClick={() => handleDiagnose(store)}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/15 hover:bg-orange-500/20 hover:border-orange-500/25 transition-colors"
                      >
                        <Stethoscope className="w-3.5 h-3.5" />
                        {language === 'zh' ? '诊断分析' : 'Diagnose'}
                      </button>
                      <button
                        onClick={() => openEditModal(store)}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/15 hover:bg-accent/20 hover:border-accent/25 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {language === 'zh' ? '编辑信息' : 'Edit'}
                      </button>
                      <button
                        onClick={() => handleDelete(store)}
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-xs bg-red-500/8 text-red-400/70 border border-red-500/10 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {stores.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '添加门店' : 'Add Store'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '添加门店' : 'Add Store'}
        size="md"
      >
        {renderForm(addForm, setAddForm, handleAddStore, language === 'zh' ? '添加' : 'Add')}
      </OverlayDialog>

      <OverlayDialog
        isOpen={!!editStore}
        onClose={() => { setEditStore(null); setEditForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '编辑门店' : 'Edit Store'}
        size="md"
      >
        {renderForm(editForm, setEditForm, handleEditStore, language === 'zh' ? '保存' : 'Save')}
      </OverlayDialog>
    </div>
  )
}

import { useState, useCallback, useEffect } from 'react'
import { Swords, Plus, RefreshCw, ChevronDown, MapPin, AlertTriangle, Shield, ShieldOff } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'

interface CompetitorRecord {
  id: string
  store_id: string
  competitor_name: string
  competitor_type: string
  distance_km: number
  strength: string
  weakness: string
  threat_level: string
  notes: string
  created_at: string
}

interface StoreOption {
  id: string
  name: string
  type: string
}

const THREAT_CONFIG: Record<string, { label: string; labelZh: string; color: string; bg: string; border: string; icon: React.ComponentType<{ className?: string }> }> = {
  high: { label: 'High', labelZh: '高威胁', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: AlertTriangle },
  medium: { label: 'Medium', labelZh: '中威胁', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Shield },
  low: { label: 'Low', labelZh: '低威胁', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: ShieldOff },
}

const EMPTY_FORM = {
  competitor_name: '',
  competitor_type: '',
  distance_km: '',
  strength: '',
  weakness: '',
  threat_level: 'medium',
  notes: '',
}

export function CompetitorPanel() {
  const language = useStore(s => s.language)

  const [stores, setStores] = useState<StoreOption[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [competitors, setCompetitors] = useState<CompetitorRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  const esc = useCallback((v: string) => v.replace(/'/g, "''"), [])

  const loadStores = useCallback(async () => {
    try {
      const db = await getDb()
      const result = await db.executeSql('store-diagnosis', 'SELECT id, name, type FROM stores ORDER BY name')
      if (result.success && result.rows) {
        const list = result.rows as unknown as StoreOption[]
        setStores(list)
        if (list.length > 0 && !selectedStoreId) {
          setSelectedStoreId(list[0].id)
        }
      }
    } catch {}
  }, [getDb, selectedStoreId])

  const loadCompetitors = useCallback(async () => {
    if (!selectedStoreId) return
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('store-diagnosis', `SELECT * FROM store_competitors WHERE store_id = '${esc(selectedStoreId)}' ORDER BY threat_level DESC, distance_km ASC`)
      if (result.success && result.rows) {
        setCompetitors(result.rows as unknown as CompetitorRecord[])
      }
    } catch {
      setCompetitors([])
    }
    setLoading(false)
  }, [getDb, selectedStoreId, esc])

  useEffect(() => { loadStores() }, [loadStores])
  useEffect(() => { if (selectedStoreId) loadCompetitors() }, [selectedStoreId, loadCompetitors])

  const handleAdd = useCallback(async () => {
    if (!selectedStoreId || !addForm.competitor_name.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const sql = `INSERT INTO store_competitors (id, store_id, competitor_name, competitor_type, distance_km, strength, weakness, threat_level, notes) VALUES ('${id}', '${esc(selectedStoreId)}', '${esc(addForm.competitor_name.trim())}', '${esc(addForm.competitor_type)}', ${Number(addForm.distance_km) || 0}, '${esc(addForm.strength)}', '${esc(addForm.weakness)}', '${esc(addForm.threat_level)}', '${esc(addForm.notes)}')`
      await db.executeSql('store-diagnosis', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadCompetitors()
    } catch {}
    setSaving(false)
  }, [selectedStoreId, addForm, getDb, esc, loadCompetitors])

  const handleDelete = useCallback(async (compId: string) => {
    try {
      const db = await getDb()
      await db.executeSql('store-diagnosis', `DELETE FROM store_competitors WHERE id = '${esc(compId)}'`)
      await loadCompetitors()
    } catch {}
  }, [getDb, esc, loadCompetitors])

  const highCount = competitors.filter(c => c.threat_level === 'high').length
  const medCount = competitors.filter(c => c.threat_level === 'medium').length
  const lowCount = competitors.filter(c => c.threat_level === 'low').length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '竞品分析' : 'COMPETITORS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadCompetitors} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '添加竞品' : 'Add Competitor'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border/15">
        <select
          value={selectedStoreId}
          onChange={e => setSelectedStoreId(e.target.value)}
          className="w-full h-8 px-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
        >
          {stores.length === 0 && (
            <option value="">{language === 'zh' ? '暂无门店' : 'No stores'}</option>
          )}
          {stores.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {competitors.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border/15 text-xs">
          <span className="text-red-400">🔴 {highCount}</span>
          <span className="text-amber-400">🟡 {medCount}</span>
          <span className="text-emerald-400">🟢 {lowCount}</span>
          <span className="text-text-muted ml-auto">{language === 'zh' ? `共${competitors.length}家` : `${competitors.length} total`}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {competitors.length === 0 && !loading && (
          <div className="flex flex-col items-center py-10 text-text-muted">
            <Swords className="w-10 h-10 opacity-30 mb-3" />
            <p className="text-sm">{language === 'zh' ? '暂无竞品记录' : 'No competitors yet'}</p>
            <p className="text-xs opacity-60 mt-1">{language === 'zh' ? '点击 + 添加竞品信息' : 'Click + to add competitor'}</p>
          </div>
        )}

        {competitors.map(comp => {
          const tc = THREAT_CONFIG[comp.threat_level] || THREAT_CONFIG.medium
          const isExpanded = expandedId === comp.id
          const ThreatIcon = tc.icon

          return (
            <div key={comp.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : comp.id)}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.bg} border ${tc.border}`}>
                  <ThreatIcon className={`w-4 h-4 ${tc.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{comp.competitor_name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs ${tc.color}`}>{tc[language === 'zh' ? 'labelZh' : 'label']}</span>
                    {comp.distance_km > 0 && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">{comp.distance_km}km</span>
                      </>
                    )}
                  </div>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-text-muted/60 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in">
                  <div className={`rounded-xl border ${tc.border} overflow-hidden`}>
                    <div className={`px-3 py-2 ${tc.bg}/50 flex items-center gap-2 border-b ${tc.border}`}>
                      <Swords className={`w-4 h-4 ${tc.color}`} />
                      <span className="text-sm font-medium text-text-primary">{comp.competitor_name}</span>
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${tc.bg} ${tc.color} border ${tc.border}`}>
                        {tc[language === 'zh' ? 'labelZh' : 'label']}
                      </span>
                    </div>

                    <div className="p-3 space-y-2.5 bg-background/30">
                      {comp.competitor_type && (
                        <div className="text-xs text-text-secondary">
                          {language === 'zh' ? '类型' : 'Type'}: {comp.competitor_type}
                        </div>
                      )}

                      {comp.distance_km > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <MapPin className="w-3 h-3 text-rose-400/70" />
                          <span>{comp.distance_km}km</span>
                        </div>
                      )}

                      {comp.strength && (
                        <div className="space-y-1">
                          <div className="text-xs text-text-muted">{language === 'zh' ? '竞品优势' : 'Strengths'}</div>
                          <div className="text-xs text-red-300/80 bg-red-500/5 rounded-md px-2 py-1.5 border border-red-500/10 leading-relaxed">
                            {comp.strength}
                          </div>
                        </div>
                      )}

                      {comp.weakness && (
                        <div className="space-y-1">
                          <div className="text-xs text-text-muted">{language === 'zh' ? '竞品劣势' : 'Weaknesses'}</div>
                          <div className="text-xs text-emerald-300/80 bg-emerald-500/5 rounded-md px-2 py-1.5 border border-emerald-500/10 leading-relaxed">
                            {comp.weakness}
                          </div>
                        </div>
                      )}

                      {comp.notes && (
                        <div className="text-xs text-text-muted/80 bg-background/50 rounded-md px-2 py-1.5 border border-border/5">
                          {comp.notes}
                        </div>
                      )}
                    </div>

                    <div className="px-3 py-2 border-t border-border/10 bg-background/20 flex justify-end">
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-red-400/70 hover:text-red-400"
                        onClick={() => handleDelete(comp.id)}
                      >
                        {language === 'zh' ? '删除' : 'Delete'}
                      </ActionButton>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '添加竞品' : 'Add Competitor'}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {language === 'zh' ? '竞品名称' : 'Competitor Name'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addForm.competitor_name}
              onChange={e => setAddForm({ ...addForm, competitor_name: e.target.value })}
              placeholder={language === 'zh' ? '竞品门店名称' : 'Competitor store name'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '类型' : 'Type'}
              </label>
              <input
                type="text"
                value={addForm.competitor_type}
                onChange={e => setAddForm({ ...addForm, competitor_type: e.target.value })}
                placeholder={language === 'zh' ? '如 零售/餐饮' : 'e.g. retail'}
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '距离 (km)' : 'Distance (km)'}
              </label>
              <input
                type="number"
                value={addForm.distance_km}
                onChange={e => setAddForm({ ...addForm, distance_km: e.target.value })}
                placeholder="1.5"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {language === 'zh' ? '威胁等级' : 'Threat Level'}
            </label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map(level => {
                const tc = THREAT_CONFIG[level]
                return (
                  <button
                    key={level}
                    onClick={() => setAddForm({ ...addForm, threat_level: level })}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${addForm.threat_level === level ? `${tc.bg} ${tc.color} ${tc.border}` : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover border-border/30'}`}
                  >
                    {tc[language === 'zh' ? 'labelZh' : 'label']}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {language === 'zh' ? '竞品优势' : 'Strengths'}
            </label>
            <textarea
              value={addForm.strength}
              onChange={e => setAddForm({ ...addForm, strength: e.target.value })}
              placeholder={language === 'zh' ? '如 品牌知名度高, 价格低' : 'e.g. Strong brand, Low prices'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {language === 'zh' ? '竞品劣势' : 'Weaknesses'}
            </label>
            <textarea
              value={addForm.weakness}
              onChange={e => setAddForm({ ...addForm, weakness: e.target.value })}
              placeholder={language === 'zh' ? '如 服务差, 品类少' : 'e.g. Poor service, Limited selection'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {language === 'zh' ? '备注' : 'Notes'}
            </label>
            <input
              type="text"
              value={addForm.notes}
              onChange={e => setAddForm({ ...addForm, notes: e.target.value })}
              placeholder={language === 'zh' ? '可选备注' : 'Optional notes'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAdd} disabled={!addForm.competitor_name.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '保存' : 'Save')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}

import { useState, useCallback, useEffect } from 'react'
import { DollarSign, Users, Plus, RefreshCw, ChevronDown, Calendar } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'

interface FinancialRecord {
  id: number
  store_id: string
  period: string
  revenue: number
  rent_cost: number
  labor_cost: number
  material_cost: number
  utility_cost: number
  other_cost: number
  customer_count: number
  repeat_customer_rate: number
  avg_transaction_value: number
  gross_profit: number
  net_profit: number
}

interface StoreOption {
  id: string
  name: string
  type: string
}

const EMPTY_FINANCIAL = {
  period: '',
  revenue: '',
  rent_cost: '',
  labor_cost: '',
  material_cost: '',
  utility_cost: '',
  other_cost: '',
  customer_count: '',
  repeat_customer_rate: '',
  avg_transaction_value: '',
}

const EMPTY_TRAFFIC = {
  date: '',
  hour: '9',
  customer_count: '',
  new_customer_count: '',
  returning_customer_count: '',
  conversion_rate: '',
}

function RatioBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-muted">{label}</span>
        <span className="text-text-secondary font-medium">{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function StoreDataEntryPanel() {
  const language = useStore(s => s.language)

  const [stores, setStores] = useState<StoreOption[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [financials, setFinancials] = useState<FinancialRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'financial' | 'traffic'>('financial')
  const [showAddFinancial, setShowAddFinancial] = useState(false)
  const [showAddTraffic, setShowAddTraffic] = useState(false)
  const [financialForm, setFinancialForm] = useState({ ...EMPTY_FINANCIAL })
  const [trafficForm, setTrafficForm] = useState({ ...EMPTY_TRAFFIC })
  const [saving, setSaving] = useState(false)
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null)

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

  const loadFinancials = useCallback(async () => {
    if (!selectedStoreId) return
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('store-diagnosis', `SELECT * FROM store_financials WHERE store_id = '${esc(selectedStoreId)}' ORDER BY period DESC LIMIT 12`)
      if (result.success && result.rows) {
        setFinancials(result.rows as unknown as FinancialRecord[])
      }
    } catch {
      setFinancials([])
    }
    setLoading(false)
  }, [getDb, selectedStoreId, esc])

  useEffect(() => { loadStores() }, [loadStores])
  useEffect(() => { if (selectedStoreId) loadFinancials() }, [selectedStoreId, loadFinancials])

  const handleAddFinancial = useCallback(async () => {
    if (!selectedStoreId || !financialForm.period || !financialForm.revenue) return
    setSaving(true)
    try {
      const db = await getDb()
      const revenue = Number(financialForm.revenue) || 0
      const rentCost = Number(financialForm.rent_cost) || 0
      const laborCost = Number(financialForm.labor_cost) || 0
      const materialCost = Number(financialForm.material_cost) || 0
      const utilityCost = Number(financialForm.utility_cost) || 0
      const otherCost = Number(financialForm.other_cost) || 0
      const customerCount = Number(financialForm.customer_count) || 0
      const repeatRate = Number(financialForm.repeat_customer_rate) || 0
      const avgTrans = Number(financialForm.avg_transaction_value) || 0
      const grossProfit = revenue - materialCost
      const netProfit = revenue - rentCost - laborCost - materialCost - utilityCost - otherCost

      const sql = `INSERT OR REPLACE INTO store_financials (store_id, period, revenue, rent_cost, labor_cost, material_cost, utility_cost, other_cost, customer_count, repeat_customer_rate, avg_transaction_value, gross_profit, net_profit) VALUES ('${esc(selectedStoreId)}', '${esc(financialForm.period)}', ${revenue}, ${rentCost}, ${laborCost}, ${materialCost}, ${utilityCost}, ${otherCost}, ${customerCount}, ${repeatRate}, ${avgTrans}, ${grossProfit}, ${netProfit})`
      await db.executeSql('store-diagnosis', sql)
      setShowAddFinancial(false)
      setFinancialForm({ ...EMPTY_FINANCIAL })
      await loadFinancials()
    } catch {}
    setSaving(false)
  }, [selectedStoreId, financialForm, getDb, esc, loadFinancials])

  const handleAddTraffic = useCallback(async () => {
    if (!selectedStoreId || !trafficForm.date || !trafficForm.customer_count) return
    setSaving(true)
    try {
      const db = await getDb()
      const hour = Number(trafficForm.hour) || 0
      const customerCount = Number(trafficForm.customer_count) || 0
      const newCustomer = Number(trafficForm.new_customer_count) || 0
      const returning = Number(trafficForm.returning_customer_count) || 0
      const conversion = Number(trafficForm.conversion_rate) || 0

      const sql = `INSERT OR REPLACE INTO store_traffic (store_id, date, hour, customer_count, new_customer_count, returning_customer_count, conversion_rate) VALUES ('${esc(selectedStoreId)}', '${esc(trafficForm.date)}', ${hour}, ${customerCount}, ${newCustomer}, ${returning}, ${conversion})`
      await db.executeSql('store-diagnosis', sql)
      setShowAddTraffic(false)
      setTrafficForm({ ...EMPTY_TRAFFIC })
    } catch {}
    setSaving(false)
  }, [selectedStoreId, trafficForm, getDb, esc])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '数据录入' : 'DATA ENTRY'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadFinancials} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
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

      <div className="flex border-b border-border/30">
        <button
          className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === 'financial' ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'}`}
          onClick={() => setActiveTab('financial')}
        >
          <DollarSign className="w-3 h-3 inline mr-1" />
          {language === 'zh' ? '财务' : 'Financial'}
        </button>
        <button
          className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === 'traffic' ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'}`}
          onClick={() => setActiveTab('traffic')}
        >
          <Users className="w-3 h-3 inline mr-1" />
          {language === 'zh' ? '客流' : 'Traffic'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'financial' && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {language === 'zh' ? `共 ${financials.length} 期数据` : `${financials.length} periods`}
              </span>
              <ActionButton
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setShowAddFinancial(true)}
                disabled={!selectedStoreId}
              >
                <Plus className="w-3 h-3" />
                {language === 'zh' ? '录入' : 'Add'}
              </ActionButton>
            </div>

            {financials.length === 0 && !loading && (
              <div className="flex flex-col items-center py-8 text-text-muted">
                <DollarSign className="w-8 h-8 opacity-30 mb-2" />
                <p className="text-xs">{language === 'zh' ? '暂无财务数据' : 'No financial data'}</p>
                <p className="text-xs opacity-60 mt-1">{language === 'zh' ? '点击录入按钮添加' : 'Click Add to enter'}</p>
              </div>
            )}

            {financials.map(fin => {
              const revenue = fin.revenue || 0
              const isExpanded = expandedPeriod === fin.period
              const rentRatio = revenue > 0 ? (fin.rent_cost / revenue) * 100 : 0
              const laborRatio = revenue > 0 ? (fin.labor_cost / revenue) * 100 : 0
              const materialRatio = revenue > 0 ? (fin.material_cost / revenue) * 100 : 0
              const netProfit = fin.net_profit || (revenue - fin.rent_cost - fin.labor_cost - fin.material_cost - fin.utility_cost - fin.other_cost)
              const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0

              return (
                <div key={fin.period} className="rounded-lg border border-border/20 overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover/40 transition-colors text-left"
                    onClick={() => setExpandedPeriod(isExpanded ? null : fin.period)}
                  >
                    <Calendar className="w-3.5 h-3.5 text-accent/70 flex-shrink-0" />
                    <span className="text-sm font-medium text-text-primary">{fin.period}</span>
                    <span className="text-xs text-text-muted ml-auto">
                      ¥{revenue.toLocaleString()}
                    </span>
                    <span className={`text-xs font-medium ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {netProfit >= 0 ? '+' : ''}¥{netProfit.toLocaleString()}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-text-muted/60 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2.5 border-t border-border/10 pt-2 animate-fade-in">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="px-2 py-1.5 rounded-md bg-background/50 border border-border/5">
                          <div className="text-xs text-text-muted">{language === 'zh' ? '营收' : 'Revenue'}</div>
                          <div className="text-sm font-medium text-text-primary">¥{revenue.toLocaleString()}</div>
                        </div>
                        <div className="px-2 py-1.5 rounded-md bg-background/50 border border-border/5">
                          <div className="text-xs text-text-muted">{language === 'zh' ? '净利润' : 'Net Profit'}</div>
                          <div className={`text-sm font-medium ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            ¥{netProfit.toLocaleString()}
                          </div>
                        </div>
                        <div className="px-2 py-1.5 rounded-md bg-background/50 border border-border/5">
                          <div className="text-xs text-text-muted">{language === 'zh' ? '客流' : 'Customers'}</div>
                          <div className="text-sm font-medium text-text-primary">{fin.customer_count}</div>
                        </div>
                        <div className="px-2 py-1.5 rounded-md bg-background/50 border border-border/5">
                          <div className="text-xs text-text-muted">{language === 'zh' ? '利润率' : 'Margin'}</div>
                          <div className={`text-sm font-medium ${profitMargin >= 10 ? 'text-emerald-400' : profitMargin >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                            {profitMargin.toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1">
                        <RatioBar label={language === 'zh' ? '租金占比' : 'Rent'} value={rentRatio} max={30} color="bg-amber-400" />
                        <RatioBar label={language === 'zh' ? '人工占比' : 'Labor'} value={laborRatio} max={40} color="bg-blue-400" />
                        <RatioBar label={language === 'zh' ? '材料占比' : 'Material'} value={materialRatio} max={50} color="bg-purple-400" />
                      </div>

                      {fin.repeat_customer_rate > 0 && (
                        <div className="text-xs text-text-muted bg-background/50 rounded-md px-2 py-1.5 border border-border/5">
                          {language === 'zh' ? '复购率' : 'Repeat Rate'}: {fin.repeat_customer_rate.toFixed(1)}%
                          {fin.avg_transaction_value > 0 && ` | ${language === 'zh' ? '客单价' : 'Avg Txn'}: ¥${fin.avg_transaction_value}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'traffic' && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {language === 'zh' ? '录入每日客流数据' : 'Enter daily traffic data'}
              </span>
              <ActionButton
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setShowAddTraffic(true)}
                disabled={!selectedStoreId}
              >
                <Plus className="w-3 h-3" />
                {language === 'zh' ? '录入' : 'Add'}
              </ActionButton>
            </div>

            {!selectedStoreId && (
              <div className="flex flex-col items-center py-8 text-text-muted">
                <Users className="w-8 h-8 opacity-30 mb-2" />
                <p className="text-xs">{language === 'zh' ? '请先选择门店' : 'DropdownSelector a store first'}</p>
              </div>
            )}

            {selectedStoreId && (
              <div className="rounded-lg border border-border/20 p-3 space-y-2">
                <p className="text-xs text-text-muted">
                  {language === 'zh'
                    ? '通过录入按钮添加客流数据，或直接在对话中告诉AI你的客流信息'
                    : 'Add traffic data via the Add button, or tell the AI your traffic info in chat'}
                </p>
                <p className="text-xs text-text-muted/60">
                  {language === 'zh'
                    ? '示例: "今天进店80人，新客35人，老客45人"'
                    : 'Example: "80 customers today, 35 new, 45 returning"'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <OverlayDialog
        isOpen={showAddFinancial}
        onClose={() => { setShowAddFinancial(false); setFinancialForm({ ...EMPTY_FINANCIAL }) }}
        title={language === 'zh' ? '录入财务数据' : 'Add Financial Data'}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {language === 'zh' ? '期间 (YYYY-MM)' : 'Period (YYYY-MM)'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={financialForm.period}
              onChange={e => setFinancialForm({ ...financialForm, period: e.target.value })}
              placeholder="2024-01"
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '营收 (元)' : 'Revenue'} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={financialForm.revenue}
                onChange={e => setFinancialForm({ ...financialForm, revenue: e.target.value })}
                placeholder="100000"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '租金 (元)' : 'Rent'}
              </label>
              <input
                type="number"
                value={financialForm.rent_cost}
                onChange={e => setFinancialForm({ ...financialForm, rent_cost: e.target.value })}
                placeholder="15000"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '人工 (元)' : 'Labor'}
              </label>
              <input
                type="number"
                value={financialForm.labor_cost}
                onChange={e => setFinancialForm({ ...financialForm, labor_cost: e.target.value })}
                placeholder="20000"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '材料 (元)' : 'Material'}
              </label>
              <input
                type="number"
                value={financialForm.material_cost}
                onChange={e => setFinancialForm({ ...financialForm, material_cost: e.target.value })}
                placeholder="30000"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '水电 (元)' : 'Utility'}
              </label>
              <input
                type="number"
                value={financialForm.utility_cost}
                onChange={e => setFinancialForm({ ...financialForm, utility_cost: e.target.value })}
                placeholder="3000"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '其他 (元)' : 'Other'}
              </label>
              <input
                type="number"
                value={financialForm.other_cost}
                onChange={e => setFinancialForm({ ...financialForm, other_cost: e.target.value })}
                placeholder="2000"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '客流' : 'Customers'}
              </label>
              <input
                type="number"
                value={financialForm.customer_count}
                onChange={e => setFinancialForm({ ...financialForm, customer_count: e.target.value })}
                placeholder="800"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '复购率%' : 'Repeat%'}
              </label>
              <input
                type="number"
                value={financialForm.repeat_customer_rate}
                onChange={e => setFinancialForm({ ...financialForm, repeat_customer_rate: e.target.value })}
                placeholder="35"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '客单价' : 'Avg Txn'}
              </label>
              <input
                type="number"
                value={financialForm.avg_transaction_value}
                onChange={e => setFinancialForm({ ...financialForm, avg_transaction_value: e.target.value })}
                placeholder="125"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddFinancial(false); setFinancialForm({ ...EMPTY_FINANCIAL }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAddFinancial} disabled={!financialForm.period || !financialForm.revenue || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '保存' : 'Save')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>

      <OverlayDialog
        isOpen={showAddTraffic}
        onClose={() => { setShowAddTraffic(false); setTrafficForm({ ...EMPTY_TRAFFIC }) }}
        title={language === 'zh' ? '录入客流数据' : 'Add Traffic Data'}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '日期' : 'Date'} <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={trafficForm.date}
                onChange={e => setTrafficForm({ ...trafficForm, date: e.target.value })}
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '时段' : 'Hour'}
              </label>
              <select
                value={trafficForm.hour}
                onChange={e => setTrafficForm({ ...trafficForm, hour: e.target.value })}
                className="w-full h-8 px-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '总客流' : 'Total'} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={trafficForm.customer_count}
                onChange={e => setTrafficForm({ ...trafficForm, customer_count: e.target.value })}
                placeholder="80"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '新客' : 'New'}
              </label>
              <input
                type="number"
                value={trafficForm.new_customer_count}
                onChange={e => setTrafficForm({ ...trafficForm, new_customer_count: e.target.value })}
                placeholder="35"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '老客' : 'Returning'}
              </label>
              <input
                type="number"
                value={trafficForm.returning_customer_count}
                onChange={e => setTrafficForm({ ...trafficForm, returning_customer_count: e.target.value })}
                placeholder="45"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {language === 'zh' ? '转化率%' : 'Conv%'}
              </label>
              <input
                type="number"
                value={trafficForm.conversion_rate}
                onChange={e => setTrafficForm({ ...trafficForm, conversion_rate: e.target.value })}
                placeholder="25"
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddTraffic(false); setTrafficForm({ ...EMPTY_TRAFFIC }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAddTraffic} disabled={!trafficForm.date || !trafficForm.customer_count || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '保存' : 'Save')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}

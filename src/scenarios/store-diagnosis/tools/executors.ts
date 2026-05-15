import type { ToolExecutionResult, ToolExecutionContext } from '../../../scenario-system/providerTypes'
import { scenarioDatabaseManager } from '@scenario-system/core/ScenarioDatabaseManager'

const SCENARIO_ID = 'store-diagnosis'

interface DbStore {
  id: string; name: string; type: string; sub_type: string; area: number
  business_hours: string; employee_count: number; avg_transaction_value: number
  main_categories: string; rent_cost: number; decoration_age: number; region: string
  city_tier: number; contact_phone: string; opened_at: string; monthly_revenue: number
  business_status: string; photos: string; notes: string; created_at: string; updated_at: string
}

interface DbBenchmark {
  category: string; sub_category: string; city_tier: number; metric: string
  industry_avg: number; top_quartile: number; unit: string
}

interface DbFinancial {
  store_id: string; period: string; revenue: number; rent_cost: number
  labor_cost: number; material_cost: number; utility_cost: number; other_cost: number
  customer_count: number; repeat_customer_rate: number; avg_transaction_value: number
  gross_profit: number; net_profit: number
}

interface DbDiagnosisRecord {
  id: string; store_id: string; dimension: string; status: string; score: number
  confidence: number; summary: string; details: string; recommendations: string
  data_sources: string; diagnosed_at: string
}

interface DbScoreRule {
  dimension: string; store_type: string; metric: string; weight: number
  excellent_threshold: number; good_threshold: number; poor_threshold: number
  benchmark_key: string; is_inverse: number; description: string
}

interface DbCompetitor {
  id: string; store_id: string; competitor_name: string; competitor_type: string
  distance_km: number; strength: string; weakness: string; threat_level: string
  notes: string; created_at: string
}

interface DbRecheckReminder {
  id: string; store_id: string; diagnosis_id: string; remind_at: string
  status: string; interval_days: number; last_score: number; notes: string; created_at: string
}

interface DbKnowledge {
  id: number; category: string; store_type: string; title: string; content: string
  tags: string; source: string; view_count: number; helpful_count: number
}

interface DbPlanTask {
  id: string; plan_id: string; title: string; description: string
  assignee: string; due_date: string; status: string; cost_level: string
  expected_impact: string; completed_at: string | null
}

const DIM_LABELS: Record<string, string> = {
  operations: '经营效率', cost: '成本结构', competition: '竞争分析', scene: '场景适配',
}

const COST_LABELS: Record<string, string> = {
  zero: '🟢零成本', low: '🟡低成本', medium: '🟠中成本', high: '🔴高成本',
}

const COST_ORDER = ['zero', 'low', 'medium', 'high']

function diagError(message: string): ToolExecutionResult {
  return { success: false, result: '', error: message }
}

function diagSuccess(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

function generateId(prefix = 'sd'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function execSql(sql: string) {
  return scenarioDatabaseManager.executeSql(SCENARIO_ID, sql)
}

function esc(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  return s
    .replace(/\0/g, '')
    .replace(/'/g, "''")
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '')
    .replace(/xp_/gi, '')
    .replace(/exec\s*\(/gi, '')
    .replace(/char\s*\(/gi, '')
    .replace(/concat\s*\(/gi, '')
}

function escLike(val: unknown): string {
  const s = esc(val)
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/
const VALID_PERIOD_REGEX = /^\d{4}-\d{2}$/
const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const VALID_DIMENSIONS = new Set(['operations', 'cost', 'competition', 'scene', 'all'])
const VALID_ACTIONS: Record<string, Set<string>> = {
  store_manage: new Set(['create', 'update', 'delete', 'get', 'list']),
  store_diagnose: new Set(['diagnose']),
  report_generate: new Set(['scorecard', 'trend', 'comparison', 'cost_breakdown', 'traffic_analysis', 'prescription', 'export', 'full']),
  optimization_plan: new Set(['create', 'update', 'delete', 'get', 'list', 'add_task', 'update_task', 'list_tasks']),
  competitor_manage: new Set(['create', 'update', 'delete', 'list', 'analysis']),
  recheck_manage: new Set(['create', 'complete', 'cancel', 'list', 'check_due']),
  store_data_entry: new Set(['add_financial', 'update_financial', 'list_financials', 'add_traffic', 'list_traffic', 'batch_import']),
}
const VALID_STORE_TYPES = new Set(['retail', 'restaurant', 'service', 'other'])
const VALID_THREAT_LEVELS = new Set(['high', 'medium', 'low'])
const VALID_BUSINESS_STATUS = new Set(['normal', 'warning', 'closed', 'renovating'])
const VALID_PLAN_STATUS = new Set(['pending', 'in_progress', 'completed', 'cancelled'])
const VALID_TASK_STATUS = new Set(['pending', 'in_progress', 'completed', 'skipped'])
const VALID_COST_LEVELS = new Set(['zero', 'low', 'medium', 'high'])

function validateId(val: unknown, fieldName = 'id'): string {
  const s = str(val)
  if (!s) throw new Error(`${fieldName} is required`)
  if (!VALID_ID_REGEX.test(s)) throw new Error(`${fieldName} contains invalid characters`)
  if (s.length > 64) throw new Error(`${fieldName} is too long (max 64 chars)`)
  return s
}

function validateEnum<T extends string>(val: unknown, validSet: Set<string>, fieldName: string): T {
  const s = str(val)
  if (!s) throw new Error(`${fieldName} is required`)
  if (!validSet.has(s)) throw new Error(`Invalid ${fieldName}: ${s}. Allowed: ${[...validSet].join(', ')}`)
  return s as T
}

function validatePeriod(val: unknown): string {
  const s = str(val)
  if (!s) throw new Error('period is required')
  if (!VALID_PERIOD_REGEX.test(s)) throw new Error('period must be in YYYY-MM format')
  return s
}

function validateDate(val: unknown): string {
  const s = str(val)
  if (!s) throw new Error('date is required')
  if (!VALID_DATE_REGEX.test(s)) throw new Error('date must be in YYYY-MM-DD format')
  return s
}

function scoreEmoji(score: number): string {
  if (score >= 80) return '✅'
  if (score >= 60) return '⚠️'
  return '❌'
}

function scoreLabel(score: number): string {
  if (score >= 80) return '优秀'
  if (score >= 60) return '良好'
  if (score >= 40) return '需改进'
  return '严重'
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function calcConfidence(hasFinancial: boolean, hasTraffic: boolean, dataPoints: number): number {
  let conf = 0.2
  if (hasFinancial) conf += 0.35
  if (hasTraffic) conf += 0.25
  conf += Math.min(dataPoints * 0.02, 0.2)
  return Math.min(Math.round(conf * 100) / 100, 1.0)
}

function num(val: unknown, fallback = 0): number {
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

function str(val: unknown, fallback = ''): string {
  return val != null ? String(val) : fallback
}

async function getStore(storeId: string): Promise<DbStore | null> {
  const r = await execSql(`SELECT * FROM stores WHERE id = '${esc(storeId)}'`)
  if (!r.success || !r.rows || r.rows.length === 0) return null
  return r.rows[0] as unknown as DbStore
}

async function getBenchmarks(category: string, subCategory?: string, cityTier?: number): Promise<DbBenchmark[]> {
  let sql = `SELECT * FROM industry_benchmarks WHERE category = '${esc(category)}'`
  if (subCategory) {
    sql += ` AND (sub_category = '${esc(subCategory)}' OR sub_category = '' OR sub_category IS NULL)`
  }
  if (cityTier && cityTier > 0) {
    sql += ` AND (city_tier = ${cityTier} OR city_tier = 0 OR city_tier IS NULL)`
  }
  sql += ` ORDER BY sub_category DESC, metric`
  const r = await execSql(sql)
  return (r.rows || []) as unknown as DbBenchmark[]
}

async function getScoreRules(dimension: string, storeType?: string): Promise<DbScoreRule[]> {
  let sql = `SELECT * FROM score_rules WHERE dimension = '${esc(dimension)}'`
  if (storeType) {
    sql += ` AND (store_type = '${esc(storeType)}' OR store_type = '')`
  }
  sql += ` ORDER BY store_type DESC, weight DESC`
  const r = await execSql(sql)
  return (r.rows || []) as unknown as DbScoreRule[]
}

async function getFinancials(storeId: string, limit = 6): Promise<DbFinancial[]> {
  const r = await execSql(`SELECT * FROM store_financials WHERE store_id = '${esc(storeId)}' ORDER BY period DESC LIMIT ${limit}`)
  return (r.rows || []) as unknown as DbFinancial[]
}

async function getTrafficData(storeId: string, limit = 30) {
  const r = await execSql(
    `SELECT date, SUM(customer_count) as daily_customers, SUM(new_customer_count) as daily_new, SUM(returning_customer_count) as daily_returning FROM store_traffic WHERE store_id = '${esc(storeId)}' GROUP BY date ORDER BY date DESC LIMIT ${limit}`
  )
  return (r.rows || []) as unknown as Array<{ date: string; daily_customers: number; daily_new: number; daily_returning: number }>
}

async function saveDiagnosis(storeId: string, dimension: string, score: number, confidence: number, summary: string, details: string, recommendations: string, dataSources: string): Promise<string> {
  const id = generateId('diag')
  const sql = `INSERT INTO diagnosis_records (id, store_id, dimension, status, score, confidence, summary, details, recommendations, data_sources, diagnosed_at) VALUES ('${id}', '${esc(storeId)}', '${esc(dimension)}', 'completed', ${score}, ${confidence}, '${esc(summary)}', '${esc(details)}', '${esc(recommendations)}', '${esc(dataSources)}', datetime('now', 'localtime'))`
  await execSql(sql)
  return id
}

function buildPrescriptionItems(dimScores: Record<string, number>, store: DbStore): Array<{ action: string; costLevel: string; expectedImpact: string }> {
  const items: Array<{ action: string; costLevel: string; expectedImpact: string }> = []
  const sortedDims = Object.entries(dimScores).sort(([, a], [, b]) => a - b)

  for (const [dim, sc] of sortedDims) {
    if (sc >= 60) continue
    if (dim === 'operations') {
      items.push({ action: '本周启动会员充值满200送30活动，目标提升复购率5-10%', costLevel: 'zero', expectedImpact: '预计提升月营收3-5%' })
      items.push({ action: '在小红书/抖音发布门店特色内容，设置到店打卡优惠', costLevel: 'low', expectedImpact: '预计新增客流10-20人/天' })
      if (sc < 40) items.push({ action: '紧急排查客流下降原因，启动限时促销引流', costLevel: 'medium', expectedImpact: '预计2周内客流回升15%' })
    } else if (dim === 'cost') {
      items.push({ action: '与房东谈判降租10%或争取免租期', costLevel: 'zero', expectedImpact: `预计月节省¥${Math.round(store.rent_cost * 0.1)}` })
      items.push({ action: '优化排班，削减闲时冗余人力', costLevel: 'zero', expectedImpact: '预计降低人工成本5-8%' })
      if (sc < 40) items.push({ action: '审查供应商合同，更换更具性价比的供应商', costLevel: 'low', expectedImpact: '预计降低材料成本8-12%' })
    } else if (dim === 'competition') {
      items.push({ action: '找到3公里内竞品未覆盖的细分需求，推出差异化产品', costLevel: 'low', expectedImpact: '预计提升客单价10-15%' })
      items.push({ action: '与周边3-5家非竞争门店建立异业联盟互相引流', costLevel: 'zero', expectedImpact: '预计新增客流5-10%' })
      if (sc < 40) items.push({ action: '考虑门店翻新或品牌重塑，提升竞争力', costLevel: 'high', expectedImpact: '预计3个月内客流提升20-30%' })
    } else if (dim === 'scene') {
      if (store.type === 'retail') {
        items.push({ action: '每2周更换橱窗陈列，使用灯光和色彩吸引路人', costLevel: 'low', expectedImpact: '预计提升进店率15-20%' })
        items.push({ action: '调整品类结构，聚焦核心品类，淘汰低效品类', costLevel: 'zero', expectedImpact: '预计提升坪效10-15%' })
      } else if (store.type === 'restaurant') {
        items.push({ action: '优化菜单结构，突出高毛利菜品，淘汰低效菜品', costLevel: 'zero', expectedImpact: '预计提升毛利率3-5%' })
        items.push({ action: '推行扫码点餐，减少等待时间，提升翻台率', costLevel: 'low', expectedImpact: '预计翻台率提升0.5-1次/天' })
      } else {
        items.push({ action: '开发3个月/6个月服务套餐，锁定客户长期消费', costLevel: 'low', expectedImpact: '预计提升留存率15-20%' })
        items.push({ action: '建立客户分层管理体系，精准营销提升复购', costLevel: 'zero', expectedImpact: '预计提升复购率10-15%' })
      }
    }
  }

  return items.sort((a, b) => COST_ORDER.indexOf(a.costLevel) - COST_ORDER.indexOf(b.costLevel))
}

async function storeManage(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const rawAction = args.action as string
  let action: string
  try {
    action = validateEnum(rawAction, VALID_ACTIONS.store_manage, 'action')
  } catch (e) {
    return diagError((e as Error).message)
  }

  switch (action) {
    case 'create': {
      const data = args.data as Record<string, unknown> | undefined
      if (!data?.name) return diagError('Store name is required for creation')
      if (String(data.name).length > 100) return diagError('Store name is too long (max 100 chars)')

      const storeType = data.type ? validateEnum(data.type, VALID_STORE_TYPES, 'type') : 'retail'
      const businessStatus = data.business_status ? validateEnum(data.business_status, VALID_BUSINESS_STATUS, 'business_status') : 'normal'

      const id = generateId('store')
      const fields = ['id', 'name', 'type', 'sub_type', 'area', 'business_hours', 'employee_count', 'avg_transaction_value', 'main_categories', 'rent_cost', 'decoration_age', 'region', 'city_tier', 'contact_phone', 'opened_at', 'monthly_revenue', 'business_status', 'photos', 'notes']
      const values = [
        `'${id}'`, `'${esc(data.name)}'`, `'${storeType}'`, `'${esc(data.sub_type || '')}'`,
        num(data.area), `'${esc(data.business_hours || '')}'`, num(data.employee_count),
        num(data.avg_transaction_value), `'${esc(data.main_categories || '')}'`,
        num(data.rent_cost), num(data.decoration_age), `'${esc(data.region || '')}'`,
        num(data.city_tier, 2), `'${esc(data.contact_phone || '')}'`, `'${esc(data.opened_at || '')}'`,
        num(data.monthly_revenue), `'${esc(businessStatus)}'`,
        `'${esc(data.photos || '')}'`, `'${esc(data.notes || '')}'`
      ]

      const sql = `INSERT INTO stores (${fields.join(', ')}) VALUES (${values.join(', ')})`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to create store')

      return diagSuccess(`✅ 门店「${data.name}」创建成功 (ID: ${id})`, { storeId: id })
    }

    case 'update': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }
      const data = args.data as Record<string, unknown> | undefined
      if (!data || Object.keys(data).length === 0) return diagError('No data provided for update')

      if (data.type && !VALID_STORE_TYPES.has(String(data.type))) return diagError(`Invalid type: ${data.type}`)
      if (data.business_status && !VALID_BUSINESS_STATUS.has(String(data.business_status))) return diagError(`Invalid business_status: ${data.business_status}`)

      const allowedFields = ['name', 'type', 'sub_type', 'area', 'business_hours', 'employee_count', 'avg_transaction_value', 'main_categories', 'rent_cost', 'decoration_age', 'region', 'city_tier', 'contact_phone', 'opened_at', 'monthly_revenue', 'business_status', 'photos', 'notes']
      const stringFields = new Set(['name', 'type', 'sub_type', 'business_hours', 'main_categories', 'region', 'contact_phone', 'opened_at', 'business_status', 'photos', 'notes'])

      const setClauses: string[] = []
      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          const val = data[field]
          setClauses.push(stringFields.has(field) ? `${field} = '${esc(val)}'` : `${field} = ${num(val)}`)
        }
      }
      setClauses.push("updated_at = datetime('now', 'localtime')")

      const sql = `UPDATE stores SET ${setClauses.join(', ')} WHERE id = '${esc(storeId)}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update store')
      if (result.rowsAffected === 0) return diagError(`Store not found: ${storeId}`)

      return diagSuccess('✅ 门店信息更新成功', { storeId })
    }

    case 'delete': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

      const sql = `DELETE FROM stores WHERE id = '${esc(storeId)}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to delete store')
      if (result.rowsAffected === 0) return diagError(`Store not found: ${storeId}`)

      return diagSuccess('✅ 门店已删除', { storeId })
    }

    case 'get': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

      const store = await getStore(storeId)
      if (!store) return diagError(`Store not found: ${storeId}`)

      const lines = [
        `**${store.name}** (${store.type}${store.sub_type ? '/' + store.sub_type : ''})`,
        `📍 区域: ${store.region || '未填写'} | 城市等级: ${store.city_tier || '未填写'}`,
        `📐 面积: ${store.area}㎡ | 👥 员工: ${store.employee_count}人`,
        `🕐 营业时间: ${store.business_hours || '未填写'}`,
        `💰 月租金: ¥${store.rent_cost} | 💵 客单价: ¥${store.avg_transaction_value}`,
        `📦 经营品类: ${store.main_categories || '未填写'}`,
        `🏠 装修年限: ${store.decoration_age}年 | 📈 月营收: ¥${store.monthly_revenue || '未填写'}`,
        `📊 经营状态: ${store.business_status || '正常'}`,
        store.opened_at ? `📅 开业日期: ${store.opened_at}` : '',
        store.notes ? `📝 备注: ${store.notes}` : '',
        `创建: ${store.created_at} | 更新: ${store.updated_at}`,
      ].filter(Boolean)

      return diagSuccess(lines.join('\n'), { store })
    }

    case 'list': {
      const filters = args.filters as Record<string, string> | undefined
      let sql = 'SELECT id, name, type, sub_type, region, area, employee_count, rent_cost, business_status FROM stores'
      const conditions: string[] = []

      if (filters?.type) {
        if (!VALID_STORE_TYPES.has(filters.type)) return diagError(`Invalid type filter: ${filters.type}`)
        conditions.push(`type = '${esc(filters.type)}'`)
      }
      if (filters?.region) conditions.push(`region LIKE '%${escLike(filters.region)}%' ESCAPE '\\'`)
      if (filters?.sub_type) conditions.push(`sub_type = '${esc(filters.sub_type)}'`)
      if (filters?.business_status) {
        if (!VALID_BUSINESS_STATUS.has(filters.business_status)) return diagError(`Invalid business_status filter: ${filters.business_status}`)
        conditions.push(`business_status = '${esc(filters.business_status)}'`)
      }

      if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
      sql += ' ORDER BY updated_at DESC'

      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to list stores')

      const stores = result.rows || []
      if (stores.length === 0) return diagSuccess('暂无门店记录。使用 store_manage 的 create 操作添加门店。')

      const lines = [
        `**门店列表 (${stores.length})**`,
        '',
        '| # | 名称 | 类型 | 区域 | 面积 | 员工 | 月租 | 状态 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...stores.map((row, i) => {
          const s = row as unknown as DbStore
          return `| ${i + 1} | ${s.name} | ${s.type}${s.sub_type ? '/' + s.sub_type : ''} | ${s.region || '-'} | ${s.area}㎡ | ${s.employee_count} | ¥${s.rent_cost} | ${s.business_status || '正常'} |`
        }),
      ]

      return diagSuccess(lines.join('\n'), { stores })
    }

    default:
      return diagError(`Unknown action: ${action}. Use create/update/delete/get/list.`)
  }
}

async function diagnoseDimension(store: DbStore, dim: string, financials: DbFinancial[], trafficRows: Array<{ date: string; daily_customers: number; daily_new: number; daily_returning: number }>): Promise<{ score: number; confidence: number; summary: string; details: string; recommendations: string; dataSources: string }> {
  const hasFinancial = financials.length > 0
  const hasTraffic = trafficRows.length > 0
  const dataPoints = financials.length + trafficRows.length
  const confidence = calcConfidence(hasFinancial, hasTraffic, dataPoints)
  const dataSources = [hasFinancial ? '财务数据' : '', hasTraffic ? '客流数据' : '', '门店基础信息'].filter(Boolean).join(', ')

  const benchmarks = await getBenchmarks(store.type, store.sub_type)
  const benchmarkMap = new Map<string, DbBenchmark>()
  for (const b of benchmarks) {
    if (!benchmarkMap.has(b.metric)) benchmarkMap.set(b.metric, b)
    const key = b.sub_category ? `${b.metric}:${b.sub_category}` : b.metric
    benchmarkMap.set(key, b)
  }

  const scoreRules = await getScoreRules(dim, store.type)
  const ruleMap = new Map<string, DbScoreRule>()
  for (const r of scoreRules) {
    if (!ruleMap.has(r.metric)) ruleMap.set(r.metric, r)
  }

  function scoreByRule(metric: string, actualValue: number | null, fallback: { excellent: number; good: number; poor: number }): { points: number; label: string } {
    if (actualValue === null) return { points: 0, label: '' }
    const rule = ruleMap.get(metric)
    if (!rule) {
      const val = actualValue
      if (val >= fallback.excellent) return { points: 15, label: `✅ ${metric}: ${val.toFixed(1)} ≥ ${fallback.excellent}` }
      if (val >= fallback.good) return { points: 5, label: `⚠️ ${metric}: ${val.toFixed(1)} (优秀线${fallback.excellent})` }
      if (val <= fallback.poor) return { points: -10, label: `❌ ${metric}: ${val.toFixed(1)} ≤ ${fallback.poor}` }
      return { points: 0, label: '' }
    }

    const isInverse = rule.is_inverse === 1
    const val = actualValue
    const excellent = rule.excellent_threshold
    const good = rule.good_threshold
    const poor = rule.poor_threshold

    if (isInverse) {
      if (val <= excellent) return { points: Math.round(rule.weight * 100), label: `✅ ${rule.description}: ${val.toFixed(1)} ≤ ${excellent}` }
      if (val <= good) return { points: Math.round(rule.weight * 70), label: `⚠️ ${rule.description}: ${val.toFixed(1)} (优秀线${excellent})` }
      if (val <= poor) return { points: Math.round(rule.weight * 40), label: `❌ ${rule.description}: ${val.toFixed(1)} (警戒线${poor})` }
      return { points: Math.round(rule.weight * 15), label: `❌ ${rule.description}: ${val.toFixed(1)} > ${poor} (严重超标)` }
    }

    if (val >= excellent) return { points: Math.round(rule.weight * 100), label: `✅ ${rule.description}: ${val.toFixed(1)} ≥ ${excellent}` }
    if (val >= good) return { points: Math.round(rule.weight * 70), label: `⚠️ ${rule.description}: ${val.toFixed(1)} (优秀线${excellent})` }
    if (val >= poor) return { points: Math.round(rule.weight * 40), label: `❌ ${rule.description}: ${val.toFixed(1)} (警戒线${poor})` }
    return { points: Math.round(rule.weight * 15), label: `❌ ${rule.description}: ${val.toFixed(1)} < ${poor} (严重不足)` }
  }

  const factors: string[] = []
  let score = 50

  switch (dim) {
    case 'operations': {
      if (hasTraffic && trafficRows.length > 0) {
        const avgDailyCustomers = trafficRows.reduce((s, r) => s + r.daily_customers, 0) / trafficRows.length
        const avgReturningRate = trafficRows.reduce((s, r) => s + (r.daily_returning / Math.max(r.daily_customers, 1)), 0) / trafficRows.length * 100

        const dailyRule = scoreByRule('daily_traffic', avgDailyCustomers, { excellent: 100, good: 50, poor: 20 })
        if (dailyRule.label) { factors.push(dailyRule.label); score += Math.round(dailyRule.points * 0.3) }
        else {
          if (avgDailyCustomers > 100) { score += 15; factors.push(`✅ 日均客流良好: ${avgDailyCustomers.toFixed(0)}人/天`) }
          else if (avgDailyCustomers > 50) { score += 5; factors.push(`⚠️ 日均客流一般: ${avgDailyCustomers.toFixed(0)}人/天`) }
          else { score -= 10; factors.push(`❌ 日均客流偏低: ${avgDailyCustomers.toFixed(0)}人/天`) }
        }

        const returnRule = scoreByRule('returning_rate', avgReturningRate, { excellent: 40, good: 25, poor: 10 })
        if (returnRule.label) { factors.push(returnRule.label); score += Math.round(returnRule.points * 0.3) }
        else {
          if (avgReturningRate > 40) { score += 15; factors.push(`✅ 复购率良好: ${avgReturningRate.toFixed(1)}%`) }
          else if (avgReturningRate > 25) { score += 5; factors.push(`⚠️ 复购率一般: ${avgReturningRate.toFixed(1)}%`) }
          else { score -= 5; factors.push(`❌ 复购率偏低: ${avgReturningRate.toFixed(1)}%`) }
        }

        const repeatBench = benchmarkMap.get('repeat_rate')
        if (repeatBench) {
          if (avgReturningRate >= repeatBench.top_quartile) { score += 5; factors.push(`✅ 复购率超过行业优秀线(${repeatBench.top_quartile}%)`) }
          else if (avgReturningRate < repeatBench.industry_avg) { score -= 5; factors.push(`❌ 复购率低于行业均值(${repeatBench.industry_avg}%)`) }
        }
      } else {
        factors.push('⚠️ 无客流数据 — 无法完整评估经营效率')
        score -= 5
      }

      if (hasFinancial && financials[0]) {
        const fin = financials[0]
        if (fin.customer_count > 0 && fin.revenue > 0) {
          const avgTrans = fin.revenue / fin.customer_count
          const trendRatio = store.avg_transaction_value > 0 ? avgTrans / store.avg_transaction_value : 1
          const trendRule = scoreByRule('transaction_trend', trendRatio, { excellent: 1.1, good: 1.0, poor: 0.9 })
          if (trendRule.label) { factors.push(trendRule.label); score += Math.round(trendRule.points * 0.2) }
          else {
            if (avgTrans > store.avg_transaction_value * 1.1) { score += 10; factors.push(`✅ 客单价趋势上升: ¥${avgTrans.toFixed(0)}`) }
            else if (avgTrans < store.avg_transaction_value * 0.9) { score -= 5; factors.push(`❌ 客单价趋势下降: ¥${avgTrans.toFixed(0)}`) }
          }
        }

        if (store.area > 0 && fin.revenue > 0) {
          const salesPerSqm = fin.revenue / store.area
          const sqmRule = scoreByRule('revenue_per_sqm', salesPerSqm, { excellent: 500, good: 200, poor: 50 })
          if (sqmRule.label) { factors.push(sqmRule.label); score += Math.round(sqmRule.points * 0.2) }
          else {
            const sqmBench = benchmarkMap.get('sales_per_sqm')
            if (sqmBench) {
              if (salesPerSqm >= sqmBench.top_quartile) { score += 10; factors.push(`✅ 坪效优秀: ¥${salesPerSqm.toFixed(0)}/㎡/月`) }
              else if (salesPerSqm >= sqmBench.industry_avg) { score += 5; factors.push(`⚠️ 坪效达标: ¥${salesPerSqm.toFixed(0)}/㎡/月`) }
              else { score -= 10; factors.push(`❌ 坪效偏低: ¥${salesPerSqm.toFixed(0)}/㎡/月 (行业均值¥${sqmBench.industry_avg})`) }
            }
          }
        }
      }

      score = clampScore(score)
      return {
        score, confidence,
        summary: score >= 70 ? '经营效率良好' : score >= 50 ? '经营效率需改善' : '经营效率存在严重问题',
        details: factors.join('\n'),
        recommendations: score >= 70
          ? '持续监控关键指标，保持客户满意度'
          : score >= 50
            ? '1. 拓展获客渠道，提升日均客流\n2. 实施会员制度，提高复购率\n3. 分析峰谷时段，优化排班效率'
            : '1. 🚨 紧急排查客流下降原因\n2. 立即启动客户留存活动\n3. 审视产品/服务质量\n4. 考虑促销活动引流',
        dataSources,
      }
    }

    case 'cost': {
      if (!hasFinancial || financials.length === 0) {
        return {
          score: clampScore(50), confidence: Math.max(confidence - 0.3, 0.1),
          summary: '成本结构无法评估', details: '⚠️ 无财务数据 — 无法评估成本结构',
          recommendations: '请先录入财务数据，以便进行成本分析', dataSources: '门店基础信息',
        }
      }

      const fin = financials[0]
      const revenue = fin.revenue
      if (revenue <= 0) {
        return {
          score: clampScore(20), confidence,
          summary: '营收为零或负数，成本结构严重异常',
          details: '❌ 营收数据异常，请检查财务数据',
          recommendations: '1. 🚨 立即核实营收数据\n2. 检查是否有漏记收入',
          dataSources,
        }
      }

      const rentRatio = (fin.rent_cost / revenue) * 100
      const laborRatio = (fin.labor_cost / revenue) * 100
      const materialRatio = (fin.material_cost / revenue) * 100
      const totalCostRatio = rentRatio + laborRatio + materialRatio + (fin.utility_cost / revenue) * 100 + (fin.other_cost / revenue) * 100

      const rentRule = scoreByRule('rent_ratio', rentRatio, { excellent: 10, good: 15, poor: 20 })
      if (rentRule.label) { factors.push(rentRule.label); score += Math.round(rentRule.points * 0.3) }
      else {
        const rentBench = benchmarkMap.get('rent_ratio')
        if (rentBench) {
          if (rentRatio <= rentBench.top_quartile) { score += 15; factors.push(`✅ 租金占比 ${rentRatio.toFixed(1)}% (优秀线: ${rentBench.top_quartile}%)`) }
          else if (rentRatio <= rentBench.industry_avg) { score += 5; factors.push(`⚠️ 租金占比 ${rentRatio.toFixed(1)}% (行业均值: ${rentBench.industry_avg}%)`) }
          else { score -= 10; factors.push(`❌ 租金占比 ${rentRatio.toFixed(1)}% 高于行业均值 ${rentBench.industry_avg}%`) }
        }
      }

      const laborRule = scoreByRule('labor_ratio', laborRatio, { excellent: 15, good: 20, poor: 30 })
      if (laborRule.label) { factors.push(laborRule.label); score += Math.round(laborRule.points * 0.3) }
      else {
        const laborBench = benchmarkMap.get('labor_ratio')
        if (laborBench) {
          if (laborRatio <= laborBench.top_quartile) { score += 15; factors.push(`✅ 人工占比 ${laborRatio.toFixed(1)}% (优秀线: ${laborBench.top_quartile}%)`) }
          else if (laborRatio <= laborBench.industry_avg) { score += 5; factors.push(`⚠️ 人工占比 ${laborRatio.toFixed(1)}% (行业均值: ${laborBench.industry_avg}%)`) }
          else { score -= 10; factors.push(`❌ 人工占比 ${laborRatio.toFixed(1)}% 高于行业均值 ${laborBench.industry_avg}%`) }
        }
      }

      const materialRule = scoreByRule('material_ratio', materialRatio, { excellent: 28, good: 35, poor: 45 })
      if (materialRule.label) { factors.push(materialRule.label); score += Math.round(materialRule.points * 0.2) }
      else {
        const materialBench = benchmarkMap.get('material_ratio')
        if (materialBench) {
          if (materialRatio <= materialBench.top_quartile) { score += 10; factors.push(`✅ 材料占比 ${materialRatio.toFixed(1)}% (优秀线: ${materialBench.top_quartile}%)`) }
          else if (materialRatio <= materialBench.industry_avg) { score += 3; factors.push(`⚠️ 材料占比 ${materialRatio.toFixed(1)}% (行业均值: ${materialBench.industry_avg}%)`) }
          else { score -= 8; factors.push(`❌ 材料占比 ${materialRatio.toFixed(1)}% 高于行业均值 ${materialBench.industry_avg}%`) }
        }
      }

      const totalRule = scoreByRule('total_cost_ratio', totalCostRatio, { excellent: 75, good: 85, poor: 95 })
      if (totalRule.label) { factors.push(totalRule.label); score += Math.round(totalRule.points * 0.2) }
      else {
        if (totalCostRatio < 80) { score += 10; factors.push('✅ 总成本占比健康') }
        else if (totalCostRatio > 95) { score -= 15; factors.push('❌ 严重: 成本接近或超过营收') }
      }

      factors.push(`📊 成本结构: 租金${rentRatio.toFixed(1)}% | 人工${laborRatio.toFixed(1)}% | 材料${materialRatio.toFixed(1)}% | 总计${totalCostRatio.toFixed(1)}%`)

      if (financials.length >= 3) {
        const latest = financials[0]
        const prev = financials[financials.length - 1]
        if (prev.revenue > 0) {
          const latestTotal = latest.rent_cost + latest.labor_cost + latest.material_cost + latest.utility_cost + latest.other_cost
          const prevTotal = prev.rent_cost + prev.labor_cost + prev.material_cost + prev.utility_cost + prev.other_cost
          const latestRatio = (latestTotal / latest.revenue) * 100
          const prevRatio = (prevTotal / prev.revenue) * 100
          if (latestRatio < prevRatio) { score += 5; factors.push(`✅ 成本占比趋势下降 (${prevRatio.toFixed(1)}% → ${latestRatio.toFixed(1)}%)`) }
          else { score -= 5; factors.push(`⚠️ 成本占比趋势上升 (${prevRatio.toFixed(1)}% → ${latestRatio.toFixed(1)}%)`) }
        }
      }

      score = clampScore(score)
      return {
        score, confidence,
        summary: score >= 70 ? '成本结构健康' : score >= 50 ? '成本结构需优化' : '成本结构严重异常',
        details: factors.join('\n'),
        recommendations: score >= 70
          ? '保持成本纪律，探索供应商批量折扣'
          : score >= 50
            ? '1. 与房东谈判降租或争取免租期\n2. 优化排班减少人力浪费\n3. 审查供应商合同争取更优价格\n4. 采取节能措施降低水电费'
            : '1. 🚨 立即进行成本审计\n2. 削减一切非必要开支\n3. 谈判降租或考虑搬迁\n4. 考虑人员优化\n5. 更换更具性价比的供应商',
        dataSources,
      }
    }

    case 'competition': {
      const competitorResult = await execSql(`SELECT * FROM store_competitors WHERE store_id = '${esc(store.id)}'`)
      const competitors = (competitorResult.rows || []) as unknown as DbCompetitor[]

      if (store.region) {
        const nearbyResult = await execSql(`SELECT COUNT(*) as count FROM stores WHERE region LIKE '%${esc(store.region)}%' AND id != '${esc(store.id)}'`)
        const nearbyCount = (nearbyResult.rows?.[0] as unknown as { count: number })?.count || 0

        const densityRule = scoreByRule('nearby_density', nearbyCount, { excellent: 2, good: 5, poor: 10 })
        if (densityRule.label) { factors.push(densityRule.label); score += Math.round(densityRule.points * 0.3) }
        else {
          if (nearbyCount <= 2) { score += 15; factors.push(`✅ 周边竞争低: ${nearbyCount}家同区域门店`) }
          else if (nearbyCount <= 5) { score += 0; factors.push(`⚠️ 周边竞争中等: ${nearbyCount}家同区域门店`) }
          else { score -= 10; factors.push(`❌ 周边竞争激烈: ${nearbyCount}家同区域门店`) }
        }
      }

      if (competitors.length > 0) {
        const highThreat = competitors.filter(c => c.threat_level === 'high').length
        const medThreat = competitors.filter(c => c.threat_level === 'medium').length
        if (highThreat > 2) { score -= 10; factors.push(`❌ ${highThreat}个高威胁竞品`) }
        else if (highThreat > 0) { score -= 5; factors.push(`⚠️ ${highThreat}个高威胁竞品`) }
        if (medThreat > 3) { score -= 5; factors.push(`⚠️ ${medThreat}个中等威胁竞品`) }
        factors.push(`📊 已录入${competitors.length}个竞品 (高${highThreat}/中${medThreat}/低${competitors.length - highThreat - medThreat})`)
      }

      if (hasFinancial && financials[0] && financials[0].revenue > 0) {
        const grossMargin = ((financials[0].revenue - financials[0].material_cost) / financials[0].revenue) * 100
        const marginRule = scoreByRule('gross_margin_rank', grossMargin, { excellent: 50, good: 35, poor: 20 })
        if (marginRule.label) { factors.push(marginRule.label); score += Math.round(marginRule.points * 0.3) }
        else {
          const marginBench = benchmarkMap.get('gross_margin')
          if (marginBench) {
            if (grossMargin >= marginBench.top_quartile) { score += 15; factors.push(`✅ 毛利率 ${grossMargin.toFixed(1)}% (优秀线: ${marginBench.top_quartile}%)`) }
            else if (grossMargin >= marginBench.industry_avg) { score += 5; factors.push(`⚠️ 毛利率 ${grossMargin.toFixed(1)}% (行业均值: ${marginBench.industry_avg}%)`) }
            else { score -= 10; factors.push(`❌ 毛利率 ${grossMargin.toFixed(1)}% 低于行业均值 ${marginBench.industry_avg}%`) }
          }
        }
      }

      const decoRule = scoreByRule('decoration_freshness', store.decoration_age, { excellent: 2, good: 4, poor: 6 })
      if (decoRule.label) { factors.push(decoRule.label); score += Math.round(decoRule.points * 0.2) }
      else {
        if (store.decoration_age > 5) { score -= 5; factors.push(`⚠️ 装修${store.decoration_age}年 — 可能需要翻新`) }
        if (store.decoration_age <= 2) { score += 5; factors.push(`✅ 近期装修(${store.decoration_age}年)`) }
      }

      if (store.main_categories) {
        const catCount = store.main_categories.split(',').length
        const focusRule = scoreByRule('category_focus', catCount, { excellent: 5, good: 8, poor: 12 })
        if (focusRule.label) { factors.push(focusRule.label); score += Math.round(focusRule.points * 0.2) }
      }

      score = clampScore(score)
      return {
        score, confidence: competitors.length > 0 ? confidence : Math.max(confidence - 0.1, 0.1),
        summary: score >= 70 ? '竞争优势明显' : score >= 50 ? '竞争力需加强' : '竞争地位薄弱',
        details: factors.join('\n') || '竞争分析数据有限',
        recommendations: score >= 70
          ? '持续保持竞争优势，关注行业动态'
          : score >= 50
            ? '1. 差异化产品/服务定位\n2. 提升门店环境和客户体验\n3. 打造独特价值主张\n4. 监控竞品定价和促销'
            : '1. 🚨 立即进行竞品分析\n2. 找到独特卖点\n3. 考虑门店翻新或品牌重塑\n4. 开展精准营销活动\n5. 探索细分市场机会',
        dataSources,
      }
    }

    case 'scene': {
      const sceneRules = await getScoreRules('scene', store.type)
      const sceneRuleMap = new Map<string, DbScoreRule>()
      for (const r of sceneRules) {
        if (!sceneRuleMap.has(r.metric)) sceneRuleMap.set(r.metric, r)
      }

      function sceneScoreByRule(metric: string, actualValue: number | null, fallback: { excellent: number; good: number; poor: number }): { points: number; label: string } {
        if (actualValue === null) return { points: 0, label: '' }
        const rule = sceneRuleMap.get(metric)
        if (!rule) {
          const val = actualValue
          if (val >= fallback.excellent) return { points: 15, label: `✅ ${metric}: ${val.toFixed(1)} ≥ ${fallback.excellent}` }
          if (val >= fallback.good) return { points: 5, label: `⚠️ ${metric}: ${val.toFixed(1)} (优秀线${fallback.excellent})` }
          if (val <= fallback.poor) return { points: -10, label: `❌ ${metric}: ${val.toFixed(1)} ≤ ${fallback.poor}` }
          return { points: 0, label: '' }
        }

        const isInverse = rule.is_inverse === 1
        const val = actualValue
        const excellent = rule.excellent_threshold
        const good = rule.good_threshold
        const poor = rule.poor_threshold

        if (isInverse) {
          if (val <= excellent) return { points: Math.round(rule.weight * 100), label: `✅ ${rule.description}: ${val.toFixed(1)} ≤ ${excellent}` }
          if (val <= good) return { points: Math.round(rule.weight * 70), label: `⚠️ ${rule.description}: ${val.toFixed(1)} (优秀线${excellent})` }
          if (val <= poor) return { points: Math.round(rule.weight * 40), label: `❌ ${rule.description}: ${val.toFixed(1)} (警戒线${poor})` }
          return { points: Math.round(rule.weight * 15), label: `❌ ${rule.description}: ${val.toFixed(1)} > ${poor} (严重超标)` }
        }

        if (val >= excellent) return { points: Math.round(rule.weight * 100), label: `✅ ${rule.description}: ${val.toFixed(1)} ≥ ${excellent}` }
        if (val >= good) return { points: Math.round(rule.weight * 70), label: `⚠️ ${rule.description}: ${val.toFixed(1)} (优秀线${excellent})` }
        if (val >= poor) return { points: Math.round(rule.weight * 40), label: `❌ ${rule.description}: ${val.toFixed(1)} (警戒线${poor})` }
        return { points: Math.round(rule.weight * 15), label: `❌ ${rule.description}: ${val.toFixed(1)} < ${poor} (严重不足)` }
      }

      switch (store.type) {
        case 'retail': {
          if (store.area > 0 && hasFinancial && financials[0]) {
            const salesPerSqm = financials[0].revenue / store.area
            const sqmRule = sceneScoreByRule('sales_per_sqm', salesPerSqm, { excellent: 500, good: 200, poor: 50 })
            if (sqmRule.label) { factors.push(sqmRule.label); score += Math.round(sqmRule.points * 0.4) }
            else {
              const sqmBench = benchmarkMap.get('sales_per_sqm')
              if (salesPerSqm > 500) { score += 15; factors.push(`✅ 坪效良好: ¥${salesPerSqm.toFixed(0)}/㎡/月`) }
              else if (salesPerSqm > 200) { score += 5; factors.push(`⚠️ 坪效一般: ¥${salesPerSqm.toFixed(0)}/㎡/月`) }
              else if (salesPerSqm > 0) { score -= 10; factors.push(`❌ 坪效偏低: ¥${salesPerSqm.toFixed(0)}/㎡/月`) }
              if (sqmBench) factors.push(`📊 行业基准: 均值¥${sqmBench.industry_avg} 优秀¥${sqmBench.top_quartile}`)
            }
          }
          if (store.main_categories) {
            const catCount = store.main_categories.split(',').length
            const catRule = sceneScoreByRule('category_balance', catCount, { excellent: 5, good: 8, poor: 12 })
            if (catRule.label) { factors.push(catRule.label); score += Math.round(catRule.points * 0.3) }
            else {
              if (catCount >= 3 && catCount <= 8) { score += 10; factors.push(`✅ 品类数量均衡: ${catCount}个`) }
              else if (catCount > 8) { score -= 5; factors.push(`⚠️ 品类过多: ${catCount}个`) }
              else { score -= 3; factors.push(`⚠️ 品类偏少: ${catCount}个`) }
            }
          }
          const displayRule = sceneScoreByRule('display_freshness', store.decoration_age, { excellent: 2, good: 4, poor: 6 })
          if (displayRule.label) { factors.push(displayRule.label); score += Math.round(displayRule.points * 0.3) }
          else {
            if (store.decoration_age > 3) { score -= 5; factors.push('⚠️ 建议更新橱窗陈列和店内布局') }
          }
          break
        }
        case 'restaurant': {
          if (hasFinancial && financials[0]) {
            const fin = financials[0]
            const materialRatio = fin.revenue > 0 ? (fin.material_cost / fin.revenue) * 100 : 0
            const foodRule = sceneScoreByRule('food_cost_ratio', materialRatio, { excellent: 28, good: 35, poor: 45 })
            if (foodRule.label) { factors.push(foodRule.label); score += Math.round(foodRule.points * 0.4) }
            else {
              if (materialRatio < 30) { score += 15; factors.push(`✅ 食材成本控制良好: ${materialRatio.toFixed(1)}%`) }
              else if (materialRatio < 40) { score += 5; factors.push(`⚠️ 食材成本可接受: ${materialRatio.toFixed(1)}%`) }
              else { score -= 10; factors.push(`❌ 食材成本偏高: ${materialRatio.toFixed(1)}%`) }
              const matBench = benchmarkMap.get('material_ratio')
              if (matBench) factors.push(`📊 行业基准: 均值${matBench.industry_avg}% 优秀${matBench.top_quartile}%`)
            }
          }
          const turnoverBench = benchmarkMap.get('table_turnover')
          if (turnoverBench) {
            const turnoverRule = sceneScoreByRule('table_turnover', turnoverBench.industry_avg, { excellent: 4, good: 2.5, poor: 1.5 })
            if (turnoverRule.label) { factors.push(turnoverRule.label); score += Math.round(turnoverRule.points * 0.3) }
            else factors.push(`📊 翻台率基准: 均值${turnoverBench.industry_avg}次/天 优秀${turnoverBench.top_quartile}次/天`)
          }
          const wasteRule = sceneScoreByRule('waste_ratio', null, { excellent: 2, good: 5, poor: 10 })
          if (wasteRule.label) { factors.push(wasteRule.label); score += Math.round(wasteRule.points * 0.3) }
          break
        }
        case 'service': {
          if (hasFinancial && financials[0]) {
            const repeatRate = financials[0].repeat_customer_rate
            const repeatRule = sceneScoreByRule('repeat_rate', repeatRate, { excellent: 50, good: 35, poor: 20 })
            if (repeatRule.label) { factors.push(repeatRule.label); score += Math.round(repeatRule.points * 0.4) }
            else {
              if (repeatRate > 50) { score += 15; factors.push(`✅ 复购率强: ${repeatRate.toFixed(1)}%`) }
              else if (repeatRate > 30) { score += 5; factors.push(`⚠️ 复购率一般: ${repeatRate.toFixed(1)}%`) }
              else { score -= 10; factors.push(`❌ 复购率低: ${repeatRate.toFixed(1)}%`) }
            }
          }
          const retBench = benchmarkMap.get('retention_rate')
          if (retBench) {
            const retRule = sceneScoreByRule('retention_rate', retBench.industry_avg, { excellent: 60, good: 40, poor: 25 })
            if (retRule.label) { factors.push(retRule.label); score += Math.round(retRule.points * 0.3) }
            else factors.push(`📊 留存率基准: 均值${retBench.industry_avg}% 优秀${retBench.top_quartile}%`)
          }
          const apptRule = sceneScoreByRule('appointment_rate', null, { excellent: 50, good: 30, poor: 15 })
          if (apptRule.label) { factors.push(apptRule.label); score += Math.round(apptRule.points * 0.3) }
          break
        }
        default:
          factors.push('⚠️ 未知门店类型，无法进行场景适配分析')
      }

      if (factors.length === 0) factors.push('⚠️ 数据不足，无法进行场景适配分析')

      score = clampScore(score)
      return {
        score, confidence,
        summary: score >= 70 ? '场景适配良好' : score >= 50 ? '场景适配需调整' : '场景适配存在严重问题',
        details: factors.join('\n'),
        recommendations: score >= 70
          ? '保持当前运营节奏，定期优化场景体验'
          : score >= 50
            ? store.type === 'retail'
              ? '1. 优化陈列布局提升进店率\n2. 调整品类结构聚焦核心品类\n3. 定期更新橱窗陈列'
              : store.type === 'restaurant'
                ? '1. 优化菜单结构突出高毛利菜品\n2. 提升翻台率\n3. 控制食材损耗'
                : '1. 开发长期服务套餐锁定客户\n2. 提升服务体验增加复购\n3. 建立客户分层管理体系'
            : '1. 🚨 立即审视门店定位\n2. 重新评估目标客群\n3. 考虑业态调整或转型',
        dataSources,
      }
    }

    default:
      return { score: 0, confidence: 0, summary: '未知维度', details: '', recommendations: '', dataSources: '' }
  }
}

async function storeDiagnose(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  let storeId: string
  try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }
  const rawDimension = args.dimension as string
  if (!rawDimension) return diagError('dimension is required')
  if (!VALID_DIMENSIONS.has(rawDimension)) return diagError(`Invalid dimension: ${rawDimension}. Allowed: ${[...VALID_DIMENSIONS].join(', ')}`)
  const dimension = rawDimension
  const includeFinancials = args.include_financials !== false
  const includeTraffic = args.include_traffic !== false

  const store = await getStore(storeId)
  if (!store) return diagError(`Store not found: ${storeId}`)

  const dimensions = dimension === 'all' ? ['operations', 'cost', 'competition', 'scene'] : [dimension]
  const financials = includeFinancials ? await getFinancials(storeId) : []
  const trafficRows = includeTraffic ? await getTrafficData(storeId) : []

  const results: Array<{ dimension: string; id: string; score: number; confidence: number; summary: string }> = []

  for (const dim of dimensions) {
    const diag = await diagnoseDimension(store, dim, financials, trafficRows)
    const id = await saveDiagnosis(storeId, dim, diag.score, diag.confidence, diag.summary, diag.details, diag.recommendations, diag.dataSources)
    results.push({ dimension: dim, id, score: diag.score, confidence: diag.confidence, summary: diag.summary })
  }

  if (dimension === 'all') {
    const overall = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    const avgConfidence = Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length * 100) / 100

    const lines = [
      `# 🏥 门店诊断报告: ${store.name}`,
      '',
      `**综合评分:** ${overall}/100 ${scoreEmoji(overall)}`,
      `**置信度:** ${Math.round(avgConfidence * 100)}%`,
      `**门店类型:** ${store.type}${store.sub_type ? '/' + store.sub_type : ''}`,
      '',
      '| 维度 | 评分 | 置信度 | 状态 | 摘要 |',
      '| --- | --- | --- | --- | --- |',
      ...results.map(r => `| ${DIM_LABELS[r.dimension] || r.dimension} | ${r.score} | ${Math.round(r.confidence * 100)}% | ${scoreLabel(r.score)} | ${r.summary} |`),
      '',
      overall < 60 ? '⚠️ **建议使用 health_check 工具获取一键处方笺**' : '',
    ].filter(Boolean)

    return diagSuccess(lines.join('\n'), { overall, dimensions: results, storeId })
  }

  const r = results[0]
  return diagSuccess(
    [`## ${DIM_LABELS[r.dimension] || r.dimension}诊断: ${store.name}`, '', `**评分:** ${r.score}/100 ${scoreEmoji(r.score)}`, `**置信度:** ${Math.round(r.confidence * 100)}%`, `**摘要:** ${r.summary}`].join('\n'),
    { dimension: r.dimension, score: r.score, confidence: r.confidence, diagnosisId: r.id }
  )
}

async function reportGenerate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  let storeId: string
  try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }
  const reportType = args.report_type as string
  const format = (args.format as string) || 'markdown'

  if (!reportType) return diagError('report_type is required')
  if (!VALID_ACTIONS.report_generate.has(reportType)) return diagError(`Invalid report_type: ${reportType}. Allowed: ${[...VALID_ACTIONS.report_generate].join(', ')}`)
  if (format !== 'markdown' && format !== 'html') return diagError('format must be markdown or html')

  const store = await getStore(storeId)
  if (!store) return diagError(`Store not found: ${storeId}`)

  const diagnosisResult = await execSql(`SELECT * FROM diagnosis_records WHERE store_id = '${esc(storeId)}' ORDER BY diagnosed_at DESC`)
  const diagnoses = (diagnosisResult.rows || []) as unknown as DbDiagnosisRecord[]

  const financialResult = await execSql(`SELECT * FROM store_financials WHERE store_id = '${esc(storeId)}' ORDER BY period DESC LIMIT 12`)
  const financials = (financialResult.rows || []) as unknown as DbFinancial[]

  const dimScores: Record<string, number> = {}
  const dimConfidence: Record<string, number> = {}
  for (const d of diagnoses) {
    if (!dimScores[d.dimension]) {
      dimScores[d.dimension] = d.score
      dimConfidence[d.dimension] = d.confidence
    }
  }
  const overall = Object.values(dimScores).length > 0 ? Math.round(Object.values(dimScores).reduce((s, v) => s + v, 0) / Object.values(dimScores).length) : 0

  switch (reportType) {
    case 'scorecard': {
      const lines = [
        `# 📊 门店评分卡: ${store.name}`, '',
        `**综合评分:** ${overall}/100 ${scoreEmoji(overall)}`,
        `**门店类型:** ${store.type}${store.sub_type ? '/' + store.sub_type : ''} | **区域:** ${store.region || '未填写'}`, '',
        ...Object.entries(dimScores).map(([dim, sc]) => `- **${DIM_LABELS[dim] || dim}**: ${sc}/100 ${scoreEmoji(sc)} (置信度${Math.round((dimConfidence[dim] || 0) * 100)}%)`),
        '', Object.keys(dimScores).length === 0 ? '⚠️ 尚无诊断数据，请先执行诊断' : '',
      ].filter(Boolean)
      return diagSuccess(lines.join('\n'), { chart: { type: 'radar', data: { dimensions: dimScores, overall }, title: `${store.name} - 评分卡` } })
    }

    case 'trend': {
      if (financials.length === 0) return diagSuccess('⚠️ 暂无财务数据，无法生成趋势报告。请先通过 store_data_entry 录入财务数据。')
      const lines = [
        `# 📈 趋势分析: ${store.name}`, '',
        `**分析周期:** ${financials[financials.length - 1]?.period} ~ ${financials[0]?.period}`, '',
        '| 月份 | 营收 | 租金 | 人工 | 材料 | 净利润 | 客流 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...[...financials].reverse().map(f => `| ${f.period} | ¥${f.revenue.toLocaleString()} | ¥${f.rent_cost.toLocaleString()} | ¥${f.labor_cost.toLocaleString()} | ¥${f.material_cost.toLocaleString()} | ¥${(f.net_profit || (f.revenue - f.rent_cost - f.labor_cost - f.material_cost - f.utility_cost - f.other_cost)).toLocaleString()} | ${f.customer_count} |`),
      ]
      return diagSuccess(lines.join('\n'), { chart: { type: 'line', data: { financials }, title: `${store.name} - 趋势分析` } })
    }

    case 'comparison': {
      const benchmarks = await getBenchmarks(store.type, store.sub_type)
      const lines = [
        `# 🏆 行业对比: ${store.name}`, '',
        `**门店类型:** ${store.type}${store.sub_type ? '/' + store.sub_type : ''}`, '',
        '| 指标 | 门店值 | 行业均值 | 优秀线 | 单位 |',
        '| --- | --- | --- | --- | --- |',
        ...benchmarks.map(b => {
          let storeVal = '-'
          if (b.metric === 'rent_ratio' && financials[0]?.revenue > 0) storeVal = `${((financials[0].rent_cost / financials[0].revenue) * 100).toFixed(1)}%`
          else if (b.metric === 'labor_ratio' && financials[0]?.revenue > 0) storeVal = `${((financials[0].labor_cost / financials[0].revenue) * 100).toFixed(1)}%`
          else if (b.metric === 'material_ratio' && financials[0]?.revenue > 0) storeVal = `${((financials[0].material_cost / financials[0].revenue) * 100).toFixed(1)}%`
          else if (b.metric === 'gross_margin' && financials[0]?.revenue > 0) storeVal = `${(((financials[0].revenue - financials[0].material_cost) / financials[0].revenue) * 100).toFixed(1)}%`
          return `| ${b.metric} | ${storeVal} | ${b.industry_avg} | ${b.top_quartile} | ${b.unit || ''} |`
        }),
      ]
      return diagSuccess(lines.join('\n'), { chart: { type: 'bar', data: { benchmarks, storeMetrics: {} }, title: `${store.name} - 行业对比` } })
    }

    case 'cost_breakdown': {
      if (financials.length === 0) return diagSuccess('⚠️ 暂无财务数据，无法生成成本分析报告。请先通过 store_data_entry 录入财务数据。')
      const fin = financials[0]
      const totalCost = fin.rent_cost + fin.labor_cost + fin.material_cost + fin.utility_cost + fin.other_cost
      const lines = [
        `# 💰 成本结构分析: ${store.name}`, '',
        `**期间:** ${fin.period} | **营收:** ¥${fin.revenue.toLocaleString()}`, '',
        '| 成本项 | 金额 | 占营收比 |',
        '| --- | --- | --- |',
        `| 租金 | ¥${fin.rent_cost.toLocaleString()} | ${fin.revenue > 0 ? ((fin.rent_cost / fin.revenue) * 100).toFixed(1) : 0}% |`,
        `| 人工 | ¥${fin.labor_cost.toLocaleString()} | ${fin.revenue > 0 ? ((fin.labor_cost / fin.revenue) * 100).toFixed(1) : 0}% |`,
        `| 材料 | ¥${fin.material_cost.toLocaleString()} | ${fin.revenue > 0 ? ((fin.material_cost / fin.revenue) * 100).toFixed(1) : 0}% |`,
        `| 水电 | ¥${fin.utility_cost.toLocaleString()} | ${fin.revenue > 0 ? ((fin.utility_cost / fin.revenue) * 100).toFixed(1) : 0}% |`,
        `| 其他 | ¥${fin.other_cost.toLocaleString()} | ${fin.revenue > 0 ? ((fin.other_cost / fin.revenue) * 100).toFixed(1) : 0}% |`,
        `| **合计** | **¥${totalCost.toLocaleString()}** | **${fin.revenue > 0 ? ((totalCost / fin.revenue) * 100).toFixed(1) : 0}%** |`,
        '', `**净利润:** ¥${(fin.net_profit || (fin.revenue - totalCost)).toLocaleString()}`,
      ]
      return diagSuccess(lines.join('\n'), { chart: { type: 'pie', data: { rent: fin.rent_cost, labor: fin.labor_cost, material: fin.material_cost, utility: fin.utility_cost, other: fin.other_cost }, title: `${store.name} - 成本结构` } })
    }

    case 'traffic_analysis': {
      const trafficData = await getTrafficData(storeId, 30)
      if (trafficData.length === 0) return diagSuccess('⚠️ 暂无客流数据，无法生成客流分析报告。请先通过 store_data_entry 录入客流数据。')
      const avgDaily = trafficData.reduce((s, r) => s + r.daily_customers, 0) / trafficData.length
      const avgNew = trafficData.reduce((s, r) => s + r.daily_new, 0) / trafficData.length
      const avgReturning = trafficData.reduce((s, r) => s + r.daily_returning, 0) / trafficData.length
      const avgReturnRate = avgDaily > 0 ? (avgReturning / avgDaily) * 100 : 0

      const peakDay = [...trafficData].sort((a, b) => b.daily_customers - a.daily_customers)[0]
      const lowDay = [...trafficData].sort((a, b) => a.daily_customers - b.daily_customers)[0]

      const lines = [
        `# 👥 客流分析: ${store.name}`, '',
        `**分析周期:** 最近${trafficData.length}天`, '',
        `**日均客流:** ${avgDaily.toFixed(0)}人`,
        `**日均新客:** ${avgNew.toFixed(0)}人 | **日均老客:** ${avgReturning.toFixed(0)}人`,
        `**复购率:** ${avgReturnRate.toFixed(1)}%`, '',
        `**客流高峰:** ${peakDay?.date} (${peakDay?.daily_customers}人)`,
        `**客流低谷:** ${lowDay?.date} (${lowDay?.daily_customers}人)`, '',
        '| 日期 | 客流 | 新客 | 老客 | 老客占比 |',
        '| --- | --- | --- | --- | --- |',
        ...trafficData.slice(0, 14).map(r => `| ${r.date} | ${r.daily_customers} | ${r.daily_new} | ${r.daily_returning} | ${r.daily_customers > 0 ? ((r.daily_returning / r.daily_customers) * 100).toFixed(1) : 0}% |`),
        trafficData.length > 14 ? '| ... | ... | ... | ... | ... |' : '',
      ].filter(Boolean)
      return diagSuccess(lines.join('\n'), { chart: { type: 'line', data: { traffic: trafficData }, title: `${store.name} - 客流趋势` } })
    }

    case 'prescription': {
      const prescriptionItems = buildPrescriptionItems(dimScores, store)
      const weakestDim = Object.entries(dimScores).sort(([, a], [, b]) => a - b)[0]

      const lines = [
        `# 🏥 门店处方笺: ${store.name}`, '',
        `**综合评分:** ${overall}/100 ${scoreEmoji(overall)}`,
        weakestDim ? `**最薄弱环节:** ${DIM_LABELS[weakestDim[0]] || weakestDim[0]}（${weakestDim[1]}分）` : '',
        '', '---', '',
        '## 📋 改善处方（按投入成本排序）', '',
        ...prescriptionItems.map((item, i) => {
          return `${i + 1}. ${COST_LABELS[item.costLevel] || item.costLevel} ${item.action}\n   → ${item.expectedImpact}`
        }),
        '',
        prescriptionItems.length === 0 ? '✅ 门店各维度表现良好，继续保持！建议定期复诊跟踪。' : '',
        '', '---',
        '*建议30天后复诊，对比改善效果*',
      ].filter(Boolean)

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'radar', data: { dimensions: dimScores, overall }, title: `${store.name} - 处方笺` },
        prescription: prescriptionItems,
      })
    }

    case 'export': {
      const now = new Date().toISOString().slice(0, 10)

      const mdContent = [
        `# 门店诊断报告 - ${store.name}`, '',
        `**报告日期:** ${now}`,
        `**门店类型:** ${store.type}${store.sub_type ? '/' + store.sub_type : ''}`,
        `**区域:** ${store.region || '未填写'} | **面积:** ${store.area}㎡`,
        `**综合评分:** ${overall}/100`, '',
        '---', '',
        '## 评分概览', '',
        '| 维度 | 评分 | 状态 |',
        '| --- | --- | --- |',
        ...Object.entries(dimScores).map(([dim, sc]) =>
          `| ${DIM_LABELS[dim] || dim} | ${sc} | ${scoreLabel(sc)} |`
        ),
        '', '---', '',
        ...diagnoses.map(d => [
          `## ${DIM_LABELS[d.dimension] || d.dimension} (${d.score}/100)`, '',
          `**摘要:** ${d.summary}`, '',
          d.details ? `**分析详情:**\n${d.details}` : '',
          '',
          d.recommendations ? `**改进建议:**\n${d.recommendations}` : '',
          '',
        ]).flat(),
        '---', '',
        `*报告由 AweeClaw 门店诊断系统自动生成 - ${now}*`,
      ].filter(line => line !== '').join('\n')

      const exportFormat = format || 'markdown'
      const fileName = `门店诊断报告_${store.name}_${now}.${exportFormat === 'html' ? 'html' : 'md'}`

      return diagSuccess(mdContent, { exportFormat, fileName, content: mdContent })
    }

    case 'full': {
      const prescriptionItems = buildPrescriptionItems(dimScores, store)
      const weakestDim = Object.entries(dimScores).sort(([, a], [, b]) => a - b)[0]
      const now = new Date().toISOString().slice(0, 10)

      const lines = [
        `# 🏥 门店全面诊断报告: ${store.name}`, '',
        `**报告日期:** ${now}`,
        `**门店类型:** ${store.type}${store.sub_type ? '/' + store.sub_type : ''}`,
        `**区域:** ${store.region || '未填写'} | **面积:** ${store.area}㎡`,
        `**综合评分:** ${overall}/100 ${scoreEmoji(overall)}`, '',
        '---', '',
        '## 📊 评分概览', '',
        '| 维度 | 评分 | 置信度 | 状态 |',
        '| --- | --- | --- | --- |',
        ...Object.entries(dimScores).map(([dim, sc]) =>
          `| ${DIM_LABELS[dim] || dim} | ${sc} | ${Math.round((dimConfidence[dim] || 0) * 100)}% | ${scoreLabel(sc)} |`
        ),
        '', '---', '',
        ...diagnoses.slice(0, 8).map(d => [
          `## ${DIM_LABELS[d.dimension] || d.dimension} (${d.score}/100)`, '',
          `**摘要:** ${d.summary}`, '',
          d.details ? `**详情:**\n${d.details}` : '',
          '',
          d.recommendations ? `**建议:**\n${d.recommendations}` : '',
          '',
        ]).flat(),
        '---', '',
        '## 📋 处方笺', '',
        weakestDim ? `**最薄弱环节:** ${DIM_LABELS[weakestDim[0]] || weakestDim[0]}（${weakestDim[1]}分）` : '',
        '',
        ...prescriptionItems.map((item, i) => {
          return `${i + 1}. ${COST_LABELS[item.costLevel]} ${item.action}\n   → ${item.expectedImpact}`
        }),
        '',
        prescriptionItems.length === 0 ? '✅ 门店各维度表现良好！' : '',
        '', '---',
        `*报告由 AweeClaw 门店诊断系统自动生成 - ${now}*`,
      ].filter(Boolean)

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'radar', data: { dimensions: dimScores, overall }, title: `${store.name} - 全面诊断` },
        prescription: prescriptionItems,
      })
    }

    default:
      return diagError(`Unknown report type: ${reportType}. Use full/scorecard/trend/comparison/cost_breakdown/traffic_analysis/prescription/export.`)
  }
}

async function optimizationPlan(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const rawAction = args.action as string
  let action: string
  try {
    action = validateEnum(rawAction, VALID_ACTIONS.optimization_plan, 'action')
  } catch (e) {
    return diagError((e as Error).message)
  }

  switch (action) {
    case 'create': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }
      const data = args.data as Record<string, unknown> | undefined
      if (!data?.title) return diagError('Plan title is required')

      const id = generateId('plan')
      const planType = str(data.plan_type, 'prescription')
      const sql = `INSERT INTO optimization_plans (id, store_id, diagnosis_id, title, description, priority, status, expected_effect, expected_roi, investment_cost, execution_cycle, plan_type, tasks) VALUES ('${id}', '${esc(storeId)}', '${esc(data.diagnosis_id || '')}', '${esc(data.title)}', '${esc(data.description || '')}', ${num(data.priority, 5)}, 'pending', '${esc(data.expected_effect || '')}', ${num(data.expected_roi)}, ${num(data.investment_cost)}, '${esc(data.execution_cycle || '')}', '${esc(planType)}', '[]')`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to create plan')

      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        for (const task of data.tasks) {
          const t = task as Record<string, unknown>
          const taskId = generateId('task')
          const costLevel = t.cost_level && VALID_COST_LEVELS.has(String(t.cost_level)) ? String(t.cost_level) : 'zero'
          await execSql(`INSERT INTO plan_tasks (id, plan_id, title, description, assignee, due_date, status, cost_level, expected_impact) VALUES ('${taskId}', '${id}', '${esc(t.title || '')}', '${esc(t.description || '')}', '${esc(t.assignee || '')}', '${esc(t.due_date || '')}', 'pending', '${esc(costLevel)}', '${esc(t.expected_impact || '')}')`)
        }
      }

      return diagSuccess(`✅ 优化方案「${data.title}」创建成功 (ID: ${id})`, { planId: id })
    }

    case 'update': {
      let planId: string
      try { planId = validateId(args.plan_id, 'plan_id') } catch (e) { return diagError((e as Error).message) }
      const data = args.data as Record<string, unknown> | undefined
      if (!data || Object.keys(data).length === 0) return diagError('No data provided for update')

      if (data.status && !VALID_PLAN_STATUS.has(String(data.status))) return diagError(`Invalid status: ${data.status}`)

      const allowedFields = ['title', 'description', 'priority', 'status', 'expected_effect', 'expected_roi', 'investment_cost', 'execution_cycle', 'plan_type']
      const stringFields = new Set(['title', 'description', 'status', 'expected_effect', 'execution_cycle', 'plan_type'])
      const setClauses: string[] = []
      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          const val = data[field]
          setClauses.push(stringFields.has(field) ? `${field} = '${esc(val)}'` : `${field} = ${num(val)}`)
        }
      }
      setClauses.push("updated_at = datetime('now', 'localtime')")

      const sql = `UPDATE optimization_plans SET ${setClauses.join(', ')} WHERE id = '${esc(planId)}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update plan')
      if (result.rowsAffected === 0) return diagError(`Plan not found: ${planId}`)

      return diagSuccess('✅ 优化方案更新成功', { planId })
    }

    case 'delete': {
      let planId: string
      try { planId = validateId(args.plan_id, 'plan_id') } catch (e) { return diagError((e as Error).message) }
      const result = await execSql(`DELETE FROM optimization_plans WHERE id = '${esc(planId)}'`)
      if (!result.success) return diagError(result.error || 'Failed to delete plan')
      if (result.rowsAffected === 0) return diagError(`Plan not found: ${planId}`)
      return diagSuccess('✅ 优化方案已删除', { planId })
    }

    case 'get': {
      let planId: string
      try { planId = validateId(args.plan_id, 'plan_id') } catch (e) { return diagError((e as Error).message) }
      const r = await execSql(`SELECT * FROM optimization_plans WHERE id = '${esc(planId)}'`)
      if (!r.success || !r.rows || r.rows.length === 0) return diagError(`Plan not found: ${planId}`)
      const plan = r.rows[0] as unknown as Record<string, unknown>

      const taskResult = await execSql(`SELECT * FROM plan_tasks WHERE plan_id = '${esc(planId)}' ORDER BY status, due_date`)
      const tasks = (taskResult.rows || []) as unknown as DbPlanTask[]

      const lines = [
        `**${plan.title}** [${plan.plan_type || 'prescription'}]`,
        `📋 状态: ${plan.status} | 优先级: ${plan.priority}`,
        plan.description ? `📝 ${plan.description}` : '',
        plan.expected_effect ? `🎯 预期效果: ${plan.expected_effect}` : '',
        plan.expected_roi ? `📈 预期ROI: ${plan.expected_roi}%` : '',
        plan.investment_cost ? `💰 投入成本: ¥${plan.investment_cost}` : '',
        plan.execution_cycle ? `⏱️ 执行周期: ${plan.execution_cycle}` : '',
        '',
        tasks.length > 0 ? `**任务 (${tasks.length}):**` : '',
        ...tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.title} ${t.cost_level ? COST_LABELS[t.cost_level] || '' : ''} ${t.expected_impact ? `→ ${t.expected_impact}` : ''}`),
      ].filter(Boolean)
      return diagSuccess(lines.join('\n'), { plan, tasks })
    }

    case 'list': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }
      const r = await execSql(`SELECT * FROM optimization_plans WHERE store_id = '${esc(storeId)}' ORDER BY priority, updated_at DESC`)
      if (!r.success) return diagError(r.error || 'Failed to list plans')
      const plans = r.rows || []
      if (plans.length === 0) return diagSuccess('暂无优化方案。使用 create 操作创建方案。')

      const lines = [
        `**优化方案列表 (${plans.length})**`, '',
        '| # | 标题 | 类型 | 状态 | 优先级 |',
        '| --- | --- | --- | --- | --- |',
        ...plans.map((p, i) => {
          const plan = p as unknown as Record<string, unknown>
          return `| ${i + 1} | ${plan.title} | ${plan.plan_type || 'general'} | ${plan.status} | ${plan.priority} |`
        }),
      ]
      return diagSuccess(lines.join('\n'), { plans })
    }

    case 'add_task': {
      let planId: string
      try { planId = validateId(args.plan_id, 'plan_id') } catch (e) { return diagError((e as Error).message) }
      const data = args.data as Record<string, unknown> | undefined
      if (!data?.title) return diagError('Task title is required')

      const costLevel = data.cost_level && VALID_COST_LEVELS.has(String(data.cost_level)) ? String(data.cost_level) : 'zero'
      const taskId = generateId('task')
      const sql = `INSERT INTO plan_tasks (id, plan_id, title, description, assignee, due_date, status, cost_level, expected_impact) VALUES ('${taskId}', '${esc(planId)}', '${esc(data.title)}', '${esc(data.description || '')}', '${esc(data.assignee || '')}', '${esc(data.due_date || '')}', 'pending', '${esc(costLevel)}', '${esc(data.expected_impact || '')}')`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to add task')
      return diagSuccess(`✅ 任务「${data.title}」添加成功`, { taskId })
    }

    case 'update_task': {
      let taskId: string
      try { taskId = validateId(args.task_id, 'task_id') } catch (e) { return diagError((e as Error).message) }
      const data = args.task_data as Record<string, unknown> | undefined
      if (!data || Object.keys(data).length === 0) return diagError('No data provided for update')

      if (data.status && !VALID_TASK_STATUS.has(String(data.status))) return diagError(`Invalid status: ${data.status}`)
      if (data.cost_level && !VALID_COST_LEVELS.has(String(data.cost_level))) return diagError(`Invalid cost_level: ${data.cost_level}`)

      const allowedFields = ['title', 'description', 'assignee', 'due_date', 'status', 'cost_level', 'expected_impact']
      const stringFields = new Set(['title', 'description', 'assignee', 'due_date', 'status', 'cost_level', 'expected_impact'])
      const setClauses: string[] = []
      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          setClauses.push(stringFields.has(field) ? `${field} = '${esc(data[field])}'` : `${field} = ${num(data[field])}`)
        }
      }
      if (data.status === 'completed') setClauses.push("completed_at = datetime('now', 'localtime')")

      const sql = `UPDATE plan_tasks SET ${setClauses.join(', ')} WHERE id = '${esc(taskId)}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update task')
      if (result.rowsAffected === 0) return diagError(`Task not found: ${taskId}`)
      return diagSuccess('✅ 任务更新成功', { taskId })
    }

    case 'list_tasks': {
      let planId: string
      try { planId = validateId(args.plan_id, 'plan_id') } catch (e) { return diagError((e as Error).message) }
      const r = await execSql(`SELECT * FROM plan_tasks WHERE plan_id = '${esc(planId)}' ORDER BY status, due_date`)
      if (!r.success) return diagError(r.error || 'Failed to list tasks')
      const tasks = (r.rows || []) as unknown as DbPlanTask[]
      if (tasks.length === 0) return diagSuccess('暂无任务。')

      const lines = [
        `**任务列表 (${tasks.length})**`, '',
        ...tasks.map((t, i) => {
          const statusIcon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'skipped' ? '⏭️' : '⬜'
          return `${i + 1}. ${statusIcon} ${t.title} ${t.cost_level ? `[${COST_LABELS[t.cost_level] || t.cost_level}]` : ''} ${t.expected_impact ? `→ ${t.expected_impact}` : ''}`
        }),
      ]
      return diagSuccess(lines.join('\n'), { tasks })
    }

    default:
      return diagError(`Unknown action: ${action}. Use create/update/delete/get/list/add_task/update_task/list_tasks.`)
  }
}

async function benchmarkQuery(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const category = args.category as string
  if (!category) return diagError('category is required')
  if (category.length > 50) return diagError('category is too long')

  const subCategory = args.sub_category as string | undefined
  const cityTier = args.city_tier as number | undefined
  if (cityTier !== undefined && (cityTier < 1 || cityTier > 5 || !Number.isInteger(cityTier))) return diagError('city_tier must be an integer 1-5')
  const metrics = args.metrics as string[] | undefined

  const benchmarks = await getBenchmarks(category, subCategory, cityTier)
  if (benchmarks.length === 0) return diagError(`No benchmark data found for category: ${category}`)

  let filtered = benchmarks
  if (metrics && metrics.length > 0) {
    const metricSet = new Set(metrics)
    filtered = benchmarks.filter(b => metricSet.has(b.metric))
  }

  const lines = [
    `# 📊 行业基准数据: ${category}${subCategory ? '/' + subCategory : ''}${cityTier ? ` (城市等级${cityTier})` : ''}`, '',
    '| 指标 | 行业均值 | 优秀线 | 单位 |',
    '| --- | --- | --- | --- |',
    ...filtered.map(b => `| ${b.metric} | ${b.industry_avg} | ${b.top_quartile} | ${b.unit || ''} |`),
    '',
    `共 ${filtered.length} 项指标`,
  ]

  return diagSuccess(lines.join('\n'), { benchmarks: filtered })
}

async function healthCheck(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  let storeId: string
  try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }
  const autoCreatePlan = args.auto_create_plan !== false

  const store = await getStore(storeId)
  if (!store) return diagError(`Store not found: ${storeId}`)

  const financials = await getFinancials(storeId, 6)
  const trafficRows = await getTrafficData(storeId, 30)

  const dimensions = ['operations', 'cost', 'competition', 'scene'] as const
  const results: Array<{ dimension: string; id: string; score: number; confidence: number; summary: string }> = []

  for (const dim of dimensions) {
    const diag = await diagnoseDimension(store, dim, financials, trafficRows)
    const id = await saveDiagnosis(storeId, dim, diag.score, diag.confidence, diag.summary, diag.details, diag.recommendations, diag.dataSources)
    results.push({ dimension: dim, id, score: diag.score, confidence: diag.confidence, summary: diag.summary })
  }

  const overall = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
  const avgConfidence = Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length * 100) / 100

  const dimScores: Record<string, number> = {}
  for (const r of results) dimScores[r.dimension] = r.score

  const prescriptionItems = buildPrescriptionItems(dimScores, store)
  const weakestDim = Object.entries(dimScores).sort(([, a], [, b]) => a - b)[0]

  let planId: string | undefined
  if (autoCreatePlan && overall < 80) {
    const id = generateId('plan')
    const planTitle = `${store.name} 体检处方 - ${new Date().toISOString().slice(0, 10)}`
    await execSql(`INSERT INTO optimization_plans (id, store_id, diagnosis_id, title, description, priority, status, expected_effect, plan_type, tasks) VALUES ('${id}', '${esc(storeId)}', '${esc(results[0]?.id || '')}', '${esc(planTitle)}', '一键体检自动生成', ${overall < 50 ? 1 : 3}, 'pending', '${esc(prescriptionItems.length > 0 ? prescriptionItems[0].expectedImpact : '')}', 'prescription', '[]')`)

    for (const item of prescriptionItems) {
      const taskId = generateId('task')
      await execSql(`INSERT INTO plan_tasks (id, plan_id, title, description, status, cost_level, expected_impact) VALUES ('${taskId}', '${id}', '${esc(item.action)}', '', 'pending', '${esc(item.costLevel)}', '${esc(item.expectedImpact)}')`)
    }
    planId = id
  }

  const lines = [
    `# 🏥 一键体检: ${store.name}`, '',
    `**综合评分:** ${overall}/100 ${scoreEmoji(overall)}`,
    `**置信度:** ${Math.round(avgConfidence * 100)}%`,
    `**门店类型:** ${store.type}${store.sub_type ? '/' + store.sub_type : ''}`, '',
    '| 维度 | 评分 | 置信度 | 状态 | 摘要 |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(r => `| ${DIM_LABELS[r.dimension] || r.dimension} | ${r.score} | ${Math.round(r.confidence * 100)}% | ${scoreLabel(r.score)} | ${r.summary} |`),
    '', '---', '',
    '## 📋 处方笺（按投入成本排序）', '',
    weakestDim ? `**最薄弱环节:** ${DIM_LABELS[weakestDim[0]] || weakestDim[0]}（${weakestDim[1]}分）` : '',
    '',
    ...prescriptionItems.map((item, i) => `${i + 1}. ${COST_LABELS[item.costLevel]} ${item.action}\n   → ${item.expectedImpact}`),
    '',
    prescriptionItems.length === 0 ? '✅ 门店各维度表现良好，继续保持！' : '',
    planId ? `\n✅ 已自动创建优化方案 (ID: ${planId})` : '',
    '', '---',
    '*建议30天后复诊，对比改善效果*',
  ].filter(Boolean)

  return diagSuccess(lines.join('\n'), {
    chart: { type: 'radar', data: { dimensions: dimScores, overall }, title: `${store.name} - 一键体检` },
    overall, dimensions: results, prescription: prescriptionItems, planId,
  })
}

async function competitorManage(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const rawAction = args.action as string
  let action: string
  try {
    action = validateEnum(rawAction, VALID_ACTIONS.competitor_manage, 'action')
  } catch (e) {
    return diagError((e as Error).message)
  }

  let storeId: string
  try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

  switch (action) {
    case 'create': {
      const data = args.data as Record<string, unknown> | undefined
      if (!data?.competitor_name) return diagError('competitor_name is required')

      const threatLevel = data.threat_level && VALID_THREAT_LEVELS.has(String(data.threat_level)) ? String(data.threat_level) : 'medium'
      const id = generateId('comp')
      const sql = `INSERT INTO store_competitors (id, store_id, competitor_name, competitor_type, distance_km, strength, weakness, threat_level, notes) VALUES ('${id}', '${esc(storeId)}', '${esc(data.competitor_name)}', '${esc(data.competitor_type || '')}', ${num(data.distance_km)}, '${esc(data.strength || '')}', '${esc(data.weakness || '')}', '${esc(threatLevel)}', '${esc(data.notes || '')}')`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to add competitor')

      return diagSuccess(`✅ 竞品「${data.competitor_name}」添加成功`, { competitorId: id })
    }

    case 'update': {
      let competitorId: string
      try { competitorId = validateId(args.competitor_id, 'competitor_id') } catch (e) { return diagError((e as Error).message) }
      const data = args.data as Record<string, unknown> | undefined
      if (!data || Object.keys(data).length === 0) return diagError('No data provided for update')

      if (data.threat_level && !VALID_THREAT_LEVELS.has(String(data.threat_level))) return diagError(`Invalid threat_level: ${data.threat_level}`)

      const allowedFields = ['competitor_name', 'competitor_type', 'distance_km', 'strength', 'weakness', 'threat_level', 'notes']
      const stringFields = new Set(['competitor_name', 'competitor_type', 'strength', 'weakness', 'threat_level', 'notes'])
      const setClauses: string[] = []
      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          setClauses.push(stringFields.has(field) ? `${field} = '${esc(data[field])}'` : `${field} = ${num(data[field])}`)
        }
      }

      if (setClauses.length === 0) return diagError('No valid fields to update')
      const sql = `UPDATE store_competitors SET ${setClauses.join(', ')} WHERE id = '${esc(competitorId)}' AND store_id = '${esc(storeId)}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update competitor')
      if (result.rowsAffected === 0) return diagError(`Competitor not found: ${competitorId}`)

      return diagSuccess('✅ 竞品信息更新成功', { competitorId })
    }

    case 'delete': {
      let competitorId: string
      try { competitorId = validateId(args.competitor_id, 'competitor_id') } catch (e) { return diagError((e as Error).message) }

      const result = await execSql(`DELETE FROM store_competitors WHERE id = '${esc(competitorId)}' AND store_id = '${esc(storeId)}'`)
      if (!result.success) return diagError(result.error || 'Failed to delete competitor')
      if (result.rowsAffected === 0) return diagError(`Competitor not found: ${competitorId}`)

      return diagSuccess('✅ 竞品已删除', { competitorId })
    }

    case 'list': {
      const r = await execSql(`SELECT * FROM store_competitors WHERE store_id = '${esc(storeId)}' ORDER BY threat_level DESC, distance_km ASC`)
      if (!r.success) return diagError(r.error || 'Failed to list competitors')
      const competitors = (r.rows || []) as unknown as DbCompetitor[]
      if (competitors.length === 0) return diagSuccess('暂无竞品记录。使用 create 操作添加竞品。')

      const threatEmoji: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' }
      const lines = [
        `**竞品列表 (${competitors.length})**`, '',
        '| # | 名称 | 类型 | 距离 | 威胁 | 优势 | 劣势 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...competitors.map((c, i) => `| ${i + 1} | ${c.competitor_name} | ${c.competitor_type || '-'} | ${c.distance_km}km | ${threatEmoji[c.threat_level] || c.threat_level} | ${c.strength || '-'} | ${c.weakness || '-'} |`),
      ]
      return diagSuccess(lines.join('\n'), { competitors })
    }

    case 'analysis': {
      const r = await execSql(`SELECT * FROM store_competitors WHERE store_id = '${esc(storeId)}'`)
      const competitors = (r.rows || []) as unknown as DbCompetitor[]
      if (competitors.length === 0) return diagSuccess('暂无竞品数据，无法进行分析。请先添加竞品信息。')

      const highThreat = competitors.filter(c => c.threat_level === 'high')
      const medThreat = competitors.filter(c => c.threat_level === 'medium')
      const lowThreat = competitors.filter(c => c.threat_level === 'low')

      const avgDistance = competitors.reduce((s, c) => s + c.distance_km, 0) / competitors.length

      const allStrengths = competitors.flatMap(c => c.strength ? c.strength.split(/[,，、]/) : []).map(s => s.trim()).filter(Boolean)
      const allWeaknesses = competitors.flatMap(c => c.weakness ? c.weakness.split(/[,，、]/) : []).map(s => s.trim()).filter(Boolean)

      const strengthFreq = new Map<string, number>()
      for (const s of allStrengths) strengthFreq.set(s, (strengthFreq.get(s) || 0) + 1)
      const weaknessFreq = new Map<string, number>()
      for (const w of allWeaknesses) weaknessFreq.set(w, (weaknessFreq.get(w) || 0) + 1)

      const topStrengths = [...strengthFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      const topWeaknesses = [...weaknessFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

      const lines = [
        `# 🏆 竞品分析: ${storeId}`, '',
        `**竞品总数:** ${competitors.length}家`,
        `**威胁分布:** 🔴高${highThreat.length} / 🟡中${medThreat.length} / 🟢低${lowThreat.length}`,
        `**平均距离:** ${avgDistance.toFixed(1)}km`, '',
        '## 竞品共同优势（需警惕）', '',
        ...topStrengths.map(([s, c]) => `- ${s} (${c}家竞品具备)`),
        topStrengths.length === 0 ? '- 暂无数据' : '',
        '', '## 竞品共同劣势（机会点）', '',
        ...topWeaknesses.map(([w, c]) => `- ${w} (${c}家竞品存在)`),
        topWeaknesses.length === 0 ? '- 暂无数据' : '',
        '', '## 建议', '',
        highThreat.length > 0 ? `⚠️ ${highThreat.length}家高威胁竞品，建议重点差异化` : '',
        avgDistance < 1 ? '⚠️ 竞品距离较近，需强化客户体验和忠诚度' : '',
        topWeaknesses.length > 0 ? `✅ 针对竞品劣势「${topWeaknesses[0][0]}」建立差异化优势` : '',
      ].filter(Boolean)

      return diagSuccess(lines.join('\n'), { competitors, analysis: { highThreat: highThreat.length, medThreat: medThreat.length, lowThreat: lowThreat.length, avgDistance, topStrengths, topWeaknesses } })
    }

    default:
      return diagError(`Unknown action: ${action}. Use create/update/delete/list/analysis.`)
  }
}

async function recheckManage(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const rawAction = args.action as string
  let action: string
  try {
    action = validateEnum(rawAction, VALID_ACTIONS.recheck_manage, 'action')
  } catch (e) {
    return diagError((e as Error).message)
  }

  switch (action) {
    case 'create': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

      const intervalDays = num(args.interval_days, 30)
      if (intervalDays < 1 || intervalDays > 365) return diagError('interval_days must be between 1 and 365')
      const diagnosisId = str(args.diagnosis_id)
      const notes = str(args.notes)

      const store = await getStore(storeId)
      if (!store) return diagError(`Store not found: ${storeId}`)

      const lastDiag = await execSql(`SELECT * FROM diagnosis_records WHERE store_id = '${esc(storeId)}' ORDER BY diagnosed_at DESC LIMIT 1`)
      const lastScore = (lastDiag.rows?.[0] as unknown as DbDiagnosisRecord)?.score || 0

      const remindAt = new Date(Date.now() + intervalDays * 86400000).toISOString().slice(0, 10)
      const id = generateId('remind')

      const sql = `INSERT INTO recheck_reminders (id, store_id, diagnosis_id, remind_at, status, interval_days, last_score, notes) VALUES ('${id}', '${esc(storeId)}', '${esc(diagnosisId)}', '${remindAt}', 'pending', ${intervalDays}, ${lastScore}, '${esc(notes)}')`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to create reminder')

      return diagSuccess(`✅ 复诊提醒已创建: ${remindAt}（${intervalDays}天后）`, { reminderId: id, remindAt, intervalDays })
    }

    case 'complete': {
      let reminderId: string
      try { reminderId = validateId(args.reminder_id, 'reminder_id') } catch (e) { return diagError((e as Error).message) }

      const result = await execSql(`UPDATE recheck_reminders SET status = 'completed' WHERE id = '${esc(reminderId)}'`)
      if (!result.success) return diagError(result.error || 'Failed to complete reminder')
      if (result.rowsAffected === 0) return diagError(`Reminder not found: ${reminderId}`)

      return diagSuccess('✅ 复诊提醒已标记完成', { reminderId })
    }

    case 'cancel': {
      let reminderId: string
      try { reminderId = validateId(args.reminder_id, 'reminder_id') } catch (e) { return diagError((e as Error).message) }

      const result = await execSql(`UPDATE recheck_reminders SET status = 'cancelled' WHERE id = '${esc(reminderId)}'`)
      if (!result.success) return diagError(result.error || 'Failed to cancel reminder')
      if (result.rowsAffected === 0) return diagError(`Reminder not found: ${reminderId}`)

      return diagSuccess('✅ 复诊提醒已取消', { reminderId })
    }

    case 'list': {
      let storeId: string
      try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

      const r = await execSql(`SELECT * FROM recheck_reminders WHERE store_id = '${esc(storeId)}' ORDER BY remind_at DESC`)
      if (!r.success) return diagError(r.error || 'Failed to list reminders')
      const reminders = (r.rows || []) as unknown as DbRecheckReminder[]
      if (reminders.length === 0) return diagSuccess('暂无复诊提醒。使用 create 操作创建提醒。')

      const statusEmoji: Record<string, string> = { pending: '⏳', completed: '✅', cancelled: '❌' }
      const lines = [
        `**复诊提醒列表 (${reminders.length})**`, '',
        ...reminders.map((rem, i) => {
          const isOverdue = rem.status === 'pending' && rem.remind_at < new Date().toISOString().slice(0, 10)
          return `${i + 1}. ${statusEmoji[rem.status] || rem.status} ${rem.remind_at} | 间隔${rem.interval_days}天 | 上次评分${rem.last_score} ${isOverdue ? '🔴已逾期' : ''}${rem.notes ? ` | ${rem.notes}` : ''}`
        }),
      ]
      return diagSuccess(lines.join('\n'), { reminders })
    }

    case 'check_due': {
      const today = new Date().toISOString().slice(0, 10)
      const r = await execSql(`SELECT r.*, s.name as store_name FROM recheck_reminders r LEFT JOIN stores s ON r.store_id = s.id WHERE r.status = 'pending' AND r.remind_at <= '${today}' ORDER BY r.remind_at ASC`)
      const dueReminders = (r.rows || []) as unknown as Array<DbRecheckReminder & { store_name: string }>

      if (dueReminders.length === 0) return diagSuccess('✅ 当前无到期复诊提醒')

      const lines = [
        `# 🔔 到期复诊提醒 (${dueReminders.length})`, '',
        ...dueReminders.map((rem, i) => `${i + 1}. **${rem.store_name || rem.store_id}** - 到期日: ${rem.remind_at} | 上次评分: ${rem.last_score}${rem.notes ? ` | ${rem.notes}` : ''}`),
        '',
        '建议使用 health_check 工具为到期门店重新体检',
      ]
      return diagSuccess(lines.join('\n'), { dueReminders })
    }

    default:
      return diagError(`Unknown action: ${action}. Use create/complete/cancel/list/check_due.`)
  }
}

async function knowledgeQuery(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const category = args.category as string | undefined
  const storeType = args.store_type as string | undefined
  const keywords = args.keywords as string | undefined
  const limit = Math.min(Math.max(num(args.limit, 5), 1), 20)

  if (storeType && !VALID_STORE_TYPES.has(storeType) && storeType !== '') return diagError(`Invalid store_type: ${storeType}`)

  let sql = 'SELECT * FROM knowledge_base WHERE 1=1'
  if (category) sql += ` AND category = '${esc(category)}'`
  if (storeType) sql += ` AND (store_type = '${esc(storeType)}' OR store_type = '')`
  if (keywords) {
    const kw = escLike(keywords)
    sql += ` AND (title LIKE '%${kw}%' ESCAPE '\\' OR content LIKE '%${kw}%' ESCAPE '\\' OR tags LIKE '%${kw}%' ESCAPE '\\')`
  }
  sql += ` ORDER BY helpful_count DESC, view_count DESC LIMIT ${limit}`

  const r = await execSql(sql)
  if (!r.success) return diagError(r.error || 'Failed to query knowledge base')
  const articles = (r.rows || []) as unknown as DbKnowledge[]

  if (articles.length === 0) return diagSuccess('未找到相关知识文章。尝试更换关键词或分类。')

  for (const article of articles) {
    await execSql(`UPDATE knowledge_base SET view_count = view_count + 1 WHERE id = ${article.id}`)
  }

  const lines = [
    `# 📚 行业知识库${category ? ` - ${category}` : ''}`, '',
    ...articles.map((a, i) => [
      `## ${i + 1}. ${a.title}`,
      `**分类:** ${a.category} | **适用:** ${a.store_type || '通用'} | **标签:** ${a.tags || '-'}`,
      '',
      a.content,
      '',
    ].join('\n')),
  ]

  return diagSuccess(lines.join('\n'), { articles })
}

async function storeDataEntry(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const rawAction = args.action as string
  let action: string
  try {
    action = validateEnum(rawAction, VALID_ACTIONS.store_data_entry, 'action')
  } catch (e) {
    return diagError((e as Error).message)
  }

  let storeId: string
  try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

  const store = await getStore(storeId)
  if (!store) return diagError(`Store not found: ${storeId}`)

  switch (action) {
    case 'add_financial': {
      const data = args.financial_data as Record<string, unknown> | undefined
      if (!data?.period) return diagError('period (YYYY-MM) is required for financial data')
      let period: string
      try { period = validatePeriod(data.period) } catch (e) { return diagError((e as Error).message) }

      const revenue = num(data.revenue)
      const rentCost = num(data.rent_cost)
      const laborCost = num(data.labor_cost)
      const materialCost = num(data.material_cost)
      const utilityCost = num(data.utility_cost)
      const otherCost = num(data.other_cost)
      const customerCount = num(data.customer_count)
      const repeatRate = num(data.repeat_customer_rate)
      const avgTrans = num(data.avg_transaction_value)
      const grossProfit = revenue - materialCost
      const netProfit = revenue - rentCost - laborCost - materialCost - utilityCost - otherCost

      const sql = `INSERT OR REPLACE INTO store_financials (store_id, period, revenue, rent_cost, labor_cost, material_cost, utility_cost, other_cost, customer_count, repeat_customer_rate, avg_transaction_value, gross_profit, net_profit) VALUES ('${esc(storeId)}', '${esc(period)}', ${revenue}, ${rentCost}, ${laborCost}, ${materialCost}, ${utilityCost}, ${otherCost}, ${customerCount}, ${repeatRate}, ${avgTrans}, ${grossProfit}, ${netProfit})`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to add financial data')

      return diagSuccess(`✅ ${period} 财务数据录入成功\n营收: ¥${revenue.toLocaleString()} | 净利润: ¥${netProfit.toLocaleString()} | 客流: ${customerCount}`, { period })
    }

    case 'update_financial': {
      const data = args.financial_data as Record<string, unknown> | undefined
      if (!data?.period) return diagError('period is required for update')
      let updatePeriod: string
      try { updatePeriod = validatePeriod(data.period) } catch (e) { return diagError((e as Error).message) }

      const allowedFields = ['revenue', 'rent_cost', 'labor_cost', 'material_cost', 'utility_cost', 'other_cost', 'customer_count', 'repeat_customer_rate', 'avg_transaction_value']
      const setClauses: string[] = []
      for (const field of allowedFields) {
        if (data[field] !== undefined) setClauses.push(`${field} = ${num(data[field])}`)
      }

      if (setClauses.length === 0) return diagError('No data provided for update')

      setClauses.push(`gross_profit = (SELECT revenue - material_cost FROM store_financials WHERE store_id = '${esc(storeId)}' AND period = '${esc(updatePeriod)}')`)
      setClauses.push(`net_profit = (SELECT revenue - rent_cost - labor_cost - material_cost - utility_cost - other_cost FROM store_financials WHERE store_id = '${esc(storeId)}' AND period = '${esc(updatePeriod)}')`)

      const sql = `UPDATE store_financials SET ${setClauses.join(', ')} WHERE store_id = '${esc(storeId)}' AND period = '${esc(updatePeriod)}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update financial data')
      if (result.rowsAffected === 0) return diagError(`No financial data found for period: ${updatePeriod}`)

      return diagSuccess(`✅ ${updatePeriod} 财务数据更新成功`, { period: updatePeriod })
    }

    case 'list_financials': {
      const r = await execSql(`SELECT * FROM store_financials WHERE store_id = '${esc(storeId)}' ORDER BY period DESC LIMIT 12`)
      if (!r.success) return diagError(r.error || 'Failed to list financials')
      const financials = (r.rows || []) as unknown as DbFinancial[]
      if (financials.length === 0) return diagSuccess('暂无财务数据。使用 add_financial 录入数据。')

      const lines = [
        `**财务数据 (${financials.length}期)**`, '',
        '| 期间 | 营收 | 租金 | 人工 | 材料 | 净利润 | 客流 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...financials.map(f => `| ${f.period} | ¥${f.revenue.toLocaleString()} | ¥${f.rent_cost.toLocaleString()} | ¥${f.labor_cost.toLocaleString()} | ¥${f.material_cost.toLocaleString()} | ¥${(f.net_profit || 0).toLocaleString()} | ${f.customer_count} |`),
      ]
      return diagSuccess(lines.join('\n'), { financials })
    }

    case 'add_traffic': {
      const data = args.traffic_data as Record<string, unknown> | undefined
      if (!data?.date) return diagError('date (YYYY-MM-DD) is required for traffic data')
      let trafficDate: string
      try { trafficDate = validateDate(data.date) } catch (e) { return diagError((e as Error).message) }

      const hour = num(data.hour, 0)
      if (hour < 0 || hour > 23) return diagError('hour must be 0-23')

      const sql = `INSERT OR REPLACE INTO store_traffic (store_id, date, hour, customer_count, new_customer_count, returning_customer_count, conversion_rate) VALUES ('${esc(storeId)}', '${esc(trafficDate)}', ${hour}, ${num(data.customer_count)}, ${num(data.new_customer_count)}, ${num(data.returning_customer_count)}, ${num(data.conversion_rate)})`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to add traffic data')

      return diagSuccess(`✅ ${data.date} ${hour}:00 客流数据录入成功`, { date: data.date, hour })
    }

    case 'list_traffic': {
      const r = await execSql(`SELECT * FROM store_traffic WHERE store_id = '${esc(storeId)}' ORDER BY date DESC, hour ASC LIMIT 100`)
      if (!r.success) return diagError(r.error || 'Failed to list traffic')
      const traffic = r.rows || []
      if (traffic.length === 0) return diagSuccess('暂无客流数据。使用 add_traffic 录入数据。')

      const lines = [
        `**客流数据 (${traffic.length}条)**`, '',
        '| 日期 | 时段 | 客流 | 新客 | 老客 | 转化率 |',
        '| --- | --- | --- | --- | --- | --- |',
        ...traffic.map((row) => {
          const t = row as unknown as Record<string, unknown>
          return `| ${t.date} | ${t.hour}:00 | ${t.customer_count} | ${t.new_customer_count} | ${t.returning_customer_count} | ${t.conversion_rate}% |`
        }),
      ]
      return diagSuccess(lines.join('\n'), { traffic })
    }

    case 'batch_import': {
      const batchData = args.batch_data as Array<Record<string, unknown>> | undefined
      if (!batchData || !Array.isArray(batchData) || batchData.length === 0) return diagError('batch_data array is required for batch import')
      if (batchData.length > 100) return diagError('Batch import limited to 100 records at a time')

      let successCount = 0
      let failCount = 0
      const errors: string[] = []

      for (const record of batchData) {
        try {
          if (record.date && record.hour !== undefined) {
            const hour = num(record.hour, 0)
            await execSql(`INSERT OR REPLACE INTO store_traffic (store_id, date, hour, customer_count, new_customer_count, returning_customer_count, conversion_rate) VALUES ('${esc(storeId)}', '${esc(record.date)}', ${hour}, ${num(record.customer_count)}, ${num(record.new_customer_count)}, ${num(record.returning_customer_count)}, ${num(record.conversion_rate)})`)
            successCount++
          } else if (record.period) {
            const revenue = num(record.revenue)
            const rentCost = num(record.rent_cost)
            const laborCost = num(record.labor_cost)
            const materialCost = num(record.material_cost)
            const utilityCost = num(record.utility_cost)
            const otherCost = num(record.other_cost)
            const grossProfit = revenue - materialCost
            const netProfit = revenue - rentCost - laborCost - materialCost - utilityCost - otherCost
            await execSql(`INSERT OR REPLACE INTO store_financials (store_id, period, revenue, rent_cost, labor_cost, material_cost, utility_cost, other_cost, customer_count, repeat_customer_rate, avg_transaction_value, gross_profit, net_profit) VALUES ('${esc(storeId)}', '${esc(record.period)}', ${revenue}, ${rentCost}, ${laborCost}, ${materialCost}, ${utilityCost}, ${otherCost}, ${num(record.customer_count)}, ${num(record.repeat_customer_rate)}, ${num(record.avg_transaction_value)}, ${grossProfit}, ${netProfit})`)
            successCount++
          } else {
            failCount++
            errors.push('Record missing period or date field')
          }
        } catch (e) {
          failCount++
          errors.push(String(e))
        }
      }

      return diagSuccess(`✅ 批量导入完成: 成功${successCount}条${failCount > 0 ? `，失败${failCount}条` : ''}${errors.length > 0 ? `\n错误: ${errors.slice(0, 5).join('; ')}` : ''}`, { successCount, failCount })
    }

    default:
      return diagError(`Unknown action: ${action}. Use add_financial/update_financial/list_financials/add_traffic/list_traffic/batch_import.`)
  }
}

async function storeProfile(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const rawAction = args.action as string
  let action: string
  try {
    action = validateEnum(rawAction, new Set(['get_profile', 'get_trend', 'compare']), 'action')
  } catch (e) {
    return diagError((e as Error).message)
  }

  let storeId: string
  try { storeId = validateId(args.store_id, 'store_id') } catch (e) { return diagError((e as Error).message) }

  const store = await getStore(storeId)
  if (!store) return diagError(`Store not found: ${storeId}`)

  switch (action) {
    case 'get_profile': {
      const financials = await getFinancials(storeId, 3)
      const trafficRows = await getTrafficData(storeId, 30)
      const latestFin = financials[0]

      const tags: string[] = []
      const metrics: Record<string, unknown> = {}

      metrics.storeInfo = {
        name: store.name,
        type: store.type,
        subType: store.sub_type,
        region: store.region,
        cityTier: store.city_tier,
        area: store.area,
        openedAt: store.opened_at,
        businessStatus: store.business_status,
      }

      if (store.type === 'retail') tags.push('🛍️ 零售')
      else if (store.type === 'restaurant') tags.push('🍽️ 餐饮')
      else if (store.type === 'service') tags.push('💇 服务业')
      else tags.push('🏪 其他')

      if (store.sub_type) {
        const subTypeMap: Record<string, string> = {
          convenience: '便利店', clothing: '服装', grocery: '生鲜超市', electronics: '数码家电',
          fast_food: '快餐', chinese: '中餐', hotpot: '火锅', bakery: '烘焙',
          beauty: '美容美发', fitness: '健身', education: '教育培训', pet: '宠物',
        }
        if (subTypeMap[store.sub_type]) tags.push(`📌 ${subTypeMap[store.sub_type]}`)
      }

      if (store.area > 0) {
        if (store.area < 50) tags.push('🏠 小型店')
        else if (store.area < 200) tags.push('🏢 中型店')
        else tags.push('🏬 大型店')
        metrics.area = store.area
      }

      if (store.opened_at) {
        const openedDate = new Date(store.opened_at)
        const yearsOpen = ((Date.now() - openedDate.getTime()) / (365.25 * 86400000)).toFixed(1)
        const y = parseFloat(yearsOpen)
        if (y < 1) tags.push('🆕 新店')
        else if (y < 3) tags.push('🌱 成长期')
        else if (y < 7) tags.push('📈 成熟期')
        else tags.push('🏆 老店')
        metrics.yearsOpen = y
      }

      if (latestFin) {
        const revenue = latestFin.revenue
        const netProfit = latestFin.net_profit || 0
        const rentRatio = revenue > 0 ? (latestFin.rent_cost / revenue) * 100 : 0
        const laborRatio = revenue > 0 ? (latestFin.labor_cost / revenue) * 100 : 0
        const grossMargin = revenue > 0 ? ((revenue - latestFin.material_cost) / revenue) * 100 : 0
        const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0
        const salesPerSqm = store.area > 0 ? revenue / store.area : 0

        metrics.revenue = revenue
        metrics.netProfit = netProfit
        metrics.rentRatio = rentRatio.toFixed(1)
        metrics.laborRatio = laborRatio.toFixed(1)
        metrics.grossMargin = grossMargin.toFixed(1)
        metrics.netMargin = netMargin.toFixed(1)
        metrics.salesPerSqm = salesPerSqm.toFixed(0)

        if (revenue > 0) {
          if (netMargin > 20) tags.push('💰 高盈利')
          else if (netMargin > 10) tags.push('📊 盈利正常')
          else if (netMargin > 0) tags.push('⚠️ 微利')
          else tags.push('🔴 亏损')
        }

        if (rentRatio > 20) tags.push('🏠 高租金')
        else if (rentRatio > 15) tags.push('🏠 租金偏高')

        if (laborRatio > 30) tags.push('👷 人工偏高')

        if (salesPerSqm > 500) tags.push('📈 高坪效')
        else if (salesPerSqm < 100 && store.area > 0) tags.push('📉 低坪效')

        if (latestFin.repeat_customer_rate > 40) tags.push('🔄 高复购')
        else if (latestFin.repeat_customer_rate > 25) tags.push('🔄 复购正常')
        else if (latestFin.repeat_customer_rate > 0) tags.push('⚠️ 低复购')
      }

      if (trafficRows.length > 0) {
        const totalTraffic = trafficRows.reduce((sum, t) => sum + (t.daily_customers || 0), 0)
        const avgDailyTraffic = totalTraffic / Math.max(new Set(trafficRows.map(t => t.date)).size, 1)
        metrics.avgDailyTraffic = avgDailyTraffic.toFixed(0)

        if (avgDailyTraffic > 100) tags.push('👥 高客流')
        else if (avgDailyTraffic < 20) tags.push('👤 低客流')
      }

      const diagResult = await execSql(`SELECT dimension, score, diagnosed_at FROM diagnosis_records WHERE store_id = '${esc(storeId)}' ORDER BY diagnosed_at DESC`)
      const diagRecords = (diagResult.rows || []) as unknown as Array<{ dimension: string; score: number; diagnosed_at: string }>
      if (diagRecords.length > 0) {
        const latestByDim = new Map<string, { score: number; diagnosed_at: string }>()
        for (const r of diagRecords) {
          if (!latestByDim.has(r.dimension)) latestByDim.set(r.dimension, { score: r.score, diagnosed_at: r.diagnosed_at })
        }
        const scores = [...latestByDim.values()].map(v => v.score)
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
        metrics.avgDiagScore = avgScore

        if (avgScore >= 80) tags.push('✅ 健康优秀')
        else if (avgScore >= 60) tags.push('⚠️ 亚健康')
        else if (avgScore >= 40) tags.push('❌ 需改善')
        else tags.push('🔴 亟需整改')
      }

      const compResult = await execSql(`SELECT COUNT(*) as cnt FROM store_competitors WHERE store_id = '${esc(storeId)}'`)
      const compCount = (compResult.rows?.[0] as unknown as Record<string, number>)?.cnt || 0
      if (compCount > 5) tags.push('⚔️ 竞争激烈')
      else if (compCount > 2) tags.push('⚔️ 有竞争')
      metrics.competitorCount = compCount

      const profileLines = [
        `# 🏪 门店画像: ${store.name}`, '',
        `**标签:** ${tags.join(' ')}`, '',
        `## 📋 基本信息`,
        `| 属性 | 值 |`,
        `| --- | --- |`,
        `| 类型 | ${store.type}${store.sub_type ? '/' + store.sub_type : ''} |`,
        `| 区域 | ${store.region || '-'} |`,
        `| 面积 | ${store.area || '-'}㎡ |`,
        `| 员工 | ${store.employee_count || '-'}人 |`,
        `| 月租金 | ¥${store.rent_cost || 0} |`,
        `| 状态 | ${store.business_status || 'normal'} |`,
        `| 开业时间 | ${store.opened_at || '-'} |`,
        metrics.yearsOpen ? `| 经营年限 | ${metrics.yearsOpen}年 |` : '',
        '',
        `## 📊 核心指标`,
        `| 指标 | 值 |`,
        `| --- | --- |`,
        metrics.revenue !== undefined ? `| 月营收 | ¥${(metrics.revenue as number).toLocaleString()} |` : '',
        metrics.netProfit !== undefined ? `| 净利润 | ¥${(metrics.netProfit as number).toLocaleString()} |` : '',
        metrics.rentRatio ? `| 租金占比 | ${metrics.rentRatio}% |` : '',
        metrics.laborRatio ? `| 人工占比 | ${metrics.laborRatio}% |` : '',
        metrics.grossMargin ? `| 毛利率 | ${metrics.grossMargin}% |` : '',
        metrics.netMargin ? `| 净利率 | ${metrics.netMargin}% |` : '',
        metrics.salesPerSqm ? `| 坪效 | ¥${metrics.salesPerSqm}/㎡ |` : '',
        metrics.avgDailyTraffic ? `| 日均客流 | ${metrics.avgDailyTraffic}人 |` : '',
        metrics.avgDiagScore !== undefined ? `| 综合评分 | ${metrics.avgDiagScore}/100 |` : '',
        metrics.competitorCount !== undefined ? `| 竞品数 | ${metrics.competitorCount}家 |` : '',
      ].filter(Boolean)

      return diagSuccess(profileLines.join('\n'), { tags, metrics })
    }

    case 'get_trend': {
      const periods = Math.min(Math.max(num(args.periods, 6), 2), 12)

      const diagResult = await execSql(`SELECT dimension, score, confidence, diagnosed_at FROM diagnosis_records WHERE store_id = '${esc(storeId)}' ORDER BY diagnosed_at ASC`)
      const diagRecords = (diagResult.rows || []) as unknown as Array<{ dimension: string; score: number; confidence: number; diagnosed_at: string }>

      const finResult = await execSql(`SELECT period, revenue, net_profit, rent_cost, labor_cost, material_cost, customer_count, repeat_customer_rate, avg_transaction_value FROM store_financials WHERE store_id = '${esc(storeId)}' ORDER BY period ASC`)
      const finRecords = (finResult.rows || []) as unknown as DbFinancial[]

      if (diagRecords.length === 0 && finRecords.length === 0) return diagSuccess('暂无历史数据，无法生成趋势。请先进行诊断或录入财务数据。')

      const lines: string[] = [
        `# 📈 趋势追踪: ${store.name}`, '',
      ]

      if (diagRecords.length > 0) {
        const dimMap = new Map<string, Array<{ score: number; date: string }>>()
        for (const r of diagRecords) {
          if (!dimMap.has(r.dimension)) dimMap.set(r.dimension, [])
          dimMap.get(r.dimension)!.push({ score: r.score, date: r.diagnosed_at })
        }

        lines.push('## 🔍 诊断评分趋势', '')
        for (const [dim, records] of dimMap) {
          const dimNames: Record<string, string> = { operations: '运营', cost: '成本', competition: '竞争', scene: '场景' }
          lines.push(`**${dimNames[dim] || dim}维度:**`)

          if (records.length < 2) {
            lines.push(`  仅1次诊断 (评分: ${records[0].score})，无法计算趋势`)
            continue
          }

          const recent = records.slice(-periods)
          const firstScore = recent[0].score
          const lastScore = recent[recent.length - 1].score
          const change = lastScore - firstScore
          const trendIcon = change > 5 ? '📈' : change < -5 ? '📉' : '➡️'
          const trendLabel = change > 5 ? '改善' : change < -5 ? '恶化' : '持平'

          lines.push(`  ${trendIcon} 趋势: ${trendLabel} (${change > 0 ? '+' : ''}${change}分)`)
          lines.push(`  最近${recent.length}次: ${recent.map(r => r.score).join(' → ')}`)
          lines.push(`  首次: ${firstScore}分 (${recent[0].date?.slice(0, 10) || '-'}) → 最新: ${lastScore}分 (${recent[recent.length - 1].date?.slice(0, 10) || '-'})`)

          if (recent.length >= 3) {
            const midIdx = Math.floor(recent.length / 2)
            const firstHalf = recent.slice(0, midIdx)
            const secondHalf = recent.slice(midIdx)
            const avgFirst = Math.round(firstHalf.reduce((s, r) => s + r.score, 0) / firstHalf.length)
            const avgSecond = Math.round(secondHalf.reduce((s, r) => s + r.score, 0) / secondHalf.length)
            const halfChange = avgSecond - avgFirst
            lines.push(`  前半程均值: ${avgFirst} → 后半程均值: ${avgSecond} (${halfChange > 0 ? '+' : ''}${halfChange})`)
          }
          lines.push('')
        }
      }

      if (finRecords.length >= 2) {
        const recentFin = finRecords.slice(-periods)
        lines.push('## 💰 财务趋势', '')
        lines.push('| 期间 | 营收 | 净利润 | 租金占比 | 人工占比 | 毛利率 | 客流 | 复购率 |')
        lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')

        for (const f of recentFin) {
          const rev = f.revenue || 0
          const rentR = rev > 0 ? ((f.rent_cost / rev) * 100).toFixed(1) : '-'
          const laborR = rev > 0 ? ((f.labor_cost / rev) * 100).toFixed(1) : '-'
          const grossM = rev > 0 ? (((rev - f.material_cost) / rev) * 100).toFixed(1) : '-'
          lines.push(`| ${f.period} | ¥${rev.toLocaleString()} | ¥${(f.net_profit || 0).toLocaleString()} | ${rentR}% | ${laborR}% | ${grossM}% | ${f.customer_count || '-'} | ${f.repeat_customer_rate || '-'}% |`)
        }

        const firstFin = recentFin[0]
        const lastFin = recentFin[recentFin.length - 1]
        const revChange = lastFin.revenue - firstFin.revenue
        const profitChange = (lastFin.net_profit || 0) - (firstFin.net_profit || 0)
        const revPctChange = firstFin.revenue > 0 ? ((revChange / firstFin.revenue) * 100).toFixed(1) : '-'

        lines.push('')
        lines.push(`**营收变化:** ${revChange > 0 ? '📈' : revChange < 0 ? '📉' : '➡️'} ${revChange > 0 ? '+' : ''}¥${revChange.toLocaleString()} (${revPctChange}%)`)
        lines.push(`**利润变化:** ${profitChange > 0 ? '📈' : profitChange < 0 ? '📉' : '➡️'} ${profitChange > 0 ? '+' : ''}¥${profitChange.toLocaleString()}`)
      }

      return diagSuccess(lines.join('\n'), { diagnosisTrend: diagRecords.length, financialTrend: finRecords.length })
    }

    case 'compare': {
      let compareStoreId: string
      try { compareStoreId = validateId(args.compare_store_id, 'compare_store_id') } catch (e) { return diagError((e as Error).message) }

      if (compareStoreId === storeId) return diagError('Cannot compare a store with itself')

      const store2 = await getStore(compareStoreId)
      if (!store2) return diagError(`Comparison store not found: ${compareStoreId}`)

      const [diag1, diag2] = await Promise.all([
        execSql(`SELECT dimension, score, diagnosed_at FROM diagnosis_records WHERE store_id = '${esc(storeId)}' ORDER BY diagnosed_at DESC`),
        execSql(`SELECT dimension, score, diagnosed_at FROM diagnosis_records WHERE store_id = '${esc(compareStoreId)}' ORDER BY diagnosed_at DESC`),
      ])

      const latestDiag1 = new Map<string, { score: number; date: string }>()
      for (const r of (diag1.rows || []) as unknown as Array<{ dimension: string; score: number; diagnosed_at: string }>) {
        if (!latestDiag1.has(r.dimension)) latestDiag1.set(r.dimension, { score: r.score, date: r.diagnosed_at })
      }
      const latestDiag2 = new Map<string, { score: number; date: string }>()
      for (const r of (diag2.rows || []) as unknown as Array<{ dimension: string; score: number; diagnosed_at: string }>) {
        if (!latestDiag2.has(r.dimension)) latestDiag2.set(r.dimension, { score: r.score, date: r.diagnosed_at })
      }

      const [fin1, fin2] = await Promise.all([
        execSql(`SELECT * FROM store_financials WHERE store_id = '${esc(storeId)}' ORDER BY period DESC LIMIT 1`),
        execSql(`SELECT * FROM store_financials WHERE store_id = '${esc(compareStoreId)}' ORDER BY period DESC LIMIT 1`),
      ])

      const f1 = (fin1.rows?.[0] as unknown as DbFinancial) || null
      const f2 = (fin2.rows?.[0] as unknown as DbFinancial) || null

      const dimNames: Record<string, string> = { operations: '运营', cost: '成本', competition: '竞争', scene: '场景' }
      const allDims = new Set([...latestDiag1.keys(), ...latestDiag2.keys()])

      const lines: string[] = [
        `# ⚖️ 门店对比`, '',
        `| 维度 | ${store.name} | ${store2.name} | 差异 |`,
        `| --- | --- | --- | --- |`,
        `| 类型 | ${store.type} | ${store2.type} | - |`,
        `| 面积 | ${store.area}㎡ | ${store2.area}㎡ | ${store.area - store2.area > 0 ? '+' : ''}${(store.area - store2.area).toFixed(0)}㎡ |`,
        `| 员工 | ${store.employee_count}人 | ${store2.employee_count}人 | ${store.employee_count - store2.employee_count > 0 ? '+' : ''}${store.employee_count - store2.employee_count} |`,
      ]

      for (const dim of allDims) {
        const s1 = latestDiag1.get(dim)?.score ?? '-'
        const s2 = latestDiag2.get(dim)?.score ?? '-'
        const diff = typeof s1 === 'number' && typeof s2 === 'number' ? s1 - s2 : '-'
        const diffStr = typeof diff === 'number' ? `${diff > 0 ? '+' : ''}${diff}` : '-'
        lines.push(`| ${dimNames[dim] || dim} | ${s1} | ${s2} | ${diffStr} |`)
      }

      if (f1 && f2) {
        lines.push('')
        lines.push('## 💰 财务对比')
        lines.push('| 指标 | 本店 | 对比店 | 差异 |')
        lines.push('| --- | --- | --- | --- |')

        const revDiff = f1.revenue - f2.revenue
        lines.push(`| 营收 | ¥${f1.revenue.toLocaleString()} | ¥${f2.revenue.toLocaleString()} | ${revDiff > 0 ? '+' : ''}¥${revDiff.toLocaleString()} |`)

        const profitDiff = (f1.net_profit || 0) - (f2.net_profit || 0)
        lines.push(`| 净利润 | ¥${(f1.net_profit || 0).toLocaleString()} | ¥${(f2.net_profit || 0).toLocaleString()} | ${profitDiff > 0 ? '+' : ''}¥${profitDiff.toLocaleString()} |`)

        if (f1.revenue > 0 && f2.revenue > 0) {
          const rentR1 = ((f1.rent_cost / f1.revenue) * 100).toFixed(1)
          const rentR2 = ((f2.rent_cost / f2.revenue) * 100).toFixed(1)
          lines.push(`| 租金占比 | ${rentR1}% | ${rentR2}% | ${(parseFloat(rentR1) - parseFloat(rentR2)).toFixed(1)}% |`)

          const gm1 = ((f1.revenue - f1.material_cost) / f1.revenue * 100).toFixed(1)
          const gm2 = ((f2.revenue - f2.material_cost) / f2.revenue * 100).toFixed(1)
          lines.push(`| 毛利率 | ${gm1}% | ${gm2}% | ${(parseFloat(gm1) - parseFloat(gm2)).toFixed(1)}% |`)
        }
      }

      const avgScore1 = latestDiag1.size > 0 ? Math.round([...latestDiag1.values()].reduce((s, v) => s + v.score, 0) / latestDiag1.size) : null
      const avgScore2 = latestDiag2.size > 0 ? Math.round([...latestDiag2.values()].reduce((s, v) => s + v.score, 0) / latestDiag2.size) : null

      if (avgScore1 !== null && avgScore2 !== null) {
        lines.push('')
        const winner = avgScore1 > avgScore2 ? store.name : avgScore1 < avgScore2 ? store2.name : '持平'
        lines.push(`**综合评分:** ${store.name} ${avgScore1}分 vs ${store2.name} ${avgScore2}分 → **${winner}领先**`)
      }

      return diagSuccess(lines.join('\n'), { store1: storeId, store2: compareStoreId })
    }

    default:
      return diagError(`Unknown action: ${action}`)
  }
}

export const storeDiagnosisExecutors: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> = {
  store_manage: storeManage,
  store_diagnose: storeDiagnose,
  report_generate: reportGenerate,
  optimization_plan: optimizationPlan,
  benchmark_query: benchmarkQuery,
  health_check: healthCheck,
  competitor_manage: competitorManage,
  recheck_manage: recheckManage,
  knowledge_query: knowledgeQuery,
  store_data_entry: storeDataEntry,
  store_profile: storeProfile,
}
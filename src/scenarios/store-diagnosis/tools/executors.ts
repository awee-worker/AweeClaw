import type { ToolExecutionResult, ToolExecutionContext } from '@/shared/types'
import { scenarioDatabaseManager } from '@/scenario-system/core/ScenarioDatabaseManager'

const SCENARIO_ID = 'store-diagnosis'

interface DbStore {
  id: string
  name: string
  type: string
  area: number
  business_hours: string
  employee_count: number
  avg_transaction_value: number
  main_categories: string
  rent_cost: number
  decoration_age: number
  region: string
  photos: string
  notes: string
  created_at: string
  updated_at: string
}

interface DbBenchmark {
  category: string
  metric: string
  industry_avg: number
  top_quartile: number
  unit: string
}

interface DbFinancial {
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
}

interface DbPlan {
  id: string
  store_id: string
  diagnosis_id: string
  title: string
  description: string
  priority: number
  status: string
  expected_effect: string
  execution_cycle: string
  tasks: string
  created_at: string
  updated_at: string
}

interface DbTask {
  id: string
  plan_id: string
  title: string
  description: string
  assignee: string
  due_date: string
  status: string
  completed_at: string | null
}

function diagError(message: string): ToolExecutionResult {
  return { success: false, result: '', error: message }
}

function diagSuccess(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

function generateId(): string {
  return `sd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function execSql(sql: string) {
  return scenarioDatabaseManager.executeSql(SCENARIO_ID, sql)
}

function esc(val: unknown): string {
  return String(val ?? '').replace(/'/g, "''")
}

async function storeManage(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const action = args.action as string

  switch (action) {
    case 'create': {
      const data = args.data as Record<string, unknown> | undefined
      if (!data?.name) return diagError('Store name is required for creation')

      const id = generateId()
      const sql = `INSERT INTO stores (id, name, type, area, business_hours, employee_count, avg_transaction_value, main_categories, rent_cost, decoration_age, region, photos, notes)
        VALUES ('${id}', '${esc(data.name)}', '${data.type || 'retail'}', ${data.area || 0}, '${esc(data.business_hours)}', ${data.employee_count || 0}, ${data.avg_transaction_value || 0}, '${esc(data.main_categories)}', ${data.rent_cost || 0}, ${data.decoration_age || 0}, '${esc(data.region)}', '${esc(data.photos)}', '${esc(data.notes)}')`

      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to create store')

      return diagSuccess(`✅ Store "${data.name}" created successfully (ID: ${id})`, { storeId: id })
    }

    case 'update': {
      const storeId = args.store_id as string
      const data = args.data as Record<string, unknown> | undefined
      if (!storeId) return diagError('store_id is required for update')
      if (!data || Object.keys(data).length === 0) return diagError('No data provided for update')

      const setClauses: string[] = []
      const allowedFields = ['name', 'type', 'area', 'business_hours', 'employee_count', 'avg_transaction_value', 'main_categories', 'rent_cost', 'decoration_age', 'region', 'photos', 'notes']

      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          const val = data[field]
          if (typeof val === 'string') {
            setClauses.push(`${field} = '${esc(val)}'`)
          } else {
            setClauses.push(`${field} = ${val}`)
          }
        }
      }
      setClauses.push("updated_at = datetime('now', 'localtime')")

      const sql = `UPDATE stores SET ${setClauses.join(', ')} WHERE id = '${storeId}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update store')
      if (result.rowsAffected === 0) return diagError(`Store not found: ${storeId}`)

      return diagSuccess(`✅ Store updated successfully`, { storeId })
    }

    case 'delete': {
      const storeId = args.store_id as string
      if (!storeId) return diagError('store_id is required for delete')

      const sql = `DELETE FROM stores WHERE id = '${storeId}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to delete store')
      if (result.rowsAffected === 0) return diagError(`Store not found: ${storeId}`)

      return diagSuccess(`✅ Store deleted successfully`, { storeId })
    }

    case 'get': {
      const storeId = args.store_id as string
      if (!storeId) return diagError('store_id is required for get')

      const sql = `SELECT * FROM stores WHERE id = '${storeId}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to query store')
      if (!result.rows || result.rows.length === 0) return diagError(`Store not found: ${storeId}`)

      const s = result.rows[0] as unknown as DbStore
      const lines = [
        `**${s.name}** (${s.type})`,
        `📍 Region: ${s.region || 'N/A'}`,
        `📐 Area: ${s.area}m² | 👥 Employees: ${s.employee_count}`,
        `🕐 Hours: ${s.business_hours || 'N/A'}`,
        `💰 Rent: ¥${s.rent_cost}/month | 💵 Avg Transaction: ¥${s.avg_transaction_value}`,
        `📦 Categories: ${s.main_categories || 'N/A'}`,
        `🏠 Decoration Age: ${s.decoration_age} years`,
        s.notes ? `📝 Notes: ${s.notes}` : '',
        `Created: ${s.created_at} | Updated: ${s.updated_at}`,
      ].filter(Boolean)

      return diagSuccess(lines.join('\n'), { store: s })
    }

    case 'list': {
      const filters = args.filters as Record<string, string> | undefined
      let sql = 'SELECT id, name, type, region, area, employee_count, rent_cost FROM stores'
      const conditions: string[] = []

      if (filters?.type) conditions.push(`type = '${filters.type}'`)
      if (filters?.region) conditions.push(`region LIKE '%${esc(filters.region)}%'`)

      if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
      sql += ' ORDER BY updated_at DESC'

      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to list stores')

      const stores = result.rows || []
      if (stores.length === 0) return diagSuccess('No stores found. Use store_manage with action "create" to add a store.')

      const lines = [
        `**Stores (${stores.length})**`,
        '',
        '| # | Name | Type | Region | Area | Employees | Rent |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...stores.map((row, i) => {
          const s = row as unknown as DbStore
          return `| ${i + 1} | ${s.name} | ${s.type} | ${s.region || '-'} | ${s.area}m² | ${s.employee_count} | ¥${s.rent_cost} |`
        }),
      ]

      return diagSuccess(lines.join('\n'), { stores })
    }

    default:
      return diagError(`Unknown action: ${action}. Use create/update/delete/get/list.`)
  }
}

async function storeDiagnose(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const storeId = args.store_id as string
  const dimension = args.dimension as string
  const period = args.period as string | undefined
  const includeFinancials = args.include_financials !== false
  const includeTraffic = args.include_traffic !== false

  if (!storeId) return diagError('store_id is required')
  if (!dimension) return diagError('dimension is required')

  const storeResult = await execSql(`SELECT * FROM stores WHERE id = '${storeId}'`)
  if (!storeResult.success || !storeResult.rows || storeResult.rows.length === 0) {
    return diagError(`Store not found: ${storeId}`)
  }
  const store = storeResult.rows[0] as unknown as DbStore

  const dimensions = dimension === 'all'
    ? ['operations', 'cost', 'competition', 'scene']
    : [dimension]

  const diagnosisResults: Array<{ dimension: string; score: number; summary: string; details: string; recommendations: string }> = []

  for (const dim of dimensions) {
    let score = 50
    let summary = ''
    let details = ''
    let recommendations = ''

    const financialData = includeFinancials
      ? await execSql(`SELECT * FROM store_financials WHERE store_id = '${storeId}' ORDER BY period DESC LIMIT 6`)
      : null

    const trafficData = includeTraffic
      ? await execSql(`SELECT date, SUM(customer_count) as daily_customers, SUM(new_customer_count) as daily_new, SUM(returning_customer_count) as daily_returning FROM store_traffic WHERE store_id = '${storeId}' GROUP BY date ORDER BY date DESC LIMIT 30`)
      : null

    const financials = (financialData?.rows || []) as unknown as DbFinancial[]
    const trafficRows = (trafficData?.rows || []) as unknown as Array<{ date: string; daily_customers: number; daily_new: number; daily_returning: number }>

    switch (dim) {
      case 'operations': {
        const factors: string[] = []
        let opsScore = 50

        if (trafficRows.length > 0) {
          const avgDailyCustomers = trafficRows.reduce((s, r) => s + r.daily_customers, 0) / trafficRows.length
          const avgReturningRate = trafficRows.reduce((s, r) => s + (r.daily_returning / Math.max(r.daily_customers, 1)), 0) / trafficRows.length * 100

          if (avgDailyCustomers > 100) { opsScore += 15; factors.push(`✅ Good daily traffic: ${avgDailyCustomers.toFixed(0)} customers/day`) }
          else if (avgDailyCustomers > 50) { opsScore += 5; factors.push(`⚠️ Moderate daily traffic: ${avgDailyCustomers.toFixed(0)} customers/day`) }
          else { opsScore -= 10; factors.push(`❌ Low daily traffic: ${avgDailyCustomers.toFixed(0)} customers/day`) }

          if (avgReturningRate > 40) { opsScore += 15; factors.push(`✅ Good returning rate: ${avgReturningRate.toFixed(1)}%`) }
          else if (avgReturningRate > 25) { opsScore += 5; factors.push(`⚠️ Moderate returning rate: ${avgReturningRate.toFixed(1)}%`) }
          else { opsScore -= 5; factors.push(`❌ Low returning rate: ${avgReturningRate.toFixed(1)}%`) }
        } else {
          factors.push('⚠️ No traffic data available — cannot fully assess operations')
        }

        if (financials.length > 0) {
          const fin = financials[0]
          if (fin.customer_count > 0) {
            const avgTrans = fin.revenue / fin.customer_count
            if (avgTrans > store.avg_transaction_value * 1.1) {
              opsScore += 10
              factors.push(`✅ Transaction value trending up: ¥${avgTrans.toFixed(0)}`)
            }
          }
        }

        score = Math.max(0, Math.min(100, opsScore))
        summary = score >= 70 ? 'Operations are healthy' : score >= 50 ? 'Operations need improvement' : 'Operations have significant issues'
        details = factors.join('\n')
        recommendations = score >= 70
          ? 'Continue monitoring key metrics; focus on maintaining customer satisfaction'
          : score >= 50
            ? '1. Improve customer acquisition channels\n2. Implement loyalty programs to boost returning rate\n3. Analyze peak/off-peak patterns to optimize staffing'
            : '1. URGENT: Investigate traffic drop causes\n2. Launch customer retention campaigns immediately\n3. Review product/service quality\n4. Consider promotional activities to drive traffic'
        break
      }

      case 'cost': {
        const factors: string[] = []
        let costScore = 50

        if (financials.length > 0) {
          const fin = financials[0]
          const revenue = fin.revenue
          if (revenue > 0) {
            const rentRatio = (fin.rent_cost / revenue) * 100
            const laborRatio = (fin.labor_cost / revenue) * 100
            const materialRatio = (fin.material_cost / revenue) * 100
            const totalCostRatio = rentRatio + laborRatio + materialRatio + (fin.utility_cost / revenue) * 100 + (fin.other_cost / revenue) * 100

            const benchmarkResult = await execSql(`SELECT * FROM industry_benchmarks WHERE category = '${store.type}'`)
            const benchmarks = (benchmarkResult.rows || []) as unknown as DbBenchmark[]
            const benchmarkMap = new Map(benchmarks.map(b => [b.metric, b]))

            const rentBench = benchmarkMap.get('rent_ratio')
            if (rentBench) {
              if (rentRatio <= rentBench.top_quartile) { costScore += 15; factors.push(`✅ Rent ratio ${rentRatio.toFixed(1)}% (top quartile: ${rentBench.top_quartile}%)`) }
              else if (rentRatio <= rentBench.industry_avg) { costScore += 5; factors.push(`⚠️ Rent ratio ${rentRatio.toFixed(1)}% (industry avg: ${rentBench.industry_avg}%)`) }
              else { costScore -= 10; factors.push(`❌ Rent ratio ${rentRatio.toFixed(1)}% ABOVE industry avg ${rentBench.industry_avg}%`) }
            }

            const laborBench = benchmarkMap.get('labor_ratio')
            if (laborBench) {
              if (laborRatio <= laborBench.top_quartile) { costScore += 15; factors.push(`✅ Labor ratio ${laborRatio.toFixed(1)}% (top quartile: ${laborBench.top_quartile}%)`) }
              else if (laborRatio <= laborBench.industry_avg) { costScore += 5; factors.push(`⚠️ Labor ratio ${laborRatio.toFixed(1)}% (industry avg: ${laborBench.industry_avg}%)`) }
              else { costScore -= 10; factors.push(`❌ Labor ratio ${laborRatio.toFixed(1)}% ABOVE industry avg ${laborBench.industry_avg}%`) }
            }

            factors.push(`📊 Cost breakdown: Rent ${rentRatio.toFixed(1)}% | Labor ${laborRatio.toFixed(1)}% | Material ${materialRatio.toFixed(1)}% | Total ${totalCostRatio.toFixed(1)}%`)

            if (totalCostRatio < 80) { costScore += 10; factors.push(`✅ Healthy total cost ratio`) }
            else if (totalCostRatio > 95) { costScore -= 15; factors.push(`❌ Critical: costs nearly equal or exceed revenue`) }
          }
        } else {
          factors.push('⚠️ No financial data available — cannot assess cost structure')
        }

        score = Math.max(0, Math.min(100, costScore))
        summary = score >= 70 ? 'Cost structure is healthy' : score >= 50 ? 'Cost structure needs optimization' : 'Cost structure is problematic'
        details = factors.join('\n')
        recommendations = score >= 70
          ? 'Maintain current cost discipline; explore volume discounts with suppliers'
          : score >= 50
            ? '1. Renegotiate rent or consider relocation\n2. Optimize staff scheduling to reduce labor waste\n3. Review supplier contracts for better pricing\n4. Reduce utility costs with energy-saving measures'
            : '1. URGENT: Conduct immediate cost audit\n2. Identify and eliminate unnecessary expenses\n3. Negotiate rent reduction or find alternative location\n4. Consider staff restructuring\n5. Switch to more cost-effective suppliers'
        break
      }

      case 'competition': {
        let compScore = 50
        const factors: string[] = []

        if (store.region) {
          const nearbyResult = await execSql(`SELECT COUNT(*) as count FROM stores WHERE region LIKE '%${esc(store.region)}%' AND id != '${storeId}'`)
          const nearbyCount = (nearbyResult.rows?.[0] as unknown as { count: number })?.count || 0
          if (nearbyCount <= 2) { compScore += 15; factors.push(`✅ Low competition: ${nearbyCount} nearby stores`) }
          else if (nearbyCount <= 5) { compScore += 0; factors.push(`⚠️ Moderate competition: ${nearbyCount} nearby stores`) }
          else { compScore -= 10; factors.push(`❌ High competition: ${nearbyCount} nearby stores`) }
        }

        if (financials.length > 0) {
          const fin = financials[0]
          const revenue = fin.revenue
          const benchmarkResult = await execSql(`SELECT * FROM industry_benchmarks WHERE category = '${store.type}'`)
          const benchmarks = (benchmarkResult.rows || []) as unknown as DbBenchmark[]
          const benchmarkMap = new Map(benchmarks.map(b => [b.metric, b]))

          const marginBench = benchmarkMap.get('gross_margin')
          if (marginBench && revenue > 0) {
            const grossMargin = ((revenue - fin.material_cost) / revenue) * 100
            if (grossMargin >= marginBench.top_quartile) { compScore += 15; factors.push(`✅ Gross margin ${grossMargin.toFixed(1)}% (top quartile: ${marginBench.top_quartile}%)`) }
            else if (grossMargin >= marginBench.industry_avg) { compScore += 5; factors.push(`⚠️ Gross margin ${grossMargin.toFixed(1)}% (industry avg: ${marginBench.industry_avg}%)`) }
            else { compScore -= 10; factors.push(`❌ Gross margin ${grossMargin.toFixed(1)}% BELOW industry avg ${marginBench.industry_avg}%`) }
          }
        }

        if (store.decoration_age > 5) { compScore -= 5; factors.push(`⚠️ Decoration is ${store.decoration_age} years old — may need refresh`) }
        if (store.decoration_age <= 2) { compScore += 5; factors.push(`✅ Recent decoration (${store.decoration_age} years)`) }

        score = Math.max(0, Math.min(100, compScore))
        summary = score >= 70 ? 'Competitive position is strong' : score >= 50 ? 'Competitive position needs strengthening' : 'Competitive position is weak'
        details = factors.join('\n') || 'Limited data for competition analysis'
        recommendations = score >= 70
          ? 'Maintain competitive edge through continuous improvement and innovation'
          : score >= 50
            ? '1. Differentiate product/service offerings\n2. Improve store environment and customer experience\n3. Develop unique value propositions\n4. Monitor competitor pricing and promotions'
            : '1. URGENT: Conduct competitive analysis\n2. Identify unique selling points\n3. Consider store renovation or rebranding\n4. Develop targeted marketing campaigns\n5. Explore niche market opportunities'
        break
      }

      case 'scene': {
        let sceneScore = 50
        const factors: string[] = []

        switch (store.type) {
          case 'retail': {
            if (store.area > 0) {
              const salesPerSqm = financials.length > 0 ? financials[0].revenue / store.area : 0
              if (salesPerSqm > 500) { sceneScore += 15; factors.push(`✅ Good sales per m²: ¥${salesPerSqm.toFixed(0)}`) }
              else if (salesPerSqm > 200) { sceneScore += 5; factors.push(`⚠️ Moderate sales per m²: ¥${salesPerSqm.toFixed(0)}`) }
              else if (salesPerSqm > 0) { sceneScore -= 10; factors.push(`❌ Low sales per m²: ¥${salesPerSqm.toFixed(0)}`) }
            }
            if (store.main_categories) {
              const catCount = store.main_categories.split(',').length
              if (catCount >= 3 && catCount <= 8) { sceneScore += 10; factors.push(`✅ Balanced category count: ${catCount}`) }
              else if (catCount > 8) { sceneScore -= 5; factors.push(`⚠️ Too many categories: ${catCount} — may dilute focus`) }
            }
            break
          }
          case 'restaurant': {
            if (financials.length > 0) {
              const fin = financials[0]
              const materialRatio = fin.revenue > 0 ? (fin.material_cost / fin.revenue) * 100 : 0
              if (materialRatio < 30) { sceneScore += 15; factors.push(`✅ Good food cost control: ${materialRatio.toFixed(1)}%`) }
              else if (materialRatio < 40) { sceneScore += 5; factors.push(`⚠️ Food cost acceptable: ${materialRatio.toFixed(1)}%`) }
              else { sceneScore -= 10; factors.push(`❌ High food cost: ${materialRatio.toFixed(1)}%`) }
            }
            break
          }
          case 'service': {
            if (financials.length > 0) {
              const repeatRate = financials[0].repeat_customer_rate
              if (repeatRate > 50) { sceneScore += 15; factors.push(`✅ Strong repeat customer rate: ${repeatRate.toFixed(1)}%`) }
              else if (repeatRate > 30) { sceneScore += 5; factors.push(`⚠️ Moderate repeat rate: ${repeatRate.toFixed(1)}%`) }
              else { sceneScore -= 10; factors.push(`❌ Low repeat rate: ${repeatRate.toFixed(1)}%`) }
            }
            break
          }
          default: {
            factors.push('General scene analysis — no specific metrics for this store type')
          }
        }

        if (store.decoration_age > 3) {
          sceneScore -= 5
          factors.push(`⚠️ Store decoration aging (${store.decoration_age} years) — consider refresh`)
        }

        score = Math.max(0, Math.min(100, sceneScore))
        summary = score >= 70 ? 'Scene-specific performance is good' : score >= 50 ? 'Scene-specific areas need improvement' : 'Scene-specific performance is concerning'
        details = factors.join('\n') || 'Limited data for scene-specific analysis'
        recommendations = score >= 70
          ? 'Continue optimizing scene-specific operations; test new approaches'
          : score >= 50
            ? store.type === 'retail'
              ? '1. Optimize product display and layout\n2. Adjust category mix based on sales data\n3. Improve visual merchandising\n4. Consider seasonal displays'
              : store.type === 'restaurant'
                ? '1. Optimize menu engineering (highlight high-margin items)\n2. Improve kitchen workflow efficiency\n3. Review portion control\n4. Enhance dining ambiance'
                : '1. Develop service packages for retention\n2. Train staff on upselling techniques\n3. Create loyalty programs\n4. Improve service environment'
            : '1. URGENT: Conduct detailed scene audit\n2. Identify specific pain points in customer journey\n3. Consider major layout or menu redesign\n4. Invest in staff training'
        break
      }
    }

    diagnosisResults.push({ dimension: dim, score, summary, details, recommendations })

    const recordId = generateId()
    await execSql(`INSERT INTO diagnosis_records (id, store_id, dimension, status, score, summary, details, recommendations)
      VALUES ('${recordId}', '${storeId}', '${dim}', 'completed', ${score}, '${esc(summary)}', '${esc(details)}', '${esc(recommendations)}')`)
  }

  const overallScore = Math.round(diagnosisResults.reduce((s, r) => s + r.score, 0) / diagnosisResults.length)

  const lines = [
    `**📊 Diagnosis Report: ${store.name}**`,
    `Period: ${period || 'Latest available data'}`,
    '',
    `**Overall Score: ${overallScore}/100** ${overallScore >= 70 ? '✅' : overallScore >= 50 ? '⚠️' : '❌'}`,
    '',
    ...diagnosisResults.flatMap(r => [
      `### ${r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1)}: ${r.score}/100 ${r.score >= 70 ? '✅' : r.score >= 50 ? '⚠️' : '❌'}`,
      `**${r.summary}**`,
      '',
      r.details,
      '',
      '**Recommendations:**',
      r.recommendations,
      '',
    ]),
  ]

  return diagSuccess(lines.join('\n'), {
    overallScore,
    dimensions: diagnosisResults,
    storeId,
    storeName: store.name,
  })
}

async function reportGenerate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const storeId = args.store_id as string
  const reportType = args.report_type as string

  if (!storeId) return diagError('store_id is required')
  if (!reportType) return diagError('report_type is required')

  const storeResult = await execSql(`SELECT * FROM stores WHERE id = '${storeId}'`)
  if (!storeResult.success || !storeResult.rows || storeResult.rows.length === 0) {
    return diagError(`Store not found: ${storeId}`)
  }
  const store = storeResult.rows[0] as unknown as DbStore

  const diagnosisResult = await execSql(`SELECT * FROM diagnosis_records WHERE store_id = '${storeId}' ORDER BY diagnosed_at DESC`)
  const diagnoses = (diagnosisResult.rows || []) as unknown as Array<{ id: string; dimension: string; score: number; summary: string; details: string; recommendations: string; diagnosed_at: string }>

  const financialResult = await execSql(`SELECT * FROM store_financials WHERE store_id = '${storeId}' ORDER BY period DESC LIMIT 12`)
  const financials = (financialResult.rows || []) as unknown as DbFinancial[]

  switch (reportType) {
    case 'scorecard': {
      const dimScores: Record<string, number> = {}
      for (const d of diagnoses) {
        if (!dimScores[d.dimension]) dimScores[d.dimension] = d.score
      }
      const overall = Object.values(dimScores).length > 0
        ? Math.round(Object.values(dimScores).reduce((s, v) => s + v, 0) / Object.values(dimScores).length)
        : 0

      const lines = [
        `**📊 Score Card: ${store.name}**`,
        '',
        `| Dimension | Score | Status |`,
        `| --- | --- | --- |`,
        `| Overall | ${overall} | ${overall >= 70 ? '✅ Good' : overall >= 50 ? '⚠️ Fair' : '❌ Poor'} |`,
        ...Object.entries(dimScores).map(([dim, sc]) =>
          `| ${dim.charAt(0).toUpperCase() + dim.slice(1)} | ${sc} | ${sc >= 70 ? '✅ Good' : sc >= 50 ? '⚠️ Fair' : '❌ Poor'} |`
        ),
      ]

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'radar', data: { dimensions: dimScores, overall }, title: `${store.name} - Diagnosis Scorecard` },
      })
    }

    case 'cost_breakdown': {
      if (financials.length === 0) return diagError('No financial data available for cost breakdown report')

      const fin = financials[0]
      const revenue = fin.revenue
      if (revenue <= 0) return diagError('Revenue is zero — cannot generate cost breakdown')

      const costs = [
        { name: 'Rent', value: fin.rent_cost },
        { name: 'Labor', value: fin.labor_cost },
        { name: 'Material', value: fin.material_cost },
        { name: 'Utility', value: fin.utility_cost },
        { name: 'Other', value: fin.other_cost },
      ]
      const totalCost = costs.reduce((s, c) => s + c.value, 0)

      const lines = [
        `**💰 Cost Breakdown: ${store.name}** (${fin.period})`,
        '',
        `Revenue: ¥${revenue.toLocaleString()}`,
        '',
        '| Cost Item | Amount | % of Revenue |',
        '| --- | --- | --- |',
        ...costs.map(c => `| ${c.name} | ¥${c.value.toLocaleString()} | ${((c.value / revenue) * 100).toFixed(1)}% |`),
        `| **Total Cost** | **¥${totalCost.toLocaleString()}** | **${((totalCost / revenue) * 100).toFixed(1)}%** |`,
        `| **Net Profit** | **¥${(revenue - totalCost).toLocaleString()}** | **${(((revenue - totalCost) / revenue) * 100).toFixed(1)}%** |`,
      ]

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'pie', data: costs.map(c => ({ name: c.name, value: c.value })), title: `${store.name} - Cost Breakdown (${fin.period})` },
      })
    }

    case 'trend': {
      if (financials.length === 0) return diagError('No financial data available for trend report')

      const lines = [
        `**📈 Financial Trend: ${store.name}**`,
        '',
        '| Period | Revenue | Total Cost | Net Profit | Customers |',
        '| --- | --- | --- | --- | --- |',
        ...financials.map(f => {
          const totalCost = f.rent_cost + f.labor_cost + f.material_cost + f.utility_cost + f.other_cost
          return `| ${f.period} | ¥${f.revenue.toLocaleString()} | ¥${totalCost.toLocaleString()} | ¥${(f.revenue - totalCost).toLocaleString()} | ${f.customer_count} |`
        }),
      ]

      return diagSuccess(lines.join('\n'), {
        chart: {
          type: 'line',
          data: financials.map(f => ({
            period: f.period,
            revenue: f.revenue,
            totalCost: f.rent_cost + f.labor_cost + f.material_cost + f.utility_cost + f.other_cost,
          })).reverse(),
          title: `${store.name} - Financial Trend`,
        },
      })
    }

    case 'comparison': {
      if (diagnoses.length === 0) return diagError('No diagnosis records available for comparison')

      const benchmarkResult = await execSql(`SELECT * FROM industry_benchmarks WHERE category = '${store.type}'`)
      const benchmarks = (benchmarkResult.rows || []) as unknown as DbBenchmark[]

      const lines = [
        `**📊 Industry Comparison: ${store.name}** (${store.type})`,
        '',
        '| Metric | Your Value | Industry Avg | Top Quartile | Status |',
        '| --- | --- | --- | --- | --- |',
      ]

      if (financials.length > 0) {
        const fin = financials[0]
        const revenue = fin.revenue
        if (revenue > 0) {
          const benchMap = new Map(benchmarks.map(b => [b.metric, b]))
          const metrics: Array<{ name: string; value: number; benchKey: string }> = [
            { name: 'Rent Ratio', value: (fin.rent_cost / revenue) * 100, benchKey: 'rent_ratio' },
            { name: 'Labor Ratio', value: (fin.labor_cost / revenue) * 100, benchKey: 'labor_ratio' },
            { name: 'Gross Margin', value: ((revenue - fin.material_cost) / revenue) * 100, benchKey: 'gross_margin' },
          ]

          for (const m of metrics) {
            const bench = benchMap.get(m.benchKey)
            if (bench) {
              const status = m.value >= bench.top_quartile ? '✅ Top' : m.value >= bench.industry_avg ? '⚠️ Avg' : '❌ Below'
              lines.push(`| ${m.name} | ${m.value.toFixed(1)}${bench.unit} | ${bench.industry_avg}${bench.unit} | ${bench.top_quartile}${bench.unit} | ${status} |`)
            }
          }
        }
      }

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'bar', data: { store, benchmarks, financials: financials[0] }, title: `${store.name} vs Industry Benchmarks` },
      })
    }

    case 'traffic_analysis': {
      const trafficResult = await execSql(`SELECT date, SUM(customer_count) as total, SUM(new_customer_count) as new_cust, SUM(returning_customer_count) as returning_cust FROM store_traffic WHERE store_id = '${storeId}' GROUP BY date ORDER BY date DESC LIMIT 30`)
      const traffic = (trafficResult.rows || []) as unknown as Array<{ date: string; total: number; new_cust: number; returning_cust: number }>

      if (traffic.length === 0) return diagError('No traffic data available')

      const lines = [
        `**🚶 Traffic Analysis: ${store.name}** (Last ${traffic.length} days)`,
        '',
        '| Date | Total | New | Returning | Return Rate |',
        '| --- | --- | --- | --- | --- |',
        ...traffic.slice(0, 15).map(t => {
          const returnRate = t.total > 0 ? ((t.returning_cust / t.total) * 100).toFixed(1) : '0.0'
          return `| ${t.date} | ${t.total} | ${t.new_cust} | ${t.returning_cust} | ${returnRate}% |`
        }),
      ]

      if (traffic.length > 15) lines.push(`... and ${traffic.length - 15} more days`)

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'area', data: traffic.reverse(), title: `${store.name} - Daily Traffic Trend` },
      })
    }

    case 'full': {
      const dimScores: Record<string, number> = {}
      for (const d of diagnoses) {
        if (!dimScores[d.dimension]) dimScores[d.dimension] = d.score
      }
      const overall = Object.values(dimScores).length > 0
        ? Math.round(Object.values(dimScores).reduce((s, v) => s + v, 0) / Object.values(dimScores).length)
        : 0

      const lines = [
        `# 📊 Full Diagnosis Report: ${store.name}`,
        '',
        `**Store Type:** ${store.type} | **Region:** ${store.region || 'N/A'} | **Area:** ${store.area}m²`,
        `**Overall Score:** ${overall}/100 ${overall >= 70 ? '✅' : overall >= 50 ? '⚠️' : '❌'}`,
        '',
        '---',
        '',
        ...diagnoses.map(d => [
          `## ${d.dimension.charAt(0).toUpperCase() + d.dimension.slice(1)}: ${d.score}/100`,
          `**${d.summary}**`,
          '',
          d.details,
          '',
          '**Recommendations:**',
          d.recommendations,
          '',
        ]).flat(),
      ]

      return diagSuccess(lines.join('\n'), {
        chart: { type: 'radar', data: { dimensions: dimScores, overall }, title: `${store.name} - Full Diagnosis Report` },
      })
    }

    default:
      return diagError(`Unknown report type: ${reportType}. Use full/scorecard/trend/comparison/cost_breakdown/traffic_analysis.`)
  }
}

async function optimizationPlan(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const action = args.action as string

  switch (action) {
    case 'create': {
      const storeId = args.store_id as string
      const data = args.data as Record<string, unknown> | undefined
      if (!storeId) return diagError('store_id is required for create')
      if (!data?.title) return diagError('Plan title is required')

      const planId = generateId()
      const diagnosisId = args.diagnosis_id as string | undefined || ''
      const tasks = data.tasks as Array<Record<string, unknown>> | undefined
      const taskIds: string[] = []

      const sql = `INSERT INTO optimization_plans (id, store_id, diagnosis_id, title, description, priority, status, expected_effect, execution_cycle, tasks)
        VALUES ('${planId}', '${storeId}', '${diagnosisId}', '${esc(data.title)}', '${esc(data.description)}', ${data.priority || 5}, '${data.status || 'pending'}', '${esc(data.expected_effect)}', '${esc(data.execution_cycle)}', '[]')`

      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to create plan')

      if (tasks && tasks.length > 0) {
        for (const task of tasks) {
          const taskId = generateId()
          taskIds.push(taskId)
          await execSql(`INSERT INTO plan_tasks (id, plan_id, title, description, assignee, due_date, status)
            VALUES ('${taskId}', '${planId}', '${esc(task.title)}', '${esc(task.description)}', '${esc(task.assignee)}', '${esc(task.due_date)}', '${task.status || 'pending'}')`)
        }
      }

      return diagSuccess(`✅ Optimization plan "${data.title}" created with ${taskIds.length} tasks (Plan ID: ${planId})`, { planId, taskIds })
    }

    case 'update': {
      const planId = args.plan_id as string
      const data = args.data as Record<string, unknown> | undefined
      if (!planId) return diagError('plan_id is required for update')
      if (!data) return diagError('No data provided for update')

      const setClauses: string[] = []
      const allowedFields = ['title', 'description', 'priority', 'status', 'expected_effect', 'execution_cycle']
      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          if (typeof data[field] === 'string') {
            setClauses.push(`${field} = '${esc(data[field])}'`)
          } else {
            setClauses.push(`${field} = ${data[field]}`)
          }
        }
      }
      setClauses.push("updated_at = datetime('now', 'localtime')")

      const sql = `UPDATE optimization_plans SET ${setClauses.join(', ')} WHERE id = '${planId}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update plan')
      if (result.rowsAffected === 0) return diagError(`Plan not found: ${planId}`)

      return diagSuccess(`✅ Plan updated successfully`, { planId })
    }

    case 'delete': {
      const planId = args.plan_id as string
      if (!planId) return diagError('plan_id is required for delete')

      await execSql(`DELETE FROM plan_tasks WHERE plan_id = '${planId}'`)
      const result = await execSql(`DELETE FROM optimization_plans WHERE id = '${planId}'`)
      if (!result.success) return diagError(result.error || 'Failed to delete plan')
      if (result.rowsAffected === 0) return diagError(`Plan not found: ${planId}`)

      return diagSuccess(`✅ Plan and its tasks deleted`, { planId })
    }

    case 'get': {
      const planId = args.plan_id as string
      if (!planId) return diagError('plan_id is required for get')

      const planResult = await execSql(`SELECT * FROM optimization_plans WHERE id = '${planId}'`)
      if (!planResult.success || !planResult.rows || planResult.rows.length === 0) return diagError(`Plan not found: ${planId}`)

      const plan = planResult.rows[0] as unknown as DbPlan
      const tasksResult = await execSql(`SELECT * FROM plan_tasks WHERE plan_id = '${planId}' ORDER BY due_date`)
      const tasks = (tasksResult.rows || []) as unknown as DbTask[]

      const lines = [
        `**📋 ${plan.title}**`,
        `Priority: ${plan.priority} | Status: ${plan.status} | Cycle: ${plan.execution_cycle || 'N/A'}`,
        plan.description ? `\n${plan.description}` : '',
        plan.expected_effect ? `\n**Expected Effect:** ${plan.expected_effect}` : '',
        '',
        `**Tasks (${tasks.length}):**`,
        ...tasks.map((t, i) => {
          const statusIcon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'skipped' ? '⏭️' : '⬜'
          return `${i + 1}. ${statusIcon} ${t.title} ${t.assignee ? `(${t.assignee})` : ''} ${t.due_date ? `[Due: ${t.due_date}]` : ''}`
        }),
      ].filter(Boolean)

      return diagSuccess(lines.join('\n'), { plan, tasks })
    }

    case 'list': {
      const storeId = args.store_id as string
      if (!storeId) return diagError('store_id is required for list')

      const result = await execSql(`SELECT id, title, priority, status, execution_cycle, created_at FROM optimization_plans WHERE store_id = '${storeId}' ORDER BY priority ASC, created_at DESC`)
      const plans = (result.rows || []) as unknown as DbPlan[]

      if (plans.length === 0) return diagSuccess('No optimization plans found for this store.')

      const lines = [
        `**📋 Optimization Plans (${plans.length})**`,
        '',
        '| # | Title | Priority | Status | Cycle | Created |',
        '| --- | --- | --- | --- | --- | --- |',
        ...plans.map((p, i) => `| ${i + 1} | ${p.title} | ${p.priority} | ${p.status} | ${p.execution_cycle || '-'} | ${p.created_at} |`),
      ]

      return diagSuccess(lines.join('\n'), { plans })
    }

    case 'add_task': {
      const planId = args.plan_id as string
      const data = args.data as Record<string, unknown> | undefined
      if (!planId) return diagError('plan_id is required for add_task')
      if (!data?.title) return diagError('Task title is required')

      const taskId = generateId()
      const sql = `INSERT INTO plan_tasks (id, plan_id, title, description, assignee, due_date, status)
        VALUES ('${taskId}', '${planId}', '${esc(data.title)}', '${esc(data.description)}', '${esc(data.assignee)}', '${esc(data.due_date)}', '${data.status || 'pending'}')`

      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to add task')

      return diagSuccess(`✅ Task "${data.title}" added to plan`, { planId, taskId })
    }

    case 'update_task': {
      const taskId = args.task_id as string
      const taskData = args.task_data as Record<string, unknown> | undefined
      if (!taskId) return diagError('task_id is required for update_task')
      if (!taskData) return diagError('task_data is required for update_task')

      const setClauses: string[] = []
      const allowedFields = ['title', 'description', 'assignee', 'due_date', 'status']
      for (const field of allowedFields) {
        if (taskData[field] !== undefined) {
          if (typeof taskData[field] === 'string') {
            setClauses.push(`${field} = '${esc(taskData[field])}'`)
          } else {
            setClauses.push(`${field} = ${taskData[field]}`)
          }
        }
      }

      if (taskData.status === 'completed') {
        setClauses.push("completed_at = datetime('now', 'localtime')")
      }

      if (setClauses.length === 0) return diagError('No fields to update')

      const sql = `UPDATE plan_tasks SET ${setClauses.join(', ')} WHERE id = '${taskId}'`
      const result = await execSql(sql)
      if (!result.success) return diagError(result.error || 'Failed to update task')
      if (result.rowsAffected === 0) return diagError(`Task not found: ${taskId}`)

      return diagSuccess(`✅ Task updated`, { taskId })
    }

    case 'list_tasks': {
      const planId = args.plan_id as string
      if (!planId) return diagError('plan_id is required for list_tasks')

      const result = await execSql(`SELECT * FROM plan_tasks WHERE plan_id = '${planId}' ORDER BY due_date, status`)
      const tasks = (result.rows || []) as unknown as DbTask[]

      if (tasks.length === 0) return diagSuccess('No tasks found for this plan.')

      const completed = tasks.filter(t => t.status === 'completed').length
      const lines = [
        `**Tasks (${completed}/${tasks.length} completed)**`,
        '',
        ...tasks.map((t, i) => {
          const statusIcon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'skipped' ? '⏭️' : '⬜'
          return `${i + 1}. ${statusIcon} **${t.title}** ${t.assignee ? `→ ${t.assignee}` : ''} ${t.due_date ? `[${t.due_date}]` : ''}`
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
  const metrics = args.metrics as string[] | undefined

  if (!category) return diagError('category is required')

  let sql = `SELECT * FROM industry_benchmarks WHERE category = '${category}'`
  if (metrics && metrics.length > 0) {
    const metricList = metrics.map(m => `'${m}'`).join(',')
    sql += ` AND metric IN (${metricList})`
  }

  const result = await execSql(sql)
  if (!result.success) return diagError(result.error || 'Failed to query benchmarks')

  const benchmarks = (result.rows || []) as unknown as DbBenchmark[]
  if (benchmarks.length === 0) return diagError(`No benchmark data found for category: ${category}`)

  const lines = [
    `**📊 Industry Benchmarks: ${category}**`,
    '',
    '| Metric | Industry Avg | Top Quartile | Unit |',
    '| --- | --- | --- | --- |',
    ...benchmarks.map(b => `| ${b.metric} | ${b.industry_avg} | ${b.top_quartile} | ${b.unit || '-'} |`),
  ]

  return diagSuccess(lines.join('\n'), { benchmarks })
}

export const storeDiagnosisExecutors = {
  store_manage: storeManage,
  store_diagnose: storeDiagnose,
  report_generate: reportGenerate,
  optimization_plan: optimizationPlan,
  benchmark_query: benchmarkQuery,
}

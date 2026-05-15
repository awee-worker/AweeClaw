import { useState, useCallback, useEffect } from 'react'
import { Stethoscope, RefreshCw, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface DiagnosisRecord {
  id: string
  store_id: string
  dimension: string
  status: string
  score: number
  summary: string
  details: string
  recommendations: string
  diagnosed_at: string
}

interface StoreName {
  id: string
  name: string
}

const DIMENSION_LABELS: Record<string, { zh: string; en: string; icon: string }> = {
  operations: { zh: '运营效率', en: 'Operations', icon: '⚙️' },
  cost: { zh: '成本结构', en: 'Cost Structure', icon: '💰' },
  competition: { zh: '竞争分析', en: 'Competition', icon: '🏆' },
  scene: { zh: '场景适配', en: 'Scene Fit', icon: '🎯' },
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-yellow-400'
  if (score >= 40) return 'text-orange-400'
  return 'text-red-400'
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-400/10'
  if (score >= 60) return 'bg-yellow-400/10'
  if (score >= 40) return 'bg-orange-400/10'
  return 'bg-red-400/10'
}

function scoreIcon(score: number) {
  if (score >= 80) return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
  if (score >= 60) return <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400" />
  if (score >= 40) return <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
  return <XCircle className="w-3.5 h-3.5 text-red-400" />
}

export function DiagnosisRecordsPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [records, setRecords] = useState<DiagnosisRecord[]>([])
  const [storeNames, setStoreNames] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterDim, setFilterDim] = useState<string>('all')

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

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
      const storeResult = await scenarioDatabaseManager.executeSql('store-diagnosis', 'SELECT id, name FROM stores')
      if (storeResult.success && storeResult.rows) {
        const map: Record<string, string> = {}
        for (const row of storeResult.rows) {
          map[(row as unknown as StoreName).id] = (row as unknown as StoreName).name
        }
        setStoreNames(map)
      }

      let sql = 'SELECT * FROM diagnosis_records ORDER BY diagnosed_at DESC'
      if (filterDim !== 'all') {
        sql = `SELECT * FROM diagnosis_records WHERE dimension = '${filterDim}' ORDER BY diagnosed_at DESC`
      }
      const result = await scenarioDatabaseManager.executeSql('store-diagnosis', sql)
      if (result.success && result.rows) {
        setRecords(result.rows as unknown as DiagnosisRecord[])
      }
    } catch {
      setRecords([])
    }
    setLoading(false)
  }, [filterDim])

  useEffect(() => { loadData() }, [loadData])

  const handleViewDetail = useCallback((record: DiagnosisRecord) => {
    const storeName = storeNames[record.store_id] || record.store_id
    const dimInfo = DIMENSION_LABELS[record.dimension]
    const dimLabel = dimInfo?.[language === 'zh' ? 'zh' : 'en'] || record.dimension
    const prompt = language === 'zh'
      ? `请展示门店「${storeName}」的${dimLabel}诊断详细报告，评分：${record.score}分`
      : `Please show the detailed ${dimLabel} diagnosis report for store "${storeName}", score: ${record.score}`
    sendToChat(prompt)
  }, [language, sendToChat, storeNames])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '诊断记录' : 'DIAGNOSIS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadData} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
        </div>
      </div>

      <div className="flex gap-0.5 px-2 py-1.5 border-b border-border/20">
        <button
          onClick={() => setFilterDim('all')}
          className={`flex-1 text-xs py-1 rounded transition-colors ${filterDim === 'all' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}
        >
          {language === 'zh' ? '全部' : 'All'}
        </button>
        {Object.entries(DIMENSION_LABELS).map(([key, info]) => (
          <button
            key={key}
            onClick={() => setFilterDim(key)}
            className={`flex-1 text-xs py-1 rounded transition-colors ${filterDim === key ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}
          >
            {info.icon}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {records.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-text-muted">
            <Stethoscope className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">{language === 'zh' ? '暂无诊断记录' : 'No diagnosis records'}</p>
            <p className="text-xs mt-1 opacity-70">{language === 'zh' ? '对门店执行诊断后记录将显示在这里' : 'Records will appear after diagnosing stores'}</p>
          </div>
        )}

        {records.map((record) => {
          const dimInfo = DIMENSION_LABELS[record.dimension]
          const isExpanded = expandedId === record.id
          const storeName = storeNames[record.store_id] || record.store_id
          return (
            <div key={record.id}>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : record.id)}
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
                <span className="text-sm">{dimInfo?.icon || '📋'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary truncate">{storeName}</div>
                  <div className="text-xs text-text-muted">{dimInfo?.[language === 'zh' ? 'zh' : 'en'] || record.dimension}</div>
                </div>
                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${scoreBg(record.score)} ${scoreColor(record.score)}`}>
                  {scoreIcon(record.score)}
                  {record.score}
                </div>
              </button>

              {isExpanded && (
                <div className="pl-8 pr-3 pb-2 space-y-1.5">
                  {record.summary && (
                    <div className="text-xs text-text-secondary leading-relaxed">{record.summary}</div>
                  )}
                  {record.recommendations && (
                    <div className="text-xs text-text-muted leading-relaxed">
                      <span className="text-accent">💡</span> {record.recommendations.substring(0, 120)}{record.recommendations.length > 120 ? '...' : ''}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{record.diagnosed_at}</span>
                  </div>
                  <ActionButton variant="ghost" size="sm" className="h-6 w-full text-xs gap-1" onClick={() => handleViewDetail(record)}>
                    {language === 'zh' ? '查看完整报告' : 'View Full Report'}
                  </ActionButton>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

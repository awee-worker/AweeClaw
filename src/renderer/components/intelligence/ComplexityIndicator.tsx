/**
 * 任务复杂度指示器
 *
 * 在用户输入框上方显示当前任务的复杂度分析，
 * 包括雷达图、特征标签和建议角色。
 */

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BrainCircuit, Users, Sparkles } from 'lucide-react'
import { taskComplexityDetector } from '@intelligence/capabilities/planning/TaskComplexityDetector'
import { ComplexityRadarChart } from './ComplexityRadarChart'

interface ComplexityIndicatorProps {
  text: string
  language?: 'zh' | 'en'
  chatMode?: string
}

const FEATURE_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  '多步骤任务': { zh: '多步骤', en: 'Multi-step', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  '长任务描述': { zh: '长描述', en: 'Long Desc', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25' },
  '跨领域': { zh: '跨领域', en: 'Cross-domain', color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
  '大范围文件操作': { zh: '大文件范围', en: 'Large Scope', color: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
  '涉及特殊关键词': { zh: '特殊关键词', en: 'Special Keywords', color: 'bg-pink-500/15 text-pink-400 border-pink-500/25' },
  '设计到实现的完整流程': { zh: '完整流程', en: 'Full Workflow', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25' },
  '前后端联动': { zh: '前后端联动', en: 'Full-stack', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  '多文件重构': { zh: '多文件重构', en: 'Multi-file', color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  '架构级设计': { zh: '架构设计', en: 'Architecture', color: 'bg-rose-500/15 text-rose-400 border-rose-500/25' },
}

const ROLE_LABELS: Record<string, { zh: string; en: string; icon: string }> = {
  planner: { zh: '规划师', en: 'Planner', icon: '📋' },
  architect: { zh: '架构师', en: 'Architect', icon: '🏗️' },
  developer: { zh: '开发者', en: 'Developer', icon: '💻' },
  tester: { zh: '测试员', en: 'Tester', icon: '🧪' },
  reviewer: { zh: '审查员', en: 'Reviewer', icon: '🔍' },
  coordinator: { zh: '协调员', en: 'Coordinator', icon: '🤝' },
}

export function ComplexityIndicator({ text, language = 'zh', chatMode }: ComplexityIndicatorProps) {
  const score = useMemo(() => {
    if (!text || text.trim().length < 5) return null
    return taskComplexityDetector.analyze(text)
  }, [text])

  if (!score || score.total === 0) return null

  // 只在 Agent 模式下显示，或当复杂度较高时显示
  const shouldShow = chatMode === 'agent' || score.total >= 40
  if (!shouldShow) return null

  const getComplexityLabel = (total: number) => {
    if (total >= 80) return { zh: '极高', en: 'Very High', color: 'text-red-400' }
    if (total >= 60) return { zh: '高', en: 'High', color: 'text-orange-400' }
    if (total >= 40) return { zh: '中等', en: 'Medium', color: 'text-yellow-400' }
    if (total >= 20) return { zh: '低', en: 'Low', color: 'text-green-400' }
    return { zh: '极低', en: 'Very Low', color: 'text-slate-400' }
  }

  const complexityLabel = getComplexityLabel(score.total)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -8, height: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-2 rounded-xl border border-border/40 bg-surface/60 backdrop-blur-sm overflow-hidden"
      >
        <div className="p-3 flex items-start gap-4">
          {/* 雷达图 */}
          <div className="flex-shrink-0">
            <ComplexityRadarChart score={score} size={130} language={language} />
          </div>

          {/* 详细信息 */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* 标题行 */}
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-3.5 h-3.5 text-accent" />
              <span className="text-xs font-medium text-text-primary">
                {language === 'zh' ? '任务复杂度分析' : 'Task Complexity Analysis'}
              </span>
              <span className={`text-xs font-bold ${complexityLabel.color}`}>
                {complexityLabel[language]}
              </span>
            </div>

            {/* 特征标签 */}
            {score.features.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {score.features.map((feature, i) => {
                  const label = FEATURE_LABELS[feature]
                  if (!label) return null
                  return (
                    <span
                      key={i}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${label.color}`}
                    >
                      {label[language]}
                    </span>
                  )
                })}
              </div>
            )}

            {/* 建议角色 */}
            {score.suggestedRoles.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Users className="w-3 h-3 text-text-muted" />
                <span className="text-[10px] text-text-muted">
                  {language === 'zh' ? '建议角色:' : 'Suggested Roles:'}
                </span>
                {score.suggestedRoles.map((role, i) => {
                  const roleInfo = ROLE_LABELS[role]
                  if (!roleInfo) return null
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium"
                    >
                      <span>{roleInfo.icon}</span>
                      <span>{roleInfo[language]}</span>
                    </span>
                  )
                })}
              </div>
            )}

            {/* 触发提示 */}
            {score.needsMultiAgent && chatMode === 'agent' && (
              <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] text-purple-400">
                  {language === 'zh'
                    ? '发送后将自动启用多 Agent 协作处理此任务'
                    : 'Multi-agent collaboration will be triggered after sending'}
                </span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

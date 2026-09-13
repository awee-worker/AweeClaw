/**
 * 行为引擎配置面板
 * 
 * 展示当前已配置的行为规则，支持添加/编辑/删除规则
 */

import { useState, useEffect } from 'react'
import { Plus, Trash2, Play, Pause, Settings2 } from 'lucide-react'
import { getBehaviorEngine, type BehaviorRule, type TriggerType } from '@renderer/intelligence/runtime/BehaviorEngine'

interface BehaviorPanelProps {
  className?: string
}

export default function BehaviorEnginePanel({ className = '' }: BehaviorPanelProps) {
  const [rules, setRules] = useState<BehaviorRule[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  const engine = getBehaviorEngine()

  // 加载规则
  useEffect(() => {
    setRules(engine.getAllRules())
    setIsRunning(true)
    
    // 监听变化
    const interval = setInterval(() => {
      setRules(engine.getAllRules())
    }, 1000)
    
    return () => clearInterval(interval)
  }, [])

  // 切换规则启用状态
  const toggleRule = (id: string) => {
    const rule = rules.find(r => r.id === id)
    if (rule) {
      engine.toggleRule(id, !rule.enabled)
      setRules([...rules])
    }
  }

  // 删除规则
  const deleteRule = (id: string) => {
    engine.deleteRule(id)
    setRules(rules.filter(r => r.id !== id))
  }

  // 添加规则
  const addRule = (rule: Omit<BehaviorRule, 'id' | 'createdAt' | 'updatedAt'>) => {
    engine.addRule(rule)
    setRules([...engine.getAllRules()])
    setShowAddForm(false)
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium">行为引擎</span>
          {isRunning && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              运行中
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
        >
          <Plus className="w-3 h-3" />
          添加规则
        </button>
      </div>

      {/* 规则列表 */}
      <div className="space-y-2">
        {rules.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            暂无行为规则<br />
            添加规则让 AI 主动服务
          </div>
        ) : (
          rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => toggleRule(rule.id)}
              onDelete={() => deleteRule(rule.id)}
            />
          ))
        )}
      </div>

      {/* 添加规则表单 */}
      {showAddForm && (
        <AddRuleForm
          onSubmit={addRule}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  )
}

// 规则卡片
function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: BehaviorRule
  onToggle: () => void
  onDelete: () => void
}) {
  const triggerLabel = getTriggerLabel(rule.trigger.type)

  return (
    <div className={`p-3 rounded-lg border transition-colors ${
      rule.enabled 
        ? 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700' 
        : 'bg-gray-50/50 border-gray-200 opacity-60 dark:bg-gray-900 dark:border-gray-800'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{rule.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {triggerLabel}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
            {rule.action.prompt || rule.action.toolName || '无内容'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title={rule.enabled ? '禁用' : '启用'}
          >
            {rule.enabled ? (
              <Pause className="w-3 h-3 text-green-500" />
            ) : (
              <Play className="w-3 h-3 text-gray-400" />
            )}
          </button>
          <button
            onClick={onDelete}
            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
            title="删除"
          >
            <Trash2 className="w-3 h-3 text-red-500" />
          </button>
        </div>
      </div>
    </div>
  )
}

// 添加规则表单
function AddRuleForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (rule: Omit<BehaviorRule, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<TriggerType>('time')
  const [prompt, setPrompt] = useState('')

  const handleSubmit = () => {
    if (!name || !prompt) return

    const baseRule = {
      enabled: true,
      name,
      trigger: {
        type,
        config: type === 'time' 
          ? { time: { value: '09:00', days: [1, 2, 3, 4, 5] } }
          : type === 'noInput'
          ? { noInput: { latencyMs: 1800000 } }
          : { cycle: { intervalMs: 3600000, infinite: true } },
      },
      action: {
        type: 'prompt' as const,
        prompt,
      },
    }

    onSubmit(baseRule)
  }

  return (
    <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            规则名称
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：每日待办提醒"
            className="w-full px-2 py-1 text-sm rounded border dark:bg-gray-800 dark:border-gray-700"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            触发类型
          </label>
          <select
            value={type}
            onChange={e => setType(e.target.value as TriggerType)}
            className="w-full px-2 py-1 text-sm rounded border dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="time">定时触发</option>
            <option value="noInput">无操作超时</option>
            <option value="cycle">周期性触发</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            AI 提示词（支持 {`{now}`}, {`{date}`}, {`{time}`} 变量）
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="请输入 AI 生成的主动消息内容"
            rows={3}
            className="w-full px-2 py-1 text-sm rounded border dark:bg-gray-800 dark:border-gray-700 resize-none"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name || !prompt}
            className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded"
          >
            添加规则
          </button>
        </div>
      </div>
    </div>
  )
}

// 触发类型标签
function getTriggerLabel(type: TriggerType): string {
  switch (type) {
    case 'time': return '定时'
    case 'noInput': return '空闲'
    case 'cycle': return '周期'
  }
}

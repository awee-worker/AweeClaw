import { memo, useState, useCallback, useRef, useEffect } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import {
  getNodeColor,
  getNodeLabel,
  SourceHandleWithPicker,
  useScrollCapture,
  emitUpdate,
} from './NodeShared'
import {
  SYSTEM_VARIABLES,
  type GuideQuestion,
} from '@shared/protocols/workflowV2'
import {
  ChevronDown,
  Variable,
  Trash2,
  MessageCircle,
  Copy,
  Check,
  X,
  Rocket,
} from 'lucide-react'

function emitAddVariable(variable: {
  name: string
  type: string
  defaultValue: string
  scope: string
}) {
  document.dispatchEvent(
    new CustomEvent('wf-add-workflow-variable', { detail: variable }),
  )
}

function emitRemoveVariable(name: string) {
  document.dispatchEvent(
    new CustomEvent('wf-remove-workflow-variable', { detail: { name } }),
  )
}

let qIdCounter = Date.now()
function genQuestionId(): string {
  qIdCounter += 1
  return `q-${qIdCounter}`
}

const INPUT_CLASS =
  'nodrag no-wheel w-full h-7 px-2 text-[11px] rounded-md border border-gray-200 bg-white text-gray-700 placeholder:text-gray-350 focus:outline-none focus:ring-1.5 focus:ring-green-400/30 focus:border-green-400 transition-all'

const SELECT_CLASS =
  'nodrag no-wheel w-full h-7 px-2 text-[11px] rounded-md border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-1.5 focus:ring-green-400/30 focus:border-green-400 transition-all'

export const StartNode = memo(function StartNode({
  id,
  data,
  selected,
}: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('start')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('start')
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const editInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editing])

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setEditValue(label)
    setEditing(true)
  }, [label])

  const [expanded, setExpanded] = useState(nodeData._expanded !== false)
  const [showAddVar, setShowAddVar] = useState(false)
  const [showAddQ, setShowAddQ] = useState(false)
  const [showSysVars, setShowSysVars] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const [newVarName, setNewVarName] = useState('')
  const [newVarType, setNewVarType] = useState('string')
  const [newVarDefault, setNewVarDefault] = useState('')

  const [newQText, setNewQText] = useState('')

  const welcomeMsg =
    nodeData.welcomeMessageZh ||
    nodeData.welcomeMessage ||
    '欢迎使用工作流，从这里开始构建你的自动化流程'
  const guideQuestions: GuideQuestion[] = nodeData.guideQuestions || []
  const workflowVars = nodeData._workflowVariables || []

  const sysVarsListRef = useScrollCapture()
  const customVarsListRef = useScrollCapture()

  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const handleWelcomeChange = useCallback(
    (val: string) =>
      emitUpdate(id, { welcomeMessageZh: val, welcomeMessage: val }),
    [id],
  )

  const handleAddVariable = useCallback(() => {
    if (!newVarName.trim()) return
    emitAddVariable({
      name: newVarName.trim(),
      type: newVarType,
      defaultValue: newVarDefault,
      scope: 'workflow',
    })
    setNewVarName('')
    setNewVarDefault('')
    setShowAddVar(false)
  }, [newVarName, newVarType, newVarDefault])

  const handleRemoveVariable = useCallback((varName: string) => {
    emitRemoveVariable(varName)
  }, [])

  const handleAddQuestion = useCallback(() => {
    if (!newQText.trim()) return
    const newQ: GuideQuestion = {
      id: genQuestionId(),
      text: newQText.trim(),
      textZh: newQText.trim(),
    }
    emitUpdate(id, { guideQuestions: [...guideQuestions, newQ] })
    setNewQText('')
    setShowAddQ(false)
  }, [newQText, guideQuestions, id])

  const handleRemoveQuestion = useCallback(
    (qId: string) => {
      emitUpdate(id, {
        guideQuestions: guideQuestions.filter((q) => q.id !== qId),
      })
    },
    [guideQuestions, id],
  )

  const handleCopySysVar = useCallback(async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      // ignore
    }
  }, [])

  return (
    <div
      className={[
        'relative rounded-2xl border bg-white shadow-sm transition-all duration-200',
        'min-w-[270px] max-w-[290px]',
        selected ? 'shadow-md' : 'hover:shadow-md',
      ].join(' ')}
      style={{
        borderColor: selected ? color : '#e5e7eb',
        boxShadow: selected
          ? `0 0 0 3px ${color}18, 0 4px 12px rgba(0,0,0,0.06)`
          : undefined,
      }}
    >
      {/* Header with Source Handle */}
      <div className="flex items-center gap-2.5 px-4 py-3 relative">
        <div
          className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 shadow-sm"
          style={{ backgroundColor: color, color: '#fff' }}
        >
          <Rocket className="w-3.5 h-3.5" />
        </div>
        {editing ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => { setEditing(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const trimmed = editValue.trim()
                if (trimmed && trimmed !== label) emitUpdate(id, { _customLabel: trimmed })
                setEditing(false)
              }
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={e => e.stopPropagation()}
            className="h-6 px-1.5 text-[12px] font-semibold rounded border border-green-300 bg-white text-gray-800 outline-none focus:ring-1.5 focus:ring-green-400/30 flex-1 min-w-0"
          />
        ) : (
          <span
            onClick={handleStartEdit}
            className="text-[12px] font-semibold text-gray-800 truncate flex-1 cursor-text hover:text-green-600 transition-colors border-b border-dashed border-transparent hover:border-green-300"
            title="Click to rename"
          >
            {label}
          </span>
        )}
        <button
          onClick={handleToggleExpand}
          className={`w-5 h-5 flex items-center justify-center rounded-md text-gray-350 hover:text-gray-600 hover:bg-gray-100 transition-all flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
        >
          <ChevronDown className="w-3 h-3" />
        </button>

        <SourceHandleWithPicker
          nodeId={id}
          nodeType="start"
          handleId="out"
          connected={false}
        />
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-gray-100">
          {/* Welcome Guide */}
          <div className="bg-green-50/70 rounded-xl p-3 border border-green-100/60">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Rocket className="w-3 h-3 text-green-600" />
              <span className="text-[10px] font-semibold text-green-700">
                欢迎引导
              </span>
            </div>
            <textarea
              value={welcomeMsg}
              onChange={(e) => handleWelcomeChange(e.target.value)}
              placeholder="输入引导词..."
              rows={2}
              className="nodrag no-wheel w-full px-2.5 py-1.5 text-[11px] rounded-lg border border-green-200 bg-white text-gray-700 placeholder:text-gray-350 focus:outline-none focus:ring-1.5 focus:ring-green-400/30 focus:border-green-400 transition-all resize-none"
              onWheel={(e) => e.stopPropagation()}
            />
          </div>

          {/* Guide Questions */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <MessageCircle className="w-3 h-3 text-blue-500" />
                <span className="text-[10px] font-semibold text-gray-500">
                  引导问题
                </span>
              </div>
              <button
                onClick={() => setShowAddQ(!showAddQ)}
                className="flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                <span className="text-xs leading-none">+</span>
                添加
              </button>
            </div>

            {showAddQ && (
              <div className="bg-gray-50 rounded-lg p-2.5 space-y-1.5 border border-gray-100">
                <input
                  value={newQText}
                  onChange={(e) => setNewQText(e.target.value)}
                  placeholder="输入引导问题..."
                  className={INPUT_CLASS}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddQuestion()
                    if (e.key === 'Escape') {
                      setShowAddQ(false)
                      setNewQText('')
                    }
                  }}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAddQuestion}
                    disabled={!newQText.trim()}
                    className="flex-1 h-7 text-[10px] font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    确认
                  </button>
                  <button
                    onClick={() => {
                      setShowAddQ(false)
                      setNewQText('')
                    }}
                    className="flex-1 h-7 text-[10px] font-medium rounded-md bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {guideQuestions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {guideQuestions.map((q) => (
                  <span
                    key={q.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-150 text-[10px] text-blue-700 group cursor-default hover:bg-blue-100 transition-colors"
                  >
                    <span className="max-w-[160px] truncate">
                      {q.textZh || q.text}
                    </span>
                    <button
                      onClick={() => handleRemoveQuestion(q.id)}
                      className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-blue-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[9px] text-gray-350 italic">
                添加引导问题，运行工作流时用户可点击发起会话
              </p>
            )}
          </div>

          {/* Custom Global Variables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Variable className="w-3 h-3 text-purple-500" />
                <span className="text-[10px] font-semibold text-gray-500">
                  自定义全局变量
                  {workflowVars.length > 0
                    ? ` (${workflowVars.length})`
                    : ''}
                </span>
              </div>
              <button
                onClick={() => setShowAddVar(!showAddVar)}
                className="flex items-center gap-0.5 text-[10px] text-purple-600 hover:text-purple-700 font-medium transition-colors"
              >
                <span className="text-xs leading-none">+</span>
                添加
              </button>
            </div>

            {showAddVar && (
              <div className="bg-gray-50 rounded-lg p-2.5 space-y-1.5 border border-gray-100">
                <input
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  placeholder="变量名"
                  className={INPUT_CLASS}
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <select
                    value={newVarType}
                    onChange={(e) => setNewVarType(e.target.value)}
                    className={`${SELECT_CLASS} flex-1`}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="object">object</option>
                    <option value="array">array</option>
                  </select>
                  <input
                    value={newVarDefault}
                    onChange={(e) => setNewVarDefault(e.target.value)}
                    placeholder="默认值"
                    className={`${INPUT_CLASS} flex-1`}
                  />
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAddVariable}
                    disabled={!newVarName.trim()}
                    className="flex-1 h-7 text-[10px] font-medium rounded-md bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    确认
                  </button>
                  <button
                    onClick={() => {
                      setShowAddVar(false)
                      setNewVarName('')
                      setNewVarDefault('')
                    }}
                    className="flex-1 h-7 text-[10px] font-medium rounded-md bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {workflowVars.length > 0 && (
              <div
                ref={customVarsListRef}
                className="nodrag no-wheel space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar"
              >
                {workflowVars.map((v) => (
                  <div
                    key={v.name}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-50/50 border border-purple-100/50 group"
                  >
                    <span className="text-[10px] font-mono font-semibold text-purple-600 truncate flex-1">
                      {v.name}
                    </span>
                    <span className="text-[9px] text-purple-400 bg-purple-100 px-1 rounded flex-shrink-0">
                      {v.type}
                    </span>
                    {v.defaultValue !== undefined &&
                      v.defaultValue !== '' && (
                        <span className="text-[9px] text-gray-400 truncate max-w-[50px] flex-shrink-0">
                          = {String(v.defaultValue)}
                        </span>
                      )}
                    <button
                      onClick={() => handleRemoveVariable(v.name)}
                      className="w-4 h-4 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {workflowVars.length === 0 && !showAddVar && (
              <p className="text-[9px] text-gray-350 italic">
                添加变量供整个工作流引用，节点中可通过 {' {'}
                变量名{'}'} 引用
              </p>
            )}
          </div>

          {/* System Variables */}
          <div className="space-y-1.5">
            <button
              onClick={() => setShowSysVars(!showSysVars)}
              className="flex items-center justify-between w-full group"
            >
              <div className="flex items-center gap-1.5">
                <svg
                  className="w-3 h-3 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                <span className="text-[10px] font-semibold text-gray-500">
                  系统变量 ({SYSTEM_VARIABLES.length} 个)
                </span>
              </div>
              <ChevronDown
                className={`w-3 h-3 text-gray-350 group-hover:text-gray-500 transition-transform ${showSysVars ? 'rotate-180' : ''}`}
              />
            </button>

            {showSysVars && (
              <div
                ref={sysVarsListRef}
                className="nodrag no-wheel max-h-[150px] overflow-y-auto custom-scrollbar space-y-0.5"
              >
                {SYSTEM_VARIABLES.map((sv) => (
                  <div
                    key={sv.key}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50/50 border border-amber-100/40 group hover:bg-amber-50/80 transition-colors"
                  >
                    <code className="text-[9px] font-mono text-amber-700 bg-amber-100/60 px-1 rounded flex-shrink-0">
                      {sv.key}
                    </code>
                    <span className="text-[9px] text-gray-500 truncate flex-1">
                      {sv.labelZh}
                    </span>
                    <span className="text-[8px] text-amber-400 bg-amber-100 px-1 rounded flex-shrink-0">
                      {sv.type}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCopySysVar(sv.key)
                      }}
                      className="w-4 h-4 flex items-center justify-center rounded text-amber-400 hover:text-amber-600 hover:bg-amber-200/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      title={`复制 ${sv.key}`}
                    >
                      {copiedKey === sv.key ? (
                        <Check className="w-2.5 h-2.5 text-green-500" />
                      ) : (
                        <Copy className="w-2.5 h-2.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!showSysVars && (
              <div className="flex flex-wrap gap-1">
                {SYSTEM_VARIABLES.slice(0, 3).map((sv) => (
                  <span
                    key={sv.key}
                    className="text-[8.5px] text-amber-600 bg-amber-50/70 px-1.5 py-0.5 rounded border border-amber-100/50"
                  >
                    {sv.key}
                  </span>
                ))}
                <span className="text-[8.5px] text-gray-350 px-1.5 py-0.5">
                  +{SYSTEM_VARIABLES.length - 3} 个
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
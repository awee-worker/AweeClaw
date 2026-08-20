/**
 * 工具参数表编辑器（ToolParamEditor）
 *
 * 可视化编辑 ToolDefinition.parameters 的树形结构：
 *  - 顶层参数列表（add / remove / reorder）
 *  - 每个参数的字段编辑（type / description / enum / items / required）
 *  - 内置参数模板（string/number/boolean/array/object/enum）
 *
 * 数据流：
 *  父组件持有 parameters 对象 → 传入 props.parameters + props.onChange
 *  子组件内部维护选中参数 key，所有修改通过 onChange 回调同步给父组件
 *
 * 设计要点：
 *  - 字体 ≥ 12px（遵守 UI 规则）
 *  - 树形结构支持一层嵌套（object.properties / array.items），后续可扩展
 *  - 必填字段通过 checkbox 控制，映射到 parameters.required 数组
 */
import { useState, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import type { ToolPropertySchema } from '@shared/protocols/modelProtocol'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from 'lucide-react'

// ==========================================
// Props 与类型
// ==========================================

/** 工具参数表（与 ToolDefinition.parameters 一致） */
export interface ToolParameters {
  type: 'object'
  properties: Record<string, ToolPropertySchema>
  required?: string[]
}

interface ToolParamEditorProps {
  /** 参数表数据 */
  parameters: ToolParameters
  /** 数据变更回调 */
  onChange: (next: ToolParameters) => void
  /** 只读模式（JSON 模式时禁用编辑） */
  readOnly?: boolean
}

// ==========================================
// 内置参数模板（B3）
// ==========================================

export type ParamTemplateKey =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum'

interface ParamTemplate {
  key: ParamTemplateKey
  label: string
  labelZh: string
  icon: string
  /** 基于模板创建参数 schema */
  create: () => ToolPropertySchema
}

export const PARAM_TEMPLATES: ParamTemplate[] = [
  {
    key: 'string',
    label: 'String',
    labelZh: '字符串',
    icon: 'Type',
    create: () => ({ type: 'string', description: '' }),
  },
  {
    key: 'number',
    label: 'Number',
    labelZh: '数字',
    icon: 'Hash',
    create: () => ({ type: 'number', description: '' }),
  },
  {
    key: 'boolean',
    label: 'Boolean',
    labelZh: '布尔',
    icon: 'ToggleLeft',
    create: () => ({ type: 'boolean', description: '' }),
  },
  {
    key: 'array',
    label: 'Array',
    labelZh: '数组',
    icon: 'List',
    create: () => ({ type: 'array', description: '', items: { type: 'string', description: '' } }),
  },
  {
    key: 'object',
    label: 'Object',
    labelZh: '对象',
    icon: 'Box',
    create: () => ({ type: 'object', description: '', properties: {} }),
  },
  {
    key: 'enum',
    label: 'Enum',
    labelZh: '枚举',
    icon: 'ListChecks',
    create: () => ({ type: 'string', description: '', enum: [] }),
  },
]

/** 根据模板 key 创建参数 schema */
export function createParamFromTemplate(key: ParamTemplateKey): ToolPropertySchema {
  const tpl = PARAM_TEMPLATES.find((t) => t.key === key)
  return tpl ? tpl.create() : PARAM_TEMPLATES[0].create()
}

// ==========================================
// 工具函数
// ==========================================

/** 生成默认参数名（param1, param2, ...）避免重名 */
function generateParamName(existingKeys: string[]): string {
  let i = 1
  while (existingKeys.includes(`param${i}`)) i++
  return `param${i}`
}

/** 判断参数是否为必填 */
function isRequired(parameters: ToolParameters, key: string): boolean {
  return (parameters.required ?? []).includes(key)
}

/** 设置参数必填状态 */
function setRequired(parameters: ToolParameters, key: string, required: boolean): ToolParameters {
  const current = new Set(parameters.required ?? [])
  if (required) current.add(key)
  else current.delete(key)
  const arr = Array.from(current)
  return { ...parameters, required: arr.length > 0 ? arr : undefined }
}

// ==========================================
// 主组件
// ==========================================

const ToolParamEditor: React.FC<ToolParamEditorProps> = ({
  parameters,
  onChange,
  readOnly = false,
}) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'

  // 展开的参数 key（用于树形折叠）
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  // 添加参数面板是否展开
  const [showTemplates, setShowTemplates] = useState(false)

  const propKeys = Object.keys(parameters.properties || {})
  const requiredArr = parameters.required ?? []

  // ==========================================
  // 参数操作
  // ==========================================

  /** 添加参数（基于模板） */
  const handleAddParam = useCallback(
    (templateKey: ParamTemplateKey) => {
      if (readOnly) return
      const newKey = generateParamName(propKeys)
      const schema = createParamFromTemplate(templateKey)
      const next: ToolParameters = {
        ...parameters,
        properties: { ...parameters.properties, [newKey]: schema },
      }
      onChange(next)
      setShowTemplates(false)
      // 自动展开新参数
      setExpandedKeys((prev) => new Set([...prev, newKey]))
    },
    [parameters, propKeys, onChange, readOnly],
  )

  /** 删除参数 */
  const handleRemoveParam = useCallback(
    (key: string) => {
      if (readOnly) return
      const nextProps = { ...parameters.properties }
      delete nextProps[key]
      const next: ToolParameters = {
        ...parameters,
        properties: nextProps,
      }
      // 同步移除 required
      onChange(setRequired(next, key, false))
      setExpandedKeys((prev) => {
        const n = new Set(prev)
        n.delete(key)
        return n
      })
    },
    [parameters, onChange, readOnly],
  )

  /** 重命名参数 */
  const handleRenameParam = useCallback(
    (oldKey: string, newKey: string) => {
      if (readOnly || !newKey || newKey === oldKey || propKeys.includes(newKey)) return
      const entries = Object.entries(parameters.properties)
      const reordered = entries.map(([k, v]) =>
        k === oldKey ? [newKey, v] : [k, v],
      ) as Array<[string, ToolPropertySchema]>
      const next: ToolParameters = {
        ...parameters,
        properties: Object.fromEntries(reordered),
      }
      // 同步 required 中的 oldKey → newKey
      if (requiredArr.includes(oldKey)) {
        const newRequired = requiredArr.map((r) => (r === oldKey ? newKey : r))
        next.required = newRequired
      }
      onChange(next)
      setExpandedKeys((prev) => {
        const n = new Set(prev)
        if (n.has(oldKey)) {
          n.delete(oldKey)
          n.add(newKey)
        }
        return n
      })
    },
    [parameters, propKeys, requiredArr, onChange, readOnly],
  )

  /** 上移参数 */
  const handleMoveUp = useCallback(
    (key: string) => {
      if (readOnly) return
      const idx = propKeys.indexOf(key)
      if (idx <= 0) return
      const entries = Object.entries(parameters.properties)
      ;[entries[idx - 1], entries[idx]] = [entries[idx], entries[idx - 1]]
      onChange({ ...parameters, properties: Object.fromEntries(entries) })
    },
    [parameters, propKeys, onChange, readOnly],
  )

  /** 下移参数 */
  const handleMoveDown = useCallback(
    (key: string) => {
      if (readOnly) return
      const idx = propKeys.indexOf(key)
      if (idx < 0 || idx >= propKeys.length - 1) return
      const entries = Object.entries(parameters.properties)
      ;[entries[idx], entries[idx + 1]] = [entries[idx + 1], entries[idx]]
      onChange({ ...parameters, properties: Object.fromEntries(entries) })
    },
    [parameters, propKeys, onChange, readOnly],
  )

  /** 切换参数必填状态 */
  const handleToggleRequired = useCallback(
    (key: string) => {
      if (readOnly) return
      onChange(setRequired(parameters, key, !isRequired(parameters, key)))
    },
    [parameters, onChange, readOnly],
  )

  /** 更新参数 schema */
  const handleUpdateSchema = useCallback(
    (key: string, patch: Partial<ToolPropertySchema>) => {
      if (readOnly) return
      const current = parameters.properties[key]
      if (!current) return
      const next: ToolParameters = {
        ...parameters,
        properties: {
          ...parameters.properties,
          [key]: { ...current, ...patch },
        },
      }
      onChange(next)
    },
    [parameters, onChange, readOnly],
  )

  /** 切换展开状态 */
  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }, [])

  // ==========================================
  // 渲染
  // ==========================================

  return (
    <div className="space-y-2">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-foreground/80">
          {t('builder.tools.params.title')}（{propKeys.length}）
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            {t('builder.tools.params.add')}
          </button>
        )}
      </div>

      {/* 参数模板选择面板 */}
      {showTemplates && !readOnly && (
        <div className="rounded border border-border bg-muted/30 p-2">
          <p className="mb-1.5 text-[12px] text-muted-foreground">
            {t('builder.tools.params.templateHint')}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {PARAM_TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => handleAddParam(tpl.key)}
                className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[12px] transition-colors hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
                title={isZh ? tpl.labelZh : tpl.label}
              >
                <span className="font-medium">{isZh ? tpl.labelZh : tpl.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 参数列表 */}
      {propKeys.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          {t('builder.tools.params.empty')}
        </div>
      ) : (
        <ul className="space-y-1">
          {propKeys.map((key, idx) => {
            const schema = parameters.properties[key]
            const expanded = expandedKeys.has(key)
            const required = isRequired(parameters, key)
            const isFirst = idx === 0
            const isLast = idx === propKeys.length - 1
            return (
              <li key={key} className="rounded border border-border/80 bg-background">
                {/* 参数行 */}
                <div className="flex items-center gap-1 px-2 py-1.5">
                  {/* 展开/折叠按钮（仅对象/数组可展开） */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(key)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    disabled={schema.type !== 'object' && schema.type !== 'array'}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </button>

                  {/* 拖拽指示符（仅视觉，不实现真正的拖拽） */}
                  <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />

                  {/* 参数名输入 */}
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => {
                      // 实时校验：不允许与现有 key 冲突
                      const v = e.target.value
                      if (v && !propKeys.includes(v)) {
                        handleRenameParam(key, v)
                      }
                    }}
                    disabled={readOnly}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[12px] outline-none focus:border-accent/50 focus:bg-background"
                  />

                  {/* 类型徽章 */}
                  <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent">
                    {schema.type}
                  </span>

                  {/* 必填 checkbox */}
                  <label className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={required}
                      onChange={() => handleToggleRequired(key)}
                      disabled={readOnly}
                      className="h-3 w-3"
                    />
                    <span>{t('builder.tools.params.required')}</span>
                  </label>

                  {/* 上移 / 下移 / 删除 */}
                  {!readOnly && (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => handleMoveUp(key)}
                        disabled={isFirst}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                        title={t('builder.tools.params.moveUp')}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(key)}
                        disabled={isLast}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                        title={t('builder.tools.params.moveDown')}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveParam(key)}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title={t('builder.tools.params.remove')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 展开后的字段编辑区 */}
                {expanded && (
                  <div className="space-y-2 border-t border-border/60 px-2 py-2">
                    {/* 类型选择 + description */}
                    <div className="flex items-center gap-2">
                      <label className="w-16 shrink-0 text-[12px] text-muted-foreground">
                        {t('builder.tools.params.type')}
                      </label>
                      <select
                        value={schema.type}
                        onChange={(e) => {
                          const newType = e.target.value
                          // 类型切换时根据新类型重置 schema（保留 description）
                          const desc = schema.description || ''
                          if (newType === 'array') {
                            handleUpdateSchema(key, {
                              type: 'array',
                              description: desc,
                              items: { type: 'string', description: '' },
                              enum: undefined,
                              properties: undefined,
                            })
                          } else if (newType === 'object') {
                            handleUpdateSchema(key, {
                              type: 'object',
                              description: desc,
                              properties: {},
                              enum: undefined,
                              items: undefined,
                            })
                          } else if (newType === 'enum') {
                            handleUpdateSchema(key, {
                              type: 'string',
                              description: desc,
                              enum: schema.enum && schema.enum.length > 0 ? schema.enum : ['option1'],
                              items: undefined,
                              properties: undefined,
                            })
                          } else {
                            handleUpdateSchema(key, {
                              type: newType,
                              description: desc,
                              enum: undefined,
                              items: undefined,
                              properties: undefined,
                            })
                          }
                        }}
                        disabled={readOnly}
                        className="flex-1 rounded border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-accent/50"
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                        <option value="array">array</option>
                        <option value="object">object</option>
                        <option value="enum">enum (string + enum)</option>
                      </select>
                    </div>

                    {/* description */}
                    <div className="flex items-start gap-2">
                      <label className="w-16 shrink-0 pt-1 text-[12px] text-muted-foreground">
                        {t('builder.tools.params.description')}
                      </label>
                      <textarea
                        value={schema.description ?? ''}
                        onChange={(e) => handleUpdateSchema(key, { description: e.target.value })}
                        disabled={readOnly}
                        rows={2}
                        placeholder={isZh ? '参数描述（AI 可读）' : 'Parameter description (AI-readable)'}
                        className="flex-1 resize-y rounded border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-accent/50"
                      />
                    </div>

                    {/* enum 值编辑（仅 enum 类型显示） */}
                    {schema.type === 'string' && schema.enum !== undefined && (
                      <div className="flex items-start gap-2">
                        <label className="w-16 shrink-0 pt-1 text-[12px] text-muted-foreground">
                          enum
                        </label>
                        <div className="flex-1 space-y-1">
                          {(schema.enum ?? []).map((val, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <input
                                type="text"
                                value={val}
                                onChange={(e) => {
                                  const next = [...(schema.enum ?? [])]
                                  next[i] = e.target.value
                                  handleUpdateSchema(key, { enum: next })
                                }}
                                disabled={readOnly}
                                className="flex-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[12px] outline-none focus:border-accent/50"
                              />
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = (schema.enum ?? []).filter((_, j) => j !== i)
                                    handleUpdateSchema(key, { enum: next })
                                  }}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ))}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...(schema.enum ?? []), 'newOption']
                                handleUpdateSchema(key, { enum: next })
                              }}
                              className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-accent"
                            >
                              <Plus className="h-3 w-3" />
                              {t('builder.tools.params.addEnum')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* array items 编辑（仅 array 类型显示） */}
                    {schema.type === 'array' && schema.items && (
                      <div className="rounded border border-border/60 bg-muted/20 p-2">
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                          {t('builder.tools.params.items')}
                        </p>
                        <div className="flex items-center gap-2">
                          <label className="w-12 shrink-0 text-[12px] text-muted-foreground">
                            type
                          </label>
                          <select
                            value={schema.items.type}
                            onChange={(e) =>
                              handleUpdateSchema(key, {
                                items: { ...schema.items!, type: e.target.value, description: schema.items!.description || '' },
                              })
                            }
                            disabled={readOnly}
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-accent/50"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                          </select>
                        </div>
                        <div className="mt-1 flex items-start gap-2">
                          <label className="w-12 shrink-0 pt-1 text-[12px] text-muted-foreground">
                            desc
                          </label>
                          <input
                            type="text"
                            value={schema.items.description ?? ''}
                            onChange={(e) =>
                              handleUpdateSchema(key, {
                                items: { ...schema.items!, description: e.target.value },
                              })
                            }
                            disabled={readOnly}
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-accent/50"
                          />
                        </div>
                      </div>
                    )}

                    {/* object 子属性编辑（仅 object 类型显示，简化版仅一层） */}
                    {schema.type === 'object' && (
                      <div className="rounded border border-border/60 bg-muted/20 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {t('builder.tools.params.properties')}
                          </p>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => {
                                const subProps = { ...(schema.properties ?? {}) }
                                let i = 1
                                while (subProps[`field${i}`]) i++
                                subProps[`field${i}`] = { type: 'string', description: '' } as ToolPropertySchema
                                handleUpdateSchema(key, { properties: subProps })
                              }}
                              className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" />
                              {t('builder.tools.params.addField')}
                            </button>
                          )}
                        </div>
                        {Object.keys(schema.properties ?? {}).length === 0 ? (
                          <p className="text-[12px] text-muted-foreground/60">
                            {t('builder.tools.params.noFields')}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(schema.properties ?? {}).map(([subKey, subSchema]) => (
                              <div key={subKey} className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={subKey}
                                  disabled={readOnly}
                                  onChange={(e) => {
                                    const newSubKey = e.target.value
                                    if (!newSubKey || subKey === newSubKey) return
                                    const entries = Object.entries(schema.properties ?? {})
                                    const idx = entries.findIndex(([k]) => k === subKey)
                                    if (idx >= 0 && !entries.find(([k]) => k === newSubKey)) {
                                      entries[idx] = [newSubKey, subSchema]
                                      handleUpdateSchema(key, { properties: Object.fromEntries(entries) })
                                    }
                                  }}
                                  className="w-24 shrink-0 rounded border border-transparent bg-background px-1 py-0.5 font-mono text-[12px] outline-none focus:border-accent/50"
                                />
                                <select
                                  value={subSchema.type}
                                  disabled={readOnly}
                                  onChange={(e) => {
                                    const subProps = { ...(schema.properties ?? {}) }
                                    subProps[subKey] = { ...subSchema, type: e.target.value }
                                    handleUpdateSchema(key, { properties: subProps })
                                  }}
                                  className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-[12px] outline-none focus:border-accent/50"
                                >
                                  <option value="string">string</option>
                                  <option value="number">number</option>
                                  <option value="boolean">boolean</option>
                                </select>
                                <input
                                  type="text"
                                  value={subSchema.description ?? ''}
                                  disabled={readOnly}
                                  onChange={(e) => {
                                    const subProps = { ...(schema.properties ?? {}) }
                                    subProps[subKey] = { ...subSchema, description: e.target.value }
                                    handleUpdateSchema(key, { properties: subProps })
                                  }}
                                  placeholder="desc"
                                  className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-[12px] outline-none focus:border-accent/50"
                                />
                                {!readOnly && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const subProps = { ...(schema.properties ?? {}) }
                                      delete subProps[subKey]
                                      handleUpdateSchema(key, { properties: subProps })
                                    }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ToolParamEditor

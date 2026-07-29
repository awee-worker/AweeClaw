/**
 * PluginConfigForm - 插件用户配置表单
 *
 * 用途：
 *  - 安装时填写必填配置（强校验）
 *  - 已安装插件详情中编辑配置
 *
 * 设计原则：
 *  - 纯受控组件（value + onChange），由父组件持有状态
 *  - 支持所有 configSchema 字段类型：text / password / number / boolean / select / multiselect
 *  - 自动注入 defaultValue（仅当用户未填写时）
 *  - 暴露 validate() 方法用于外部触发表单校验
 *  - secret 字段以密码框渲染，避免明文可见
 */
import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { type Language } from '@renderer/i18n/i18nSetup'
import { useStore } from '@store'

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 单个配置字段定义（来自 manifest.configSchema.fields） */
export interface PluginConfigField {
  key: string
  label?: string
  labelZh?: string
  description?: string
  descriptionZh?: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect'
  required?: boolean
  secret?: boolean
  defaultValue?: string
  placeholder?: string
  options?: Array<{ value: string; label?: string; labelZh?: string }>
  /**
   * 条件显示规则：当依赖字段的值满足条件时才显示本字段。
   * 用于实现"选择服务商后只显示该服务商的配置项"等动态表单场景。
   * 未设置时字段始终显示。
   */
  visibleWhen?: {
    /** 依赖的字段 key（如 'provider'） */
    field: string
    /** 当依赖字段值等于此值时显示（与 in 互斥，equals 优先） */
    equals?: string
    /** 当依赖字段值在此列表中时显示（与 equals 互斥） */
    in?: string[]
  }
}

/** configSchema 完整结构 */
export interface PluginConfigSchema {
  fields?: PluginConfigField[]
}

/** 表单值：键 → 字符串（boolean 类型以 'true'/'false' 表示；multiselect 以逗号分隔） */
export type PluginConfigValues = Record<string, string>

/** 暴露给父组件的命令式 API */
export interface PluginConfigFormHandle {
  /** 触发完整校验，返回是否通过；不通过时会在 UI 上展示错误 */
  validate: () => boolean
  /** 获取当前所有字段的值（含 defaultValue 注入） */
  getValues: () => PluginConfigValues
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/** 检测系统是否为中文环境 */
function useIsZh(): boolean {
  const language = useStore((s) => s.language) as Language
  return language === 'zh'
}

/** 将字段定义转为初始值（用户值优先，否则使用 defaultValue） */
export function buildInitialValues(
  fields: PluginConfigField[],
  userValues?: PluginConfigValues,
): PluginConfigValues {
  const result: PluginConfigValues = {}
  for (const f of fields) {
    const v = userValues?.[f.key]
    if (v !== undefined && v !== '') {
      result[f.key] = v
    } else if (f.defaultValue !== undefined) {
      result[f.key] = f.defaultValue
    } else {
      result[f.key] = ''
    }
  }
  return result
}

/** 校验字段：返回错误消息（通过则返回空串） */
function validateField(field: PluginConfigField, value: string, isZh: boolean): string {
  if (field.required && !value.trim()) {
    const name = isZh ? field.labelZh || field.label || field.key : field.label || field.key
    return isZh ? `${name} 为必填项` : `${name} is required`
  }
  if (field.type === 'number' && value && Number.isNaN(Number(value))) {
    const name = isZh ? field.labelZh || field.label || field.key : field.label || field.key
    return isZh ? `${name} 必须为数字` : `${name} must be a number`
  }
  return ''
}

/**
 * 判断字段是否可见（基于 visibleWhen 条件 + 当前表单值）。
 * 未设置 visibleWhen 的字段始终可见。
 */
function isFieldVisible(field: PluginConfigField, values: PluginConfigValues): boolean {
  if (!field.visibleWhen) return true
  const depValue = values[field.visibleWhen.field] ?? ''
  if (field.visibleWhen.equals !== undefined) {
    return depValue === field.visibleWhen.equals
  }
  if (field.visibleWhen.in !== undefined) {
    return field.visibleWhen.in.includes(depValue)
  }
  return true
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

interface Props {
  /** configSchema 中的字段列表 */
  fields: PluginConfigField[]
  /** 当前表单值 */
  value: PluginConfigValues
  /** 值变更回调 */
  onChange: (next: PluginConfigValues) => void
  /** 是否禁用所有字段（如保存中） */
  disabled?: boolean
  /** 字段错误信息（外部传入，key → 错误消息）；与内部校验合并展示 */
  externalErrors?: Record<string, string>
}

/** 密码字段可见性状态 */
interface FieldVisibilityState {
  [key: string]: boolean
}

const PluginConfigForm = forwardRef<PluginConfigFormHandle, Props>(function PluginConfigForm(
  { fields, value, onChange, disabled = false, externalErrors = {} },
  ref,
) {
  const isZh = useIsZh()
  const [visibility, setVisibility] = useState<FieldVisibilityState>({})

  // 字段标签/描述本地化
  const labelOf = (f: PluginConfigField): string =>
    isZh ? f.labelZh || f.label || f.key : f.label || f.key
  const descOf = (f: PluginConfigField): string | undefined =>
    isZh ? f.descriptionZh || f.description : f.description

  // 计算每个字段的错误（外部优先，否则用内部校验）
  // 不可见字段（visibleWhen 不满足）跳过 required 校验，避免隐藏的必填项阻断提交
  const errors = useMemo(() => {
    const map: Record<string, string> = {}
    for (const f of fields) {
      // 不可见字段不参与校验
      if (!isFieldVisible(f, value)) continue
      const ext = externalErrors[f.key]
      if (ext) {
        map[f.key] = ext
      } else {
        const v = value[f.key] ?? ''
        const err = validateField(f, v, isZh)
        if (err) map[f.key] = err
      }
    }
    return map
  }, [fields, value, externalErrors, isZh])

  // 暴露命令式 API
  useImperativeHandle(ref, () => ({
    validate: () => Object.values(errors).every((e) => !e),
    getValues: () => ({ ...value }),
  }))

  /** 单字段值变更 */
  const updateField = (key: string, v: string) => {
    onChange({ ...value, [key]: v })
  }

  /** 切换密码可见性 */
  const toggleVisibility = (key: string) => {
    setVisibility((s) => ({ ...s, [key]: !s[key] }))
  }

  // 过滤出可见字段（visibleWhen 条件满足的字段）
  const visibleFields = fields.filter((f) => isFieldVisible(f, value))

  if (fields.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {isZh ? '此插件无需配置项' : 'No configuration required'}
      </div>
    )
  }

  if (visibleFields.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {isZh ? '请先选择上方选项以显示配置项' : 'Select an option above to reveal config fields'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {visibleFields.map((field) => {
        const v = value[field.key] ?? ''
        const err = errors[field.key]
        const desc = descOf(field)
        const isPassword = field.type === 'password' || field.secret === true
        const showPlain = visibility[field.key] === true

        return (
          <div key={field.key} className="space-y-1.5">
            <label className="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              <span>{labelOf(field)}</span>
              {field.required && <span className="text-red-500">*</span>}
            </label>

            {desc && <p className="text-xs text-zinc-500 dark:text-zinc-400">{desc}</p>}

            {/* 不同类型控件 */}
            {field.type === 'boolean' ? (
              <select
                value={v || 'false'}
                disabled={disabled}
                onChange={(e) => updateField(field.key, e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="false">{isZh ? '否' : 'No'}</option>
                <option value="true">{isZh ? '是' : 'Yes'}</option>
              </select>
            ) : field.type === 'select' || field.type === 'multiselect' ? (
              <select
                value={v}
                disabled={disabled}
                multiple={field.type === 'multiselect'}
                onChange={(e) => {
                  if (field.type === 'multiselect') {
                    const selected = Array.from(e.target.selectedOptions).map((o) => o.value)
                    updateField(field.key, selected.join(','))
                  } else {
                    updateField(field.key, e.target.value)
                  }
                }}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {field.type === 'select' && !field.required && <option value="">—</option>}
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {isZh ? opt.labelZh || opt.label || opt.value : opt.label || opt.value}
                  </option>
                ))}
              </select>
            ) : (
              <div className="relative">
                <input
                  type={
                    isPassword && !showPlain
                      ? 'password'
                      : field.type === 'number'
                        ? 'number'
                        : 'text'
                  }
                  value={v}
                  disabled={disabled}
                  placeholder={field.placeholder}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={`w-full rounded-md border bg-white px-3 py-2 pr-10 text-sm transition-colors dark:bg-zinc-900 dark:text-zinc-100 ${
                    err
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-zinc-300 focus:border-blue-500 dark:border-zinc-700'
                  } focus:outline-none focus:ring-1 focus:ring-blue-500/40`}
                />
                {isPassword && (
                  <button
                    type="button"
                    onClick={() => toggleVisibility(field.key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    tabIndex={-1}
                  >
                    {showPlain ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            )}

            {err && <p className="text-xs text-red-500">{err}</p>}
          </div>
        )
      })}
    </div>
  )
})

export default PluginConfigForm

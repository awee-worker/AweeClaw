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
import { createPortal } from 'react-dom'
import { Eye, EyeOff, Loader2, Search, X } from 'lucide-react'
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
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect' | 'action'
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
  /** action 类型专属：按钮触发的动作（目前仅支持 fetchModels） */
  action?: 'fetchModels'
  /** action 类型专属：选择后填入的目标字段 key */
  targetField?: string
  /** action 类型专属：按钮文字（英文） */
  buttonText?: string
  /** action 类型专属：按钮文字（中文） */
  buttonTextZh?: string
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

/**
 * 预设模型列表兜底：当 fetchModels IPC 失败或服务商不支持 /v1/models 端点时使用。
 * 用于 Stability AI / 通义万相等非 OpenAI 兼容协议的服务商。
 */
const PRESET_MODELS: Record<string, string[]> = {
  stability: ['sd3', 'sd3.5-medium', 'sdxl'],
  wanxiang: ['wan2.2-t2i-flash', 'wan2.2-t2i-plus', 'wan2.1-t2i-turbo', 'wanx2.1-t2i-turbo'],
  dalle3: ['dall-e-3', 'gpt-image-1'],
  'openai-compatible': ['dall-e-3', 'gpt-image-1', 'dall-e-2'],
}

function getPresetModels(provider: string): string[] {
  return PRESET_MODELS[provider] || []
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
  // action 字段加载状态：key → loading
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  // 模型选择弹窗：{ field, models, query }
  const [modelPicker, setModelPicker] = useState<{
    field: PluginConfigField
    models: string[]
    query: string
    isPreset: boolean
  } | null>(null)

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

  /**
   * 处理 action 字段点击（目前仅支持 fetchModels 动作）
   *
   * 流程：
   * 1. 从当前表单值读取 provider / apiKey / baseUrl
   * 2. 调用已有的 fetchModels IPC 通道（providerMonitor.ts:321）
   * 3. 成功且非空 → 弹出列表供选择
   * 4. 失败或空 → 降级到预设列表（getPresetModels）
   */
  async function handleAction(field: PluginConfigField) {
    if (field.action !== 'fetchModels') return
    if (!field.targetField) return

    setActionLoading((s) => ({ ...s, [field.key]: true }))
    try {
      // 从表单值读取当前 provider 和对应凭据
      const provider = value.provider || ''
      // provider 名对应 config 中的字段前缀，如 dalle3 → openai_api_key / openai_base_url
      const apiKeyByProvider: Record<string, string> = {
        dalle3: value.openai_api_key || '',
        stability: value.stability_api_key || '',
        wanxiang: value.dashscope_api_key || '',
        'openai-compatible': value.openai_compatible_api_key || '',
      }
      const baseUrlByProvider: Record<string, string> = {
        dalle3: value.openai_base_url || 'https://api.openai.com/v1',
        stability: '',
        wanxiang: '',
        'openai-compatible': value.openai_compatible_base_url || 'https://api.openai.com/v1',
      }
      const apiKey = apiKeyByProvider[provider] || ''
      const baseUrl = baseUrlByProvider[provider] || ''

      // 调用已有 IPC：window.electronAPI.fetchModels(provider, apiKey, baseUrl, protocol?)
      const electronAPI = (window as unknown as { electronAPI?: { fetchModels?: (p: string, k: string, b?: string, pr?: string) => Promise<{ success: boolean; models?: string[]; error?: string }> } }).electronAPI
      let models: string[] = []
      let isPreset = false

      if (electronAPI?.fetchModels && apiKey) {
        const result = await electronAPI.fetchModels(provider, apiKey, baseUrl, undefined)
        if (result.success && result.models && result.models.length > 0) {
          models = result.models
        }
      }

      // 降级：IPC 不可用 / 失败 / 返回空 → 使用预设列表
      if (models.length === 0) {
        models = getPresetModels(provider)
        isPreset = true
      }

      if (models.length === 0) {
        // 没有任何模型可用，提示错误
        const errMsg = isZh ? '未获取到模型列表，请检查 API Key 或手动填写模型名' : 'No models fetched, check API Key or enter model name manually'
        window.alert(errMsg)
        return
      }

      // 弹出模型选择列表
      setModelPicker({ field, models, query: '', isPreset })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 出错时也尝试降级到预设
      const provider = value.provider || ''
      const presets = getPresetModels(provider)
      if (presets.length > 0) {
        setModelPicker({ field, models: presets, query: '', isPreset: true })
      } else {
        window.alert(isZh ? `获取模型失败: ${msg}` : `Fetch models failed: ${msg}`)
      }
    } finally {
      setActionLoading((s) => ({ ...s, [field.key]: false }))
    }
  }

  /** 从模型选择弹窗中选定模型，填入目标字段 */
  const pickModel = (model: string) => {
    if (!modelPicker) return
    const targetField = modelPicker.field.targetField
    if (targetField) {
      updateField(targetField, model)
    }
    setModelPicker(null)
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
            ) : field.type === 'action' ? (
              <button
                type="button"
                disabled={disabled || actionLoading[field.key]}
                onClick={() => handleAction(field)}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {actionLoading[field.key] && <Loader2 size={14} className="animate-spin" />}
                {actionLoading[field.key]
                  ? (isZh ? '获取中...' : 'Fetching...')
                  : (isZh ? field.buttonTextZh || field.buttonText || '获取模型' : field.buttonText || 'Fetch Models')}
              </button>
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

      {/* 模型选择弹窗 — 通过 createPortal 渲染到 body，避免被父容器 overflow 截断 */}
      {modelPicker &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setModelPicker(null)}
          >
            <div
              className="flex max-h-80 w-96 flex-col rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  {isZh ? '选择模型' : 'Select Model'}
                </h3>
                <button
                  type="button"
                  onClick={() => setModelPicker(null)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 来源提示：预设列表时告知用户 */}
              {modelPicker.isPreset && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                  {isZh
                    ? '未能从服务商 API 获取（可能不支持 /v1/models），以下为预设模型列表'
                    : 'Could not fetch from API (provider may not support /v1/models). Showing preset list:'}
                </p>
              )}

              {/* 搜索框 */}
              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type="text"
                  value={modelPicker.query}
                  onChange={(e) =>
                    setModelPicker({ ...modelPicker, query: e.target.value })
                  }
                  placeholder={isZh ? '搜索模型...' : 'Search models...'}
                  className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  autoFocus
                />
              </div>

              {/* 模型列表 */}
              <div className="flex-1 space-y-1 overflow-auto">
                {modelPicker.models
                  .filter((m) =>
                    modelPicker.query
                      ? m.toLowerCase().includes(modelPicker.query.toLowerCase())
                      : true,
                  )
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="w-full rounded px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      onClick={() => pickModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                {modelPicker.models.filter((m) =>
                  modelPicker.query
                    ? m.toLowerCase().includes(modelPicker.query.toLowerCase())
                    : true,
                ).length === 0 && (
                  <p className="py-4 text-center text-xs text-zinc-500">
                    {isZh ? '无匹配模型' : 'No matching models'}
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
})

export default PluginConfigForm

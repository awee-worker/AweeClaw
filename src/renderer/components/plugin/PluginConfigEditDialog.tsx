/**
 * PluginConfigEditDialog - 已安装插件配置编辑对话框
 *
 * 用途：
 *  - 在"已安装插件"列表中，点击插件的"配置"按钮打开
 *  - 用户可修改 {{config.KEY}} 模板变量对应的值
 *  - 保存后会触发后端 MCP 服务重连（若该插件是 MCP 型）
 *
 * 数据流：
 *   读取 ← pluginService.getPluginConfig(pluginKey) → IPC(plugin:getConfig)
 *   保存 ← pluginService.savePluginConfig(pluginKey, values) → IPC(plugin:saveConfig)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2, Save, CheckCircle2 } from 'lucide-react'
import { useStore } from '@store'
import { toast } from '../foundation/NotificationProvider'
import { getPluginConfig, savePluginConfig } from '@services/pluginService'
import PluginConfigForm, {
  buildInitialValues,
  type PluginConfigField,
  type PluginConfigFormHandle,
  type PluginConfigValues,
} from './PluginConfigForm'
import { type Language } from '@renderer/i18n'

interface Props {
  /** 是否显示 */
  open: boolean
  /** 插件 key（用于读写配置） */
  pluginKey: string
  /** 插件名称（用于标题） */
  pluginName: string
  /** configSchema 中的字段列表（来自本地 manifest） */
  fields: PluginConfigField[]
  /** 关闭对话框 */
  onClose: () => void
}

export function PluginConfigEditDialog({
  open,
  pluginKey,
  pluginName,
  fields,
  onClose,
}: Props) {
  const language = useStore((s) => s.language) as Language
  const isZh = language === 'zh'
  const formRef = useRef<PluginConfigFormHandle>(null)

  const [values, setValues] = useState<PluginConfigValues>(() => buildInitialValues(fields))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [savedAt, setSavedAt] = useState<number | undefined>()

  // 加载已有配置
  useEffect(() => {
    if (!open || !pluginKey) return
    let cancelled = false
    setLoading(true)
    setError(undefined)
    getPluginConfig(pluginKey)
      .then((saved) => {
        if (cancelled) return
        // 合并：已保存值优先，否则用 defaultValue
        setValues(buildInitialValues(fields, saved))
      })
      .catch((err) => {
        if (cancelled) return
        setError(isZh ? `加载配置失败：${err}` : `Failed to load config: ${err}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pluginKey])

  // 字段变化时重置初始值
  useEffect(() => {
    if (open) setValues(buildInitialValues(fields))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, open])

  // 是否有任何字段（无字段则不展示表单）
  const hasFields = fields.length > 0

  // 是否有未保存改动
  const isDirty = useMemo(() => {
    const initial = buildInitialValues(fields)
    for (const f of fields) {
      if ((values[f.key] ?? '') !== (initial[f.key] ?? '')) return true
    }
    return false
  }, [fields, values])

  /** Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, saving, onClose])

  /** 保存配置 */
  const handleSave = async () => {
    const form = formRef.current
    if (!form) return
    if (!form.validate()) {
      setError(isZh ? '请检查必填项' : 'Please check required fields')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const result = await savePluginConfig(pluginKey, form.getValues())
      if (result.success) {
        setSavedAt(Date.now())
        toast.success(
          isZh
            ? `配置已保存${result.reconnected ? '，MCP 服务已重连' : ''}`
            : `Config saved${result.reconnected ? ', MCP service reconnected' : ''}`,
        )
      } else {
        setError(result.error || (isZh ? '保存失败' : 'Save failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-[480px] max-w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {pluginName} - {isZh ? '配置' : 'Settings'}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {isZh
                ? '修改配置后保存将自动重启插件 MCP 服务'
                : 'Saving will automatically restart the plugin MCP service'}
            </p>
          </div>
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
          ) : hasFields ? (
            <PluginConfigForm
              ref={formRef}
              fields={fields}
              value={values}
              onChange={setValues}
              disabled={saving}
            />
          ) : (
            <div className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {isZh ? '此插件无需配置项' : 'No configuration required'}
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-5 mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 成功提示（短暂） */}
        {savedAt && !error && (
          <div className="mx-5 mb-3 flex items-center gap-1.5 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-600 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400">
            <CheckCircle2 size={14} />
            {isZh ? '已保存' : 'Saved'}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="rounded-md border border-zinc-300 px-3.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {isZh ? '关闭' : 'Close'}
          </button>
          {hasFields && (
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? (isZh ? '保存中...' : 'Saving...') : isZh ? '保存' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default PluginConfigEditDialog

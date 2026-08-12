/**
 * PluginInstallConfigDialog - 安装时插件配置对话框
 *
 * 使用场景：
 *  - 用户在插件市场点击"安装"时，如果该插件声明了 configSchema.fields
 *    且其中存在 required 字段（必填），则弹出此对话框让用户填写
 *  - 全部字段为可选时，直接安装（不弹窗）
 *
 * 交互：
 *  - 用户填写表单 → 点击"安装" → 校验通过 → 调用 onConfirm(values)
 *  - 取消则关闭对话框，不触发安装
 *
 * 注意：扫码登录渠道（如微信）的流程是先安装插件再扫码，
 *       扫码逻辑见 PluginQrLoginModal 组件。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import PluginConfigForm, {
  buildInitialValues,
  type PluginConfigField,
  type PluginConfigFormHandle,
  type PluginConfigValues,
} from './PluginConfigForm'

interface Props {
  /** 是否显示 */
  open: boolean
  /** 插件名称（用于标题） */
  pluginName: string
  /** configSchema 中的字段列表 */
  fields: PluginConfigField[]
  /** 已有配置（升级/重装时回填） */
  initialValues?: PluginConfigValues
  /** 是否正在安装中（禁用按钮 + loading） */
  loading?: boolean
  /** 错误信息（来自安装失败的回显） */
  error?: string
  /** 确认安装，传回用户填写的配置 */
  onConfirm: (values: PluginConfigValues) => void
  /** 取消 */
  onCancel: () => void
}

export function PluginInstallConfigDialog({
  open,
  pluginName,
  fields,
  initialValues,
  loading = false,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const formRef = useRef<PluginConfigFormHandle>(null)
  const [values, setValues] = useState<PluginConfigValues>(() =>
    buildInitialValues(fields, initialValues),
  )

  // 字段或 initialValues 变化时重置
  useEffect(() => {
    if (open) {
      setValues(buildInitialValues(fields, initialValues))
    }
  }, [open, fields, initialValues])

  // 是否有必填字段（无则不应弹出此对话框，由父组件控制）
  const hasRequired = useMemo(
    () => fields.some((f) => f.required),
    [fields],
  )

  /** 提交：触发校验并回调 */
  const handleConfirm = () => {
    const form = formRef.current
    if (!form) return
    if (!form.validate()) return
    onConfirm(form.getValues())
  }

  /** Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, loading, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="w-[480px] max-w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {pluginName} - 配置
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              请填写插件所需的配置参数，安装后可在插件详情中修改
            </p>
          </div>
          <button
            onClick={() => !loading && onCancel()}
            disabled={loading}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {fields.length > 0 && (
            <PluginConfigForm
              ref={formRef}
              fields={fields}
              value={values}
              onChange={setValues}
              disabled={loading}
            />
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-5 mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-zinc-300 px-3.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? '安装中...' : hasRequired ? '安装' : '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 扫码登录 Modal（qrLogin 渠道安装成功后弹出） ───────────

/**
 * PluginQrLoginModal - 插件安装后的扫码登录对话框
 *
 * 使用场景：
 *  - qrLogin 渠道插件（如微信）安装成功后弹出
 *  - 插件已注册到 channelRegistry，fetchQRCode/pollQRStatus 可正常调用
 *  - 扫码成功后回调 onSuccess(token, baseUrl)，由父组件创建账户并连接
 *  - 用户可跳过扫码（关闭对话框），后续在设置→渠道中扫码
 */
import { QRLoginView } from '../settings/tabs/QRLoginView'
import type { Language } from '@renderer/i18n'

interface QrLoginModalProps {
  /** 插件名称（用于标题） */
  pluginName: string
  /** 渠道 ID（如 weixin） */
  channelId: string
  /** 语言 */
  language: Language
  /** 是否正在创建账户（禁用关闭） */
  addingAccount: boolean
  /** 扫码成功回调 */
  onSuccess: (token: string, baseUrl: string) => void
  /** 取消/跳过 */
  onCancel: () => void
}

export function PluginQrLoginModal({
  pluginName,
  channelId,
  language,
  addingAccount,
  onSuccess,
  onCancel,
}: QrLoginModalProps) {
  /** Esc 关闭 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !addingAccount) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [addingAccount, onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => !addingAccount && onCancel()}
    >
      <div
        className="w-[420px] max-w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {pluginName} - {language === 'zh' ? '扫码登录' : 'QR Login'}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {language === 'zh'
                ? '插件已安装，请扫码登录以连接账户'
                : 'Plugin installed, scan QR code to connect account'}
            </p>
          </div>
          <button
            onClick={() => !addingAccount && onCancel()}
            disabled={addingAccount}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* 扫码登录组件 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <QRLoginView
            channelId={channelId as any}
            language={language === 'zh' ? 'zh' : 'en'}
            onLoginSuccess={onSuccess}
          />
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={onCancel}
            disabled={addingAccount}
            className="rounded-md border border-zinc-300 px-3.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {addingAccount
              ? language === 'zh' ? '连接中...' : 'Connecting...'
              : language === 'zh' ? '跳过，稍后设置' : 'Skip, set up later'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PluginInstallConfigDialog

/**
 * 微信个人号 QR 码扫码登录组件
 *
 * 流程：获取 QR 码 → 展示二维码 → 轮询扫码状态 → 确认后自动保存 Token
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { QrCode, Smartphone, Check, RefreshCw, X, Loader2 } from 'lucide-react'
import { ActionButton } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { getAPI } from '../../../adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import QRCode from 'qrcode'

type QRState = 'idle' | 'loading' | 'showing' | 'success' | 'error'

interface WeixinQRLoginProps {
  language: 'en' | 'zh'
  onLoginSuccess: (token: string, baseUrl: string) => void
}

export function WeixinQRLogin({ language, onLoginSuccess }: WeixinQRLoginProps) {
  const api = getAPI()
  const [qrState, setQrState] = useState<QRState>('idle')
  const [qrImageDataUrl, setQrImageDataUrl] = useState('')
  const [pollStatus, setPollStatus] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isStarting, setIsStarting] = useState(false)

  // 使用 ref 管理轮询状态，避免闭包陈旧问题
  const abortedRef = useRef(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const languageRef = useRef(language)
  const onLoginSuccessRef = useRef(onLoginSuccess)

  // 同步 ref
  useEffect(() => { languageRef.current = language }, [language])
  useEffect(() => { onLoginSuccessRef.current = onLoginSuccess }, [onLoginSuccess])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      abortedRef.current = true
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
      }
    }
  }, [])

  /** 单次轮询 */
  const pollOnce = useCallback(async (code: string) => {
    if (abortedRef.current) return

    try {
      const result = await api.channel.weixinPollQRStatus(code)
      if (!result.success) {
        throw new Error(result.error || 'Poll failed')
      }

      const status = (result.status || '').trim().toLowerCase()
      setPollStatus(status)

      switch (status) {
        case 'confirmed':
          setQrState('success')
          toast.success(t('settings.wechatloginsuccess', languageRef.current as Language) || 'Login successful')
          if (result.bot_token) {
            onLoginSuccessRef.current(result.bot_token, result.baseurl || 'https://ilinkai.weixin.qq.com')
          }
          return // 停止轮询
        case 'expired':
          return // 停止轮询，用户需重新获取
        case 'wait':
        case 'scanned':
          if (!abortedRef.current) {
            pollTimerRef.current = setTimeout(() => pollOnce(code), 1500)
          }
          return
        default:
          // 未知状态，继续轮询
          if (!abortedRef.current) {
            pollTimerRef.current = setTimeout(() => pollOnce(code), 2000)
          }
      }
    } catch {
      if (!abortedRef.current) {
        pollTimerRef.current = setTimeout(() => pollOnce(code), 3000)
      }
    }
  }, [api]) // 仅依赖 api，其余通过 ref 访问

  /** 开始扫码登录 */
  const startLogin = useCallback(async () => {
    // 清理上一次轮询
    abortedRef.current = true
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }

    abortedRef.current = false
    setIsStarting(true)
    setErrorMessage('')
    setPollStatus('')
    setQrImageDataUrl('')

    try {
      const result = await api.channel.weixinFetchQRCode()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch QR code')
      }

      const qrContent = result.qrcode_img_content || result.qrcode || ''
      if (!qrContent) {
        throw new Error('No QR code data returned')
      }

      const code = result.qrcode || ''
      const dataUrl = await QRCode.toDataURL(qrContent, { width: 208, margin: 1 })
      setQrImageDataUrl(dataUrl)
      setQrState('showing')

      // 启动轮询
      pollOnce(code)
    } catch (err: any) {
      setErrorMessage(err?.message || String(err))
      setQrState('error')
    } finally {
      setIsStarting(false)
    }
  }, [api, pollOnce])

  /** 取消扫码 */
  const cancel = useCallback(() => {
    abortedRef.current = true
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setQrState('idle')
    setQrImageDataUrl('')
    setPollStatus('')
  }, [])

  const statusText = (() => {
    switch (pollStatus) {
      case 'wait':
        return language === 'zh' ? '等待扫码...' : 'Waiting for scan...'
      case 'scanned':
        return language === 'zh' ? '已扫码，请在手机上确认' : 'Scanned, confirm on your phone'
      case 'expired':
        return language === 'zh' ? '二维码已过期' : 'QR code expired'
      default:
        return language === 'zh' ? '等待扫码...' : 'Waiting for scan...'
    }
  })()

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-medium text-text-primary">
            {language === 'zh' ? '微信扫码登录' : 'WeChat QR Login'}
          </h4>
          <p className="text-xs text-text-muted mt-1">
            {language === 'zh'
              ? '扫描二维码登录微信个人号，登录后 Token 将自动填入'
              : 'Scan QR code to login, token will be auto-filled'}
          </p>
        </div>
      </div>

      {/* 空闲状态 - 开始扫码按钮 */}
      {qrState === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <ActionButton
            disabled={isStarting}
            onClick={startLogin}
          >
            {isStarting ? (
              <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" />
            ) : (
              <QrCode className="mr-1.5 w-3.5 h-3.5" />
            )}
            {language === 'zh' ? '开始扫码登录' : 'Start QR Login'}
          </ActionButton>
        </div>
      )}

      {/* 展示二维码 */}
      {qrState === 'showing' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative rounded-lg border border-border/50 bg-white p-3">
            {qrImageDataUrl ? (
              <img
                src={qrImageDataUrl}
                alt="WeChat QR Code"
                className="w-52 h-52"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-text-muted">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            )}

            {/* 已扫码遮罩 */}
            {pollStatus === 'scanned' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80">
                <div className="text-center">
                  <Smartphone className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-xs font-medium text-foreground">
                    {language === 'zh' ? '已扫码' : 'Scanned'}
                  </p>
                </div>
              </div>
            )}

            {/* 过期遮罩 */}
            {pollStatus === 'expired' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-background/80 gap-2">
                <p className="text-xs text-text-muted">
                  {language === 'zh' ? '二维码已过期' : 'QR code expired'}
                </p>
                <ActionButton
                  size="sm"
                  variant="outline"
                  onClick={startLogin}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {language === 'zh' ? '刷新' : 'Refresh'}
                </ActionButton>
              </div>
            )}
          </div>

          <p className="text-xs text-text-muted text-center max-w-xs">
            {statusText}
          </p>

          <ActionButton
            variant="ghost"
            size="sm"
            onClick={cancel}
          >
            <X className="w-3 h-3 mr-1" />
            {language === 'zh' ? '取消' : 'Cancel'}
          </ActionButton>
        </div>
      )}

      {/* 登录成功 */}
      {qrState === 'success' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="flex w-12 h-12 items-center justify-center rounded-full bg-green-500/10">
            <Check className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-xs font-medium text-text-primary">
            {language === 'zh' ? '登录成功！Token 已自动填入' : 'Login successful! Token auto-filled'}
          </p>
        </div>
      )}

      {/* 错误状态 */}
      {qrState === 'error' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-xs text-red-400">{errorMessage}</p>
          <ActionButton
            variant="outline"
            size="sm"
            onClick={startLogin}
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            {language === 'zh' ? '重试' : 'Retry'}
          </ActionButton>
        </div>
      )}
    </div>
  )
}

/**
 * 通用扫码登录组件
 *
 * 从 WeixinQRLogin 泛化而来，支持所有声明了 qrLogin 能力的渠道插件。
 * 流程：获取 QR 码 → 展示二维码 → 轮询扫码状态 → 确认后回调
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { QrCode, Smartphone, Check, RefreshCw, X, Loader2 } from 'lucide-react'
import { ActionButton } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { getAPI } from '../../../adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import QRCode from 'qrcode'
import type { ChannelId } from '@shared/protocols/channel'

type QRState = 'idle' | 'loading' | 'showing' | 'success' | 'error'

interface QRLoginViewProps {
  channelId: ChannelId
  language: 'en' | 'zh'
  onLoginSuccess: (token: string, baseUrl: string) => void
}

export function QRLoginView({ channelId, language, onLoginSuccess }: QRLoginViewProps) {
  const api = getAPI()
  const [qrState, setQrState] = useState<QRState>('idle')
  const [qrImageDataUrl, setQrImageDataUrl] = useState('')
  const [pollStatus, setPollStatus] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isStarting, setIsStarting] = useState(false)

  const abortedRef = useRef(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const languageRef = useRef(language)
  const onLoginSuccessRef = useRef(onLoginSuccess)

  useEffect(() => { languageRef.current = language }, [language])
  useEffect(() => { onLoginSuccessRef.current = onLoginSuccess }, [onLoginSuccess])

  useEffect(() => {
    return () => {
      abortedRef.current = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  /** 单次轮询 */
  const pollOnce = useCallback(async (code: string) => {
    if (abortedRef.current) return

    try {
      const result = await api.channel.pollQRStatus(channelId as string, code)
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
            onLoginSuccessRef.current(result.bot_token, result.baseurl || '')
          }
          return
        case 'expired':
          return
        case 'wait':
        case 'scanned':
          if (!abortedRef.current) {
            pollTimerRef.current = setTimeout(() => pollOnce(code), 1500)
          }
          return
        default:
          if (!abortedRef.current) {
            pollTimerRef.current = setTimeout(() => pollOnce(code), 2000)
          }
      }
    } catch {
      if (!abortedRef.current) {
        pollTimerRef.current = setTimeout(() => pollOnce(code), 3000)
      }
    }
  }, [api, channelId])

  /** 开始扫码登录 */
  const startLogin = useCallback(async () => {
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
      const result = await api.channel.fetchQRCode(channelId as string)
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

      pollOnce(code)
    } catch (err: any) {
      setErrorMessage(err?.message || String(err))
      setQrState('error')
    } finally {
      setIsStarting(false)
    }
  }, [api, channelId, pollOnce])

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
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-medium text-text-primary">
            {language === 'zh' ? '扫码登录' : 'QR Login'}
          </h4>
          <p className="text-xs text-text-muted mt-1">
            {language === 'zh'
              ? '扫描二维码登录，登录后 Token 将自动填入'
              : 'Scan QR code to login, token will be auto-filled'}
          </p>
        </div>
      </div>

      {qrState === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <ActionButton disabled={isStarting} onClick={startLogin}>
            {isStarting ? (
              <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" />
            ) : (
              <QrCode className="mr-1.5 w-3.5 h-3.5" />
            )}
            {language === 'zh' ? '开始扫码登录' : 'Start QR Login'}
          </ActionButton>
        </div>
      )}

      {qrState === 'showing' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative rounded-lg border border-border/50 bg-white p-3">
            {qrImageDataUrl ? (
              <img src={qrImageDataUrl} alt="QR Code" className="w-52 h-52" />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-text-muted">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            )}

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

            {pollStatus === 'expired' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-background/80 gap-2">
                <p className="text-xs text-text-muted">
                  {language === 'zh' ? '二维码已过期' : 'QR code expired'}
                </p>
                <ActionButton size="sm" variant="outline" onClick={startLogin}>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {language === 'zh' ? '刷新' : 'Refresh'}
                </ActionButton>
              </div>
            )}
          </div>

          <p className="text-xs text-text-muted text-center max-w-xs">{statusText}</p>

          <ActionButton variant="ghost" size="sm" onClick={cancel}>
            <X className="w-3 h-3 mr-1" />
            {language === 'zh' ? '取消' : 'Cancel'}
          </ActionButton>
        </div>
      )}

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

      {qrState === 'error' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-xs text-red-400">{errorMessage}</p>
          <ActionButton variant="outline" size="sm" onClick={startLogin}>
            <RefreshCw className="w-3 h-3 mr-1" />
            {language === 'zh' ? '重试' : 'Retry'}
          </ActionButton>
        </div>
      )}
    </div>
  )
}

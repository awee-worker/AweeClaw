/**
 * BoosterPanel — 加油包购买面板
 *
 * 职责：
 * 1. 展示可购买的加油包列表（额度、价格、描述）
 * 2. 选择支付方式 → 创建加油包订单 → 扫码/跳转支付
 * 3. 轮询订单状态，支付成功后刷新配额
 *
 * 独立组件，不与 PlanPanel 混合。
 * 加油包额度购买后会叠加到用户配额上限中（后端 getQuota 已处理）。
 */
import { useState, useCallback, useEffect } from 'react'
import {
  Zap,
  CreditCard,
  ExternalLink,
  AlertCircle,
  Loader2,
  Package,
} from 'lucide-react'
import QRCode from 'qrcode'
import { logger } from '@shared/toolkit/LogEngine'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import {
  getBoosterPacks,
  createBoosterOrder,
  type BoosterPackConfig,
} from '@services/featureGuardService'
import { formatTokenCount } from '@utils/formatter'
import {
  type PaymentResult,
  type PaymentChannelInfo,
  channelLabels,
  channelStyles,
  extractChannelNames,
} from './shared'

interface BoosterPanelProps {
  language: Language
}

interface PaymentState {
  result: PaymentResult | null
  orderNo: string
  channel: string
  qrCodeDataUrl: string
}

export function BoosterPanel({ language }: BoosterPanelProps) {
  const { fetchQuota } = useStore(
    useShallow((s) => ({
      fetchQuota: s.fetchQuota,
    })),
  )

  const [packs, setPacks] = useState<BoosterPackConfig[]>([])
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [mockMode, setMockMode] = useState(false)
  const [loadingPacks, setLoadingPacks] = useState(true)
  const [selectedPack, setSelectedPack] = useState<BoosterPackConfig | null>(null)
  const [paymentChannel, setPaymentChannel] = useState('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [payment, setPayment] = useState<PaymentState | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)

  // 加载加油包列表 + 支付渠道
  useEffect(() => {
    setLoadingPacks(true)
    Promise.all([
      getBoosterPacks().then((data) => setPacks(data || [])),
      backendApi
        .get<PaymentChannelInfo>('/api/v1/payment/channels')
        .then((data) => {
          setAvailableChannels(extractChannelNames(data))
          setMockMode(data?.mockMode ?? false)
        })
        .catch(() => {
          setAvailableChannels(['WECHAT', 'ALIPAY'])
          setMockMode(false)
        }),
    ]).finally(() => setLoadingPacks(false))
  }, [])

  // 生成二维码
  useEffect(() => {
    if (payment?.result?.qrCodeUrl) {
      QRCode.toDataURL(payment.result.qrCodeUrl, {
        width: 192,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((url) => setPayment((p) => (p ? { ...p, qrCodeDataUrl: url } : p)))
        .catch(() => {})
    }
  }, [payment?.result?.qrCodeUrl])

  const handlePurchase = useCallback(async () => {
    if (!selectedPack || !paymentChannel) return
    setPaymentLoading(true)
    setPaymentError('')
    setPayment(null)
    try {
      const result = await createBoosterOrder(selectedPack.id, paymentChannel)
      const newPayment: PaymentState = {
        result: { ...result.payment, orderNo: result.order.orderNo },
        orderNo: result.order.orderNo,
        channel: paymentChannel,
        qrCodeDataUrl: '',
      }
      setPayment(newPayment)

      if (paymentChannel === 'ALIPAY' && result.payment?.paymentUrl) {
        window.electronAPI?.openExternalUrl?.(result.payment.paymentUrl)
      }
      setPolling(true)
      pollOrderStatus(result.order.orderNo)
    } catch (e: any) {
      setPaymentError(e?.message || '创建订单失败')
    } finally {
      setPaymentLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPack, paymentChannel, language])

  const pollOrderStatus = useCallback(
    async (orderNo: string) => {
      let attempts = 0
      const maxAttempts = 60
      const poll = async () => {
        if (attempts >= maxAttempts) {
          setPolling(false)
          return
        }
        attempts++
        try {
          const order = await backendApi.get<any>(
            `/api/v1/payment/order/${orderNo}`,
          )
          if (order?.status === 'PAID') {
            setPolling(false)
            toast.success(t('booster.purchasesuccess', language))
            await fetchQuota()
            // 重置状态
            setPayment(null)
            setSelectedPack(null)
            setPaymentChannel('')
            return
          }
          if (order?.status === 'CANCELLED' || order?.status === 'EXPIRED') {
            setPolling(false)
            setPaymentError(
              order.status === 'CANCELLED' ? '订单已取消' : '订单已过期',
            )
            return
          }
        } catch (e) {
          logger.ui.warn('Failed to poll booster order:', e)
        }
        setTimeout(poll, 2000)
      }
      poll()
    },
    [language, fetchQuota],
  )

  const handleMockPay = useCallback(async () => {
    if (!payment?.orderNo) return
    try {
      const serverUrl = useStore.getState().serverUrl
      await fetch(
        `${serverUrl}/api/v1/payment/booster-mock-pay/${payment.orderNo}`,
      )
    } catch (e) {
      logger.ui.warn('Mock booster pay failed:', e)
    }
  }, [payment?.orderNo])

  const displayChannels = mockMode
    ? ['MOCK', ...availableChannels.filter((c) => c !== 'MOCK')]
    : availableChannels

  // 支付进行中
  if (payment) {
    return (
      <div className="space-y-4">
        <div className="p-6 rounded-xl bg-surface/50 border border-border/50 text-center space-y-4">
          {payment.channel === 'WECHAT' && payment.result?.qrCodeUrl && (
            <div className="space-y-3">
              <p className="text-sm text-text-primary">
                {language === 'zh' ? '请使用微信扫码支付' : 'Scan with WeChat to pay'}
              </p>
              <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                {payment.qrCodeDataUrl ? (
                  <img src={payment.qrCodeDataUrl} alt="QR" className="w-full h-full" />
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                )}
              </div>
            </div>
          )}
          {payment.channel === 'ALIPAY' && payment.result?.paymentUrl && (
            <div className="space-y-3">
              <p className="text-sm text-text-primary">
                {language === 'zh' ? '正在跳转到支付宝' : 'Redirecting to Alipay'}
              </p>
              <ActionButton
                variant="secondary"
                onClick={() =>
                  window.electronAPI?.openExternalUrl?.(payment.result!.paymentUrl!)
                }
                leftIcon={<ExternalLink className="w-4 h-4" />}
              >
                {language === 'zh' ? '前往支付' : 'Go to Pay'}
              </ActionButton>
            </div>
          )}
          {payment.channel === 'MOCK' && (
            <div className="space-y-3">
              <p className="text-sm text-text-primary">
                {language === 'zh' ? '模拟支付模式' : 'Mock Payment Mode'}
              </p>
              <ActionButton variant="success" onClick={handleMockPay}>
                {language === 'zh' ? '模拟支付成功' : 'Mock Pay Success'}
              </ActionButton>
            </div>
          )}
        </div>

        {polling && (
          <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
            <Loader2 className="w-3 h-3 animate-spin" />
            {language === 'zh' ? '等待支付确认...' : 'Waiting for payment confirmation...'}
          </div>
        )}

        <ActionButton
          variant="ghost"
          className="w-full"
          onClick={() => {
            setPayment(null)
            setPaymentError('')
            setPolling(false)
            setSelectedPack(null)
            setPaymentChannel('')
          }}
        >
          {t('user.back', language)}
        </ActionButton>
      </div>
    )
  }

  // 加载中
  if (loadingPacks) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
      </div>
    )
  }

  // 加油包列表为空
  if (packs.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-text-muted">
        {language === 'zh' ? '暂无可购买的加油包' : 'No booster packs available'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/[0.04] border border-accent/20">
        <Zap className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-text-primary">
            {t('booster.title', language)}
          </p>
          <p className="text-[12px] text-text-muted mt-1">
            {t('booster.description', language)}
          </p>
        </div>
      </div>

      {/* 加油包列表 */}
      <div className="space-y-3">
        {packs.map((pack) => {
          const isSelected = selectedPack?.id === pack.id
          return (
            <button
              key={pack.id}
              onClick={() => {
                setSelectedPack(pack)
                setPaymentChannel('')
                setPaymentError('')
              }}
              className={`w-full p-4 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-accent/50 bg-accent/5 ring-1 ring-accent/30'
                  : 'border-border/50 bg-surface/30 hover:border-border'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="shrink-0 p-2.5 rounded-lg bg-accent/10">
                  <Package className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{pack.name}</p>
                  <p className="text-[12px] text-text-muted mt-0.5">{pack.description}</p>
                  <p className="text-[12px] text-accent mt-1">
                    {t('booster.quota', language)}: {formatTokenCount(pack.quotaAmount)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-text-primary">¥{pack.price}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* 支付方式选择 */}
      {selectedPack && (
        <div className="space-y-3 pt-4 border-t border-border/30">
          <p className="text-xs text-text-muted">
            {t('booster.selectchannel', language)}
          </p>
          <div
            className={`grid gap-2 ${
              displayChannels.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
            }`}
          >
            {displayChannels.map((ch) => {
              const style = channelStyles[ch] || channelStyles.MOCK
              const label = channelLabels[ch] || { zh: ch, en: ch }
              return (
                <button
                  key={ch}
                  onClick={() => setPaymentChannel(ch)}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    paymentChannel === ch ? style.active : style.inactive
                  }`}
                >
                  <span className="text-sm font-medium text-text-primary">
                    {language === 'zh' ? label.zh : label.en}
                  </span>
                </button>
              )
            })}
          </div>

          {paymentError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{paymentError}</span>
            </div>
          )}

          <ActionButton
            variant="primary"
            className="w-full"
            onClick={handlePurchase}
            disabled={!paymentChannel || paymentLoading}
            leftIcon={paymentLoading ? undefined : <CreditCard className="w-4 h-4" />}
          >
            {paymentLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t('user.pay', language, { price: selectedPack.price.toFixed(2) })
            )}
          </ActionButton>
        </div>
      )}
    </div>
  )
}

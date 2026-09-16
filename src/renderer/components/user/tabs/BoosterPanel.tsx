/**
 * BoosterPanel — 加油包购买面板
 *
 * 职责：
 * 1. 展示可购买的加油包列表（额度、价格、描述）
 * 2. 选择支付方式 → 创建加油包订单 → 扫码支付（与套餐购买保持一致）
 * 3. 轮询 + 主动对账，支付成功后刷新配额
 *
 * 支付体验与 PlanPanel 对齐：微信/支付宝均为二维码扫码支付，
 * 支付宝走后端 page.pay 收银台 iframe 内嵌（qr_pay_mode=4）；
 * 回调延迟或丢失时通过 reconcile 主动补单，避免「已付款却停在等待确认」。
 *
 * 加油包额度购买后会叠加到用户配额上限中（后端 getQuota 已处理）。
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Zap,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Package,
} from 'lucide-react'
import QRCode from 'qrcode'
import { logger } from '@shared/toolkit/LogEngine'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '@components/ui'
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
  getChannelIconUrl,
} from './shared'
import { ChannelIcon } from '@components/payment/ChannelIcon'

interface BoosterPanelProps {
  language: Language
}

export function BoosterPanel({ language }: BoosterPanelProps) {
  const { fetchQuota } = useStore(
    useShallow((s) => ({
      fetchQuota: s.fetchQuota,
    })),
  )

  const [packs, setPacks] = useState<BoosterPackConfig[]>([])
  const [channelInfo, setChannelInfo] = useState<PaymentChannelInfo | null>(null)
  const [loadingPacks, setLoadingPacks] = useState(true)
  const [selectedPack, setSelectedPack] = useState<BoosterPackConfig | null>(null)
  const [paymentChannel, setPaymentChannel] = useState('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载加油包列表 + 支付渠道
  useEffect(() => {
    setLoadingPacks(true)
    Promise.all([
      getBoosterPacks().then((data) => setPacks(data || [])),
      backendApi
        .get<PaymentChannelInfo>('/api/v1/payment/channels')
        .then((data) => {
          setChannelInfo(data || null)
          // 默认选中微信支付（与套餐购买保持一致）
          const names = extractChannelNames(data || undefined)
          if (names.length > 0) {
            setPaymentChannel(names.includes('WECHAT') ? 'WECHAT' : names[0])
          }
        })
        .catch(() =>
          setChannelInfo({ channels: ['WECHAT', 'ALIPAY'], mockMode: false }),
        ),
    ]).finally(() => setLoadingPacks(false))
  }, [])

  // 生成二维码（微信 code_url / 支付宝当面付 qr_code）
  useEffect(() => {
    if (paymentResult?.qrCodeUrl) {
      QRCode.toDataURL(paymentResult.qrCodeUrl, {
        width: 192,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch(() => setQrCodeDataUrl(''))
    } else {
      setQrCodeDataUrl('')
    }
  }, [paymentResult?.qrCodeUrl])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setPolling(false)
  }, [])

  // 组件卸载时清理轮询定时器
  useEffect(
    () => () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    },
    [],
  )

  /** 重置支付状态（返回 / 完成） */
  const resetPayment = useCallback(() => {
    stopPolling()
    setPaymentResult(null)
    setPaymentSuccess(false)
    setPaymentError('')
    setQrCodeDataUrl('')
  }, [stopPolling])

  /** 支付确认成功：停止轮询并刷新配额 */
  const markPaid = useCallback(async () => {
    stopPolling()
    setPaymentSuccess(true)
    await fetchQuota()
  }, [stopPolling, fetchQuota])

  /**
   * 主动向支付网关对账（补单）
   *
   * 加油包与套餐共用 /payment/order/:orderNo/reconcile：回调（notify）延迟或丢失时，
   * 由后端直接向网关查询该笔交易的真实状态并补正订单，
   * 避免用户已付款却永远停在「等待支付确认」。
   */
  const reconcileOrder = useCallback(
    async (orderNo: string): Promise<boolean> => {
      try {
        const res = await backendApi.post<{ reconciled: boolean }>(
          `/api/v1/payment/order/${orderNo}/reconcile`,
          {},
        )
        if (res?.reconciled) {
          await markPaid()
          return true
        }
      } catch (e) {
        logger.ui.warn('Failed to reconcile booster order:', e)
      }
      return false
    },
    [markPaid],
  )

  /** 用户自助核实：已扫码付款但界面仍停在「等待确认」时的手动入口 */
  const handleVerifyNow = useCallback(async () => {
    if (!paymentResult?.orderNo) return
    setPaymentError('')
    const done = await reconcileOrder(paymentResult.orderNo)
    if (!done) {
      setPaymentError(
        language === 'zh'
          ? '暂未查询到已支付的交易，请确认已完成付款后重试'
          : 'No completed payment found yet, please confirm you have paid',
      )
    }
  }, [paymentResult?.orderNo, reconcileOrder, language])

  const pollOrderStatus = useCallback(
    async (orderNo: string) => {
      let attempts = 0
      const maxAttempts = 60 // 最多轮询 60 次
      const intervalMs = 3000 // 每 3 秒轮询一次，共约 3 分钟

      const poll = async () => {
        if (attempts >= maxAttempts) {
          stopPolling()
          setPaymentError(
            language === 'zh'
              ? '支付确认超时，如已支付请点击「我已支付，立即核实」'
              : 'Payment confirmation timeout, if you have paid please click "I have paid, verify now"',
          )
          return
        }
        attempts++
        try {
          // 每 5 轮（约 15 秒）主动对账一次，兜住回调延迟或丢失的情况
          if (attempts % 5 === 1 && (await reconcileOrder(orderNo))) return

          const order = await backendApi.get<{ status?: string }>(
            `/api/v1/payment/order/${orderNo}`,
          )
          if (order?.status === 'PAID') {
            await markPaid()
            return
          }
          if (order?.status === 'CANCELLED' || order?.status === 'EXPIRED') {
            stopPolling()
            setPaymentError(
              order.status === 'CANCELLED'
                ? language === 'zh'
                  ? '订单已取消，请重新下单'
                  : 'Order cancelled, please start over'
                : language === 'zh'
                  ? '订单已过期，请重新下单'
                  : 'Order expired, please start over',
            )
            return
          }
        } catch (e) {
          logger.ui.warn('Failed to poll booster order:', e)
        }
        pollTimerRef.current = setTimeout(poll, intervalMs)
      }
      poll()
    },
    [language, stopPolling, reconcileOrder, markPaid],
  )

  const handlePurchase = useCallback(async () => {
    if (!selectedPack || !paymentChannel) return
    setPaymentLoading(true)
    setPaymentError('')
    setPolling(false)
    setPaymentResult(null)
    setQrCodeDataUrl('')
    setPaymentSuccess(false)
    try {
      const result = await createBoosterOrder(selectedPack.id, paymentChannel)

      // 网关下单失败的二次防御（后端该分支不抛异常，只返回 success:false）
      if (result.payment?.success === false) {
        setPaymentError(
          result.payment.error ||
            (language === 'zh' ? '创建订单失败' : 'Failed to create order'),
        )
        return
      }

      const orderNo = result.order?.orderNo || result.payment?.orderNo
      if (!orderNo) {
        setPaymentError(
          language === 'zh' ? '创建订单失败' : 'Failed to create order',
        )
        return
      }

      setPaymentResult({ ...result.payment, orderNo })
      setPolling(true)
      pollOrderStatus(orderNo)
    } catch (e: any) {
      setPaymentError(
        e?.message ||
          (language === 'zh' ? '创建订单失败' : 'Failed to create order'),
      )
    } finally {
      setPaymentLoading(false)
    }
  }, [selectedPack, paymentChannel, language, pollOrderStatus])

  const displayChannels = extractChannelNames(channelInfo || undefined)


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
    <div className="w-full">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* ======================================== */}
        {/* 左侧：说明 + 加油包列表 */}
        {/* ======================================== */}
        <div className="flex-1 min-w-0 space-y-4">
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
                    setPaymentError('')
                  }}
                  disabled={!!paymentResult}
                  className={`w-full p-4 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-accent/50 bg-accent/5 ring-1 ring-accent/30'
                      : 'border-border/50 bg-surface/30 hover:border-border'
                  } ${paymentResult ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                      <p className="text-lg font-bold text-text-primary">
                        ¥{Number(pack.price).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ======================================== */}
        {/* 右侧：支付方式 + 支付信息（固定宽度 360px） */}
        {/* ======================================== */}
        <div className="w-full lg:w-[360px] shrink-0 space-y-4">
          <div className="p-4 rounded-xl bg-surface/50 border border-border/40">
            <h4 className="text-sm font-medium text-text-primary mb-3">
              {t('user.selectpaymentmethod', language)}
            </h4>

            {selectedPack ? (
              <>
                {/* 已选加油包摘要 */}
                <div className="mb-3 p-3 rounded-lg bg-accent/5 border border-accent/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">
                      {selectedPack.name}
                    </span>
                    <span className="text-lg font-bold text-accent">
                      ¥{Number(selectedPack.price).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-muted mt-1">
                    {t('booster.quota', language)}:{' '}
                    {formatTokenCount(selectedPack.quotaAmount)}
                  </p>
                </div>

                {/* 渠道列表（图标 + 名称，与套餐购买一致） */}
                {displayChannels.length === 0 ? (
                  <div className="text-center py-6 text-sm text-text-muted">
                    {language === 'zh'
                      ? '暂无可用支付方式，请联系管理员'
                      : 'No payment channels available'}
                  </div>
                ) : (
                  <div
                    className={`grid gap-2 ${
                      displayChannels.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    }`}
                  >
                    {displayChannels.map((ch) => {
                      const style = channelStyles[ch] || {
                        active: 'border-accent/50 bg-accent/10 ring-1 ring-accent/30',
                        inactive: 'border-border/50 bg-surface/30 hover:border-border',
                      }
                      const label = channelLabels[ch] || { zh: ch, en: ch }
                      const iconUrl = getChannelIconUrl(channelInfo || undefined, ch)
                      return (
                        <button
                          key={ch}
                          onClick={() => setPaymentChannel(ch)}
                          disabled={!!paymentResult}
                          className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                            paymentChannel === ch ? style.active : style.inactive
                          } ${paymentResult ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <ChannelIcon channel={ch} iconUrl={iconUrl} className="w-6 h-6" />
                          <span className="text-sm font-medium text-text-primary">
                            {language === 'zh' ? label.zh : label.en}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* 错误提示 */}
                {paymentError && (
                  <div className="flex items-center gap-2 p-3 mt-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{paymentError}</span>
                  </div>
                )}

                {/* 支付按钮 / 支付结果（二维码显示在支付方式下方） */}
                {!paymentResult ? (
                  <ActionButton
                    variant="primary"
                    className="w-full mt-3"
                    onClick={handlePurchase}
                    disabled={!paymentChannel || paymentLoading}
                    leftIcon={paymentLoading ? undefined : <CreditCard className="w-4 h-4" />}
                  >
                    {paymentLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      t('user.pay', language, {
                        price: Number(selectedPack.price).toFixed(2),
                      })
                    )}
                  </ActionButton>
                ) : paymentSuccess ? (
                  /* 支付成功标识 */
                  <div className="mt-3 space-y-3 text-center">
                    <div className="py-6 flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                        <CheckCircle2 className="w-10 h-10 text-green-500" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-text-primary">
                          {language === 'zh' ? '支付成功' : 'Payment Successful'}
                        </p>
                        <p className="text-[12px] text-text-muted mt-1">
                          {t('booster.purchasesuccess', language)}
                        </p>
                      </div>
                    </div>
                    <ActionButton variant="ghost" className="w-full" onClick={resetPayment}>
                      {language === 'zh' ? '完成' : 'Done'}
                    </ActionButton>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {/* 微信支付二维码 */}
                    {paymentChannel === 'WECHAT' && paymentResult.qrCodeUrl && (
                      <div className="space-y-2 text-center">
                        <p className="text-sm text-text-primary">
                          {t('user.scanwithwechattopay', language)}
                        </p>
                        <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                          {qrCodeDataUrl ? (
                            <img src={qrCodeDataUrl} alt="QR" className="w-full h-full" />
                          ) : (
                            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                          )}
                        </div>
                      </div>
                    )}
                    {/* 支付宝扫码支付 */}
                    {paymentChannel === 'ALIPAY' &&
                      (paymentResult.paymentUrl || paymentResult.qrCodeUrl) && (
                        <div className="space-y-2 text-center">
                          <p className="text-sm text-text-primary">
                            {language === 'zh'
                              ? '请用支付宝扫码支付'
                              : 'Scan with Alipay to pay'}
                          </p>
                          {paymentResult.paymentUrl ? (
                            /* 电脑网站支付：iframe 内嵌支付宝收银台（qr_pay_mode=4），二维码不跳出客户端
                               ⚠ 容器尺寸需与后端 alipay-gateway.ts 的 qrcode_width（200）一致 */
                            <>
                              <div className="w-56 h-56 mx-auto bg-white rounded-xl overflow-hidden flex items-center justify-center">
                                <iframe
                                  title="alipay-cashier"
                                  src={paymentResult.paymentUrl}
                                  scrolling="no"
                                  className="w-[200px] h-[200px] border-0 block"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const url = paymentResult.paymentUrl
                                  if (url) window.electronAPI?.openExternalUrl?.(url)
                                }}
                                className="text-xs text-accent hover:underline"
                              >
                                {language === 'zh' ? '在浏览器中打开' : 'Open in browser'}
                              </button>
                            </>
                          ) : (
                            /* 当面付：本地渲染 qr_code 二维码 */
                            <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                              {qrCodeDataUrl ? (
                                <img src={qrCodeDataUrl} alt="QR" className="w-full h-full" />
                              ) : (
                                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    {/* 轮询提示 */}
                    {polling && (
                      <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t('user.waitingforpaymentconfirmation', language)}
                      </div>
                    )}
                    {/* 自助补单入口：已扫码付款但回调未送达时的自救通道，
                        轮询超时或订单被判超时后仍需可见，故不放在 polling 分支内 */}
                    <button
                      type="button"
                      onClick={handleVerifyNow}
                      className="w-full text-xs text-accent hover:underline"
                    >
                      {language === 'zh' ? '我已支付，立即核实' : 'I have paid, verify now'}
                    </button>
                    {/* 取消按钮 */}
                    <ActionButton variant="ghost" className="w-full" onClick={resetPayment}>
                      {t('user.back', language)}
                    </ActionButton>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-sm text-text-muted">
                {language === 'zh'
                  ? '请从左侧选择要购买的加油包'
                  : 'Please select a booster pack from the left'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


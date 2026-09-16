/**
 * PaymentDialog — 通用支付弹窗（微信支付 / 支付宝）
 *
 * 用途：为「付费场景购买 / 续费」「付费插件购买 / 续费」提供与套餐购买一致的
 * 支付体验，避免各业务面板重复实现支付 UI 与轮询逻辑。
 *
 * 完整流程：
 *   1. 拉取可用支付渠道（/payment/channels），用户选择微信 / 支付宝
 *   2. 调用调用方传入的 createOrder(channel) 创建订单，拿到二维码 / 收银台链接
 *   3. 每 3 秒轮询订单状态，每 15 秒主动向网关对账（回调丢失时兜底补单）
 *   4. 用户点击「我已支付，立即核实」可手动对账
 *   5. 支付成功后调用 onPaid()，由调用方完成安装 / 刷新列表
 *
 * 为什么不用回调结果直接判断成功：网关回调可能延迟甚至丢失，
 * 因此以「轮询订单状态 + 主动对账」为唯一判定依据。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { backendApi } from '@services/backendApi'
import { logger } from '@shared/toolkit/LogEngine'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { ActionButton } from '@components/ui'
import type { Language } from '@renderer/i18n'
import {
  type PaymentChannelInfo,
  channelLabels,
  channelStyles,
  extractChannelNames,
  getChannelIconUrl,
} from '@components/user/tabs/shared'
import { ChannelIcon } from './ChannelIcon'

/** 创建订单的返回结构（与后端 /payment/scenario-order、/payment/plugin-order 对齐） */
export interface PaymentOrderResult {
  orderNo: string
  amount: number
  payment: {
    paymentUrl?: string
    qrCodeUrl?: string
    mockMode?: boolean
  }
}

interface PaymentDialogProps {
  isOpen: boolean
  /** 弹窗标题，如「购买场景」「续费插件」 */
  title: string
  /** 商品名（场景名 / 插件名） */
  subjectName: string
  /** 应付金额（元） */
  amount: number
  language: Language
  /** 创建订单：由调用方决定调用场景还是插件的下单接口 */
  createOrder: (channel: string) => Promise<PaymentOrderResult>
  /** 支付成功回调（此时权益已在后端发放，可安全执行安装 / 刷新） */
  onPaid: () => void | Promise<void>
  onClose: () => void
  /** 成功后的状态说明 */
  successHint?: string
}

/** 轮询参数：每 3 秒一次，最多 60 次（约 3 分钟） */
const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60

export function PaymentDialog({
  isOpen,
  title,
  subjectName,
  amount,
  language,
  createOrder,
  onPaid,
  onClose,
  successHint,
}: PaymentDialogProps) {
  const zh = language === 'zh'

  const [channels, setChannels] = useState<PaymentChannelInfo | null>(null)
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState<PaymentOrderResult | null>(null)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [paid, setPaid] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState('')

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  /** 弹窗关闭 / 卸载后停止一切异步回调，避免对已卸载组件 setState */
  const activeRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setPolling(false)
  }, [])

  /** 重置所有支付状态（每次打开弹窗、每次切换渠道） */
  const resetState = useCallback(() => {
    stopPolling()
    attemptsRef.current = 0
    setOrder(null)
    setQrCodeDataUrl('')
    setPaid(false)
    setError('')
  }, [stopPolling])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  // 打开弹窗：拉取支付渠道并默认选中微信支付
  useEffect(() => {
    if (!isOpen) return
    resetState()

    backendApi
      .get<PaymentChannelInfo>('/api/v1/payment/channels')
      .then((info) => {
        const data = info || null
        setChannels(data)
        const names = extractChannelNames(data || undefined)
        setChannel((prev) =>
          prev && names.includes(prev)
            ? prev
            : names.includes('WECHAT')
              ? 'WECHAT'
              : names[0] || '',
        )
      })
      .catch(() => {
        // 渠道接口异常时退化为默认两渠道，保证支付入口仍然可用
        setChannels({ channels: ['WECHAT', 'ALIPAY'], mockMode: false })
        setChannel('WECHAT')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // 二维码渲染（微信 Native 与支付宝当面付均返回 qrCodeUrl）
  useEffect(() => {
    if (order?.payment.qrCodeUrl) {
      QRCode.toDataURL(order.payment.qrCodeUrl, {
        width: 192,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((url) => activeRef.current && setQrCodeDataUrl(url))
        .catch(() => activeRef.current && setQrCodeDataUrl(''))
    } else {
      setQrCodeDataUrl('')
    }
  }, [order?.payment.qrCodeUrl])

  const markPaid = useCallback(async () => {
    stopPolling()
    setPaid(true)
    await onPaid()
    // onPaid 由调用方提供，可能是异步的安装 / 刷新逻辑
  }, [stopPolling, onPaid])

  /**
   * 主动向支付网关对账（补单）
   *
   * 异步回调可能延迟、丢失，或因回调地址配置问题始终无法送达；此时单纯轮询本地
   * 订单状态会永远停在 PENDING。这里周期性地让后端直接向网关查询交易真实状态。
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
        logger.ui.warn('Failed to reconcile order:', e)
      }
      return false
    },
    [markPaid],
  )

  const startPolling = useCallback(
    (orderNo: string) => {
      attemptsRef.current = 0
      setPolling(true)

      const poll = async () => {
        if (!activeRef.current) return
        if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
          stopPolling()
          setError(
            zh
              ? '支付确认超时，如已完成支付请点击「我已支付，立即核实」'
              : 'Payment confirmation timeout, if you have paid please click "I have paid, verify now"',
          )
          return
        }
        attemptsRef.current++

        try {
          // 每 5 轮（约 15 秒）主动对账一次，兜住回调延迟或丢件的情况
          if (attemptsRef.current % 5 === 1 && (await reconcileOrder(orderNo))) {
            return
          }

          const result = await backendApi.get<{ status: string }>(
            `/api/v1/payment/order/${orderNo}`,
          )
          if (!activeRef.current) return

          if (result?.status === 'PAID') {
            await markPaid()
            return
          }
          if (result?.status === 'CANCELLED' || result?.status === 'EXPIRED') {
            stopPolling()
            setError(
              zh
                ? `订单已${result.status === 'CANCELLED' ? '取消' : '过期'}，请重新下单`
                : `Order ${result.status.toLowerCase()}, please create a new order`,
            )
            return
          }
        } catch (e) {
          logger.ui.warn('Failed to poll order status:', e)
        }

        pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }

      poll()
    },
    [zh, markPaid, reconcileOrder, stopPolling],
  )

  /** 模拟支付（后端未开启 PAYMENT_MOCK_MODE 时会返回 403） */
  const mockPay = useCallback(
    async (orderNo: string) => {
      try {
        await backendApi.post(`/api/v1/payment/mock-pay/${orderNo}`, {})
        await markPaid()
      } catch (e: any) {
        stopPolling()
        setError(e?.message || (zh ? '模拟支付失败' : 'Mock payment failed'))
      }
    },
    [markPaid, stopPolling, zh],
  )

  /** 发起下单 */
  const handlePay = useCallback(async () => {
    if (!channel) return
    setLoading(true)
    setError('')
    try {
      const result = await createOrder(channel)
      if (!activeRef.current) return
      setOrder(result)

      if (result.payment.mockMode) {
        await mockPay(result.orderNo)
      } else {
        startPolling(result.orderNo)
      }
    } catch (e: any) {
      setError(
        e?.message ||
          (zh ? '创建订单失败，请稍后重试' : 'Failed to create order, please retry'),
      )
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [channel, createOrder, mockPay, startPolling, zh])

  /** 用户自助核实（已付款但界面仍停在等待确认） */
  const handleVerifyNow = useCallback(async () => {
    if (!order) return
    setError('')
    const done = await reconcileOrder(order.orderNo)
    if (!done) {
      setError(
        zh
          ? '暂未查询到已支付的交易，请确认已完成付款后重试'
          : 'No completed payment found yet, please confirm you have paid',
      )
    }
  }, [order, reconcileOrder, zh])

  const handleClose = useCallback(() => {
    stopPolling()
    onClose()
  }, [onClose, stopPolling])

  const displayChannels = extractChannelNames(channels || undefined)
  const currentChannel = order ? order.payment && channel : channel

  return (
    <OverlayDialog isOpen={isOpen} onClose={handleClose} title={title} size="md">
      <div className="space-y-4">
        {/* 商品与金额 */}
        <div className="p-3.5 rounded-xl border border-border/40 bg-surface/30">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{subjectName}</p>
              <p className="text-[12px] text-text-muted mt-0.5">
                {zh ? '应付金额' : 'Amount due'}
              </p>
            </div>
            <p className="text-xl font-bold text-text-primary shrink-0">
              ¥{Number(amount).toFixed(2)}
            </p>
          </div>
        </div>

        {paid ? (
          /* 支付成功 */
          <div className="space-y-3 text-center py-2">
            <div className="py-4 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9 text-green-500" />
              </div>
              <div>
                <p className="text-base font-semibold text-text-primary">
                  {zh ? '支付成功' : 'Payment Successful'}
                </p>
                <p className="text-[12px] text-text-muted mt-1">
                  {successHint || (zh ? '权益已生效' : 'Your entitlement is active')}
                </p>
              </div>
            </div>
            <ActionButton variant="ghost" className="w-full" onClick={handleClose}>
              {zh ? '完成' : 'Done'}
            </ActionButton>
          </div>
        ) : !order ? (
          /* 第一步：选择支付方式 */
          <>
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-text-secondary">
                {zh ? '选择支付方式' : 'Select payment method'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(displayChannels.length > 0 ? displayChannels : ['WECHAT', 'ALIPAY']).map(
                  (ch) => {
                    const styles = channelStyles[ch] || channelStyles.WECHAT
                    const isActive = channel === ch
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => setChannel(ch)}
                        className={`h-12 rounded-xl border flex items-center justify-center gap-2 text-sm font-medium transition-all ${
                          isActive ? styles.active : styles.inactive
                        }`}
                      >
                        <ChannelIcon
                          channel={ch}
                          iconUrl={getChannelIconUrl(channels || undefined, ch)}
                        />
                        <span className="text-text-primary">
                          {channelLabels[ch]?.[zh ? 'zh' : 'en'] || ch}
                        </span>
                      </button>
                    )
                  },
                )}
              </div>
            </div>

            {error && (
              <p className="text-[12px] text-status-error bg-status-error/5 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <ActionButton
              variant="primary"
              className="w-full"
              onClick={handlePay}
              disabled={!channel || loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : zh ? (
                `支付 ¥${Number(amount).toFixed(2)}`
              ) : (
                `Pay ¥${Number(amount).toFixed(2)}`
              )}
            </ActionButton>
          </>
        ) : (
          /* 第二步：扫码支付 */
          <div className="space-y-3">
            {currentChannel === 'WECHAT' && order.payment.qrCodeUrl && (
              <div className="space-y-2 text-center">
                <p className="text-sm text-text-primary">
                  {zh ? '请使用微信扫码支付' : 'Scan with WeChat to pay'}
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

            {currentChannel === 'ALIPAY' && (order.payment.paymentUrl || order.payment.qrCodeUrl) && (
              <div className="space-y-2 text-center">
                <p className="text-sm text-text-primary">
                  {zh ? '请用支付宝扫码支付' : 'Scan with Alipay to pay'}
                </p>
                {order.payment.paymentUrl ? (
                  /* 电脑网站支付：iframe 内嵌收银台（qr_pay_mode=4），二维码不跳出客户端。
                     容器必须与二维码等尺寸（200px），否则多出的宽高会以空白显现导致看起来未居中。
                     ⚠ 调整尺寸需同步后端 alipay-gateway.ts 的 qrcode_width。 */
                  <>
                    <div className="w-56 h-56 mx-auto bg-white rounded-xl overflow-hidden flex items-center justify-center">
                      <iframe
                        title="alipay-cashier"
                        src={order.payment.paymentUrl}
                        scrolling="no"
                        className="w-[200px] h-[200px] border-0 block"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = order.payment.paymentUrl
                        if (url) window.electronAPI?.openExternalUrl?.(url)
                      }}
                      className="text-xs text-accent hover:underline"
                    >
                      {zh ? '在浏览器中打开' : 'Open in browser'}
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

            {polling && (
              <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                {zh ? '等待支付确认中…' : 'Waiting for payment confirmation…'}
              </div>
            )}

            {error && (
              <p className="text-[12px] text-status-error bg-status-error/5 rounded-lg px-3 py-2 text-center">
                {error}
              </p>
            )}

            {/* 自助补单入口：刻意放在 polling 分支之外 —— 轮询超时或订单被判超时后，
                恰恰是最需要用它的时刻，按钮必须仍然可见 */}
            <button
              type="button"
              onClick={handleVerifyNow}
              className="w-full text-xs text-accent hover:underline"
            >
              {zh ? '我已支付，立即核实' : 'I have paid, verify now'}
            </button>

            <ActionButton variant="ghost" className="w-full" onClick={handleClose}>
              {zh ? '取消' : 'Cancel'}
            </ActionButton>
          </div>
        )}
      </div>
    </OverlayDialog>
  )
}

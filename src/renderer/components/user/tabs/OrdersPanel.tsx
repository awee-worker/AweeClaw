import { useState, useCallback, useEffect } from 'react'
import {
  CreditCard,
  Clock,
  Trash2,
  Loader2,
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { toast } from '@components/foundation/NotificationProvider'
import { type OrderItem, type PaymentResult, channelLabels, orderStatusMap } from './shared'

interface OrdersPanelProps {
  language: Language
}

export function OrdersPanel({ language }: OrdersPanelProps) {
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const limit = 10

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const result = await backendApi.get<{ orders: OrderItem[]; total: number }>(`/api/v1/payment/orders?page=${page}&limit=${limit}`)
      setOrders(result?.orders || [])
      setTotal(result?.total || 0)
    } catch {
      toast.error(t('user.failedtoloadorders', language as Language), '')
    } finally {
      setLoading(false)
    }
  }, [page, language])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleCancel = useCallback(async (orderNo: string) => {
    setActionLoading(orderNo)
    try {
      await backendApi.post(`/api/v1/payment/cancel/${orderNo}`)
      toast.success(t('user.ordercancelled', language as Language), '')
      await fetchOrders()
    } catch (e: any) {
      toast.error(t('user.cancelfailed', language as Language), e?.message || '')
    } finally {
      setActionLoading(null)
    }
  }, [language, fetchOrders])

  const handleDelete = useCallback(async (orderNo: string) => {
    setActionLoading(orderNo)
    try {
      await backendApi.delete(`/api/v1/payment/order/${orderNo}`)
      toast.success(t('user.orderdeleted', language as Language), '')
      await fetchOrders()
    } catch (e: any) {
      toast.error(t('user.deletefailed', language as Language), e?.message || '')
    } finally {
      setActionLoading(null)
    }
  }, [language, fetchOrders])

  const handlePay = useCallback(async (order: OrderItem) => {
    try {
      const result = await backendApi.post<{ order: any; payment: PaymentResult }>('/api/v1/payment/create', {
        planId: order.planName,
        channel: order.channel,
        periodMonths: order.periodMonths,
      })
      if (result.payment?.paymentUrl) {
        window.electronAPI?.openExternalUrl?.(result.payment.paymentUrl)
      }
      if (result.payment?.qrCodeUrl) {
        toast.info(t('user.pleasescanqrcodeto', language as Language), '')
      }
    } catch (e: any) {
      toast.error(t('user.failedtoinitiatepayment', language as Language), e?.message || '')
    }
  }, [language])

  const getRemainingTime = useCallback((expiredAt: string | null) => {
    if (!expiredAt) return null
    const diff = new Date(expiredAt).getTime() - Date.now()
    if (diff <= 0) return null
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <CreditCard className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">{t('user.noordersyet', language as Language)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const statusInfo = orderStatusMap[order.status] || orderStatusMap.PENDING
            const remaining = order.status === 'PENDING' ? getRemainingTime(order.expiredAt) : null
            return (
              <div key={order.id} className="p-4 rounded-xl border border-border/40 bg-surface/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-text-secondary">{order.orderNo}</span>
                    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${statusInfo.color}`}>
                      {language === 'zh' ? statusInfo.zh : statusInfo.en}
                    </span>
                    {remaining && (
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <Clock className="w-3 h-3" />
                        {remaining}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-muted">{new Date(order.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{order.planDisplayName}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {channelLabels[order.channel]?.[language === 'zh' ? 'zh' : 'en'] || order.channel}
                      {order.periodMonths > 1 ? ` · ${order.periodMonths}${t('user.months', language as Language)}` : ` · 1${t('user.month', language as Language)}`}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-text-primary">¥{Number(order.amount).toFixed(2)}</p>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  {order.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handlePay(order)}
                        disabled={actionLoading === order.orderNo}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                      >
                        {t('user.paynow', language as Language)}
                      </button>
                      <button
                        onClick={() => handleCancel(order.orderNo)}
                        disabled={actionLoading === order.orderNo}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface/50 text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                      >
                        {actionLoading === order.orderNo ? <Loader2 className="w-3 h-3 animate-spin" /> : t('user.cancel', language as Language)}
                      </button>
                    </>
                  )}
                  {order.status !== 'PENDING' && (
                    <button
                      onClick={() => handleDelete(order.orderNo)}
                      disabled={actionLoading === order.orderNo}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-status-error/70 hover:text-status-error hover:bg-status-error/5 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === order.orderNo ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Trash2 className="w-3 h-3 inline mr-1" />{t('user.delete', language as Language)}</>}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface/50 text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                {t('user.prev', language as Language)}
              </button>
              <span className="text-xs text-text-muted">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface/50 text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                {t('user.next', language as Language)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

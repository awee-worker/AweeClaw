/**
 * MyPurchasesPanel — 我的购买（付费场景 / 付费插件）
 *
 * 职责：
 *   1. 展示已购场景与已购插件的权益状态（有效 / 已到期 / 永久）与到期时间
 *   2. 对到期或即将到期的条目提供「续费」入口，走与套餐一致的支付流程
 *   3. 顶部展示未读的到期提醒（7/3/1 天提醒与已到期提醒）
 *
 * 数据来源：
 *   - GET /payment/scenario-orders | /payment/plugin-orders：已购列表（含 expiresAt / valid）
 *   - GET /payment/notifications：未读到期提醒
 *   - POST /payment/scenario-order | /payment/plugin-order（intent=renew）：续费下单
 */
import { useState, useCallback, useEffect } from 'react'
import { Package, Loader2, Clock, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { toast } from '@components/foundation/NotificationProvider'
import { PaymentDialog, type PaymentOrderResult } from '@components/payment/PaymentDialog'

type PurchaseKind = 'scenario' | 'plugin'

/** 已购条目（场景 / 插件共用一个视图模型） */
interface PurchaseItem {
  id: string
  status: string
  price: string | number
  paidAt: string | null
  expiresAt: string | null
  renewCount: number
  /** 后端计算的权益是否仍然有效（含有效期判断） */
  valid: boolean
  /** 商品有效期（天），null = 永久买断 */
  validityDays?: number | null
  nameZh: string
  name: string
}

interface NotificationItem {
  id: string
  type: string
  title: string
  content: string | null
  createdAt: string
}

interface MyPurchasesPanelProps {
  language: Language
}

export function MyPurchasesPanel({ language }: MyPurchasesPanelProps) {
  const zh = language === 'zh'

  const [kind, setKind] = useState<PurchaseKind>('scenario')
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [notices, setNotices] = useState<NotificationItem[]>([])
  const [renewTarget, setRenewTarget] = useState<PurchaseItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint =
        kind === 'scenario'
          ? '/api/v1/payment/scenario-orders?page=1&limit=50'
          : '/api/v1/payment/plugin-orders?page=1&limit=50'

      const result = await backendApi.get<{
        items: Array<Record<string, any>>
      }>(endpoint)

      const mapped: PurchaseItem[] = (result?.items || []).map((row) => {
        const subject = kind === 'scenario' ? row.scenario : row.plugin
        return {
          id: row.id,
          status: row.status,
          price: row.price,
          paidAt: row.paidAt,
          expiresAt: row.expiresAt,
          renewCount: row.renewCount || 0,
          valid: row.valid !== false,
          validityDays: subject?.validityDays ?? null,
          nameZh: subject?.nameZh || '',
          name: subject?.name || '',
        }
      })

      setItems(mapped)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [kind])

  /** 加载未读到期提醒（场景 / 插件） */
  const loadNotices = useCallback(async () => {
    try {
      const result = await backendApi.get<{ items: NotificationItem[] }>(
        '/api/v1/payment/notifications?unreadOnly=true&limit=20',
      )
      const relevant = (result?.items || []).filter((n) =>
        [
          'scenario_expiring',
          'scenario_expired',
          'plugin_expiring',
          'plugin_expired',
        ].includes(n.type),
      )
      setNotices(relevant)
    } catch {
      setNotices([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadNotices()
  }, [loadNotices])

  const dismissNotice = useCallback(async (id: string) => {
    try {
      await backendApi.post(`/api/v1/payment/notifications/${id}/read`, {})
      setNotices((prev) => prev.filter((n) => n.id !== id))
    } catch {
      // 标记已读失败不阻塞用户，下轮刷新会重新拉取
    }
  }, [])

  /** 续费下单：intent=renew 表示允许在有效期内顺延 */
  const createRenewOrder = useCallback(
    async (item: PurchaseItem, channel: string): Promise<PaymentOrderResult> => {
      const endpoint =
        kind === 'scenario'
          ? '/api/v1/payment/scenario-order'
          : '/api/v1/payment/plugin-order'
      const key = kind === 'scenario' ? 'scenarioId' : 'pluginId'

      const res = await backendApi.post<{
        order: { orderNo: string; amount: number | string }
        payment: { paymentUrl?: string; qrCodeUrl?: string; mockMode?: boolean }
      }>(endpoint, { [key]: item.id, channel, intent: 'renew' })

      return {
        orderNo: res.order.orderNo,
        amount: Number(res.order.amount),
        payment: res.payment,
      }
    },
    [kind],
  )

  /** 到期展示：永久 / 剩余天数 / 已到期 */
  const renderExpiry = (item: PurchaseItem) => {
    if (!item.expiresAt) {
      return (
        <span className="text-[12px] text-text-muted">
          {zh ? '永久有效' : 'Lifetime'}
        </span>
      )
    }

    const expiry = new Date(item.expiresAt)
    const daysLeft = Math.ceil(
      (expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    )
    const dateText = expiry.toLocaleDateString(zh ? 'zh-CN' : 'en-US')

    if (daysLeft <= 0) {
      return (
        <span className="text-[12px] text-status-error">
          {zh ? `已于 ${dateText} 到期` : `Expired on ${dateText}`}
        </span>
      )
    }

    return (
      <span className={`text-[12px] ${daysLeft <= 7 ? 'text-amber-400' : 'text-text-muted'}`}>
        {zh
          ? `${dateText} 到期（剩余 ${daysLeft} 天）`
          : `Expires ${dateText} (${daysLeft} days left)`}
      </span>
    )
  }

  const currentSubjectName = (item: PurchaseItem) =>
    (zh ? item.nameZh : item.name) || item.nameZh || item.name || item.id

  return (
    <div className="space-y-4">
      {/* 到期提醒横幅 */}
      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((n) => {
            const isExpired = n.type.endsWith('_expired')
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3.5 rounded-xl border ${
                  isExpired
                    ? 'border-rose-500/30 bg-rose-500/5'
                    : 'border-amber-500/30 bg-amber-500/5'
                }`}
              >
                <AlertTriangle
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    isExpired ? 'text-rose-400' : 'text-amber-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">{n.title}</p>
                  {n.content && (
                    <p className="text-[12px] text-text-secondary mt-1">{n.content}</p>
                  )}
                </div>
                <button
                  onClick={() => dismissNotice(n.id)}
                  className="text-[12px] text-text-muted hover:text-text-primary shrink-0"
                >
                  {zh ? '知道了' : 'Dismiss'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 场景 / 插件切换 */}
      <div className="flex items-center gap-2">
        {(['scenario', 'plugin'] as PurchaseKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              kind === k
                ? 'bg-accent/10 text-text-primary border border-accent/20'
                : 'text-text-secondary hover:bg-surface-hover border border-transparent'
            }`}
          >
            {k === 'scenario'
              ? zh
                ? '已购场景'
                : 'Scenarios'
              : zh
                ? '已购插件'
                : 'Plugins'}
          </button>
        ))}
        <button
          onClick={() => {
            load()
            loadNotices()
          }}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-text-secondary hover:bg-surface-hover transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {zh ? '刷新' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            {kind === 'scenario'
              ? zh
                ? '暂无已购场景'
                : 'No purchased scenarios yet'
              : zh
                ? '暂无已购插件'
                : 'No purchased plugins yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl border border-border/40 bg-surface/30 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {currentSubjectName(item)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {item.expiresAt && !item.valid ? (
                      <span className="flex items-center gap-1 text-[12px] text-status-error">
                        <AlertTriangle className="w-3 h-3" />
                        {zh ? '已到期' : 'Expired'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[12px] text-green-400">
                        <CheckCircle2 className="w-3 h-3" />
                        {zh ? '权益有效' : 'Active'}
                      </span>
                    )}
                    {item.expiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-text-muted" />
                        {renderExpiry(item)}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-base font-bold text-text-primary shrink-0">
                  ¥{Number(item.price).toFixed(2)}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[12px] text-text-muted">
                  {item.renewCount > 0
                    ? zh
                      ? `已续费 ${item.renewCount - 1} 次`
                      : `Renewed ${item.renewCount - 1} time(s)`
                    : zh
                      ? `购买于 ${item.paidAt ? new Date(item.paidAt).toLocaleDateString('zh-CN') : '—'}`
                      : `Purchased ${item.paidAt ? new Date(item.paidAt).toLocaleDateString() : '—'}`}
                </p>
                {/* 永久买断的商品没有续费概念，不展示续费入口 */}
                {item.expiresAt !== null && (
                  <button
                    onClick={() => setRenewTarget(item)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                  >
                    {item.valid
                      ? zh
                        ? '续费'
                        : 'Renew'
                      : zh
                        ? '立即续费'
                        : 'Renew now'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 续费支付弹窗：支付成功后重新拉取权益状态 */}
      {renewTarget && (
        <PaymentDialog
          isOpen={!!renewTarget}
          title={zh ? '续费' : 'Renew'}
          subjectName={currentSubjectName(renewTarget)}
          amount={Number(renewTarget.price)}
          language={language}
          createOrder={(channel) => createRenewOrder(renewTarget, channel)}
          onPaid={async () => {
            await load()
            await loadNotices()
            toast.success(
              zh ? '续费成功，有效期已延长' : 'Renewed successfully, expiry extended',
              '',
            )
          }}
          onClose={() => setRenewTarget(null)}
          successHint={zh ? '有效期已延长' : 'Expiry extended'}
        />
      )}

      <p className="text-[12px] text-text-muted/70 text-center pt-2">
        {zh
          ? '到期前 7 / 3 / 1 天会收到提醒；到期后权益失效，续费即可恢复使用。系统不自动续费。'
          : 'You will be reminded 7 / 3 / 1 days before expiry. No auto-renewal.'}
      </p>
    </div>
  )
}

export default MyPurchasesPanel

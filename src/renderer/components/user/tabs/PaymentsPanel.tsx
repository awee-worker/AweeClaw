import { useState, useCallback, useEffect } from 'react'
import {
  Receipt,
  Loader2,
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { toast } from '@components/foundation/NotificationProvider'
import { type PaymentRecordItem, channelLabels } from './shared'

interface PaymentsPanelProps {
  language: Language
}

export function PaymentsPanel({ language }: PaymentsPanelProps) {
  const [records, setRecords] = useState<PaymentRecordItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const limit = 10

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const result = await backendApi.get<{ records: PaymentRecordItem[]; total: number }>(`/api/v1/payment/records?page=${page}&limit=${limit}`)
      setRecords(result?.records || [])
      setTotal(result?.total || 0)
    } catch {
      toast.error(t('user.failedtoloadpaymentrecords', language as Language), '')
    } finally {
      setLoading(false)
    }
  }, [page, language])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-12">
          <Receipt className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">{t('user.nopaymentrecords', language as Language)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(record => (
            <div key={record.id} className="p-4 rounded-xl border border-border/40 bg-surface/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-accent/60" />
                  <span className="text-sm font-medium text-text-primary">{record.order?.planDisplayName || '-'}</span>
                </div>
                <span className="text-xs text-text-muted">{new Date(record.paidAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-text-muted">
                <div className="space-y-0.5">
                  <p>{t('user.order', language as Language)}: {record.order?.orderNo}</p>
                  <p>{t('user.transaction', language as Language)}: {record.transactionId}</p>
                  <p>{t('user.channel', language as Language)}: {channelLabels[record.channel]?.[language === 'zh' ? 'zh' : 'en'] || record.channel}</p>
                </div>
                <p className="text-lg font-bold text-text-primary">¥{Number(record.paidAmount).toFixed(2)}</p>
              </div>
            </div>
          ))}

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

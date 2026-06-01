import { useState, useCallback, useEffect } from 'react'
import {
  FileText,
  Receipt,
  Trash2,
  Building2,
  User,
  Mail,
  Loader2,
} from 'lucide-react'
import { ActionButton, TextField } from '@components/ui'
import { t, type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { toast } from '@components/foundation/NotificationProvider'
import { type OrderItem, type InvoiceItem, invoiceStatusMap } from './shared'

interface InvoicesPanelProps {
  language: Language
}

export function InvoicesPanel({ language }: InvoicesPanelProps) {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showApplyForm, setShowApplyForm] = useState(false)
  const [paidOrders, setPaidOrders] = useState<OrderItem[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)

  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [titleType, setTitleType] = useState<'personal' | 'company'>('personal')
  const [invoiceTitle, setInvoiceTitle] = useState('')
  const [invoiceTaxNumber, setInvoiceTaxNumber] = useState('')
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const limit = 10

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const result = await backendApi.get<{ invoices: InvoiceItem[]; total: number }>(`/api/v1/invoice?page=${page}&limit=${limit}`)
      setInvoices(result?.invoices || [])
      setTotal(result?.total || 0)
    } catch {
      toast.error(t('user.failedtoloadinvoices', language as Language), '')
    } finally {
      setLoading(false)
    }
  }, [page, language])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  const fetchPaidOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const result = await backendApi.get<{ orders: OrderItem[] }>('/api/v1/payment/orders?page=1&limit=50')
      const paid = (result?.orders || []).filter(o => o.status === 'PAID')
      setPaidOrders(paid)
    } catch {
      toast.error(t('user.failedtoloadorders', language as Language), '')
    } finally {
      setLoadingOrders(false)
    }
  }, [language])

  const handleOpenApply = useCallback(() => {
    setShowApplyForm(true)
    setSelectedOrderId('')
    setTitleType('personal')
    setInvoiceTitle('')
    setInvoiceTaxNumber('')
    setInvoiceEmail('')
    fetchPaidOrders()
  }, [fetchPaidOrders])

  const handleSubmitApply = useCallback(async () => {
    if (!selectedOrderId || !invoiceTitle.trim()) {
      toast.error(t('user.pleasefillrequiredfields', language as Language), '')
      return
    }
    if (titleType === 'company' && !invoiceTaxNumber.trim()) {
      toast.error(t('user.pleaseentertaxnumber', language as Language), '')
      return
    }
    setSubmitting(true)
    try {
      await backendApi.post('/api/v1/invoice', {
        orderId: selectedOrderId,
        titleType,
        title: invoiceTitle.trim(),
        taxNumber: titleType === 'company' ? invoiceTaxNumber.trim() : undefined,
        email: invoiceEmail.trim() || undefined,
      })
      toast.success(t('user.applicationsubmitted', language as Language), '')
      setShowApplyForm(false)
      await fetchInvoices()
    } catch (e: any) {
      toast.error(t('user.applyfailed', language as Language), e?.message || '')
    } finally {
      setSubmitting(false)
    }
  }, [selectedOrderId, titleType, invoiceTitle, invoiceTaxNumber, invoiceEmail, language, fetchInvoices])

  const handleCancel = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      await backendApi.post(`/api/v1/invoice/${id}/cancel`)
      toast.success(t('user.invoicecancelled', language as Language), '')
      await fetchInvoices()
    } catch (e: any) {
      toast.error(t('user.cancelfailed', language as Language), e?.message || '')
    } finally {
      setActionLoading(null)
    }
  }, [language, fetchInvoices])

  const handleDelete = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      await backendApi.delete(`/api/v1/invoice/${id}`)
      toast.success(t('user.invoicedeleted', language as Language), '')
      await fetchInvoices()
    } catch (e: any) {
      toast.error(t('user.deletefailed', language as Language), e?.message || '')
    } finally {
      setActionLoading(null)
    }
  }, [language, fetchInvoices])

  const totalPages = Math.ceil(total / limit)

  if (showApplyForm) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setShowApplyForm(false)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
            {t('user.back', language as Language)}
          </button>
        </div>

        <h4 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <Receipt className="w-4 h-4 text-accent" />
          {t('user.applyforinvoice', language as Language)}
        </h4>

        {loadingOrders ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : paidOrders.length === 0 ? (
          <div className="text-center py-8 text-sm text-text-muted">
            {t('user.nopaidordersavailable', language as Language)}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{t('user.selectorder', language as Language)}</label>
              <select
                value={selectedOrderId}
                onChange={e => setSelectedOrderId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-surface/30 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">{t('user.selectorder2', language as Language)}</option>
                {paidOrders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} - {o.planDisplayName} ¥{Number(o.amount).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{t('user.titletype', language as Language)}</label>
              <div className="flex gap-2">
                {(['personal', 'company'] as const).map(titleOpt => (
                  <button
                    key={titleOpt}
                    onClick={() => setTitleType(titleOpt)}
                    className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-colors ${
                      titleType === titleOpt
                        ? 'bg-accent/10 border-accent/30 text-accent'
                        : 'bg-surface/30 border-border/30 text-text-secondary hover:bg-surface/50'
                    }`}
                  >
                    {titleOpt === 'personal' ? (t('user.personal', language as Language)) : (t('user.company', language as Language))}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{t('user.invoicetitle', language as Language)}</label>
              <TextField
                value={invoiceTitle}
                onChange={e => setInvoiceTitle(e.target.value)}
                placeholder={t('user.enterinvoicetitle', language as Language)}
                leftIcon={titleType === 'company' ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
              />
            </div>

            {titleType === 'company' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">{t('user.taxnumber', language as Language)}</label>
                <TextField
                  value={invoiceTaxNumber}
                  onChange={e => setInvoiceTaxNumber(e.target.value)}
                  placeholder={t('user.entertaxid', language as Language)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{t('user.email', language as Language)}</label>
              <TextField
                type="email"
                value={invoiceEmail}
                onChange={e => setInvoiceEmail(e.target.value)}
                placeholder={t('user.enteremailforinvoice', language as Language)}
                leftIcon={<Mail className="w-4 h-4" />}
              />
            </div>

            <div className="flex justify-end">
              <ActionButton variant="primary" onClick={handleSubmitApply} disabled={submitting} className="min-w-[120px]">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('user.submit', language as Language)}
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-primary">{t('user.invoicelist', language as Language)}</h4>
        <button
          onClick={handleOpenApply}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
        >
          {t('user.apply', language as Language)}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">{t('user.noinvoicesyet', language as Language)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => {
            const statusInfo = invoiceStatusMap[inv.status] || invoiceStatusMap.PENDING
            return (
              <div key={inv.id} className="p-4 rounded-xl border border-border/40 bg-surface/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-accent/60" />
                    <span className="text-sm font-medium text-text-primary">{inv.title}</span>
                    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${statusInfo.color}`}>
                      {language === 'zh' ? statusInfo.zh : statusInfo.en}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted">{new Date(inv.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <div className="space-y-0.5">
                    <p>{t('user.order', language as Language)}: {inv.order?.orderNo} · {inv.order?.planDisplayName} · ¥{Number(inv.order?.amount || 0).toFixed(2)}</p>
                    <p>{t('user.type', language as Language)}: {inv.titleType === 'company' ? (t('user.company2', language as Language)) : (t('user.personal2', language as Language))}{inv.taxNumber ? ` · ${inv.taxNumber}` : ''}</p>
                    {inv.invoiceNo && <p>{t('user.invoiceno', language as Language)}: {inv.invoiceNo}</p>}
                    {inv.rejectReason && <p className="text-red-400">{t('user.reason', language as Language)}: {inv.rejectReason}</p>}
                  </div>
                  {inv.invoiceUrl && inv.status === 'ISSUED' && (
                    <button
                      onClick={() => window.electronAPI?.openExternalUrl?.(inv.invoiceUrl!)}
                      className="px-2 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                    >
                      {t('user.view', language as Language)}
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  {inv.status === 'PENDING' && (
                    <button
                      onClick={() => handleCancel(inv.id)}
                      disabled={actionLoading === inv.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface/50 text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {actionLoading === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t('user.cancel', language as Language)}
                    </button>
                  )}
                  {(inv.status === 'CANCELLED' || inv.status === 'REJECTED' || inv.status === 'ISSUED') && (
                    <button
                      onClick={() => handleDelete(inv.id)}
                      disabled={actionLoading === inv.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-status-error/70 hover:text-status-error hover:bg-status-error/5 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Trash2 className="w-3 h-3 inline mr-1" />{t('user.delete', language as Language)}</>}
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

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
import { type Language } from '@renderer/i18n'
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
      toast.error(language === 'zh' ? '获取发票列表失败' : 'Failed to load invoices', '')
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
      toast.error(language === 'zh' ? '获取订单失败' : 'Failed to load orders', '')
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
      toast.error(language === 'zh' ? '请填写必要信息' : 'Please fill required fields', '')
      return
    }
    if (titleType === 'company' && !invoiceTaxNumber.trim()) {
      toast.error(language === 'zh' ? '请填写税号' : 'Please enter tax number', '')
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
      toast.success(language === 'zh' ? '申请已提交' : 'Application submitted', '')
      setShowApplyForm(false)
      await fetchInvoices()
    } catch (e: any) {
      toast.error(language === 'zh' ? '申请失败' : 'Apply failed', e?.message || '')
    } finally {
      setSubmitting(false)
    }
  }, [selectedOrderId, titleType, invoiceTitle, invoiceTaxNumber, invoiceEmail, language, fetchInvoices])

  const handleCancel = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      await backendApi.post(`/api/v1/invoice/${id}/cancel`)
      toast.success(language === 'zh' ? '发票已取消' : 'Invoice cancelled', '')
      await fetchInvoices()
    } catch (e: any) {
      toast.error(language === 'zh' ? '取消失败' : 'Cancel failed', e?.message || '')
    } finally {
      setActionLoading(null)
    }
  }, [language, fetchInvoices])

  const handleDelete = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      await backendApi.delete(`/api/v1/invoice/${id}`)
      toast.success(language === 'zh' ? '发票已删除' : 'Invoice deleted', '')
      await fetchInvoices()
    } catch (e: any) {
      toast.error(language === 'zh' ? '删除失败' : 'Delete failed', e?.message || '')
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
            {language === 'zh' ? '← 返回' : '← Back'}
          </button>
        </div>

        <h4 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <Receipt className="w-4 h-4 text-accent" />
          {language === 'zh' ? '申请开票' : 'Apply for Invoice'}
        </h4>

        {loadingOrders ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : paidOrders.length === 0 ? (
          <div className="text-center py-8 text-sm text-text-muted">
            {language === 'zh' ? '暂无可开票订单' : 'No paid orders available'}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '选择订单' : 'Select Order'}</label>
              <select
                value={selectedOrderId}
                onChange={e => setSelectedOrderId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-surface/30 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">{language === 'zh' ? '请选择订单' : 'Select order'}</option>
                {paidOrders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} - {o.planDisplayName} ¥{Number(o.amount).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '抬头类型' : 'Title Type'}</label>
              <div className="flex gap-2">
                {(['personal', 'company'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTitleType(t)}
                    className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-colors ${
                      titleType === t
                        ? 'bg-accent/10 border-accent/30 text-accent'
                        : 'bg-surface/30 border-border/30 text-text-secondary hover:bg-surface/50'
                    }`}
                  >
                    {t === 'personal' ? (language === 'zh' ? '个人' : 'Personal') : (language === 'zh' ? '企业' : 'Company')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '发票抬头' : 'Invoice Title'}</label>
              <TextField
                value={invoiceTitle}
                onChange={e => setInvoiceTitle(e.target.value)}
                placeholder={language === 'zh' ? '输入发票抬头' : 'Enter invoice title'}
                leftIcon={titleType === 'company' ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
              />
            </div>

            {titleType === 'company' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '税号' : 'Tax Number'}</label>
                <TextField
                  value={invoiceTaxNumber}
                  onChange={e => setInvoiceTaxNumber(e.target.value)}
                  placeholder={language === 'zh' ? '输入纳税人识别号' : 'Enter tax ID'}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '接收邮箱' : 'Email'}</label>
              <TextField
                type="email"
                value={invoiceEmail}
                onChange={e => setInvoiceEmail(e.target.value)}
                placeholder={language === 'zh' ? '输入接收发票的邮箱' : 'Enter email for invoice'}
                leftIcon={<Mail className="w-4 h-4" />}
              />
            </div>

            <div className="flex justify-end">
              <ActionButton variant="primary" onClick={handleSubmitApply} disabled={submitting} className="min-w-[120px]">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : language === 'zh' ? '提交申请' : 'Submit'}
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
        <h4 className="text-sm font-medium text-text-primary">{language === 'zh' ? '发票列表' : 'Invoice List'}</h4>
        <button
          onClick={handleOpenApply}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
        >
          {language === 'zh' ? '+ 申请开票' : '+ Apply'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">{language === 'zh' ? '暂无发票' : 'No invoices yet'}</p>
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
                    <p>{language === 'zh' ? '订单' : 'Order'}: {inv.order?.orderNo} · {inv.order?.planDisplayName} · ¥{Number(inv.order?.amount || 0).toFixed(2)}</p>
                    <p>{language === 'zh' ? '类型' : 'Type'}: {inv.titleType === 'company' ? (language === 'zh' ? '企业' : 'Company') : (language === 'zh' ? '个人' : 'Personal')}{inv.taxNumber ? ` · ${inv.taxNumber}` : ''}</p>
                    {inv.invoiceNo && <p>{language === 'zh' ? '发票号' : 'Invoice No'}: {inv.invoiceNo}</p>}
                    {inv.rejectReason && <p className="text-red-400">{language === 'zh' ? '驳回原因' : 'Reason'}: {inv.rejectReason}</p>}
                  </div>
                  {inv.invoiceUrl && inv.status === 'ISSUED' && (
                    <button
                      onClick={() => window.electronAPI?.openExternalUrl?.(inv.invoiceUrl!)}
                      className="px-2 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                    >
                      {language === 'zh' ? '查看' : 'View'}
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
                      {actionLoading === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : language === 'zh' ? '取消' : 'Cancel'}
                    </button>
                  )}
                  {(inv.status === 'CANCELLED' || inv.status === 'REJECTED' || inv.status === 'ISSUED') && (
                    <button
                      onClick={() => handleDelete(inv.id)}
                      disabled={actionLoading === inv.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-status-error/70 hover:text-status-error hover:bg-status-error/5 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Trash2 className="w-3 h-3 inline mr-1" />{language === 'zh' ? '删除' : 'Delete'}</>}
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
                {language === 'zh' ? '上一页' : 'Prev'}
              </button>
              <span className="text-xs text-text-muted">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface/50 text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                {language === 'zh' ? '下一页' : 'Next'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { Feather, Crown, Rocket } from 'lucide-react'
import type { Language } from '@renderer/i18n'

export type ProfileTab = 'plan' | 'profile' | 'security' | 'desktop'

export type BillingTab = 'orders' | 'invoices' | 'payments' | 'usage'

export interface PlanItem {
  id: string
  name: string
  displayName: string
  description: string | null
  tokenLimit: number
  price: number
  isActive: boolean
  isDefault: boolean
}

export interface PaymentResult {
  orderNo: string
  qrCodeUrl?: string
  paymentUrl?: string
}

export interface PaymentChannelInfo {
  channels: string[]
  mockMode: boolean
}

export interface OrderItem {
  id: string
  orderNo: string
  planName: string
  planDisplayName: string
  amount: string
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED'
  channel: string
  periodMonths: number
  paidAt: string | null
  expiredAt: string | null
  cancelledAt: string | null
  createdAt: string
  paymentRecords: Array<{ transactionId: string; paidAmount: number; paidAt: string }>
}

export interface InvoiceItem {
  id: string
  orderId: string
  type: 'ELECTRONIC' | 'PAPER'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ISSUED'
  titleType: string
  title: string
  taxNumber: string | null
  email: string | null
  invoiceNo: string | null
  invoiceUrl: string | null
  rejectReason: string | null
  issuedAt: string | null
  cancelledAt: string | null
  createdAt: string
  order: { orderNo: string; planDisplayName: string; amount: string; paidAt: string | null }
}

export interface PaymentRecordItem {
  id: string
  transactionId: string
  channel: string
  paidAmount: number
  paidAt: string
  order: { orderNo: string; planDisplayName: string; amount: string }
}

export const planIcons: Record<string, React.ReactNode> = {
  FREE: <Feather className="w-5 h-5 text-text-muted" />,
  PRO: <Crown className="w-5 h-5 text-violet-400" />,
  ENTERPRISE: <Rocket className="w-5 h-5 text-amber-400" />,
}

export const planColors: Record<string, string> = {
  FREE: 'border-text-muted/30 bg-text-muted/5',
  PRO: 'border-violet-500/30 bg-violet-500/5',
  ENTERPRISE: 'border-amber-500/30 bg-amber-500/5',
}

export const channelLabels: Record<string, { zh: string; en: string }> = {
  WECHAT: { zh: '微信支付', en: 'WeChat Pay' },
  ALIPAY: { zh: '支付宝', en: 'Alipay' },
  MOCK: { zh: '模拟支付', en: 'Mock Pay' },
}

export const channelStyles: Record<string, { active: string; inactive: string }> = {
  WECHAT: {
    active: 'border-green-500/50 bg-green-500/10 ring-1 ring-green-500/30',
    inactive: 'border-border/50 bg-surface/30 hover:border-border',
  },
  ALIPAY: {
    active: 'border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30',
    inactive: 'border-border/50 bg-surface/30 hover:border-border',
  },
  MOCK: {
    active: 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30',
    inactive: 'border-border/50 bg-surface/30 hover:border-border',
  },
}

export const orderStatusMap: Record<string, { zh: string; en: string; color: string }> = {
  PENDING: { zh: '待支付', en: 'Pending', color: 'text-amber-400 bg-amber-400/10' },
  PAID: { zh: '已支付', en: 'Paid', color: 'text-green-400 bg-green-400/10' },
  CANCELLED: { zh: '已取消', en: 'Cancelled', color: 'text-text-muted bg-surface/50' },
  REFUNDED: { zh: '已退款', en: 'Refunded', color: 'text-blue-400 bg-blue-400/10' },
  EXPIRED: { zh: '已过期', en: 'Expired', color: 'text-text-muted bg-surface/50' },
}

export const invoiceStatusMap: Record<string, { zh: string; en: string; color: string }> = {
  PENDING: { zh: '审核中', en: 'Pending', color: 'text-amber-400 bg-amber-400/10' },
  APPROVED: { zh: '已审核', en: 'Approved', color: 'text-blue-400 bg-blue-400/10' },
  REJECTED: { zh: '已驳回', en: 'Rejected', color: 'text-red-400 bg-red-400/10' },
  CANCELLED: { zh: '已取消', en: 'Cancelled', color: 'text-text-muted bg-surface/50' },
  ISSUED: { zh: '已开票', en: 'Issued', color: 'text-green-400 bg-green-400/10' },
}

export type { Language }

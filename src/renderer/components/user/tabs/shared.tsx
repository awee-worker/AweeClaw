import { Feather, Crown, Rocket, Users } from 'lucide-react'
import type { Language } from '@renderer/i18n'

export type ProfileTab = 'plan' | 'subscription' | 'profile' | 'security'

export type BillingTab = 'orders' | 'booster' | 'invoices' | 'payments' | 'usage'

/** 套餐功能矩阵结构（与后端 PlanFeatures 对齐） */
export interface PlanFeaturesData {
  modes?: string[]
  toolsLimit?: number
  mcp?: boolean
  skill?: boolean
  codebaseIndex?: boolean
  scenarioDiscount?: number
  prioritySupport?: boolean
  seats?: number
  teamCollaboration?: boolean
  privateDeployment?: boolean
  sla?: boolean
}

export interface PlanItem {
  id: string
  name: string
  displayName: string
  description: string | null
  tokenLimit: number
  price: number
  yearPrice: number | null
  seats?: number
  sort?: number
  isActive: boolean
  isDefault: boolean
  features?: PlanFeaturesData | Record<string, unknown> | null
}

export interface PaymentResult {
  /** 支付网关下单是否成功 */
  success?: boolean
  orderNo: string
  qrCodeUrl?: string
  paymentUrl?: string
  /** 失败时的错误信息 */
  error?: string
}

export interface PaymentChannelInfo {
  /** 渠道列表（兼容旧格式字符串数组和新格式对象数组） */
  channels: string[] | Array<{ channel: string; iconUrl: string | null }>
  mockMode: boolean
}

/**
 * 从 PaymentChannelInfo 中提取渠道名称列表（兼容新旧格式）
 */
export function extractChannelNames(info: PaymentChannelInfo | undefined): string[] {
  if (!info?.channels) return []
  if (info.channels.length === 0) return []
  if (typeof info.channels[0] === 'string') {
    return info.channels as string[]
  }
  return (info.channels as Array<{ channel: string; iconUrl: string | null }>).map(
    (c) => c.channel,
  )
}

/**
 * 获取渠道图标 URL（新格式才有）
 */
export function getChannelIconUrl(
  info: PaymentChannelInfo | undefined,
  channel: string,
): string | null {
  if (!info?.channels) return null
  if (info.channels.length === 0) return null
  if (typeof info.channels[0] === 'string') return null
  const found = (info.channels as Array<{ channel: string; iconUrl: string | null }>).find(
    (c) => c.channel === channel,
  )
  return found?.iconUrl || null
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
  status: 'PENDING' | 'APROVED' | 'REJECTED' | 'CANCELLED' | 'ISSUED'
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
  TEAM: <Users className="w-5 h-5 text-blue-400" />,
  ENTERPRISE: <Rocket className="w-5 h-5 text-amber-400" />,
}

export const planColors: Record<string, string> = {
  FREE: 'border-text-muted/30 bg-text-muted/5',
  PRO: 'border-violet-500/30 bg-violet-500/5',
  TEAM: 'border-blue-500/30 bg-blue-500/5',
  ENTERPRISE: 'border-amber-500/30 bg-amber-500/5',
}

/** 套餐主题色（用于强调元素，如选中边框、价格文字） */
export const planAccents: Record<string, string> = {
  FREE: 'text-text-muted',
  PRO: 'text-violet-400',
  TEAM: 'text-blue-400',
  ENTERPRISE: 'text-amber-400',
}

export const channelLabels: Record<string, { zh: string; en: string }> = {
  WECHAT: { zh: '微信支付', en: 'WeChat Pay' },
  ALIPAY: { zh: '支付宝', en: 'Alipay' },
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

/**
 * 格式化 Token 额度展示
 * -1 表示无限
 */
export function formatTokenLimit(limit: number): string {
  if (limit === -1) return '∞'
  if (limit >= 1000000) return `${(limit / 1000000).toFixed(limit % 1000000 === 0 ? 0 : 1)}M`
  if (limit >= 1000) return `${(limit / 1000).toFixed(limit % 1000 === 0 ? 0 : 1)}K`
  return String(limit)
}

/**
 * 解析套餐 features 字段（容错处理）
 */
export function parsePlanFeatures(raw: unknown): PlanFeaturesData {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as PlanFeaturesData
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as PlanFeaturesData
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * 获取套餐功能亮点列表（用于卡片展示）
 * 返回有序的功能亮点标签
 */
export function getPlanHighlights(
  plan: PlanItem,
  language: Language,
): Array<{ label: string; enabled: boolean }> {
  const features = parsePlanFeatures(plan.features)
  const zh = language === 'zh'

  // Token 额度
  const tokenLabel =
    plan.tokenLimit === -1
      ? zh ? '无限 Token' : 'Unlimited Tokens'
      : `${formatTokenLimit(plan.tokenLimit)} ${zh ? 'Token' : 'Tokens'}`

  // 工作模式
  const modes = features.modes ?? ['quick']
  const modeLabel = zh
    ? modes.includes('expert')
      ? '专家模式'
      : modes.includes('think')
        ? '思考模式'
        : '极速模式'
    : modes.includes('expert')
      ? 'Expert Mode'
      : modes.includes('think')
        ? 'Think Mode'
        : 'Quick Mode'

  // 工具数量
  const toolsLimit = features.toolsLimit ?? 10
  const toolsLabel = toolsLimit === -1
    ? (zh ? '无限工具' : 'Unlimited Tools')
    : (zh ? `${toolsLimit} 个工具` : `${toolsLimit} Tools`)

  return [
    { label: tokenLabel, enabled: true },
    { label: modeLabel, enabled: true },
    { label: toolsLabel, enabled: true },
    { label: zh ? 'MCP' : 'MCP', enabled: Boolean(features.mcp) },
    { label: zh ? '技能' : 'Skills', enabled: Boolean(features.skill) },
    { label: zh ? '代码库索引' : 'Codebase Index', enabled: Boolean(features.codebaseIndex) },
    { label: zh ? '优先支持' : 'Priority Support', enabled: Boolean(features.prioritySupport) },
    { label: zh ? '团队协作' : 'Team Collaboration', enabled: Boolean(features.teamCollaboration) },
    { label: zh ? '私有部署' : 'Private Deployment', enabled: Boolean(features.privateDeployment) },
  ]
}

export type { Language }

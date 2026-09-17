import { Feather, Crown, Rocket, Users } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { CAPABILITY_GROUPS } from '@configuration/toolCategoryDefs'

/** 用户中心 Tab（加油包紧随套餐管理，属于同一购买场景） */
export type ProfileTab = 'plan' | 'booster' | 'subscription' | 'profile' | 'security'

export type BillingTab = 'orders' | 'purchases' | 'invoices' | 'payments' | 'usage'

/** 套餐功能矩阵结构（与后端 PlanFeatures 对齐） */
export interface PlanFeaturesData {
  modes?: string[]
  /**
   * 工具能力组白名单（组定义见 @configuration/toolCategoryDefs）
   * `undefined` = 未配置 → 全放行
   */
  allowedToolGroups?: string[]
  mcp?: boolean
  skill?: boolean
  codebaseIndex?: boolean
  scenarioDiscount?: number
  prioritySupport?: boolean
  seats?: number
  teamCollaboration?: boolean
  privateDeployment?: boolean
  sla?: boolean

  // ── 能力数量上限（-1 表示无限；undefined 表示未配置，卡片不展示该项） ──
  /** 自定义智能体数量上限 */
  customAgentsLimit?: number
  /** 桌面伴侣角色模型数量上限 */
  companionModelsLimit?: number
  /** 项目数量上限 */
  projectsLimit?: number
  /** 自动化任务数量上限（自动化规则 + 定时任务） */
  automationTasksLimit?: number

  // ── 客户端功能开关 ──
  /** 直播互动（B站 / YouTube / Twitch 弹幕接入） */
  liveInteraction?: boolean
  /** VTS（VTube Studio）联动 */
  vts?: boolean
  /** A2A（Agent2Agent）协议 */
  a2a?: boolean
  /** 对外 OpenAPI 服务 */
  externalApi?: boolean
  /** VMC（Virtual Motion Capture）协议 */
  vmc?: boolean
  /** IoT 集成 */
  iot?: boolean
  /** 感知预测（行为预测 / 场景感知） */
  perception?: boolean
  /** 主动助手（主动建议与预授权动作） */
  proactive?: boolean
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
  /** 订单类型：SUBSCRIPTION 套餐 / BOOSTER 加油包 / SCENARIO / PLUGIN / MCP */
  type?: string
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

/** 能力分组 */
export type PlanCapabilityGroup = 'core' | 'quota' | 'client'

/** 分组展示标题 */
export const planCapabilityGroupLabels: Record<
  PlanCapabilityGroup,
  { zh: string; en: string }
> = {
  core: { zh: '核心能力', en: 'Core' },
  quota: { zh: '数量上限', en: 'Limits' },
  client: { zh: '扩展功能', en: 'Extensions' },
}

/** 卡片展示时的分组顺序 */
export const planCapabilityGroupOrder: PlanCapabilityGroup[] = ['core', 'quota', 'client']

export interface PlanCapability {
  /** 展示文案 */
  label: string
  /** 当前套餐是否包含该能力 */
  enabled: boolean
  /** 所属分组 */
  group: PlanCapabilityGroup
}

/**
 * 工作模式条目（与后端 features.modes 取值对齐；文案与客户端 MODE_CONFIGS 一致）
 *
 * 逐项独立展示，而非合并为一个「极速/思考/专家模式」标签——
 * 合并后无法判断某个模式到底为哪个套餐所有，失去横向对比意义。
 */
const MODE_ITEMS: Array<{ id: string; zh: string; en: string }> = [
  { id: 'quick', zh: '快速模式', en: 'Quick Mode' },
  { id: 'think', zh: '思考模式', en: 'Think Mode' },
  { id: 'expert', zh: '专家模式', en: 'Expert Mode' },
]

/** 客户端能力开关键（与后端 PlanFeatures 对齐） */
type PlanClientCapabilityKey =
  | 'liveInteraction'
  | 'vts'
  | 'vmc'
  | 'a2a'
  | 'externalApi'
  | 'iot'
  | 'perception'
  | 'proactive'

/** 客户端能力开关键 → i18n 文案键（复用付费墙的既有译名，保证口径一致） */
const CLIENT_CAPABILITY_ITEMS: Array<[PlanClientCapabilityKey, string]> = [
  ['liveInteraction', 'featureguard.capability.liveInteraction'],
  ['vts', 'featureguard.capability.vts'],
  ['vmc', 'featureguard.capability.vmc'],
  ['a2a', 'featureguard.capability.a2a'],
  ['externalApi', 'featureguard.capability.externalApi'],
  ['iot', 'featureguard.capability.iot'],
  ['perception', 'featureguard.capability.perception'],
  ['proactive', 'featureguard.capability.proactive'],
]

/**
 * 数量上限文案
 * - `-1` → 无限
 * - `undefined` / `null` → 未配置，返回 null（调用方跳过不展示）
 */
function formatQuotaLabel(
  limit: number | undefined | null,
  zh: boolean,
  zhName: string,
  enName: string,
): string | null {
  if (limit === undefined || limit === null) return null
  if (limit === -1) return zh ? `${zhName} 无限` : `Unlimited ${enName}`
  return zh ? `${zhName} ${limit} 个` : `${limit} ${enName}`
}

/** 数量上限条目定义（数组顺序即展示顺序） */
const QUOTA_FIELDS: Array<{
  key:
    | 'seats'
    | 'customAgentsLimit'
    | 'companionModelsLimit'
    | 'projectsLimit'
    | 'automationTasksLimit'
  zh: string
  en: string
}> = [
  { key: 'seats', zh: '席位', en: 'Seats' },
  { key: 'customAgentsLimit', zh: '智能体', en: 'Agents' },
  { key: 'companionModelsLimit', zh: '伴侣模型', en: 'Companion Models' },
  { key: 'projectsLimit', zh: '项目', en: 'Projects' },
  { key: 'automationTasksLimit', zh: '自动化任务', en: 'Automation Tasks' },
]

/**
 * 获取套餐完整能力清单（用于卡片全量展示）
 *
 * 分组：
 * - `core`  核心能力：Token / 工作模式（逐项）/ 工具能力组（逐组）/ MCP / 技能 / 代码库索引 / 优先支持 / 团队协作 / 私有部署 / SLA
 * - `quota` 数量上限：席位 / 智能体 / 伴侣模型 / 项目 / 自动化任务
 * - `client` 扩展功能：直播互动 / VTS / VMC / A2A / 对外 API / IoT / 感知预测 / 主动助手
 *
 * 未包含的能力仍返回（`enabled: false`），由卡片置灰打叉展示，保证各套餐可横向逐项对比。
 */
export function getPlanCapabilities(plan: PlanItem, language: Language): PlanCapability[] {
  const features = parsePlanFeatures(plan.features)
  const zh = language === 'zh'
  const caps: PlanCapability[] = []

  // ── 核心能力 ──
  caps.push({
    group: 'core',
    enabled: true,
    label:
      plan.tokenLimit === -1
        ? zh
          ? '无限 Token'
          : 'Unlimited Tokens'
        : `${formatTokenLimit(plan.tokenLimit)} ${zh ? 'Token' : 'Tokens'}`,
  })

  // 工作模式：逐项展示可用性，而非合并成一个标签，便于对比各套餐支持哪些模式
  const modes = features.modes ?? ['quick']
  for (const mode of MODE_ITEMS) {
    caps.push({
      group: 'core',
      enabled: modes.includes(mode.id),
      label: zh ? mode.zh : mode.en,
    })
  }

  // 工具能力组：逐组展开，让用户看到具体能用哪些能力组（而非「N 类工具」这种模糊描述）
  // 组名与顺序取自 CAPABILITY_GROUPS（与后端 tool-catalog.ts 逐项对齐）
  // undefined = 未配置（全放行）；[] = 仅系统必需工具
  const toolGroups = features.allowedToolGroups
  for (const group of CAPABILITY_GROUPS) {
    caps.push({
      group: 'core',
      enabled: toolGroups === undefined || toolGroups.includes(group.id),
      label: zh ? group.name : group.nameEn,
    })
  }

  caps.push(
    { group: 'core', enabled: Boolean(features.mcp), label: 'MCP' },
    { group: 'core', enabled: Boolean(features.skill), label: zh ? '技能' : 'Skills' },
    {
      group: 'core',
      enabled: Boolean(features.codebaseIndex),
      label: zh ? '代码库索引' : 'Codebase Index',
    },
    {
      group: 'core',
      enabled: Boolean(features.prioritySupport),
      label: zh ? '优先支持' : 'Priority Support',
    },
    {
      group: 'core',
      enabled: Boolean(features.teamCollaboration),
      label: zh ? '团队协作' : 'Team Collaboration',
    },
    {
      group: 'core',
      enabled: Boolean(features.privateDeployment),
      label: zh ? '私有部署' : 'Private Deployment',
    },
    { group: 'core', enabled: Boolean(features.sla), label: zh ? 'SLA 保障' : 'SLA' },
  )

  // ── 数量上限（-1 = 无限；未配置则不展示该项） ──
  for (const field of QUOTA_FIELDS) {
    const raw = field.key === 'seats' ? features.seats ?? plan.seats : features[field.key]
    if (raw === undefined) continue
    const label = formatQuotaLabel(raw, zh, field.zh, field.en)
    if (!label) continue
    caps.push({ group: 'quota', enabled: raw === -1 || raw > 0, label })
  }

  // ── 扩展功能（客户端能力开关） ──
  for (const [key, i18nKey] of CLIENT_CAPABILITY_ITEMS) {
    caps.push({ group: 'client', enabled: Boolean(features[key]), label: t(i18nKey, language) })
  }

  return caps
}

export type { Language }

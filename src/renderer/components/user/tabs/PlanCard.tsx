/**
 * PlanCard — 套餐横向卡片组件
 *
 * 职责：
 * 1. 横向布局展示套餐信息：左侧图标+名称+描述，中间功能亮点，右侧价格+操作
 * 2. 当前套餐显示灰色样式 + "当前套餐"标签，不可选中
 * 3. 企业版（price=0 且非免费）显示"联系销售"
 * 4. 选中状态高亮，支持点击选中
 *
 * 使用示例：
 *   <PlanCard
 *     plan={plan}
 *     isCurrent={plan.name === effectivePlanId}
 *     selected={selectedPlan?.id === plan.id}
 *     onSelect={() => handleSelect(plan)}
 *     billingPeriod="monthly"
 *     language="zh"
 *   />
 */
import { CreditCard, Check, X, Mail } from 'lucide-react'
import { type Language } from '@renderer/i18n'
import {
  type PlanItem,
  planIcons,
  planColors,
  planAccents,
  getPlanHighlights,
} from './shared'

export interface PlanCardProps {
  plan: PlanItem
  /** 是否为当前生效套餐 */
  isCurrent: boolean
  /** 是否被选中（待支付） */
  selected: boolean
  /** 选中回调（当前套餐不触发） */
  onSelect: (plan: PlanItem) => void
  /** 计费周期 */
  billingPeriod: 'monthly' | 'yearly'
  language: Language
}

export function PlanCard({
  plan,
  isCurrent,
  selected,
  onSelect,
  billingPeriod,
  language,
}: PlanCardProps) {
  const zh = language === 'zh'
  const highlights = getPlanHighlights(plan, language)
  const accent = planAccents[plan.name] || 'text-text-primary'
  const isEnterprise = plan.name === 'ENTERPRISE'
  const isFreePlan = plan.name === 'FREE'

  // 价格展示：年付时显示月均价格
  const monthlyPrice =
    billingPeriod === 'yearly' && plan.yearPrice
      ? plan.yearPrice / 12
      : Number(plan.price)

  // 免费版不可订阅（到期自动降级，无需手动选择）
  const isDisabled = isCurrent || isFreePlan

  // 当前套餐或免费版：灰色样式 + 禁用交互
  const containerCls = isDisabled
    ? 'border-border/30 bg-surface/20 opacity-60 cursor-default'
    : selected
      ? `${planColors[plan.name] || 'border-accent/30 bg-accent/5'} border-accent/50 ring-1 ring-accent/30 cursor-pointer`
      : `${planColors[plan.name] || 'border-border/50 bg-surface/30'} hover:border-border hover:bg-surface/50 cursor-pointer`

  const handleClick = () => {
    if (isDisabled) return
    onSelect(plan)
  }

  return (
    <div
      role={isDisabled ? 'presentation' : 'button'}
      tabIndex={isDisabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick()
        }
      }}
      className={`relative w-full p-4 rounded-xl border transition-all ${containerCls}`}
    >
      <div className="flex items-start gap-3">
        {/* 左侧：图标 */}
        <div className="shrink-0 mt-0.5">
          {planIcons[plan.name] || <CreditCard className="w-5 h-5 text-text-muted" />}
        </div>

        {/* 中间：名称 + 描述 + 功能亮点 */}
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-semibold ${isCurrent ? 'text-text-muted' : 'text-text-primary'}`}>
                {plan.displayName}
              </p>
              {isCurrent && (
                <span className="px-1.5 py-0.5 rounded text-[12px] font-medium bg-accent/15 text-accent">
                  {zh ? '当前套餐' : 'Current'}
                </span>
              )}
              {isFreePlan && !isCurrent && (
                <span className="px-1.5 py-0.5 rounded text-[12px] font-medium bg-green-500/10 text-green-400">
                  {zh ? '免费' : 'Free'}
                </span>
              )}
              {isEnterprise && (
                <span className="px-1.5 py-0.5 rounded text-[12px] font-medium bg-amber-500/10 text-amber-400">
                  {zh ? '定制' : 'Custom'}
                </span>
              )}
            </div>
            {plan.description && (
              <p className="text-[12px] text-text-muted mt-0.5 truncate">{plan.description}</p>
            )}
          </div>

          {/* 功能亮点标签 */}
          <div className="flex flex-wrap gap-1.5">
            {highlights.slice(0, 6).map((h, idx) => (
              <span
                key={idx}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] ${
                  h.enabled
                    ? isCurrent
                      ? 'bg-text-muted/5 text-text-muted'
                      : 'bg-surface/50 text-text-secondary'
                    : 'bg-surface/30 text-text-muted/50 line-through'
                }`}
              >
                {h.enabled ? (
                  <Check className="w-3 h-3 shrink-0" />
                ) : (
                  <X className="w-3 h-3 shrink-0" />
                )}
                {h.label}
              </span>
            ))}
          </div>
        </div>

        {/* 右侧：价格 + 操作 */}
        <div className="shrink-0 text-right flex flex-col items-end justify-between gap-2 min-w-[80px]">
          <div>
            {isFreePlan ? (
              <p className={`text-lg font-bold ${isCurrent ? 'text-text-muted' : accent}`}>
                {zh ? '免费' : 'Free'}
              </p>
            ) : isEnterprise ? (
              <p className={`text-lg font-bold ${isCurrent ? 'text-text-muted' : accent}`}>
                {zh ? '联系销售' : 'Contact'}
              </p>
            ) : (
              <>
                <p className={`text-lg font-bold ${isCurrent ? 'text-text-muted' : accent}`}>
                  ¥{monthlyPrice.toFixed(0)}
                </p>
                <p className="text-[12px] text-text-muted">
                  {zh ? '/月' : '/mo'}
                </p>
                {billingPeriod === 'yearly' && plan.yearPrice && (
                  <p className="text-[12px] text-accent/80">
                    ¥{plan.yearPrice}/{zh ? '年' : 'yr'}
                  </p>
                )}
              </>
            )}
          </div>

          {/* 操作按钮 / 状态标签 */}
          <div>
            {isCurrent ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-muted">
                <Check className="w-3 h-3" />
                {zh ? '使用中' : 'Active'}
              </span>
            ) : isFreePlan ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-muted">
                {zh ? '基础套餐' : 'Basic'}
              </span>
            ) : isEnterprise ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  window.electronAPI?.openExternalUrl?.('mailto:sales@aweeclaw.com')
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
              >
                <Mail className="w-3 h-3" />
                {zh ? '联系' : 'Contact'}
              </button>
            ) : selected ? (
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium bg-accent/10 ${accent}`}>
                <Check className="w-3 h-3" />
                {zh ? '已选' : 'Selected'}
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-medium text-text-muted">
                {zh ? '选择' : 'Select'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

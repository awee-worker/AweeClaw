/**
 * AboutPartnerTab —「合伙人」Tab
 *
 * 展示三类合伙人招募计划：合伙人、场景应用开发者、插件与技能开发者，
 * 并提供联系方式入口。
 *
 * 内容结构：
 *   1. 顶部标题区：合伙人计划定位 + 副标题
 *   2. 招募卡片（3 个，纵向排列）：三类招募方向
 *   3. 权益说明：加入后可获得的资源与支持
 *   4. 底部联系方式（AboutContactCard 复用）
 *
 * 数据来源：招募项为静态配置，联系方式来自 BRAND.contact。
 */
import { motion } from 'framer-motion'
import { Handshake, Compass, Blocks, Sparkles, TrendingUp } from 'lucide-react'
import { AboutContactCard } from './AboutContactCard'

/** 招募方向配置 */
const RECRUITMENTS = [
  {
    icon: Handshake,
    accentClass: 'from-blue-500/15 to-transparent border-blue-500/30',
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-400',
    labelZh: '合伙人招募',
    labelEn: 'Partner Program',
    descZh: '面向区域与行业合作伙伴，共建 AweeClaw 生态，共享商业收益',
    descEn: 'For regional and industry partners to co-build the ecosystem',
    benefitsZh: ['区域/行业独家授权', '销售分润体系', '品牌联合推广', '优先产品支持'],
    benefitsEn: ['Regional exclusive license', 'Sales revenue sharing', 'Co-marketing', 'Priority support'],
  },
  {
    icon: Compass,
    accentClass: 'from-violet-500/15 to-transparent border-violet-500/30',
    iconBg: 'bg-violet-500/10',
    iconColor: 'text-violet-400',
    labelZh: '场景应用开发者',
    labelEn: 'Scenario Developers',
    descZh: '开发垂直领域场景应用，上架市场获取收益，触达海量用户',
    descEn: 'Build vertical scenario apps, publish to marketplace, reach users',
    benefitsZh: ['场景应用上架销售', '收益自主定价', '开发者技术支持', '流量曝光扶持'],
    benefitsEn: ['Publish & sell scenarios', 'Autonomous pricing', 'Dev tech support', 'Traffic exposure'],
  },
  {
    icon: Blocks,
    accentClass: 'from-emerald-500/15 to-transparent border-emerald-500/30',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-400',
    labelZh: '插件与技能开发者',
    labelEn: 'Plugin & Skill Developers',
    descZh: '开发 MCP 插件与技能扩展，丰富平台能力，获取持续收益',
    descEn: 'Build MCP plugins and skills to enrich the platform and earn',
    benefitsZh: ['插件市场上架', '付费/免费灵活选择', 'SDK 与文档支持', '社区共建认证'],
    benefitsEn: ['Plugin marketplace', 'Free or paid options', 'SDK & docs', 'Community certification'],
  },
]

/** 加入后权益 */
const PRIVILEGES = [
  { icon: TrendingUp, labelZh: '商业收益', labelEn: 'Revenue', descZh: '多渠道变现，收益透明结算', descEn: 'Multi-channel monetization, transparent settlement' },
  { icon: Sparkles, labelZh: '技术赋能', labelEn: 'Tech Enablement', descZh: 'SDK / API / 文档全方位支持', descEn: 'SDK, API and full documentation support' },
  { icon: Handshake, labelZh: '生态共建', labelEn: 'Ecosystem', descZh: '与平台共同成长，共享生态红利', descEn: 'Grow together, share ecosystem dividends' },
]

interface AboutPartnerTabProps {
  isZh: boolean
}

export function AboutPartnerTab({ isZh }: AboutPartnerTabProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* 顶部标题区 */}
      <div className="text-center space-y-1.5">
        <h2 className="text-base font-black text-text-primary tracking-tight">
          {isZh ? '合伙人招募计划' : 'Partner Program'}
        </h2>
        <p className="text-[12px] text-text-muted leading-relaxed">
          {isZh
            ? '与 AweeClaw 携手，共建 AI 智能体生态，共享增长红利'
            : 'Join AweeClaw to co-build the AI agent ecosystem and share growth'}
        </p>
      </div>

      {/* 招募卡片（纵向排列） */}
      <div className="space-y-3">
        {RECRUITMENTS.map((item, i) => {
          const Icon = item.icon
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`flex items-start gap-3.5 p-3.5 rounded-xl bg-gradient-to-r ${item.accentClass} border hover:shadow-md transition-all duration-200`}
            >
              <div className={`w-10 h-10 rounded-lg ${item.iconBg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${item.iconColor}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-text-primary mb-0.5">
                  {isZh ? item.labelZh : item.labelEn}
                </div>
                <p className="text-[12px] text-text-muted leading-relaxed mb-2">
                  {isZh ? item.descZh : item.descEn}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(isZh ? item.benefitsZh : item.benefitsEn).map((b) => (
                    <span
                      key={b}
                      className="px-2 py-0.5 rounded-full bg-surface/50 border border-border/40 text-[12px] font-medium text-text-secondary"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* 权益说明 */}
      <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40">
        <div className="text-[12px] font-black text-text-muted uppercase tracking-widest opacity-40 mb-3">
          {isZh ? '加入权益' : 'Privileges'}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PRIVILEGES.map((p, i) => {
            const Icon = p.icon
            return (
              <div
                key={i}
                className="flex flex-col items-center text-center gap-1.5 p-2 rounded-lg bg-surface/30"
              >
                <Icon className="w-4 h-4 text-accent" />
                <span className="text-[12px] font-bold text-text-primary">
                  {isZh ? p.labelZh : p.labelEn}
                </span>
                <span className="text-[12px] text-text-muted leading-tight">
                  {isZh ? p.descZh : p.descEn}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 联系方式 */}
      <AboutContactCard isZh={isZh} />
    </motion.div>
  )
}

export default AboutPartnerTab

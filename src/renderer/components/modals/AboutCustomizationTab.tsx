/**
 * AboutCustomizationTab —「定制」Tab
 *
 * 面向企业或个人，提供场景应用定制服务介绍与联系方式。
 *
 * 内容结构：
 *   1. 顶部标题区：定制服务定位 + 副标题
 *   2. 服务卡片网格（2×2）：四类定制服务
 *   3. 服务流程：需求沟通 → 方案设计 → 开发交付 → 持续支持
 *   4. 底部联系方式（AboutContactCard 复用）
 *
 * 数据来源：服务项为静态配置，联系方式来自 BRAND.contact。
 */
import { motion } from 'framer-motion'
import {
  Compass,
  Building2,
  Workflow,
  Headset,
  ClipboardList,
  PencilRuler,
  Rocket,
  LifeBuoy,
} from 'lucide-react'
import { AboutContactCard } from './AboutContactCard'

/** 定制服务项配置 */
const SERVICES = [
  {
    icon: Compass,
    labelZh: '场景应用定制',
    labelEn: 'Scenario Customization',
    descZh: '针对企业业务流程，定制专属场景智能体应用，深度匹配行业需求',
    descEn: 'Tailor scenario agent apps to your business processes and industry needs',
    pointsZh: ['业务流程分析', '专属场景建模', '智能体工作流编排'],
    pointsEn: ['Process analysis', 'Scenario modeling', 'Agent workflow design'],
  },
  {
    icon: Building2,
    labelZh: '私有化部署',
    labelEn: 'Private Deployment',
    descZh: '企业内部私有化部署，数据完全自主可控，满足安全合规要求',
    descEn: 'On-premise deployment with full data control and compliance',
    pointsZh: ['本地化部署', '数据安全隔离', '合规审计支持'],
    pointsEn: ['On-premise install', 'Data isolation', 'Compliance support'],
  },
  {
    icon: Workflow,
    labelZh: '系统集成',
    labelEn: 'System Integration',
    descZh: '与现有 ERP/CRM/OA 等系统深度集成，打通数据与工具链',
    descEn: 'Deep integration with ERP/CRM/OA to connect data and toolchains',
    pointsZh: ['API 对接', '工具链打通', '数据流转编排'],
    pointsEn: ['API bridging', 'Toolchain sync', 'Data pipeline'],
  },
  {
    icon: Headset,
    labelZh: '专属技术支持',
    labelEn: 'Dedicated Support',
    descZh: '优先响应的专家技术支持，保障业务稳定运行与持续优化',
    descEn: 'Priority expert support to ensure stable operation and optimization',
    pointsZh: ['7×12 优先响应', '专家驻场支持', '定期优化巡检'],
    pointsEn: ['7×12 priority', 'On-site expert', 'Regular optimization'],
  },
]

/** 服务流程步骤 */
const PROCESS = [
  { icon: ClipboardList, labelZh: '需求沟通', labelEn: 'Requirements' },
  { icon: PencilRuler, labelZh: '方案设计', labelEn: 'Solution Design' },
  { icon: Rocket, labelZh: '开发交付', labelEn: 'Build & Deliver' },
  { icon: LifeBuoy, labelZh: '持续支持', labelEn: 'Ongoing Support' },
]

interface AboutCustomizationTabProps {
  isZh: boolean
}

export function AboutCustomizationTab({ isZh }: AboutCustomizationTabProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* 顶部标题区 */}
      <div className="text-center space-y-1.5">
        <h2 className="text-base font-black text-text-primary tracking-tight">
          {isZh ? '场景应用定制服务' : 'Scenario Customization Service'}
        </h2>
        <p className="text-[12px] text-text-muted leading-relaxed">
          {isZh
            ? '为企业和个人提供端到端的场景应用定制，从需求到上线全程陪伴'
            : 'End-to-end scenario customization for enterprises and individuals'}
        </p>
      </div>

      {/* 服务卡片网格 */}
      <div className="grid grid-cols-2 gap-3">
        {SERVICES.map((svc, i) => {
          const Icon = svc.icon
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex flex-col p-3.5 rounded-xl bg-white/[0.02] border border-border/40 hover:border-accent/30 transition-colors"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-accent" />
                </div>
                <span className="text-[13px] font-bold text-text-primary">
                  {isZh ? svc.labelZh : svc.labelEn}
                </span>
              </div>
              <p className="text-[12px] text-text-muted leading-relaxed mb-2.5">
                {isZh ? svc.descZh : svc.descEn}
              </p>
              <ul className="space-y-1 mt-auto">
                {(isZh ? svc.pointsZh : svc.pointsEn).map((pt) => (
                  <li
                    key={pt}
                    className="flex items-center gap-1.5 text-[12px] text-text-secondary"
                  >
                    <span className="w-1 h-1 rounded-full bg-accent/60 flex-shrink-0" />
                    {pt}
                  </li>
                ))}
              </ul>
            </motion.div>
          )
        })}
      </div>

      {/* 服务流程 */}
      <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40">
        <div className="text-[12px] font-black text-text-muted uppercase tracking-widest opacity-40 mb-3">
          {isZh ? '服务流程' : 'Process'}
        </div>
        <div className="flex items-center justify-between">
          {PROCESS.map((step, i) => {
            const Icon = step.icon
            return (
              <div key={i} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <span className="text-[12px] font-medium text-text-secondary whitespace-nowrap">
                    {isZh ? step.labelZh : step.labelEn}
                  </span>
                </div>
                {i < PROCESS.length - 1 && (
                  <div className="flex-1 h-px bg-border/40 mx-2 mt-[-18px]" />
                )}
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

export default AboutCustomizationTab

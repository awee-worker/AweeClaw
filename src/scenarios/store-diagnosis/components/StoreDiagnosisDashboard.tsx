import { Building2, Stethoscope, TrendingUp, ClipboardList, BarChart3, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'
import { useStore } from '@store'

export default function StoreDiagnosisDashboard() {
  const language = useStore(s => s.language)
  const setActiveSidePanel = useStore(s => s.setActiveSidePanel)

  const quickActions = [
    {
      icon: Building2,
      label: language === 'zh' ? '添加门店' : 'Add Store',
      desc: language === 'zh' ? '录入门店基本信息' : 'Enter store basic info',
      onClick: () => setActiveSidePanel('stores'),
      color: 'text-blue-400',
    },
    {
      icon: Stethoscope,
      label: language === 'zh' ? '运营诊断' : 'Diagnosis',
      desc: language === 'zh' ? '全面诊断门店运营' : 'Full store operation diagnosis',
      onClick: () => setActiveSidePanel('diagnosis'),
      color: 'text-orange-400',
    },
    {
      icon: ClipboardList,
      label: language === 'zh' ? '优化方案' : 'Optimization',
      desc: language === 'zh' ? '制定改进行动计划' : 'Create improvement action plan',
      onClick: () => setActiveSidePanel('plans'),
      color: 'text-purple-400',
    },
    {
      icon: TrendingUp,
      label: language === 'zh' ? '行业基准' : 'Benchmarks',
      desc: language === 'zh' ? '对比行业标杆数据' : 'Compare industry benchmarks',
      onClick: () => setActiveSidePanel('benchmarks'),
      color: 'text-emerald-400',
    },
  ]

  const diagnosisDimensions = [
    { icon: BarChart3, label: language === 'zh' ? '经营效率' : 'Operations', desc: language === 'zh' ? '坪效、人效、翻台率' : 'Revenue/sqm, staff efficiency, table turnover' },
    { icon: CheckCircle2, label: language === 'zh' ? '服务质量' : 'Service Quality', desc: language === 'zh' ? '客户满意度、投诉率' : 'Customer satisfaction, complaint rate' },
    { icon: AlertTriangle, label: language === 'zh' ? '成本管控' : 'Cost Control', desc: language === 'zh' ? '食材损耗、人力成本' : 'Food waste, labor cost' },
    { icon: TrendingUp, label: language === 'zh' ? '增长潜力' : 'Growth', desc: language === 'zh' ? '复购率、新客增长' : 'Repeat rate, new customer growth' },
  ]

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
            <Stethoscope className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">
            {language === 'zh' ? '门店诊断工作台' : 'Store Diagnosis Workspace'}
          </h1>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {language === 'zh'
              ? '全面诊断门店运营状况，对比行业基准，制定优化方案'
              : 'Diagnose store operations, compare industry benchmarks, and create optimization plans'}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className="flex flex-col items-center gap-2 p-5 rounded-xl border border-border/30 bg-surface/30 hover:bg-surface-hover hover:border-accent/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <action.icon className={`w-5 h-5 ${action.color}`} />
              </div>
              <span className="text-sm font-medium text-text-primary">{action.label}</span>
              <span className="text-xs text-text-muted text-center">{action.desc}</span>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border/30 bg-surface/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Stethoscope className="w-4 h-4 text-accent/60" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              {language === 'zh' ? '诊断维度' : 'Diagnosis Dimensions'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {diagnosisDimensions.map((dim) => (
              <div key={dim.label} className="flex items-start gap-3 p-3 rounded-lg bg-surface/30">
                <dim.icon className="w-4 h-4 text-accent/60 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-text-primary">{dim.label}</p>
                  <p className="text-xs text-text-muted">{dim.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border/30 bg-surface/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowRight className="w-4 h-4 text-accent/60" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              {language === 'zh' ? '快速入门' : 'Quick Start'}
            </span>
          </div>
          <div className="space-y-2 text-xs text-text-muted">
            <p>1. {language === 'zh' ? '在左侧「门店管理」面板中添加门店信息' : 'Add store info in the Stores panel on the left'}</p>
            <p>2. {language === 'zh' ? '在右侧对话中告诉 AI 你想诊断什么' : 'Tell AI what you want to diagnose in the chat on the right'}</p>
            <p>3. {language === 'zh' ? 'AI 将自动生成诊断报告和优化建议' : 'AI will automatically generate diagnosis reports and optimization suggestions'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

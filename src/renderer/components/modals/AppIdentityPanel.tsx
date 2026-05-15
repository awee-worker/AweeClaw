import { logger } from '@toolkit/LogEngine'
import { useState, useEffect } from 'react'
import { X, Github, ExternalLink, Shield, Cpu, Layers, Activity, Globe, BookOpen } from 'lucide-react'
import { Logo } from '../foundation/BrandMark'
import { useStore } from '@store'
import { OverlayDialog } from '../ui'
import { motion } from 'framer-motion'
import { BRAND } from '@shared/brand'

interface AppIdentityPanelProps {
  onClose: () => void
}

const TEAM_MEMBERS = [
  { name: 'awee', avatar: 'https://github.com/awee-worker.png', url: 'https://github.com/awee-worker', role: 'Creator' },
  { name: 'kerwin', avatar: 'https://github.com/kerwin2046.png', url: 'https://github.com/kerwin2046', role: 'Architect' },
  { name: 'cniu6', avatar: 'https://github.com/cniu6.png', url: 'https://github.com/cniu6', role: 'Engineer' },
  { name: '晨曦', avatar: 'https://github.com/tss-tss.png', url: 'https://github.com/tss-tss', role: 'Engineer' },
  { name: 'joanboss', avatar: 'https://github.com/joanboss.png', url: 'https://github.com/joanboss', role: 'Designer' },
  { name: '玉衡', avatar: 'https://github.com/yuheng-888.png', url: 'https://github.com/yuheng-888', role: 'Engineer' },
]

const CAPABILITIES = [
  { icon: Shield, labelEn: 'Scenario Guard', labelZh: '场景守卫', descEn: 'Context-aware security policies', descZh: '上下文感知安全策略' },
  { icon: Cpu, labelEn: 'Multi-Model', labelZh: '多模型引擎', descEn: 'Unified LLM orchestration', descZh: '统一大模型编排' },
  { icon: Layers, labelEn: 'Scenario Engine', labelZh: '场景引擎', descEn: 'Domain-specific AI workflows', descZh: '领域定制AI工作流' },
  { icon: Activity, labelEn: 'Live Profiling', labelZh: '实时剖析', descEn: 'Token budget & performance', descZh: 'Token预算与性能监控' },
]

const TECH_STACK = [
  { name: 'Electron', category: 'Runtime' },
  { name: 'React 19', category: 'UI' },
  { name: 'TypeScript', category: 'Language' },
  { name: 'Monaco Editor', category: 'Editor' },
  { name: 'Zustand', category: 'State' },
  { name: 'MCP Protocol', category: 'Tools' },
]

export default function AppIdentityPanel({ onClose }: AppIdentityPanelProps) {
  const language = useStore(s => s.language)
  const [version, setVersion] = useState('1.0.0')
  const [activeTab, setActiveTab] = useState<'about' | 'system' | 'team'>('about')
  const isZh = language === 'zh'

  useEffect(() => {
    const loadAppVersion = async () => {
      try {
        const appVersion = await window.electronAPI?.getAppVersion?.()
        if (appVersion) setVersion(appVersion)
      } catch (e) {
        logger.ui.error('Failed to get app version:', e)
      }
    }
    loadAppVersion()
  }, [])

  return (
    <OverlayDialog isOpen={true} onClose={onClose} noPadding size="2xl" className="overflow-hidden bg-transparent shadow-2xl">
      <div className="relative overflow-hidden bg-surface/80 backdrop-blur-3xl border border-border/50 flex flex-col h-[620px] w-full">
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '20px 20px' }}
        />
        <div className="absolute top-[-30%] left-[20%] w-[500px] h-[400px] bg-accent/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-5%] w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-[140px] pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-50 p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-text-muted hover:text-text-primary transition-all duration-300"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
          <div className="px-8 pt-8 pb-4 flex flex-col items-center">
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: 0.5, type: 'spring', bounce: 0.3 }}
              className="mb-5 relative group cursor-default"
            >
              <div className="absolute inset-0 bg-accent/30 blur-3xl rounded-full opacity-50 group-hover:opacity-70 transition-opacity duration-700" />
              <div className="relative w-20 h-20 flex items-center justify-center transform group-hover:scale-105 transition-transform duration-500">
                <Logo className="w-full text-accent drop-shadow-lg" />
              </div>
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-surface border border-border shadow-md text-[10px] font-mono font-bold text-accent whitespace-nowrap z-20">
                v{version}
              </div>
            </motion.div>

            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="text-center space-y-2 max-w-md"
            >
              <h1 className="text-3xl font-black text-text-primary tracking-tight">AweeClaw</h1>
              <p className="text-[13px] text-text-secondary leading-relaxed font-medium opacity-80">
                {isZh ? '场景驱动的 AI 原生智能体平台' : 'Scenario-Driven AI-Native Agent Platform'}
              </p>
            </motion.div>

            <motion.div
              initial={{ y: 5, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              className="flex gap-1.5 mt-5 bg-surface/50 rounded-full p-1 border border-border/30"
            >
              {(['about', 'system', 'team'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-all ${activeTab === tab ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  {tab === 'about' ? (isZh ? '概览' : 'Overview') : tab === 'system' ? (isZh ? '系统' : 'System') : (isZh ? '团队' : 'Team')}
                </button>
              ))}
            </motion.div>
          </div>

          <div className="flex-1 overflow-y-auto px-8 pb-6 custom-scrollbar">
            {activeTab === 'about' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {CAPABILITIES.map((cap, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-border/40 hover:border-accent/20 transition-colors"
                    >
                      <div className="p-1.5 rounded-lg bg-accent/10 flex-shrink-0">
                        <cap.icon className="w-3.5 h-3.5 text-accent" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-text-primary">{isZh ? cap.labelZh : cap.labelEn}</div>
                        <div className="text-[11px] text-text-muted leading-relaxed">{isZh ? cap.descZh : cap.descEn}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40">
                  <div className="text-[11px] font-black text-text-muted uppercase tracking-widest opacity-40 mb-3">{isZh ? '技术栈' : 'Tech Stack'}</div>
                  <div className="flex flex-wrap gap-2">
                    {TECH_STACK.map(tech => (
                      <span key={tech.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface/50 border border-border/40 text-[11px] font-medium text-text-secondary">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent/50" />
                        {tech.name}
                        <span className="text-text-muted/50 text-[9px]">{tech.category}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'system' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <SystemHealthCard isZh={isZh} />
                <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40">
                  <div className="text-[11px] font-black text-text-muted uppercase tracking-widest opacity-40 mb-3">{isZh ? '运行环境' : 'Runtime Environment'}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <EnvItem label="Platform" value={navigator.platform} />
                    <EnvItem label="Electron" value={window.electronAPI ? 'Active' : 'N/A'} />
                    <EnvItem label="Renderer" value="Chromium" />
                    <EnvItem label="Architecture" value={navigator.userAgent.includes('ARM') ? 'ARM64' : 'x64'} />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'team' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {TEAM_MEMBERS.map((member, i) => (
                    <motion.a
                      key={member.name}
                      href={member.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.02] border border-border/40 hover:border-accent/20 transition-all group"
                    >
                      <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full border-2 border-border group-hover:border-accent/40 transition-colors shadow-sm" />
                      <div className="text-[12px] font-bold text-text-primary">{member.name}</div>
                      <div className="text-[10px] text-text-muted">{member.role}</div>
                    </motion.a>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-4 pt-2">
                  <SocialLink href={BRAND.links.github} icon={Github} label="GitHub" />
                  <SocialLink href={BRAND.links.gitee} icon={ExternalLink} label="Gitee" />
                  <SocialLink href="#" icon={Globe} label={isZh ? '官网' : 'Website'} />
                  <SocialLink href="#" icon={BookOpen} label={isZh ? '文档' : 'Docs'} />
                </div>
              </motion.div>
            )}
          </div>

          <div className="relative z-10 px-8 py-4 border-t border-border/30 bg-surface/20 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 group cursor-pointer">
                <img src="https://github.com/awee-worker.png" alt="awee" className="w-8 h-8 rounded-full shadow ring-1 ring-white/10 group-hover:scale-105 transition-transform" />
                <div>
                  <p className="text-[12px] font-bold text-text-primary group-hover:text-accent transition-colors">awee</p>
                  <p className="text-[10px] text-text-muted">Creator & Maintainer</p>
                </div>
              </div>
              <p className="text-[10px] text-text-muted/70 font-medium">© 2025-present awee. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </OverlayDialog>
  )
}

function SystemHealthCard({ isZh }: { isZh: boolean }) {
  const [health, setHealth] = useState({ memory: 'N/A', models: 0, scenarios: 0, uptime: '0m' })

  useEffect(() => {
    const checkHealth = async () => {
      try {
        if (performance && (performance as any).memory) {
          const mem = (performance as any).memory
          const usedMB = Math.round(mem.usedJSHeapSize / 1048576)
          setHealth(prev => ({ ...prev, memory: `${usedMB}MB` }))
        }
        const uptimeMin = Math.round(performance.now() / 60000)
        setHealth(prev => ({ ...prev, uptime: `${uptimeMin}m` }))
      } catch { /* ignore */ }
    }
    checkHealth()
    const timer = setInterval(checkHealth, 30000)
    return () => clearInterval(timer)
  }, [])

  const metrics = [
    { label: isZh ? '内存' : 'Memory', value: health.memory, status: 'ok' as const },
    { label: isZh ? '运行时间' : 'Uptime', value: health.uptime, status: 'ok' as const },
    { label: isZh ? '模型' : 'Models', value: String(health.models), status: 'info' as const },
    { label: isZh ? '场景' : 'Scenarios', value: String(health.scenarios), status: 'info' as const },
  ]

  return (
    <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[11px] font-black text-text-muted uppercase tracking-widest opacity-40">{isZh ? '系统健康' : 'System Health'}</span>
        <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-surface/30">
            <span className="text-[14px] font-bold text-text-primary">{m.value}</span>
            <span className="text-[10px] text-text-muted">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EnvItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-surface/30">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className="text-[11px] font-mono font-medium text-text-secondary">{value}</span>
    </div>
  )
}

function SocialLink({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-all text-[11px] font-medium">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </a>
  )
}

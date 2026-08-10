/**
 * AboutContactCard — 商务合作联系方式卡片
 *
 * 用于「定制」「合伙人」Tab 底部，展示微信号与邮箱，支持一键复制。
 * 联系方式来源于 BRAND.contact（单一真相源），禁止硬编码。
 *
 * 设计要点：
 *   - 微信 / 邮箱两行，每行带图标、标签、值、复制按钮
 *   - 点击复制到剪贴板，按钮切换为「已复制」状态（1.5s 后恢复）
 *   - 字体最小 12px，配色与 About 弹窗整体风格一致
 */
import { useState } from 'react'
import { MessageCircle, Mail, Copy, Check } from 'lucide-react'
import { BRAND } from '@shared/brand'

interface AboutContactCardProps {
  isZh: boolean
}

/** 单个联系方式行 */
function ContactRow({
  icon,
  label,
  value,
  isZh,
}: {
  icon: React.ReactNode
  label: string
  value: string
  isZh: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败（部分环境受限）
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-surface/40 border border-border/40 hover:border-accent/30 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold text-text-muted">{label}</div>
        <div className="text-[13px] font-mono font-medium text-text-primary truncate">{value}</div>
      </div>
      <button
        onClick={handleCopy}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 flex-shrink-0 ${
          copied
            ? 'bg-green-500/15 text-green-400'
            : 'bg-accent/10 text-accent hover:bg-accent hover:text-white'
        }`}
        title={isZh ? '复制' : 'Copy'}
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5" />
            {isZh ? '已复制' : 'Copied'}
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            {isZh ? '复制' : 'Copy'}
          </>
        )}
      </button>
    </div>
  )
}

export function AboutContactCard({ isZh }: AboutContactCardProps) {
  return (
    <div className="space-y-3">
      {/* 区块标题 */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-black text-text-muted uppercase tracking-widest opacity-40">
          {isZh ? '联系我们' : 'Contact Us'}
        </span>
        <div className="flex-1 h-px bg-border/30" />
      </div>

      {/* 联系方式行 */}
      <ContactRow
        icon={<MessageCircle className="w-4 h-4 text-accent" />}
        label={isZh ? '微信号' : 'WeChat'}
        value={BRAND.contact.wechat}
        isZh={isZh}
      />
      <ContactRow
        icon={<Mail className="w-4 h-4 text-accent" />}
        label={isZh ? '邮箱' : 'Email'}
        value={BRAND.contact.email}
        isZh={isZh}
      />

      {/* 友情提示 */}
      <p className="text-[12px] text-text-muted/60 text-center leading-relaxed pt-1">
        {isZh
          ? '添加微信或发送邮件时，请简要说明您的需求'
          : 'Please briefly describe your needs when contacting'}
      </p>
    </div>
  )
}

export default AboutContactCard

/**
 * 插话 Part 视图
 *
 * 用户在 AI 执行过程中补的一句说明，出现在它被采纳的那一刻。刻意做成右侧气泡，
 * 让它在视觉上仍属于「用户说的话」，同时用标签与顺手可读的位置说明它不是新一轮发言。
 */
import { CornerDownRight } from 'lucide-react'
import { useStore } from '@store'
import type { AssistantPart, UserSteerPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { t, type Language } from '@renderer/i18n'
import { MarkdownContentView } from '../markdown/MarkdownContentView'

function UserSteerBubble({ content, fontSize }: { content: string; fontSize: number }) {
  const language = useStore(s => s.language)

  return (
    <div className="w-full flex justify-end my-1">
      <div className="max-w-[85%] sm:max-w-[75%] min-w-0 flex flex-col items-end gap-1">
        <span className="flex items-center gap-1 px-1 text-[11px] text-text-tertiary select-none">
          <CornerDownRight className="w-3 h-3" aria-hidden />
          {t('chat.steer.cardLabel', language as Language)}
        </span>
        <div className="bg-surface text-text-primary/95 px-4 py-2.5 rounded-[18px] rounded-tr-[4px] border border-border/50 shadow-sm w-fit max-w-full">
          <div className="text-[14px] leading-relaxed">
            <MarkdownContentView content={content} fontSize={fontSize} preserveLineBreaks />
          </div>
        </div>
      </div>
    </div>
  )
}

export function UserSteerPartView(part: AssistantPart, ctx: PartRenderContext): React.ReactNode {
  const steerPart = part as UserSteerPart
  if (!steerPart.content?.trim()) return null
  return <UserSteerBubble content={steerPart.content} fontSize={ctx.fontSize} />
}

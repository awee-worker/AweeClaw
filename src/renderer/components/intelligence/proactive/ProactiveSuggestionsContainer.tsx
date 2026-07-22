/**
 * 主动建议卡片容器（阶段10 s10-06 新增）
 *
 * 职责：
 * 1. 调用 useProactiveSuggestions hook 订阅 IPC 推送
 * 2. 渲染当前可见的 ProactiveSuggestionCard 列表（最多 3 条）
 * 3. 使用 AnimatePresence 实现卡片进出动画
 *
 * 集成位置：ChatPanel 顶部，Virtuoso 消息列表上方
 *
 * @module intelligence/proactive/ProactiveSuggestionsContainer
 */

import { memo, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { type Language } from '@renderer/i18n'
import { ProactiveSuggestionCard, type ProactiveProposal } from './ProactiveSuggestionCard'
import { useProactiveSuggestions } from './useProactiveSuggestions'

interface Props {
  language: Language
}

/**
 * 主动建议卡片容器（memo 优化：language 不变时不重渲染）
 */
export const ProactiveSuggestionsContainer = memo(function ProactiveSuggestionsContainer({
  language,
}: Props) {
  const { proposals, dismiss, acceptProposal } = useProactiveSuggestions()

  const handleAccept = useCallback(
    (proposal: ProactiveProposal) => {
      void acceptProposal(proposal)
    },
    [acceptProposal],
  )

  if (proposals.length === 0) return null

  return (
    <div className="shrink-0 px-4 pt-2 z-10">
      <AnimatePresence mode="popLayout">
        {proposals.map((proposal) => (
          <ProactiveSuggestionCard
            key={proposal.id}
            proposal={proposal}
            language={language}
            onDismiss={dismiss}
            onAccept={handleAccept}
          />
        ))}
      </AnimatePresence>
    </div>
  )
})

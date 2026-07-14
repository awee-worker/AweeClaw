/**
 * VoiceTextStream - 语音对话实时文本流
 *
 * 在浮动窗口和沉浸模式下共用，实时显示：
 * - 用户说话内容（STT 结果）
 * - AI 回复文本（流式）
 * - 工具调用动作（如"正在创建文件"）
 * - 工具执行结果摘要
 *
 * 自动滚动到最新内容。
 */

import { memo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Bot, Wrench, CheckCircle2, XCircle } from 'lucide-react'
import type { ActivityStatus } from '../../utils/voiceActivityStatus'

/** 单条流式消息 */
interface StreamEntry {
  id: string
  type: 'user' | 'ai' | 'tool-start' | 'tool-end'
  text: string
  toolName?: string
  success?: boolean
}

interface VoiceTextStreamProps {
  /** 流式消息列表 */
  entries: StreamEntry[]
  /** 当前活动状态（正在执行的工具） */
  activity: ActivityStatus | null
  /** 最大高度，超出滚动 */
  maxHeight?: string
  /** 是否自动滚动到底部 */
  autoScroll?: boolean
}

function VoiceTextStreamImpl({
  entries,
  activity,
  maxHeight = '200px',
  autoScroll = true,
}: VoiceTextStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [entries, activity, autoScroll])

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto voice-text-stream-scroll"
      style={{ maxHeight }}
    >
      <div className="flex flex-col gap-2 px-3 py-2">
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {entry.type === 'user' && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mt-0.5">
                    <User className="w-3 h-3 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-text-primary leading-relaxed">
                      {entry.text}
                    </p>
                  </div>
                </div>
              )}

              {entry.type === 'ai' && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center mt-0.5">
                    <Bot className="w-3 h-3 text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-text-primary leading-relaxed whitespace-pre-wrap break-words">
                      {entry.text}
                    </p>
                  </div>
                </div>
              )}

              {entry.type === 'tool-start' && (
                <div className="flex items-start gap-2 pl-2 border-l-2 border-violet-500/40">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center mt-0.5">
                    <Wrench className="w-2.5 h-2.5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="text-[12px] text-text-secondary">
                      {entry.text}
                    </span>
                    {entry.toolName && activity?.toolName === entry.toolName && (
                      <div className="w-3 h-3 rounded-full border border-violet-400/50 border-t-violet-400 animate-spin flex-shrink-0" />
                    )}
                  </div>
                </div>
              )}

              {entry.type === 'tool-end' && (
                <div className="flex items-start gap-2 pl-2 border-l-2 border-violet-500/20">
                  <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                    entry.success ? 'bg-emerald-500/15' : 'bg-red-500/15'
                  }`}>
                    {entry.success ? (
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-2.5 h-2.5 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-muted leading-relaxed">
                      {entry.text}
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 当前正在执行的工具活动状态 */}
        {activity && !entries.some(e => e.toolName === activity.toolName && e.type === 'tool-start') && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 pl-2 border-l-2 border-violet-500/40"
          >
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center mt-0.5">
              <Wrench className="w-2.5 h-2.5 text-violet-400" />
            </div>
            <span className="text-[12px] text-text-secondary">
              {activity.action}
              {activity.target && (
                <span className="text-text-muted ml-1 font-mono">{activity.target}</span>
              )}
            </span>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export const VoiceTextStream = memo(VoiceTextStreamImpl)
export type { StreamEntry }

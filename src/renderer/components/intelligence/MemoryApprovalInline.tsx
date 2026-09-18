import React, { useState, useEffect } from 'react'
import { CheckCircle2, ChevronDown, Brain } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface MemoryApprovalInlineProps {
    content: string
    isAwaitingApproval: boolean
    isSuccess?: boolean
    messageId: string
    toolCallId: string
    args: Record<string, any>
}

export const MemoryApprovalInline: React.FC<MemoryApprovalInlineProps> = ({
    content: rawContent,
    isAwaitingApproval,
    isSuccess,
}) => {
    const content = rawContent || ''
    const language = useStore(s => s.language)
    const expandContextByDefault = useStore(s => s.agentConfig.expandContextByDefault ?? true)
    const [isExpanded, setIsExpanded] = useState(!isSuccess && expandContextByDefault)

    useEffect(() => {
        if (isSuccess) {
            setIsExpanded(false)
        }
    }, [isSuccess])

    const statusText = isSuccess
        ? (t('ai.memorystored', language as Language))
        : (t('ai.memoryproposal', language as Language))

    const isRunning = !isSuccess && !isAwaitingApproval

    return (
        <div className="group my-0.5 relative hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden">
            {/* Header - 与 ToolCallCard 完全一致的扁平化结构 */}
            <div
                className="flex items-center gap-2 py-1.5 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Expand Toggle */}
                <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="shrink-0 text-text-muted/85 hover:text-text-muted"
                >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                {/* Status Icon */}
                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isRunning ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-status-success/10 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-status-success" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-status-warning/10 flex items-center justify-center border border-status-warning/30">
                            <Brain className="w-2.5 h-2.5 text-status-warning" />
                        </div>
                    )}
                </div>

                {/* Status Text */}
                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    {/* 状态文案必须完整可读：它与右侧摘要同处一行，
                        若允许收缩会被摘要挤成"已存入记..."。这里固定不收缩、
                        不换行，把可压缩的额度全部让给摘要。 */}
                    <span className={`text-[12px] shrink-0 whitespace-nowrap ${isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText}
                    </span>
                    {!isExpanded && (
                        <span className="text-[12px] text-text-muted/85 truncate min-w-0">
                            — {content.slice(0, 50)}{content.length > 50 ? '...' : ''}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded Content */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                        className="overflow-hidden"
                    >
                        <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
                            {/* Visual Threading Line */}
                            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

                            {/* Content */}
                            <div className="relative z-10 mt-1">
                                <div className="text-[12px] text-text-secondary leading-relaxed font-sans whitespace-pre-wrap border-l-2 border-border/30 pl-2 ml-1">
                                    {content}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

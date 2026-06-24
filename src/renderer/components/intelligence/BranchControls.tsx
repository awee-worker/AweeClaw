import { useState, useCallback } from 'react'
import { GitBranch, RotateCcw, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore, selectBranches, selectActiveBranch, selectIsOnBranch } from '@intelligence/state/IntelligenceStore'
import { ActionButton } from '../ui'
import { t, type Language } from '@renderer/i18n'

/** 分支选择器样式映射 */
const BRANCH_STYLE = {
    active: 'bg-accent/10 border border-accent/20 text-accent hover:bg-accent/15',
    inactive: 'bg-surface/30 border border-transparent hover:border-border/40 hover:bg-surface/50 text-text-muted hover:text-text-primary',
} as const

/** 确认弹窗状态管理 */
function useConfirmPopup(onConfirm: () => void) {
    const [visible, setVisible] = useState(false)

    const open = useCallback(() => setVisible(true), [])
    const close = useCallback(() => setVisible(false), [])
    const toggle = useCallback(() => setVisible((v) => !v), [])
    const confirm = useCallback(() => {
        onConfirm()
        setVisible(false)
    }, [onConfirm])

    return { visible, open, close, toggle, confirm }
}

/**
 * 分支选择器
 *
 * 展示当前分支状态，点击触发分支管理面板。
 */
export function BranchSelector({
    language = 'en',
    onClick,
}: {
    language?: 'zh' | 'en'
    onClick?: () => void
}) {
    const activeBranch = useAgentStore(selectActiveBranch)
    const branches = useAgentStore(selectBranches)
    const isOnBranch = useAgentStore(selectIsOnBranch)

    const displayText = isOnBranch && activeBranch ? activeBranch.name : t('ai.main', language as Language)
    const showCount = branches.length > 0 && !isOnBranch
    const styleClass = isOnBranch ? BRANCH_STYLE.active : BRANCH_STYLE.inactive

    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-200 group ${styleClass}`}
            title={t('ai.clicktomanagebranches', language as Language)}
        >
            <GitBranch
                className={`w-3.5 h-3.5 ${isOnBranch ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}
            />
            <span className="truncate max-w-[120px] font-medium">{displayText}</span>
            {showCount && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-surface text-[10px] font-bold border border-border/50">
                    {branches.length}
                </span>
            )}
            <ChevronDown className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
        </button>
    )
}

/** 确认弹窗 */
function ConfirmPopup({
    visible,
    language,
    onCancel,
    onConfirm,
}: {
    visible: boolean
    language: 'zh' | 'en'
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 5 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute top-full right-0 mt-2 p-3 rounded-xl bg-background/80 backdrop-blur-xl border border-border/50 shadow-xl shadow-black/20 z-50 min-w-[260px]"
                >
                    <div className="absolute -top-1.5 right-6 w-3 h-3 bg-background/80 backdrop-blur-xl border-t border-l border-border/50 transform rotate-45" />

                    <p className="text-xs text-text-secondary mb-3 leading-relaxed relative z-10">
                        {t('ai.thiswillcreateanew', language as Language)}
                    </p>
                    <div className="flex gap-2 relative z-10">
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            onClick={onCancel}
                            className="flex-1 h-7 text-xs hover:bg-black/10"
                        >
                            {t('ai.cancel', language as Language)}
                        </ActionButton>
                        <ActionButton
                            variant="primary"
                            size="sm"
                            onClick={onConfirm}
                            className="flex-1 h-7 text-xs whitespace-nowrap bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20"
                        >
                            <GitBranch className="w-3.5 h-3.5 mr-1.5" />
                            {t('ai.createbranch', language as Language)}
                        </ActionButton>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

/**
 * 消息分支操作
 *
 * 提供重新生成按钮，点击后弹出确认弹窗。
 */
export function MessageBranchActions({
    messageId,
    language = 'en',
    onRegenerate,
}: {
    messageId: string
    language?: 'zh' | 'en'
    onRegenerate?: (messageId: string) => void
}) {
    const handleCreateBranch = useCallback(() => {
        if (onRegenerate) onRegenerate(messageId)
    }, [messageId, onRegenerate])

    const { visible, toggle, close, confirm } = useConfirmPopup(handleCreateBranch)

    return (
        <div className="relative">
            <ActionButton
                variant="ghost"
                size="sm"
                onClick={toggle}
                className={`text-xs gap-1.5 h-7 px-2.5 transition-all ${visible ? 'bg-accent/10 text-accent' : 'hover:bg-surface/50'}`}
                title={t('ai.regeneratecreatebranch', language as Language)}
            >
                <RotateCcw className={`w-3.5 h-3.5 ${visible ? 'text-accent' : ''}`} />
                <span>{t('ai.regenerate', language as Language)}</span>
            </ActionButton>

            <ConfirmPopup
                visible={visible}
                language={language}
                onCancel={close}
                onConfirm={confirm}
            />
        </div>
    )
}

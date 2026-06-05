import { PenTool, BookOpen, Users, FileText, Sparkles, Lightbulb } from 'lucide-react'
import { logger } from '@shared/toolkit/LogEngine'
import { useStore } from '@store'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { t, type Language } from '@renderer/i18n'

export default function WritingWorkspace() {
    const language = useStore(s => s.language)
    const llmConfig = useStore(s => s.llmConfig)
    const workspacePath = useStore(s => s.workspacePath)
    const setActiveSidePanel = useStore(s => s.setActiveSidePanel)

    const sendToChat = async (prompt: string) => {
        try {
            const agentConfig = getAgentConfig()
            await Agent.send(
                prompt,
                { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
                workspacePath,
                'agent',
            )
        } catch (e) { logger.agent.warn('Writing agent failed:', e) }
    }

    const quickActions = [
        {
            icon: Sparkles,
            label: t('writing.startwriting', language as Language),
            desc: t('writing.letaihelpyoucraft', language as Language),
            onClick: () => sendToChat(t('writing.iwanttostartwriting', language as Language)),
        },
        {
            icon: BookOpen,
            label: t('writing.continuewriting', language as Language),
            desc: t('writing.continuefromexistingdraft', language as Language),
            onClick: () => setActiveSidePanel('explorer'),
        },
        {
            icon: Users,
            label: t('writing.createcharacter', language as Language),
            desc: t('writing.designstorycharacters', language as Language),
            onClick: () => setActiveSidePanel('characters'),
        },
        {
            icon: FileText,
            label: t('writing.writeoutline', language as Language),
            desc: t('writing.planstorystructure', language as Language),
            onClick: () => sendToChat(t('writing.pleasehelpmecreatea', language as Language)),
        },
    ]

    const prompts = [
        t('writing.writeashortstoryabout', language as Language),
        t('writing.helpmerefinethetone', language as Language),
        t('writing.createanantagonistformy', language as Language),
        t('writing.rewritethispassagewithmore', language as Language),
    ]

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="max-w-xl w-full space-y-8">
                <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                        <PenTool className="w-8 h-8 text-accent" />
                    </div>
                    <h1 className="text-2xl font-semibold text-text-primary">
                        {t('writing.creativewritingstudio', language as Language)}
                    </h1>
                    <p className="text-sm text-text-muted max-w-md mx-auto">
                        {t('writing.craftstoriesshapecharacterspolish', language as Language)}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    {quickActions.map((action) => (
                        <button
                            key={action.label}
                            onClick={action.onClick}
                            className="flex flex-col items-center gap-2 p-5 rounded-xl border border-border/30 bg-surface/30 hover:bg-surface-hover hover:border-accent/30 transition-all group"
                        >
                            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                                <action.icon className="w-5 h-5 text-accent" />
                            </div>
                            <span className="text-sm font-medium text-text-primary">{action.label}</span>
                            <span className="text-[11px] text-text-muted text-center">{action.desc}</span>
                        </button>
                    ))}
                </div>

                <div className="rounded-xl border border-border/30 bg-surface/20 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Lightbulb className="w-4 h-4 text-amber-400/70" />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            {t('writing.prompts', language as Language)}
                        </span>
                    </div>
                    <div className="space-y-1.5">
                        {prompts.map((prompt, i) => (
                            <button
                                key={i}
                                onClick={() => sendToChat(prompt)}
                                className="w-full text-left text-xs text-text-secondary hover:text-accent px-2 py-1.5 rounded hover:bg-accent/5 transition-colors"
                            >
                                "{prompt}"
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

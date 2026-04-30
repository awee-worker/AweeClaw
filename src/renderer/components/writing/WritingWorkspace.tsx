import { PenTool, BookOpen, Users, FileText, Sparkles, Lightbulb } from 'lucide-react'
import { useStore } from '@store'
import { Agent } from '@/renderer/agent/core'
import { getAgentConfig } from '@/renderer/agent/utils/AgentConfig'

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
        } catch {}
    }

    const quickActions = [
        {
            icon: Sparkles,
            label: language === 'zh' ? '开始创作' : 'Start Writing',
            desc: language === 'zh' ? '让 AI 帮你构思故事' : 'Let AI help you craft a story',
            onClick: () => sendToChat(language === 'zh' ? '我想开始创作一个新故事，请帮我构思一个有趣的开头。' : 'I want to start writing a new story. Please help me brainstorm an interesting opening.'),
        },
        {
            icon: BookOpen,
            label: language === 'zh' ? '续写内容' : 'Continue Writing',
            desc: language === 'zh' ? '从现有草稿继续' : 'Continue from existing draft',
            onClick: () => setActiveSidePanel('explorer'),
        },
        {
            icon: Users,
            label: language === 'zh' ? '创建角色' : 'Create Character',
            desc: language === 'zh' ? '设计故事中的人物' : 'Design story characters',
            onClick: () => setActiveSidePanel('characters'),
        },
        {
            icon: FileText,
            label: language === 'zh' ? '写大纲' : 'Write Outline',
            desc: language === 'zh' ? '规划故事结构' : 'Plan story structure',
            onClick: () => sendToChat(language === 'zh' ? '请帮我创建一个故事大纲，包括主要情节、转折点和结局。' : 'Please help me create a story outline with main plot points, twists, and ending.'),
        },
    ]

    const prompts = [
        language === 'zh' ? '写一个关于时间旅行的短篇故事' : 'Write a short story about time travel',
        language === 'zh' ? '帮我优化这段文案的语气和节奏' : 'Help me refine the tone and rhythm of this copy',
        language === 'zh' ? '为我的小说创建一个反派角色' : 'Create an antagonist for my novel',
        language === 'zh' ? '把这段文字改写成更生动的描写' : 'Rewrite this passage with more vivid descriptions',
    ]

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="max-w-xl w-full space-y-8">
                <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                        <PenTool className="w-8 h-8 text-accent" />
                    </div>
                    <h1 className="text-2xl font-semibold text-text-primary">
                        {language === 'zh' ? '创意写作工作台' : 'Creative Writing Studio'}
                    </h1>
                    <p className="text-sm text-text-muted max-w-md mx-auto">
                        {language === 'zh'
                            ? '构思故事、塑造角色、打磨文字，与 AI 协作完成创作'
                            : 'Craft stories, shape characters, polish prose — collaborate with AI'}
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
                            <span className="text-[10px] text-text-muted text-center">{action.desc}</span>
                        </button>
                    ))}
                </div>

                <div className="rounded-xl border border-border/30 bg-surface/20 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Lightbulb className="w-4 h-4 text-amber-400/70" />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '灵感提示' : 'Prompts'}
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

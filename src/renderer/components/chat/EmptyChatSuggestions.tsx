import { Sparkles, Code, FileText, Bug, ArrowRight, Brain, Lightbulb, Globe, PenTool, BarChart3, MessageSquare, HelpCircle } from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/config/scenarios'
import { publicAsset } from '@utils/publicAsset'
import type { ReactNode } from 'react'

interface EmptyChatSuggestionsProps {
  onSelectSuggestion: (text: string) => void
}

interface SuggestionItem {
  icon: ReactNode
  title: string
  titleZh: string
  prompt: string
  iconBg: string
}

const SCENARIO_SUGGESTIONS: Record<string, SuggestionItem[]> = {
  'code-editor': [
    { icon: <Sparkles className="w-4 h-4 text-purple-500" />, title: 'Explain this project', titleZh: '解释当前项目', prompt: 'Please explain the overall architecture and purpose of the current project.', iconBg: 'bg-purple-500/10' },
    { icon: <Code className="w-4 h-4 text-accent" />, title: 'Generate feature', titleZh: '生成新功能', prompt: "I want to build a new feature. Let's start by discussing the requirements and architecture.", iconBg: 'bg-accent/10' },
    { icon: <FileText className="w-4 h-4 text-emerald-500" />, title: 'Add documentation', titleZh: '添加注释或文档', prompt: 'Generate comprehensive comments and documentation for the active file.', iconBg: 'bg-emerald-500/10' },
    { icon: <Bug className="w-4 h-4 text-orange-500" />, title: 'Find hidden bugs', titleZh: '帮我找出隐藏的 Bug', prompt: 'Review the current codebase or active file for any potential bugs, edge cases, or security issues.', iconBg: 'bg-orange-500/10' },
  ],
  'data-analyst': [
    { icon: <BarChart3 className="w-4 h-4 text-blue-500" />, title: 'Analyze a dataset', titleZh: '分析数据集', prompt: 'I have a dataset I want to analyze. Help me explore its structure, find patterns, and generate insights.', iconBg: 'bg-blue-500/10' },
    { icon: <Globe className="w-4 h-4 text-emerald-500" />, title: 'Create visualization', titleZh: '创建可视化图表', prompt: 'Help me create a compelling data visualization. What chart type would work best for my data?', iconBg: 'bg-emerald-500/10' },
    { icon: <Brain className="w-4 h-4 text-purple-500" />, title: 'Statistical analysis', titleZh: '统计分析', prompt: 'I need help with statistical analysis. Guide me through choosing the right tests and interpreting results.', iconBg: 'bg-purple-500/10' },
    { icon: <FileText className="w-4 h-4 text-orange-500" />, title: 'Data cleaning', titleZh: '数据清洗', prompt: 'Help me clean and preprocess my dataset. Check for missing values, outliers, and data quality issues.', iconBg: 'bg-orange-500/10' },
  ],
  'creative-writer': [
    { icon: <PenTool className="w-4 h-4 text-pink-500" />, title: 'Start a story', titleZh: '开始一个故事', prompt: 'Help me start writing a story. I need help with plot, characters, and setting.', iconBg: 'bg-pink-500/10' },
    { icon: <Lightbulb className="w-4 h-4 text-yellow-500" />, title: 'Brainstorm ideas', titleZh: '头脑风暴', prompt: "I need creative ideas. Let's brainstorm together and explore different angles.", iconBg: 'bg-yellow-500/10' },
    { icon: <FileText className="w-4 h-4 text-blue-500" />, title: 'Improve my writing', titleZh: '改进我的写作', prompt: 'Review my writing and suggest improvements for clarity, style, and engagement.', iconBg: 'bg-blue-500/10' },
    { icon: <MessageSquare className="w-4 h-4 text-emerald-500" />, title: 'Write copy', titleZh: '撰写文案', prompt: 'Help me write compelling copy for my project. Make it persuasive and engaging.', iconBg: 'bg-emerald-500/10' },
  ],
  'general-assistant': [
    { icon: <Lightbulb className="w-4 h-4 text-yellow-500" />, title: 'Brainstorm ideas', titleZh: '头脑风暴', prompt: "I need some creative ideas. Let's brainstorm together and explore different possibilities.", iconBg: 'bg-yellow-500/10' },
    { icon: <HelpCircle className="w-4 h-4 text-blue-500" />, title: 'Answer questions', titleZh: '回答问题', prompt: 'I have a question I need help with. Can you provide a clear and thorough explanation?', iconBg: 'bg-blue-500/10' },
    { icon: <Globe className="w-4 h-4 text-emerald-500" />, title: 'Research a topic', titleZh: '研究一个话题', prompt: 'Help me research a topic. Find relevant information and summarize the key points.', iconBg: 'bg-emerald-500/10' },
    { icon: <Brain className="w-4 h-4 text-purple-500" />, title: 'Solve a problem', titleZh: '解决问题', prompt: "I'm facing a problem and need help thinking through it. Let's work through it step by step.", iconBg: 'bg-purple-500/10' },
  ],
}

const SCENARIO_TITLES: Record<string, { title: string; titleZh: string; subtitle: string; subtitleZh: string }> = {
  'code-editor': { title: 'What to build today?', titleZh: '今天想构建什么？', subtitle: 'Choose a suggestion below, or tell me your initial thoughts directly.', subtitleZh: '选择下方建议，或直接告诉我你的初步想法' },
  'data-analyst': { title: 'What data to explore?', titleZh: '想探索什么数据？', subtitle: 'Choose a suggestion below, or describe your data analysis needs.', subtitleZh: '选择下方建议，或描述你的数据分析需求' },
  'creative-writer': { title: 'What to create today?', titleZh: '今天想创作什么？', subtitle: 'Choose a suggestion below, or share your creative vision.', subtitleZh: '选择下方建议，或分享你的创意灵感' },
  'general-assistant': { title: 'How can I help?', titleZh: '有什么可以帮你的？', subtitle: 'Choose a suggestion below, or ask me anything.', subtitleZh: '选择下方建议，或直接问我任何问题' },
}

export default function EmptyChatSuggestions({ onSelectSuggestion }: EmptyChatSuggestionsProps) {
  const language = useStore(s => s.language)
  const activeScenarioId = useStore(s => s.activeScenarioId)

  const scenario = scenarioRegistry.get(activeScenarioId)
  const scenarioId = scenario?.id || 'code-editor'
  const suggestions = SCENARIO_SUGGESTIONS[scenarioId] || SCENARIO_SUGGESTIONS['general-assistant']
  const titleConfig = SCENARIO_TITLES[scenarioId] || SCENARIO_TITLES['general-assistant']

  return (
    <div className="flex flex-col items-center justify-center p-6 select-none z-10 w-full max-w-md mx-auto my-auto min-h-[65vh]">
      <div className="relative mb-10 flex flex-col items-center w-full">
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-accent/20 blur-[50px] rounded-full w-40 h-40 pointer-events-none" />

        <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center mb-6 overflow-hidden">
          <img src={publicAsset('brand/ip/ai-avatar.gif')} alt="AI" className="w-full h-full object-cover" draggable={false} />
        </div>

        <h1 className="text-xl font-semibold text-text-primary tracking-tight mb-2">
          {language === 'zh' ? titleConfig.titleZh : titleConfig.title}
        </h1>
        <p className="text-xs text-text-muted max-w-[260px] text-center leading-relaxed">
          {language === 'zh' ? titleConfig.subtitleZh : titleConfig.subtitle}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full relative z-10">
        {suggestions.map((item) => (
          <button
            key={item.prompt}
            onClick={() => onSelectSuggestion(item.prompt)}
            className="group relative flex items-center gap-4 py-3 px-4 rounded-xl border border-transparent bg-transparent hover:bg-surface-hover hover:border-border/60 transition-all duration-200 w-full text-left"
          >
            <div className={`p-2 rounded-xl ${item.iconBg} transition-colors shrink-0`}>
              {item.icon}
            </div>

            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-medium text-text-secondary group-hover:text-text-primary transition-colors block truncate">
                {language === 'zh' ? item.titleZh : item.title}
              </span>
            </div>

            <div className="shrink-0 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200">
              <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-accent" />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

const DEFAULT_TITLE: WelcomeTitleConfig = {
  title: 'How can I help?',
  titleZh: '有什么可以帮你的？',
  subtitle: 'Choose a suggestion below, or ask me anything.',
  subtitleZh: '选择下方建议，或直接问我任何问题',
}

const DEFAULT_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Lightbulb', title: 'Brainstorm ideas', titleZh: '头脑风暴', prompt: "I need some creative ideas. Let's brainstorm together and explore different possibilities.", color: '' },
  { icon: 'HelpCircle', title: 'Answer questions', titleZh: '回答问题', prompt: 'I have a question I need help with. Can you provide a clear and thorough explanation?', color: '' },
  { icon: 'Globe', title: 'Research a topic', titleZh: '研究一个话题', prompt: 'Help me research a topic. Find relevant information and summarize the key points.', color: '' },
  { icon: 'Brain', title: 'Solve a problem', titleZh: '解决问题', prompt: "I'm facing a problem and need help thinking through it. Let's work through it step by step.", color: '' },
]

interface EmptyChatSuggestionsProps {
  onSelectSuggestion: (text: string) => void
}

export default function EmptyChatSuggestions({ onSelectSuggestion }: EmptyChatSuggestionsProps) {
  const language = useStore(s => s.language)
  const activeScenarioId = useStore(s => s.activeScenarioId)

  const scenario = scenarioRegistry.get(activeScenarioId)
  const ui = scenario?.ui
  const suggestions = ui?.welcomeSuggestions || DEFAULT_SUGGESTIONS
  const titleConfig = ui?.welcomeTitle || DEFAULT_TITLE

  return (
    <div className="flex flex-col items-center justify-center p-6 select-none z-10 w-full max-w-lg mx-auto my-auto min-h-[65vh]">
      <div className="relative mb-8 flex flex-col items-center w-full">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {language === 'zh' ? titleConfig.titleZh : titleConfig.title}
        </h1>
      </div>

      <div className="flex flex-wrap gap-2 justify-center w-full relative z-10">
        {suggestions.map((item) => (
          <button
            key={item.prompt}
            onClick={() => onSelectSuggestion(item.prompt)}
            className="inline-flex items-center px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 bg-[#f5f5f5] dark:bg-[#2a2a2e] text-[#333333] dark:text-[#cccccc] hover:bg-[#ebebeb] dark:hover:bg-[#353538] border border-transparent"
          >
            <span>{language === 'zh' ? item.titleZh : item.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

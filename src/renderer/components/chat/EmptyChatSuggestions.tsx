import {
  Sparkles, Code2, FileText, Bug, Brain, Lightbulb, Globe, PenTool, BarChart3,
  MessageSquare, HelpCircle, Stethoscope, Building2, TrendingUp, ClipboardList,
  Store, Search, Database, Zap, Target, Settings, BookOpen, Layout, Terminal,
  Cpu, Shield, Palette, Music, Camera, Film, Map, Compass, Heart, Star,
  Award, Briefcase, Calendar, Cloud, Coffee, Download, Edit, Eye, Flag,
  Folder, Gift, Home, Key, Lock, Mail, Mic, Monitor, Moon, Phone, PieChart,
  Printer, Rocket, Send, Share, Sun, Tag, Wrench, Umbrella, Users, Video,
  Wifi, Wind, X, Check, ChevronRight, ArrowRight, Plus, Minus, Info, AlertTriangle,
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/config/scenarios'
import { publicAsset } from '@utils/publicAsset'
import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/types/scenario'
import type { ComponentType } from 'react'

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Sparkles, Code2, FileText, Bug, Brain, Lightbulb, Globe, PenTool, BarChart3,
  MessageSquare, HelpCircle, Stethoscope, Building2, TrendingUp, ClipboardList,
  Store, Search, Database, Zap, Target, Settings, BookOpen, Layout, Terminal,
  Cpu, Shield, Palette, Music, Camera, Film, Map, Compass, Heart, Star,
  Award, Briefcase, Calendar, Cloud, Coffee, Download, Edit, Eye, Flag,
  Folder, Gift, Home, Key, Lock, Mail, Mic, Monitor, Moon, Phone, PieChart,
  Printer, Rocket, Send, Share, Sun, Tag, Wrench, Umbrella, Users, Video,
  Wifi, Wind, X, Check, ChevronRight, ArrowRight, Plus, Minus, Info, AlertTriangle,
}

const DEFAULT_TITLE: WelcomeTitleConfig = {
  title: 'How can I help?',
  titleZh: '有什么可以帮你的？',
  subtitle: 'Choose a suggestion below, or ask me anything.',
  subtitleZh: '选择下方建议，或直接问我任何问题',
}

const DEFAULT_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Lightbulb', title: 'Brainstorm ideas', titleZh: '头脑风暴', prompt: "I need some creative ideas. Let's brainstorm together and explore different possibilities.", color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20' },
  { icon: 'HelpCircle', title: 'Answer questions', titleZh: '回答问题', prompt: 'I have a question I need help with. Can you provide a clear and thorough explanation?', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'Globe', title: 'Research a topic', titleZh: '研究一个话题', prompt: 'Help me research a topic. Find relevant information and summarize the key points.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'Brain', title: 'Solve a problem', titleZh: '解决问题', prompt: "I'm facing a problem and need help thinking through it. Let's work through it step by step.", color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
]

interface EmptyChatSuggestionsProps {
  onSelectSuggestion: (text: string) => void
}

function renderIcon(iconName: string) {
  const IconComponent = ICON_MAP[iconName]
  if (!IconComponent) return <Sparkles className="w-3.5 h-3.5" />
  return <IconComponent className="w-3.5 h-3.5" />
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

      <div className="flex flex-wrap gap-2 justify-center w-full relative z-10">
        {suggestions.map((item) => (
          <button
            key={item.prompt}
            onClick={() => onSelectSuggestion(item.prompt)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-medium transition-all duration-200 ${item.color}`}
          >
            {renderIcon(item.icon)}
            <span>{language === 'zh' ? item.titleZh : item.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

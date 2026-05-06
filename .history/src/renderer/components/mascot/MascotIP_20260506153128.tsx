import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { PanelRightOpen, PanelRightClose } from 'lucide-react'

export function MascotIP() {
  const { chatVisible, setChatVisible, language } = useStore(useShallow(s => ({
    chatVisible: s.chatVisible,
    setChatVisible: s.setChatVisible,
    language: s.language,
  })))

  const handleToggle = () => {
    setChatVisible(!chatVisible)
  }

  return (
    <button
      onClick={handleToggle}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
        chatVisible
          ? 'text-accent bg-accent/10 hover:bg-accent/20'
          : 'text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]'
      }`}
      title={language === 'zh' ? (chatVisible ? '隐藏 AI 助手' : '显示 AI 助手') : (chatVisible ? 'Hide AI Assistant' : 'Show AI Assistant')}
    >
      {chatVisible ? (
        <PanelRightClose className="w-4 h-4" />
      ) : (
        <PanelRightOpen className="w-4 h-4" />
      )}
    </button>
  )
}

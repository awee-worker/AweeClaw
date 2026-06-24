/**
 * 场景开发助手欢迎页
 *
 * 显示场景介绍和快捷操作入口。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { SCENARIO_BUILDER_WELCOME_SUGGESTIONS, SCENARIO_BUILDER_WELCOME_TITLE } from '../../config/welcome'

const BuilderWelcomePage: React.FC = () => {
  const { language } = useI18n()
  const isZh = language === 'zh'

  const title = isZh ? SCENARIO_BUILDER_WELCOME_TITLE.titleZh : SCENARIO_BUILDER_WELCOME_TITLE.title
  const subtitle = isZh ? SCENARIO_BUILDER_WELCOME_TITLE.subtitleZh : SCENARIO_BUILDER_WELCOME_TITLE.subtitle

  const handleSuggestionClick = (prompt: string) => {
    // 通过自定义事件通知聊天面板发送消息
    window.dispatchEvent(
      new CustomEvent('scenario:welcome-suggestion', {
        detail: { scenarioId: 'scenario-builder', prompt },
      }),
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* 标题 */}
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent"
              >
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {/* 快捷操作 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SCENARIO_BUILDER_WELCOME_SUGGESTIONS.map((suggestion, idx) => {
            const suggestionTitle = isZh ? suggestion.titleZh : suggestion.title
            return (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(suggestion.prompt)}
                className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all hover:scale-[1.02] ${suggestion.color}`}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background/50">
                  <SuggestionIcon name={suggestion.icon} />
                </div>
                <span className="text-xs font-medium">{suggestionTitle}</span>
              </button>
            )
          })}
        </div>

        {/* 功能介绍 */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FeatureCard
            icon="FolderTree"
            title={isZh ? '项目管理' : 'Project Management'}
            desc={isZh ? '创建、打开、管理场景项目' : 'Create, open, manage scenario projects'}
          />
          <FeatureCard
            icon="Hammer"
            title={isZh ? '构建调试' : 'Build & Debug'}
            desc={isZh ? '校验配置、构建打包、热重载' : 'Validate, build, pack, hot reload'}
          />
          <FeatureCard
            icon="Package"
            title={isZh ? '本地安装' : 'Local Install'}
            desc={isZh ? '安装到客户端测试' : 'Install to client for testing'}
          />
          <FeatureCard
            icon="Cloud"
            title={isZh ? '发布市场' : 'Publish'}
            desc={isZh ? '发布到开发者中心' : 'Publish to developer center'}
          />
        </div>
      </div>
    </div>
  )
}

/** 功能卡片 */
const FeatureCard: React.FC<{ icon: string; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className="flex items-start gap-3 rounded-lg border border-border p-3">
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
      <FeatureIcon name={icon} />
    </div>
    <div className="min-w-0">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
    </div>
  </div>
)

/** 建议图标 */
const SuggestionIcon: React.FC<{ name: string }> = ({ name }) => <FeatureIcon name={name} />

/** 功能图标 - 内置 SVG 图标集 */
const FeatureIcon: React.FC<{ name: string }> = ({ name }) => {
  const icons: Record<string, React.ReactNode> = {
    Rocket: (
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0 M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    ),
    FileCode: (
      <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4 M14 2v4a2 2 0 0 0 2 2h4 M10 18l-2-2 2-2 M14 14l2 2-2 2" />
    ),
    Wrench: (
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    ),
    Play: <path d="M6 3v18l15-9z" />,
    Package: (
      <path d="M16.5 9.4 7.5 4.21 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12" />
    ),
    Cloud: <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 14.9 M12 12v9" />,
    FolderTree: (
      <path d="M20 10h-5a2 2 0 0 0-2 2v8 M9 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-6z M2 2h6v6H2z" />
    ),
    Hammer: (
      <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9 M17.5 12.5 22 8l-4-4-4.5 4.5 M12 21l3.5-3.5" />
    ),
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name] || icons.Wrench}
    </svg>
  )
}

export default BuilderWelcomePage

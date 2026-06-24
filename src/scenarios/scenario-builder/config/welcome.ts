import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const SCENARIO_BUILDER_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  {
    icon: 'Rocket',
    title: 'Create a scenario',
    titleZh: '创建场景',
    prompt: '帮我创建一个新的场景项目，声明式类型，用于法律咨询助手',
    color: 'text-accent bg-accent/10 border-accent/20 hover:bg-accent/20',
  },
  {
    icon: 'FileCode',
    title: 'Write scenario.json',
    titleZh: '编写场景配置',
    prompt: '帮我编写一个场景的 scenario.json 配置，包含提示词、工具、UI 布局',
    color: 'text-sky-500 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20',
  },
  {
    icon: 'Wrench',
    title: 'Develop custom tool',
    titleZh: '开发自定义工具',
    prompt: '帮我开发一个场景自定义工具，用于查询数据库并返回结构化结果',
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20',
  },
  {
    icon: 'Play',
    title: 'Debug & build',
    titleZh: '调试与构建',
    prompt: '帮我调试和构建当前场景项目，检查配置是否正确',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20',
  },
  {
    icon: 'Package',
    title: 'Install locally',
    titleZh: '本地安装',
    prompt: '帮我将构建好的场景安装到本地客户端进行测试',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20',
  },
  {
    icon: 'Cloud',
    title: 'Publish to market',
    titleZh: '发布到市场',
    prompt: '帮我将完成的场景发布到开发者中心市场',
    color: 'text-pink-500 bg-pink-500/10 border-pink-500/20 hover:bg-pink-500/20',
  },
]

export const SCENARIO_BUILDER_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'Build your own scenario',
  titleZh: '开发你的场景',
  subtitle: 'Create, debug, install, and publish AweeClaw scenarios with AI assistance',
  subtitleZh: '使用 AI 辅助创建、调试、安装和发布 AweeClaw 场景',
}

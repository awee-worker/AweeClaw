import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const DEV_STUDIO_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  {
    icon: 'Rocket',
    title: 'Create a new project',
    titleZh: '创建新项目',
    prompt: 'I want to create a new project. Help me choose the right tech stack and scaffold it.',
    color: 'text-accent bg-accent/10 border-accent/20 hover:bg-accent/20',
  },
  {
    icon: 'Globe',
    title: 'Build a Next.js app',
    titleZh: '构建 Next.js 全栈应用',
    prompt: 'Help me build a full-stack Next.js application with TypeScript, Tailwind CSS, and a database.',
    color: 'text-sky-500 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20',
  },
  {
    icon: 'Server',
    title: 'Set up a REST API',
    titleZh: '搭建 REST API 服务',
    prompt: 'Help me create a REST API service with Express/Fastify, authentication, and database integration.',
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20',
  },
  {
    icon: 'Layout',
    title: 'Design a landing page',
    titleZh: '设计一个落地页',
    prompt: 'Help me design and build a responsive landing page with modern UI components.',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20',
  },
  {
    icon: 'GitBranch',
    title: 'Import existing project',
    titleZh: '导入已有项目',
    prompt: 'Help me import an existing project and set up the development environment.',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20',
  },
  {
    icon: 'Bot',
    title: 'Multi-agent development',
    titleZh: '多 Agent 协作开发',
    prompt: 'Let multiple AI agents collaborate on building my project - PM, coder, reviewer, tester, and DevOps.',
    color: 'text-pink-500 bg-pink-500/10 border-pink-500/20 hover:bg-pink-500/20',
  },
]

export const DEV_STUDIO_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'What to build today?',
  titleZh: '今天想构建什么？',
  subtitle: 'Start from a template, import existing code, or describe your idea and let AI build it.',
  subtitleZh: '从模板开始、导入已有代码，或描述你的想法让 AI 帮你构建',
}
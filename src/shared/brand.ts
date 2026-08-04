/**
 * 品牌配置 - 单一真相来源 (Single Source of Truth)
 *
 * 所有品牌相关字符串集中管理，禁止在代码中硬编码品牌信息。
 * 主进程和渲染进程均可安全导入。
 */

export const BRAND = {
  name: 'AweeClaw',
  dirName: '.aweeclaw',
  cssPrefix: 'aweeclaw',
  themePrefix: 'aweeclaw',
  workspaceExt: 'aweeclaw-workspace',
  defaultTheme: 'aweeclaw-light',
  lightTheme: 'aweeclaw-light',

  author: {
    name: 'Awee Lee',
    wechat: 'jst-jst-ja-ja-ja',
    email: 'aweelee@qq.com',
  },

  links: {
    gitee: 'https://gitee.com/aweelee/aweeclaw.git',
    github: 'https://github.com/aweelee/aweeclaw',
    releases: 'https://github.com/aweelee/aweeclaw/releases/latest',
    website: 'https://www.aweeclaw.com',
    docs: 'https://docs.aweeclaw.com',
    developer: 'https://developer.aweeclaw.com',
    scenarios: 'https://docs.aweeclaw.com',
  },

  tagline: 'Connect AI to Your World',
  description: 'Scene-Driven AI-Native Agent Application Construction Platform',

  storageKeys: {
    themeId: 'aweeclaw-theme-id',
    themeBg: 'aweeclaw-theme-bg',
    themeType: 'aweeclaw-theme-type',
    settingsCache: 'aweeclaw-settings-cache',
    cloudAuth: 'aweeclaw-cloud-auth',
    customScenarios: 'aweeclaw-custom-scenarios',
    uninstalledBuiltin: 'aweeclaw-uninstalled-builtin-scenarios',
  },

  mcp: {
    clientName: 'AweeClaw',
    clientId: 'aweeclaw',
    providerName: 'AweeClaw',
  },

  debug: {
    clientId: 'aweeclaw',
    clientName: 'AweeClaw',
  },

  cloud: {
    providerId: 'aweeclaw-cloud',
    providerName: 'AweeClaw Cloud',
  },

  dragDrop: {
    fileMimeType: 'application/aweeclaw-file-path',
  },

  layout: {
    dynamicIslandId: 'aweeclaw-dynamic-island',
  },

  paths: {
    knowledge: '.aweeclaw/knowledge',
    knowledgeStore: '.aweeclaw/knowledge/store.json',
    knowledgeVectors: '.aweeclaw/knowledge/vectors.json',
    knowledgeConversation: '.aweeclaw/knowledge/conversation.json',
    memory: '.aweeclaw/memory',
    memoryStore: '.aweeclaw/memory/store.json',
    oldMemory: '.aweeclaw/memory.json',
    oldKnowledge: '.aweeclaw/knowledge/manual.json',
    plan: '.aweeclaw/plan',
    skills: '.aweeclaw/skills',
    skillsConfig: '.aweeclaw/skills/.skills-config.json',
    rules: '.aweeclaw/rules.md',
    projectSummary: '.aweeclaw/project-summary.json',
    structuralIndex: '.aweeclaw/structural-index.json',
    indexStatus: '.aweeclaw/index-status.json',
    index: '.aweeclaw/index',
    agentTemp: '.aweeclaw/agent-temp',
    pythonTemp: '.aweeclaw/python-temp',
    uploads: '.aweeclaw/uploads',
    screenshot: '.aweeclaw/screenshot',
  },

  marketplace: {
    baseUrl: 'https://marketplace.aweeclaw.com/api',
  },
} as const

export type BrandConfig = typeof BRAND

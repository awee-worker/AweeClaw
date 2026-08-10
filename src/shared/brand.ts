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

  /**
   * 商务合作联系方式（定制服务 / 合伙人招募等）
   * 与 author（创建者个人）区分，用于对外商务对接。
   */
  contact: {
    wechat: 'AweeClaw',
    email: 'jweelee@qq.com',
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
    /** 项目附件（本地优先：跟随工作区走，后端仅作跨设备同步兜底） */
    attachments: '.aweeclaw/attachments',
  },

  /**
   * 项目附件配置（主进程与渲染进程共用，单一真相源）
   * 避免前后端扩展名/限制不一致导致"前端允许、后端拒绝"问题
   */
  attachmentConfig: {
    /** 单文件大小上限（字节）：20MB */
    maxFileSize: 20 * 1024 * 1024,
    /** 单项目附件数量上限 */
    maxCount: 20,
    /** 文本内容截断阈值（字节）：50KB（足够 AI 读取，避免 _meta.json 过大） */
    maxTextLength: 50 * 1024,
    /** 允许的文件扩展名（小写，不含点）—— 主进程校验 + 渲染进程过滤共用 */
    allowedExtensions: [
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'txt', 'md', 'csv', 'json',
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
      'zip', 'rar', '7z',
    ],
    /** <input accept> 属性值（逗号分隔，前端文件选择器用） */
    acceptAttr: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.jpg,.jpeg,.png,.gif,.webp,.svg,.zip,.rar,.7z',
  },

  marketplace: {
    baseUrl: 'https://marketplace.aweeclaw.com/api',
  },
} as const

export type BrandConfig = typeof BRAND

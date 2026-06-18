/**
 * dev-studio 脚手架服务
 *
 * 负责项目模板管理和项目脚手架生成。
 */
import type { ProjectTemplate, TemplateCategory, CreateProjectOptions, ProjectScaffoldResult, ScaffoldStep } from '../types'

// ==========================================
// 内置模板定义
// ==========================================

const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'nextjs-fullstack',
    name: 'Next.js Full Stack',
    nameZh: 'Next.js 全栈应用',
    description: 'Full-stack application with Next.js, TypeScript, Tailwind CSS, and Prisma',
    descriptionZh: 'Next.js + TypeScript + Tailwind CSS + Prisma 全栈应用',
    icon: 'Globe',
    category: 'fullstack',
    tags: ['nextjs', 'react', 'typescript', 'tailwind', 'prisma', 'fullstack'],
    featured: true,
    variables: [
      { key: 'projectName', label: 'Project Name', labelZh: '项目名称', type: 'string', default: 'my-app', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
      { key: 'tailwind', label: 'Tailwind CSS', labelZh: '使用 Tailwind CSS', type: 'boolean', default: true },
      { key: 'eslint', label: 'ESLint', labelZh: '使用 ESLint', type: 'boolean', default: true },
      { key: 'srcDir', label: 'Use src/ directory', labelZh: '使用 src/ 目录', type: 'boolean', default: true },
      { key: 'appRouter', label: 'App Router', labelZh: '使用 App Router', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'npm',
      url: 'create-next-app@latest',
      preInstall: [],
      postInstall: ['git init', 'git add .', 'git commit -m "Initial commit from Dev Studio"'],
    },
  },
  {
    id: 'vite-react',
    name: 'Vite + React',
    nameZh: 'Vite + React 应用',
    description: 'Modern React SPA with Vite, TypeScript, and Tailwind CSS',
    descriptionZh: 'Vite + React + TypeScript + Tailwind CSS 现代化前端应用',
    icon: 'Zap',
    category: 'frontend',
    tags: ['vite', 'react', 'typescript', 'tailwind', 'spa'],
    featured: true,
    variables: [
      { key: 'projectName', label: 'Project Name', labelZh: '项目名称', type: 'string', default: 'vite-app', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
      { key: 'tailwind', label: 'Tailwind CSS', labelZh: '使用 Tailwind CSS', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'npm',
      url: 'create-vite@latest',
      postInstall: ['npm install', 'git init'],
    },
  },
  {
    id: 'express-api',
    name: 'Express API',
    nameZh: 'Express API 服务',
    description: 'REST API service with Express, TypeScript, and Prisma',
    descriptionZh: 'Express + TypeScript + Prisma REST API 服务',
    icon: 'Server',
    category: 'api',
    tags: ['express', 'node', 'typescript', 'prisma', 'api', 'rest'],
    featured: true,
    variables: [
      { key: 'projectName', label: 'Project Name', labelZh: '项目名称', type: 'string', default: 'api-server', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
      { key: 'database', label: 'Database', labelZh: '数据库', type: 'select', default: 'sqlite', options: [
        { label: 'SQLite', value: 'sqlite' },
        { label: 'PostgreSQL', value: 'postgresql' },
        { label: 'MySQL', value: 'mysql' },
      ]},
      { key: 'auth', label: 'Authentication', labelZh: '身份认证', type: 'boolean', default: true },
      { key: 'eslint', label: 'ESLint', labelZh: '使用 ESLint', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'inline',
      files: {},
      postInstall: ['npm install', 'git init'],
    },
  },
  {
    id: 'vue3-spa',
    name: 'Vue 3 SPA',
    nameZh: 'Vue 3 单页应用',
    description: 'Modern Vue 3 SPA with Vite, TypeScript, and Pinia',
    descriptionZh: 'Vue 3 + Vite + TypeScript + Pinia 现代化单页应用',
    icon: 'Layers',
    category: 'frontend',
    tags: ['vue', 'vite', 'typescript', 'pinia', 'spa'],
    variables: [
      { key: 'projectName', label: 'Project Name', labelZh: '项目名称', type: 'string', default: 'vue-app', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
      { key: 'tailwind', label: 'Tailwind CSS', labelZh: '使用 Tailwind CSS', type: 'boolean', default: true },
      { key: 'router', label: 'Vue Router', labelZh: '使用 Vue Router', type: 'boolean', default: true },
      { key: 'pinia', label: 'Pinia', labelZh: '使用 Pinia 状态管理', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'npm',
      url: 'create-vue@latest',
      postInstall: ['npm install', 'git init'],
    },
  },
  {
    id: 'static-landing',
    name: 'Static Landing Page',
    nameZh: '静态落地页',
    description: 'Responsive landing page with HTML, Tailwind CSS, and vanilla JS',
    descriptionZh: 'HTML + Tailwind CSS + Vanilla JS 响应式落地页',
    icon: 'Layout',
    category: 'static',
    tags: ['html', 'tailwind', 'landing', 'static', 'responsive'],
    variables: [
      { key: 'projectName', label: 'Project Name', labelZh: '项目名称', type: 'string', default: 'landing-page', required: true },
      { key: 'tailwind', label: 'Tailwind CSS', labelZh: '使用 Tailwind CSS', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'inline',
      files: {},
      postInstall: ['git init'],
    },
  },
  {
    id: 'electron-app',
    name: 'Electron App',
    nameZh: 'Electron 桌面应用',
    description: 'Cross-platform desktop app with Electron, React, and TypeScript',
    descriptionZh: 'Electron + React + TypeScript 跨平台桌面应用',
    icon: 'Monitor',
    category: 'frontend',
    tags: ['electron', 'react', 'typescript', 'desktop', 'cross-platform'],
    variables: [
      { key: 'projectName', label: 'Project Name', labelZh: '项目名称', type: 'string', default: 'electron-app', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
      { key: 'tailwind', label: 'Tailwind CSS', labelZh: '使用 Tailwind CSS', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'npm',
      url: 'create-electron-app@latest',
      postInstall: ['npm install', 'git init'],
    },
  },
  {
    id: 'npm-library',
    name: 'NPM Library',
    nameZh: 'NPM 库',
    description: 'TypeScript library with tsup, vitest, and automated publishing',
    descriptionZh: 'TypeScript 库 + tsup 构建 + vitest 测试 + 自动发布',
    icon: 'Package',
    category: 'library',
    tags: ['typescript', 'library', 'npm', 'vitest', 'tsup'],
    variables: [
      { key: 'projectName', label: 'Package Name', labelZh: '包名', type: 'string', default: 'my-lib', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
      { key: 'eslint', label: 'ESLint', labelZh: '使用 ESLint', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'inline',
      files: {},
      postInstall: ['npm install', 'git init'],
    },
  },
  {
    id: 'cli-tool',
    name: 'CLI Tool',
    nameZh: 'CLI 命令行工具',
    description: 'Node.js CLI tool with Commander.js, chalk, and ora',
    descriptionZh: 'Node.js CLI 工具 + Commander.js + chalk + ora',
    icon: 'Terminal',
    category: 'cli',
    tags: ['node', 'cli', 'commander', 'typescript', 'tool'],
    variables: [
      { key: 'projectName', label: 'CLI Name', labelZh: '命令名', type: 'string', default: 'my-cli', required: true },
      { key: 'typescript', label: 'TypeScript', labelZh: '使用 TypeScript', type: 'boolean', default: true },
    ],
    scaffold: {
      type: 'inline',
      files: {},
      postInstall: ['npm install', 'npm link', 'git init'],
    },
  },
]

// ==========================================
// 分类标签映射
// ==========================================

const CATEGORY_LABELS: Record<TemplateCategory, { en: string; zh: string }> = {
  frontend: { en: 'Frontend', zh: '前端' },
  backend: { en: 'Backend', zh: '后端' },
  fullstack: { en: 'Full Stack', zh: '全栈' },
  mobile: { en: 'Mobile', zh: '移动端' },
  static: { en: 'Static Site', zh: '静态站点' },
  library: { en: 'Library', zh: '库/组件' },
  api: { en: 'API Service', zh: 'API 服务' },
  cli: { en: 'CLI Tool', zh: 'CLI 工具' },
}

// ==========================================
// ScaffoldService
// ==========================================

export class ScaffoldService {
  /**
   * 获取所有可用模板
   */
  getTemplates(category?: TemplateCategory): ProjectTemplate[] {
    if (category) {
      return BUILTIN_TEMPLATES.filter(t => t.category === category)
    }
    return [...BUILTIN_TEMPLATES]
  }

  /**
   * 获取精选模板
   */
  getFeaturedTemplates(): ProjectTemplate[] {
    return BUILTIN_TEMPLATES.filter(t => t.featured)
  }

  /**
   * 获取单个模板
   */
  getTemplate(id: string): ProjectTemplate | undefined {
    return BUILTIN_TEMPLATES.find(t => t.id === id)
  }

  /**
   * 获取模板分类列表
   */
  getCategories(): { key: TemplateCategory; label: string; labelZh: string }[] {
    return Object.entries(CATEGORY_LABELS).map(([key, val]) => ({
      key: key as TemplateCategory,
      label: val.en,
      labelZh: val.zh,
    }))
  }

  /**
   * 搜索模板
   */
  searchTemplates(query: string): ProjectTemplate[] {
    const q = query.toLowerCase()
    return BUILTIN_TEMPLATES.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.nameZh.includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.includes(q)),
    )
  }

  /**
   * 验证变量
   */
  validateVariables(template: ProjectTemplate, variables: Record<string, string | number | boolean>): string[] {
    const errors: string[] = []
    for (const v of template.variables) {
      if (v.required && (variables[v.key] === undefined || variables[v.key] === '')) {
        errors.push(`${v.label} is required`)
      }
      if (v.type === 'select' && v.options && variables[v.key] !== undefined) {
        const validValues = v.options.map(o => o.value)
        if (!validValues.includes(String(variables[v.key]))) {
          errors.push(`${v.label}: invalid value "${variables[v.key]}"`)
        }
      }
    }
    return errors
  }

  /**
   * 构建脚手架命令
   */
  buildScaffoldCommand(template: ProjectTemplate, options: CreateProjectOptions): string {
    const { scaffold } = template
    const { name, variables = {} } = options

    switch (scaffold.type) {
      case 'npm': {
        const parts = [scaffold.url]
        // Create Next.js app style
        if (scaffold.url?.includes('create-next-app')) {
          parts.push(name)
          if (variables.typescript === false) parts.push('--no-typescript')
          if (variables.tailwind === false) parts.push('--no-tailwind')
          if (variables.eslint === false) parts.push('--no-eslint')
          if (variables.srcDir === false) parts.push('--no-src-dir')
          if (variables.appRouter === false) parts.push('--no-app')
        }
        // Create Vite style
        else if (scaffold.url?.includes('create-vite')) {
          parts.push(name)
          if (variables.typescript !== false) parts.push('--template', 'react-ts')
          else parts.push('--template', 'react')
        }
        // Create Vue style
        else if (scaffold.url?.includes('create-vue')) {
          parts.push(name)
        }
        // Create Electron style
        else if (scaffold.url?.includes('create-electron-app')) {
          parts.push(name)
          if (variables.typescript !== false) parts.push('--template=typescript-webpack')
        }
        else {
          parts.push(name)
        }
        return `npx ${parts.join(' ')}`
      }
      case 'git':
        return `git clone ${scaffold.url} ${name}`
      case 'download':
        return `# Download scaffold from ${scaffold.url}`
      case 'inline':
      default:
        return `# Inline scaffold for ${template.name}`
    }
  }

  /**
   * 获取安装后脚本
   */
  getPostInstallScripts(template: ProjectTemplate, _localPath: string, _variables: Record<string, string | number | boolean>): string[] {
    return template.scaffold.postInstall ?? []
  }

  /**
   * 执行脚手架（模拟 - 实际由终端执行）
   */
  async scaffold(options: CreateProjectOptions): Promise<ProjectScaffoldResult> {
    const template = this.getTemplate(options.templateId)
    if (!template) {
      return {
        success: false,
        error: `Template not found: ${options.templateId}`,
        steps: [{ id: 'validate', status: 'failed', message: `Template "${options.templateId}" not found` }],
      }
    }

    const validationErrors = this.validateVariables(template, options.variables ?? {})
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: validationErrors.join('; '),
        steps: [{ id: 'validate', status: 'failed', message: validationErrors.join('; ') }],
      }
    }

    const steps: ScaffoldStep[] = [
      { id: 'validate', status: 'success', message: 'Template validated' },
      { id: 'scaffold', status: 'success', message: this.buildScaffoldCommand(template, options) },
    ]

    const postInstall = this.getPostInstallScripts(template, options.localPath, options.variables ?? {})
    for (let i = 0; i < postInstall.length; i++) {
      steps.push({
        id: `postinstall-${i}`,
        status: 'pending',
        message: postInstall[i],
      })
    }

    return {
      success: true,
      localPath: options.localPath,
      steps,
    }
  }
}

export const scaffoldService = new ScaffoldService()
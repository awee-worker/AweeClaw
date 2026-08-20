/**
 * 生命周期钩子代码片段集合
 *
 * 提供场景模块生命周期钩子样板：
 *  - lifecycle-activate:    onActivate 钩子（初始化资源）
 *  - lifecycle-deactivate:  onDeactivate 钩子（清理资源）
 *  - lifecycle-healthcheck: onHealthCheck 钩子（健康检查）
 *  - lifecycle-full:        完整生命周期模块样板
 */
import type { Snippet } from './types'

// ==========================================
// onActivate 钩子
// ==========================================
export const lifecycleActivateSnippet: Snippet = {
  id: 'lifecycle-activate',
  name: 'On Activate Hook',
  nameZh: '激活钩子',
  description: 'onActivate hook for resource initialization (DB / IPC / cache)',
  descriptionZh: 'onActivate 钩子：初始化数据库、注册 IPC、预热缓存',
  category: 'lifecycle',
  applicableTypes: ['programmatic'],
  language: 'typescript',
  icon: 'Power',
  tags: ['lifecycle', 'activate', 'init'],
  difficulty: 'beginner',
  targetFile: 'src/index.ts',
  variables: [
    {
      name: 'scenarioId',
      defaultValue: 'my_scenario',
      description: 'Scenario ID for logging',
      descriptionZh: '场景 ID（用于日志）',
      required: true,
    },
  ],
  code: `onActivate: async (context) => {
  context.getLogger().info('[\${scenarioId}] activating...')

  // 1. 初始化数据库（如果声明了 database:query 权限）
  try {
    const scripts = await context.readInstallScripts()
    if (scripts.length > 0) {
      await context.executeSql(scripts.map(s => s.sql).join('\\n'))
      context.getLogger().info('[\${scenarioId}] database initialized')
    }
  } catch (err) {
    context.getLogger().error('[\${scenarioId}] DB init failed:', err)
    // 非致命错误：场景仍可继续激活
  }

  // 2. 注册 IPC 处理器（如果有）
  // context.registerIpcHandler('my-scenario:action', handler)

  // 3. 预热缓存 / 加载配置
  // const config = await context.loadConfig()

  context.getLogger().info('[\${scenarioId}] activated')
},`,
  usage: '插入到 src/index.ts 的 module 对象中；声明了 database:query 权限时必须初始化表结构。',
}

// ==========================================
// onDeactivate 钩子
// ==========================================
export const lifecycleDeactivateSnippet: Snippet = {
  id: 'lifecycle-deactivate',
  name: 'On Deactivate Hook',
  nameZh: '停用钩子',
  description: 'onDeactivate hook for cleanup (IPC / cache / timers)',
  descriptionZh: 'onDeactivate 钩子：清理 IPC、缓存、定时器',
  category: 'lifecycle',
  applicableTypes: ['programmatic'],
  language: 'typescript',
  icon: 'PowerOff',
  tags: ['lifecycle', 'deactivate', 'cleanup'],
  difficulty: 'beginner',
  targetFile: 'src/index.ts',
  variables: [
    {
      name: 'scenarioId',
      defaultValue: 'my_scenario',
      description: 'Scenario ID for logging',
      descriptionZh: '场景 ID（用于日志）',
      required: true,
    },
  ],
  code: `onDeactivate: async (context) => {
  context.getLogger().info('[\${scenarioId}] deactivating...')

  // 1. 注销 IPC 处理器
  // context.unregisterIpcHandler('my-scenario:action')

  // 2. 清理定时器 / 监听器
  // if (this.timer) clearTimeout(this.timer)

  // 3. 清空内存缓存
  // this.cache.clear()

  // 注意：不要在此处 DROP 表！数据保留以备下次激活。
  // 仅在用户主动"卸载场景"时才执行 uninstall SQL。

  context.getLogger().info('[\${scenarioId}] deactivated')
},`,
  usage: '插入到 src/index.ts 的 module 对象中；只清理易失资源，不要 DROP 表。',
}

// ==========================================
// onHealthCheck 钩子
// ==========================================
export const lifecycleHealthCheckSnippet: Snippet = {
  id: 'lifecycle-healthcheck',
  name: 'Health Check Hook',
  nameZh: '健康检查钩子',
  description: 'onHealthCheck hook returning structured health status',
  descriptionZh: 'onHealthCheck 钩子：返回结构化健康状态',
  category: 'lifecycle',
  applicableTypes: ['programmatic'],
  language: 'typescript',
  icon: 'HeartPulse',
  tags: ['lifecycle', 'healthcheck', 'monitoring'],
  difficulty: 'intermediate',
  targetFile: 'src/index.ts',
  variables: [
    {
      name: 'scenarioId',
      defaultValue: 'my_scenario',
      description: 'Scenario ID',
      descriptionZh: '场景 ID',
      required: true,
    },
  ],
  code: `onHealthCheck: async (context): Promise<ScenarioHealthCheck[]> => {
  const checks: ScenarioHealthCheck[] = []

  // 1. 模块本身
  checks.push({
    name: 'module',
    status: 'healthy',
    message: '\${scenarioId} ready',
  })

  // 2. 数据库连通性
  try {
    await context.executeSql('SELECT 1')
    checks.push({ name: 'database', status: 'healthy', message: 'DB reachable' })
  } catch (err) {
    checks.push({
      name: 'database',
      status: 'unhealthy',
      message: (err as Error).message,
    })
  }

  // 3. 外部依赖（如已配置）
  // try {
  //   await fetch('https://api.example.com/health', { signal: AbortSignal.timeout(2000) })
  //   checks.push({ name: 'external_api', status: 'healthy' })
  // } catch {
  //   checks.push({ name: 'external_api', status: 'degraded', message: 'timeout' })
  // }

  return checks
},`,
  usage: '插入到 src/index.ts；客户端会在状态栏显示健康状态；外部依赖检查必须设置超时，避免阻塞。',
}

// ==========================================
// 完整生命周期模块
// ==========================================
export const lifecycleFullSnippet: Snippet = {
  id: 'lifecycle-full',
  name: 'Full Lifecycle Module',
  nameZh: '完整生命周期模块',
  description: 'Complete ScenarioModule with all lifecycle hooks implemented',
  descriptionZh: '完整 ScenarioModule：实现所有生命周期钩子',
  category: 'lifecycle',
  applicableTypes: ['programmatic'],
  language: 'typescript',
  icon: 'Layers',
  tags: ['lifecycle', 'module', 'full', 'template'],
  difficulty: 'advanced',
  targetFile: 'src/index.ts',
  variables: [
    {
      name: 'scenarioId',
      defaultValue: 'my_scenario',
      description: 'Scenario ID',
      descriptionZh: '场景 ID',
      required: true,
    },
    {
      name: 'scenarioName',
      defaultValue: 'My Scenario',
      description: 'Scenario display name',
      descriptionZh: '场景显示名',
      required: true,
    },
  ],
  code: `import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioHealthCheck,
} from '@aweeclaw/scenario-sdk'

const module: ScenarioModule = {
  id: '\${scenarioId}',
  version: '1.0.0',

  getManifest: () => ({
    id: '\${scenarioId}',
    version: '1.0.0',
    name: '\${scenarioName}',
    nameZh: '\${scenarioName}',
    author: 'developer',
    icon: 'Package',
    category: 'custom',
    tags: [],
    minAppVersion: '1.7.0',
    permissions: [],
    dependencies: [],
  }),

  getPlugin: () => ({
    id: '\${scenarioId}',
    name: '\${scenarioName}',
    nameZh: '\${scenarioName}',
    icon: 'Package',
    description: '',
    descriptionZh: '',
    version: '1.0.0',
    author: 'developer',
    category: 'custom',
    isBuiltin: false,
    requiresWorkspace: false,
    hasSettings: false,
    source: 'local',
    identity: { systemPrompt: '你是 \${scenarioName} 助手' },
    capabilities: { builtinTools: [], modes: [], contextTypes: [], outputFormats: ['text'] },
    ui: { layout: 'chat-centric', wideModeHidesChat: false, panels: [], sidebarItems: [], statusBarItems: [] },
    dataSources: { workspace: false, customSources: [] },
  }),

  getTools: () => [],
  getComponents: () => ({}),
  getInstallScripts: () => [],
  getUninstallScripts: () => [],
  getIpcHandlers: () => [],

  onActivate: async (context) => {
    context.getLogger().info('[\${scenarioId}] activated')
  },

  onDeactivate: async (context) => {
    context.getLogger().info('[\${scenarioId}] deactivated')
  },

  onHealthCheck: async (context): Promise<ScenarioHealthCheck[]> => {
    const log = context.getLogger()
    const checks: ScenarioHealthCheck[] = [
      { name: 'module', status: 'healthy', message: '\${scenarioId} ready' },
    ]
    try {
      await context.executeSql('SELECT 1')
      checks.push({ name: 'database', status: 'healthy', message: 'DB reachable' })
    } catch (err) {
      log.warn('[\${scenarioId}] DB unreachable:', err)
      checks.push({ name: 'database', status: 'unhealthy', message: (err as Error).message })
    }
    return checks
  },
}

export default module`,
  usage: '作为 src/index.ts 的初始模板；按需添加 getTools / getComponents / getIpcHandlers 等能力。',
}

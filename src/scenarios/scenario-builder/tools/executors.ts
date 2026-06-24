/**
 * 场景开发助手工具执行器
 *
 * 将工具定义映射到实际执行逻辑。
 * 每个执行器调用对应的服务方法。
 */
import type { ToolExecutor } from '@shared/protocols/modelGateway'
import { projectService, buildService, installService, publishService } from '../services'
import { SCENARIO_DEV_KNOWLEDGE, SCENARIO_DEV_QUICK_REF } from '../config/prompts-knowledge'

// ==========================================
// 项目管理执行器
// ==========================================

export const listScenarioProjectsExecutor: ToolExecutor = async (args, _context) => {
  const status = args.status as string | undefined
  const projects = await projectService.listProjects(status as any)
  return {
    success: true,
    result: JSON.stringify({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        scenarioId: p.scenarioId,
        version: p.version,
        type: p.type,
        status: p.status,
        localPath: p.localPath,
        updatedAt: p.updatedAt,
      })),
      total: projects.length,
    }),
  }
}

export const createScenarioProjectExecutor: ToolExecutor = async (args, _context) => {
  const result = await projectService.createProject({
    name: args.name as string,
    scenarioId: args.scenario_id as string,
    type: args.type as 'declarative' | 'programmatic',
    version: (args.version as string) || '1.0.0',
    description: args.description as string | undefined,
    author: args.author as string | undefined,
    tags: args.tags as string[] | undefined,
    localPath: args.local_path as string | undefined,
  })

  if (!result.success) {
    return { success: false, result: '', error: result.error }
  }

  return {
    success: true,
    result: JSON.stringify({
      project: result.project,
      localPath: result.localPath,
      steps: result.steps,
      message: `项目已创建：${result.project?.name}（路径：${result.localPath}）`,
    }),
  }
}

export const getScenarioProjectExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }
  return { success: true, result: JSON.stringify({ project }) }
}

export const updateScenarioProjectExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const updates: Record<string, unknown> = {}

  if (args.name) updates.name = args.name
  if (args.version) updates.version = args.version
  if (args.description) updates.description = args.description
  if (args.status) updates.status = args.status

  await projectService.updateProject(projectId, updates)
  const project = await projectService.getProject(projectId)

  return {
    success: true,
    result: JSON.stringify({ project, message: '项目已更新' }),
  }
}

export const deleteScenarioProjectExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  await projectService.deleteProject(projectId)
  return {
    success: true,
    result: JSON.stringify({ message: `项目 ${projectId} 已归档` }),
  }
}

// ==========================================
// 开发辅助执行器
// ==========================================

export const getScenarioTemplatesExecutor: ToolExecutor = async (args, _context) => {
  // 返回内置模板列表
  const templates = getBuiltinTemplates()
  const type = args.type as string | undefined
  const filtered = type ? templates.filter((t) => t.type === type) : templates

  return {
    success: true,
    result: JSON.stringify({
      templates: filtered.map((t) => ({
        id: t.id,
        name: t.name,
        nameZh: t.nameZh,
        type: t.type,
        category: t.category,
        description: t.description,
      })),
      total: filtered.length,
    }),
  }
}

export const readScenarioFileExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const filePath = args.file_path as string

  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }

  // 通过 IPC 读取文件
  const content = await readFileViaIpc(project.localPath, filePath)
  if (content === null) {
    return { success: false, result: '', error: `File not found: ${filePath}` }
  }

  return {
    success: true,
    result: JSON.stringify({
      path: filePath,
      content,
      size: content.length,
    }),
  }
}

export const writeScenarioFileExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const filePath = args.file_path as string
  const content = args.content as string

  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }

  // 通过 IPC 写入文件
  const success = await writeFileViaIpc(project.localPath, filePath, content)
  if (!success) {
    return { success: false, result: '', error: `Failed to write file: ${filePath}` }
  }

  return {
    success: true,
    result: JSON.stringify({
      path: filePath,
      size: content.length,
      message: `文件已写入：${filePath}`,
    }),
  }
}

export const getScenarioKnowledgeExecutor: ToolExecutor = async (args, _context) => {
  const topic = (args.topic as string) || 'all'

  if (topic === 'all') {
    return {
      success: true,
      result: SCENARIO_DEV_KNOWLEDGE,
    }
  }

  // 按主题提取知识片段
  const knowledge = extractTopic(SCENARIO_DEV_KNOWLEDGE, topic)
  return {
    success: true,
    result: knowledge || SCENARIO_DEV_QUICK_REF,
  }
}

// ==========================================
// 构建调试执行器
// ==========================================

export const validateScenarioExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string

  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }

  // 读取 scenario.json 进行基础校验
  const configContent = await readFileViaIpc(project.localPath, 'scenario.json')
  if (configContent === null) {
    return {
      success: false,
      result: '',
      error: 'scenario.json not found. Please create it first.',
    }
  }

  let config: Record<string, unknown>
  try {
    config = JSON.parse(configContent)
  } catch (err) {
    return {
      success: false,
      result: '',
      error: `Invalid JSON in scenario.json: ${(err as Error).message}`,
    }
  }

  const validationResult = buildService.validateConfig(config)

  // 调用 CLI 校验（如果可用）
  const buildRecord = await buildService.validateProject(projectId)

  return {
    success: validationResult.valid && buildRecord.status === 'success',
    result: JSON.stringify({
      validation: validationResult,
      buildOutput: buildRecord.output,
      message: validationResult.valid
        ? '场景配置校验通过'
        : `校验失败：${validationResult.errors.length} 个错误`,
    }),
  }
}

export const buildScenarioExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string

  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }

  const buildRecord = await buildService.buildProject(projectId)

  // 更新项目状态和构建时间
  if (buildRecord.status === 'success') {
    await projectService.updateProject(projectId, {
      status: 'ready',
      lastBuiltAt: buildRecord.finishedAt,
    })
  } else {
    await projectService.updateProject(projectId, { status: 'developing' })
  }

  return {
    success: buildRecord.status === 'success',
    result: JSON.stringify({
      buildId: buildRecord.id,
      status: buildRecord.status,
      output: buildRecord.output,
      durationMs: buildRecord.durationMs,
      message:
        buildRecord.status === 'success'
          ? '构建成功，可以安装或发布'
          : '构建失败，请检查输出日志',
    }),
  }
}

export const packScenarioExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string

  const buildRecord = await buildService.packProject(projectId)

  return {
    success: buildRecord.status === 'success',
    result: JSON.stringify({
      buildId: buildRecord.id,
      status: buildRecord.status,
      output: buildRecord.output,
      durationMs: buildRecord.durationMs,
    }),
  }
}

export const getBuildLogsExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const limit = (args.limit as number) || 20

  const history = await buildService.getBuildHistory(projectId, limit)

  return {
    success: true,
    result: JSON.stringify({
      logs: history.map((r) => ({
        id: r.id,
        buildType: r.buildType,
        status: r.status,
        exitCode: r.exitCode,
        output: r.output,
        durationMs: r.durationMs,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
      total: history.length,
    }),
  }
}

// ==========================================
// 安装发布执行器
// ==========================================

export const installScenarioExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const packagePath = args.package_path as string

  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }

  const record = await installService.installScenario(projectId, project.version, packagePath)

  return {
    success: record.status === 'installed',
    result: JSON.stringify({
      installId: record.id,
      status: record.status,
      error: record.error,
      message:
        record.status === 'installed'
          ? '场景已安装到本地客户端，可以在场景列表中查看'
          : `安装失败：${record.error}`,
    }),
  }
}

export const publishScenarioExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const packageName = args.package_name as string
  const packagePath = args.package_path as string
  const version = args.version as string

  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }

  // 检查登录状态
  const publishStatus = await publishService.checkPublishStatus()
  if (!publishStatus.loggedIn) {
    return {
      success: false,
      result: '',
      error: '未登录开发者中心，请先登录（aweeclaw-scenario login 或在开发者中心登录）',
    }
  }

  const record = await publishService.publishScenario(projectId, version, packageName, packagePath)

  // 更新项目发布时间
  if (record.status === 'published') {
    await projectService.updateProject(projectId, {
      status: 'published',
      lastPublishedAt: record.publishedAt,
    })
  }

  return {
    success: record.status === 'published',
    result: JSON.stringify({
      publishId: record.id,
      status: record.status,
      marketplaceId: record.marketplaceId,
      downloadUrl: record.downloadUrl,
      error: record.error,
      message:
        record.status === 'published'
          ? '场景已发布到市场，等待审核'
          : `发布失败：${record.error}`,
    }),
  }
}

export const getPublishHistoryExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const history = await publishService.getPublishHistory(projectId)

  return {
    success: true,
    result: JSON.stringify({
      history: history.map((r) => ({
        id: r.id,
        version: r.version,
        packageName: r.packageName,
        status: r.status,
        marketplaceId: r.marketplaceId,
        downloadUrl: r.downloadUrl,
        error: r.error,
        publishedAt: r.publishedAt,
      })),
      total: history.length,
    }),
  }
}

export const checkPublishStatusExecutor: ToolExecutor = async (_args, _context) => {
  const status = await publishService.checkPublishStatus()
  return {
    success: true,
    result: JSON.stringify({
      loggedIn: status.loggedIn,
      developerName: status.developerName,
      message: status.loggedIn
        ? `已登录${status.developerName ? `（${status.developerName}）` : ''}，可以发布`
        : '未登录，请先登录开发者中心',
    }),
  }
}

// ==========================================
// 辅助函数
// ==========================================

/** 内置模板列表 */
function getBuiltinTemplates() {
  return [
    {
      id: 'declarative-basic',
      name: 'Declarative Basic',
      nameZh: '声明式基础模板',
      type: 'declarative' as const,
      category: 'basic',
      description: 'Basic declarative scenario with system prompt',
      descriptionZh: '基础声明式场景，包含系统提示词',
    },
    {
      id: 'declarative-with-tools',
      name: 'Declarative with Tools',
      nameZh: '声明式带工具模板',
      type: 'declarative' as const,
      category: 'advanced',
      description: 'Declarative scenario with custom tools',
      descriptionZh: '带自定义工具的声明式场景',
    },
    {
      id: 'programmatic-basic',
      name: 'Programmatic Basic',
      nameZh: '编程式基础模板',
      type: 'programmatic' as const,
      category: 'basic',
      description: 'Basic programmatic scenario with TypeScript',
      descriptionZh: '基础编程式场景，使用 TypeScript',
    },
    {
      id: 'programmatic-full',
      name: 'Programmatic Full',
      nameZh: '编程式完整模板',
      type: 'programmatic' as const,
      category: 'advanced',
      description: 'Full programmatic scenario with UI, tools, database',
      descriptionZh: '完整编程式场景，包含 UI、工具、数据库',
    },
  ]
}

/** 按主题提取知识片段 */
function extractTopic(knowledge: string, topic: string): string | null {
  const topicMap: Record<string, string> = {
    types: '一、场景类型',
    manifest: '三、scenario.json 完整配置',
    prompts: '四、提示词编写',
    tools: '七、自定义工具开发',
    database: '八、数据库脚本',
    ui: '九、UI 布局配置',
    lifecycle: '十、生命周期',
    build: '十一、构建与发布',
    publish: '十一、构建与发布',
  }

  const heading = topicMap[topic]
  if (!heading) return null

  const startIdx = knowledge.indexOf(heading)
  if (startIdx === -1) return null

  // 找到下一个同级标题
  const nextHeadingMatch = knowledge.slice(startIdx + heading.length).match(/\n## [一二三四五六七八九十]+、/)
  const endIdx = nextHeadingMatch && nextHeadingMatch.index !== undefined
    ? startIdx + heading.length + nextHeadingMatch.index
    : knowledge.length

  return knowledge.slice(startIdx, endIdx).trim()
}

/** 调用文件读取 IPC */
async function readFileViaIpc(basePath: string, relativePath: string): Promise<string | null> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    try {
      const fullPath = `${basePath}/${relativePath}`
      const result = await (window as any).electronAPI.invoke('scenario-builder:readFile', fullPath)
      return result.success ? (result.content as string) : null
    } catch {
      return null
    }
  }
  return null
}

/** 调用文件写入 IPC */
async function writeFileViaIpc(basePath: string, relativePath: string, content: string): Promise<boolean> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    try {
      const fullPath = `${basePath}/${relativePath}`
      const result = await (window as any).electronAPI.invoke('scenario-builder:writeFile', fullPath, content)
      return result.success ?? false
    } catch {
      return false
    }
  }
  return false
}

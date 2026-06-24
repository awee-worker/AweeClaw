/**
 * 场景开发助手 IPC 处理器
 *
 * 提供渲染进程调用的 IPC 通道，桥接到服务层。
 */
import type { ScenarioIpcHandler } from '@shared/protocols/scenario-arch'
import { projectService, buildService, installService, publishService } from '../services'
import { SCENARIO_DEV_KNOWLEDGE } from '../config/prompts-knowledge'

export const scenarioBuilderIpcHandlers: ScenarioIpcHandler[] = [
  // ==========================================
  // 项目管理 IPC
  // ==========================================
  {
    channel: 'scenario-builder:listProjects',
    handler: async (...args: unknown[]) => {
      const status = args[0] as string | undefined
      return projectService.listProjects(status as any)
    },
  },
  {
    channel: 'scenario-builder:createProject',
    handler: async (...args: unknown[]) => {
      const options = args[0] as Record<string, unknown>
      return projectService.createProject({
        name: options.name as string,
        scenarioId: options.scenarioId as string,
        type: options.type as 'declarative' | 'programmatic',
        version: options.version as string | undefined,
        description: options.description as string | undefined,
        author: options.author as string | undefined,
        tags: options.tags as string[] | undefined,
        localPath: options.localPath as string | undefined,
      })
    },
  },
  {
    channel: 'scenario-builder:getProject',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return projectService.getProject(projectId)
    },
  },
  {
    channel: 'scenario-builder:updateProject',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      const updates = args[1] as Record<string, unknown>
      return projectService.updateProject(projectId, updates)
    },
  },
  {
    channel: 'scenario-builder:deleteProject',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return projectService.deleteProject(projectId)
    },
  },

  // ==========================================
  // 构建调试 IPC
  // ==========================================
  {
    channel: 'scenario-builder:validateProject',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return buildService.validateProject(projectId)
    },
  },
  {
    channel: 'scenario-builder:buildProject',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return buildService.buildProject(projectId)
    },
  },
  {
    channel: 'scenario-builder:packProject',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return buildService.packProject(projectId)
    },
  },
  {
    channel: 'scenario-builder:getBuildHistory',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      const limit = (args[1] as number) || 20
      return buildService.getBuildHistory(projectId, limit)
    },
  },
  {
    channel: 'scenario-builder:validateConfig',
    handler: async (...args: unknown[]) => {
      const config = args[0] as Record<string, unknown>
      return buildService.validateConfig(config)
    },
  },

  // ==========================================
  // 安装 IPC
  // ==========================================
  {
    channel: 'scenario-builder:installScenario',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      const version = args[1] as string
      const packagePath = args[2] as string
      return installService.installScenario(projectId, version, packagePath)
    },
  },
  {
    channel: 'scenario-builder:uninstallScenario',
    handler: async (...args: unknown[]) => {
      const scenarioId = args[0] as string
      return installService.uninstallScenario(scenarioId)
    },
  },
  {
    channel: 'scenario-builder:getInstallHistory',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return installService.getInstallHistory(projectId)
    },
  },

  // ==========================================
  // 发布 IPC
  // ==========================================
  {
    channel: 'scenario-builder:publishScenario',
    handler: async (...args: unknown[]) => {
      const params = args[0] as Record<string, unknown>
      return publishService.publishScenario(
        params.projectId as string,
        params.version as string,
        params.packageName as string,
        params.packagePath as string,
      )
    },
  },
  {
    channel: 'scenario-builder:getPublishHistory',
    handler: async (...args: unknown[]) => {
      const projectId = args[0] as string
      return publishService.getPublishHistory(projectId)
    },
  },
  {
    channel: 'scenario-builder:checkPublishStatus',
    handler: async () => {
      return publishService.checkPublishStatus()
    },
  },

  // ==========================================
  // 知识库 IPC
  // ==========================================
  {
    channel: 'scenario-builder:getKnowledge',
    handler: async (...args: unknown[]) => {
      const topic = (args[0] as string) || 'all'
      if (topic === 'all') {
        return { content: SCENARIO_DEV_KNOWLEDGE }
      }
      // 返回完整知识库，前端按需提取
      return { content: SCENARIO_DEV_KNOWLEDGE, topic }
    },
  },
]

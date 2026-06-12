/**
 * 多 Agent 协作执行模块
 *
 * 从 IntelligenceCore 中拆分出来的多 Agent 协作逻辑，
 * 包含新建协作和继续协作两个核心流程。
 *
 * 职责：
 * - 执行多 Agent 协作任务（executeMultiAgent）
 * - 继续已有的多 Agent 协作（continueMultiAgent）
 * - 提供共享的 callLLM 工厂函数
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useAgentStore } from '../state/IntelligenceStore'
import { useStore } from '@renderer/state'
import type { WorkspaceAgent } from '@renderer/state/slices/agentWorkspaceSlice'
import type { LLMConfig } from '@intelligence/providerTypes'
import { smartOrchestrator, extractFilesFromOutput, type ExtractedFile, type AgentProgressEvent } from '../multiAgent/SmartOrchestrator'
import { runAgentSubLoop } from '../multiAgent/AgentSubLoop'
import { TeamCollaborationProtocol } from '../multiAgent/TeamCollaborationProtocol'
import { playNotificationSound } from '@utils/notificationSound'

// ===== 类型定义 =====

export interface MultiAgentConfig {
  enabled: boolean
  mode: 'auto' | 'always'
  threshold: number
  requireConsensus: boolean
  maxAgents: number
}

export interface RunningTask {
  abortController: AbortController
  assistantId: string
  requestId?: string
  planTaskId?: string
}

// ===== 共享工具函数 =====

/**
 * 创建 callLLM 函数
 *
 * 封装 LLM 调用逻辑，支持流式响应、中止检测和超时控制。
 * 被 executeMultiAgent 和 continueMultiAgent 共享。
 */
export function createCallLLM(config: LLMConfig, abortController: AbortController | undefined): (systemPrompt: string, userMessage: string) => Promise<string> {
  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    if (abortController?.signal.aborted) {
      throw new Error('Aborted by user')
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userMessage },
    ]

    const subRequestId = crypto.randomUUID()
    let fullContent = ''
    let fullReasoning = ''
    let settled = false

    return new Promise<string>((resolve, reject) => {
      let checkInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        if (checkInterval) clearInterval(checkInterval)
        unsubStream()
        unsubError()
        unsubDone()
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        api.llm.abort()
        reject(new Error('Aborted by user'))
      }

      abortController?.signal.addEventListener('abort', onAbort, { once: true })

      const unsubStream = api.llm.onStream(subRequestId, (data) => {
        if (data.type === 'text' && data.content) {
          fullContent += data.content
        }
        if (data.type === 'reasoning' && data.content) {
          fullReasoning += data.content
        }
      })

      const unsubError = api.llm.onError(subRequestId, (err) => {
        if (settled) return
        settled = true
        abortController?.signal.removeEventListener('abort', onAbort)
        cleanup()
        reject(new Error(err.message))
      })

      const unsubDone = api.llm.onDone(subRequestId, (data) => {
        if (settled) return
        settled = true
        abortController?.signal.removeEventListener('abort', onAbort)
        if (typeof data?.reasoning === 'string' && data.reasoning.length >= fullReasoning.length) {
          fullReasoning = data.reasoning
        }
        cleanup()
        resolve(fullContent || '无响应')
      })

      api.llm.send({
        config,
        messages,
        requestId: subRequestId,
      }).catch((err) => {
        if (settled) return
        settled = true
        abortController?.signal.removeEventListener('abort', onAbort)
        cleanup()
        reject(err)
      })

      checkInterval = setInterval(() => {
        if (settled && checkInterval) {
          clearInterval(checkInterval)
        }
        if (abortController?.signal.aborted && !settled) {
          settled = true
          cleanup()
          api.llm.abort()
          reject(new Error('Aborted by user'))
        }
      }, 200)

      setTimeout(() => {
        if (settled) return
        settled = true
        abortController?.signal.removeEventListener('abort', onAbort)
        cleanup()
        reject(new Error('Sub-task timeout (120s)'))
      }, 120000)
    })
  }
}

/**
 * 创建 executeAgent 函数
 *
 * 封装 Agent 子循环执行逻辑，自动添加语言指令。
 */
export function createExecuteAgent(
  config: LLMConfig,
  workspacePath: string | null,
  abortSignal: AbortSignal | undefined
): (systemPrompt: string, userMessage: string) => Promise<string> {
  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const lang = useStore.getState().language || 'zh'
    const langDirective = lang === 'zh'
      ? '\n\n【语言要求】你必须使用中文进行所有交流和输出，包括讨论、分析、文档、注释等。代码变量名和文件路径保持英文。'
      : '\n\n[Language] You MUST use English for all communication and output.'

    const result = await runAgentSubLoop({
      config,
      systemPrompt: systemPrompt + langDirective,
      userMessage,
      workspacePath,
      maxIterations: 15,
      abortSignal,
    })

    if (result.error && !result.content) {
      throw new Error(result.error)
    }

    return result.content || ''
  }
}

/**
 * 保存提取的文件到磁盘
 */
async function saveExtractedFiles(
  _agentId: string,
  _agentName: string,
  _content: string,
  extractedFiles: ExtractedFile[],
  projectDir: string | null
): Promise<string[]> {
  if (!projectDir) return []
  const savedPaths: string[] = []

  if (extractedFiles.length > 0) {
    for (const file of extractedFiles) {
      try {
        const dirPart = file.path.includes('/')
          ? file.path.substring(0, file.path.lastIndexOf('/'))
          : ''
        if (dirPart) {
          await api.file.ensureDir(`${projectDir}/${dirPart}`)
        }
        const fullPath = `${projectDir}/${file.path}`
        await api.file.write(fullPath, file.content)
        savedPaths.push(fullPath)
      } catch (err) {
        logger.agent.warn(`[SmartOrchestrator] Failed to save file ${file.path}:`, err)
      }
    }
  }
  // 当智能体没有通过 write_file 工具创建任何文件时，
  // 不再自动创建角色工作记录 .md 文件，避免产出无关文件。
  // 智能体的输出内容会保留在 outputPreview 中供查看。

  return savedPaths
}

// ===== 角色映射 =====

const ROLE_MAP: Record<string, WorkspaceAgent['role']> = {
  'architect': 'architect',
  'solution-architect': 'architect',
  'developer': 'backend',
  'backend-dev': 'backend',
  'backend-developer': 'backend',
  'server-dev': 'backend',
  'api-dev': 'backend',
  'reviewer': 'analyst',
  'code-reviewer': 'analyst',
  'analyst': 'analyst',
  'qa': 'tester',
  'tester': 'tester',
  'test-engineer': 'tester',
  'qa-engineer': 'tester',
  'coordinator': 'pm',
  'pm': 'pm',
  'project-manager': 'pm',
  'manager': 'pm',
  'frontend': 'frontend',
  'frontend-dev': 'frontend',
  'frontend-developer': 'frontend',
  'ui-dev': 'frontend',
  'web-dev': 'frontend',
  'designer': 'designer',
  'ui-designer': 'designer',
  'ux-designer': 'designer',
  'ui-ux': 'designer',
  'devops': 'devops',
  'deploy': 'devops',
  'sre': 'devops',
  'database': 'architect',
  'db-engineer': 'architect',
  'dba': 'architect',
}

/** 角色去重：确保同一角色不会出现多次，重复角色尝试映射到其他可用角色 */
const ROLE_ALTERNATIVES: Record<string, WorkspaceAgent['role'][]> = {
  frontend: ['designer', 'architect'],
  backend: ['architect', 'devops'],
  architect: ['backend', 'analyst'],
  designer: ['frontend', 'pm'],
  tester: ['analyst', 'devops'],
  analyst: ['tester', 'backend'],
  devops: ['backend', 'architect'],
  pm: ['architect', 'analyst'],
  custom: [],
}

function deduplicateRoles(agents: WorkspaceAgent[]): WorkspaceAgent[] {
  const seenRoles = new Set<WorkspaceAgent['role']>()
  return agents.map(agent => {
    if (seenRoles.has(agent.role)) {
      // 尝试从候选角色中找一个未使用的
      const alternatives = ROLE_ALTERNATIVES[agent.role] || []
      const altRole = alternatives.find(r => !seenRoles.has(r))
      if (altRole) {
        seenRoles.add(altRole)
        return { ...agent, role: altRole }
      }
      // 无可用候选，降级为 custom
      return { ...agent, role: 'custom' as const }
    }
    seenRoles.add(agent.role)
    return agent
  })
}

// ===== 核心执行函数 =====

/**
 * 执行多 Agent 协作任务
 *
 * 将复杂任务分解为子任务，分配给不同角色的 Agent 并行执行，
 * 最后汇总结果并更新到 UI。
 */
export async function executeMultiAgent(
  task: string,
  config: LLMConfig,
  workspacePath: string | null,
  threadId: string,
  assistantId: string,
  _requestId: string,
  _multiAgentConfig: MultiAgentConfig,
  runningTasks: Map<string, RunningTask>
): Promise<void> {
  const agentStore = useAgentStore.getState()
  const globalStore = useStore.getState()

  agentStore.setStreamPhase('streaming', threadId)
  agentStore.setStreamState({ streamDetail: 'reasoning' }, threadId)

  const sessionId = `ma-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const abortController = runningTasks.get(threadId)?.abortController
  const callLLM = createCallLLM(config, abortController)

  try {
    globalStore.setActiveWorkspaceSession({
      sessionId,
      threadId,
      status: 'planning',
      summary: '',
      agents: [],
      teamChat: [],
      createdAt: Date.now(),
    })
    globalStore.setWorkspaceViewVisible(true)

    agentStore.appendToAssistant(assistantId, '🧠 **多智能体协作已启动**，已切换到智能体工作台查看详情', threadId)

    const context = workspacePath ? `Workspace: ${workspacePath}` : ''
    const plan = await smartOrchestrator.plan(task, context, callLLM)

    const projectName = plan.projectName
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'project'
    const dirName = `${projectName}_${sessionId.slice(-6)}`

    let projectDir: string | null = null
    if (workspacePath) {
      projectDir = `${workspacePath}/${dirName}`
      try {
        await api.file.ensureDir(projectDir)
      } catch {
        // directory may already exist
      }
    }

    globalStore.updateWorkspaceSession({
      projectPath: projectDir || undefined,
    })

    const collaborationProtocol = new TeamCollaborationProtocol({
      onStateChange: (state) => {
        useStore.getState().updateWorkspaceSession({
          collaborationPhase: state.phase,
        })
      },
      onChatMessage: (message) => {
        useStore.getState().addTeamChatMessage(message)
      },
      callLLM,
      userLanguage: useStore.getState().language || 'zh',
    })

    const executeAgent = createExecuteAgent(config, projectDir, abortController?.signal)

    const workspaceAgents: WorkspaceAgent[] = plan.agents.map(a => {
      const idLower = a.id.toLowerCase()
      const detectedRole: WorkspaceAgent['role'] = Object.entries(ROLE_MAP).find(([key]) => idLower.includes(key))?.[1] ?? 'custom'
      return {
        id: a.id,
        name: a.name,
        icon: a.icon,
        role: detectedRole,
        status: 'waiting' as const,
        taskDescription: a.taskDescription,
        scope: a.scope,
        forbidden: a.forbidden,
        outputFiles: [],
        progress: 0,
        currentStep: '',
        toolCalls: [],
        progressEvents: [],
        outputPreview: '',
        iterationCount: 0,
        retryCount: 0,
      }
    })

    // 角色去重：同一角色只保留第一个，重复的降级为 custom
    const dedupedAgents = deduplicateRoles(workspaceAgents)

    const agentStatusMap = new Map<string, 'waiting' | 'working' | 'completed' | 'failed'>()
    for (const a of dedupedAgents) {
      agentStatusMap.set(a.id, 'waiting')
    }

    globalStore.updateWorkspaceSession({
      status: 'plan_review',
      agents: dedupedAgents,
      summary: plan.summary,
      collaborationPhase: 'meeting',
      plan: {
        agents: plan.agents.map(a => ({
          id: a.id,
          name: a.name,
          icon: a.icon,
          taskDescription: a.taskDescription,
          scope: a.scope,
          forbidden: a.forbidden,
        })),
        executionOrder: plan.executionOrder,
        summary: plan.summary,
      },
    })

    const agentInfoList = dedupedAgents.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
    }))

    await collaborationProtocol.startMeeting(task, agentInfoList)

    agentStore.appendToAssistant(assistantId, `\n\n📋 **协作计划已生成**: ${plan.summary}，共 ${plan.agents.length} 个智能体，请在工作台审核`, threadId)

    await new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (abortController?.signal.aborted) {
          clearInterval(checkInterval)
          reject(new Error('Aborted by user'))
          return
        }
        const currentSession = useStore.getState().activeWorkspaceSession
        if (!currentSession || currentSession.sessionId !== sessionId) {
          clearInterval(checkInterval)
          reject(new Error('Session cancelled'))
          return
        }
        if (currentSession.status === 'executing') {
          clearInterval(checkInterval)
          resolve()
        }
        if (currentSession.status === 'failed') {
          clearInterval(checkInterval)
          reject(new Error('Plan rejected'))
        }
      }, 300)

      setTimeout(() => {
        clearInterval(checkInterval)
        const currentSession = useStore.getState().activeWorkspaceSession
        if (currentSession?.status === 'plan_review') {
          useStore.getState().updateWorkspaceSession({ status: 'executing' })
          resolve()
        }
      }, 30000)
    })

    await collaborationProtocol.startDiscussion(agentInfoList, task)

    await collaborationProtocol.startVoting(
      agentInfoList,
      ['按计划执行', '优化后执行']
    )

    collaborationProtocol.delegateTasks(
      dedupedAgents.map(a => ({
        agentId: a.id,
        agentName: a.name,
        task: a.taskDescription,
      }))
    )

    collaborationProtocol.startExecution()

    await smartOrchestrator.execute(plan, {
      onPlanCreated: () => {},

      onAgentStart: (agentId: string) => {
        agentStatusMap.set(agentId, 'working')
        useStore.getState().updateWorkspaceAgent(agentId, {
          status: 'working',
          startedAt: Date.now(),
          currentStep: '开始执行任务...',
        })
        useStore.getState().updateWorkspaceSession({ currentAgentId: agentId })

        const agent = plan.agents.find(a => a.id === agentId)
        if (agent) {
          useStore.getState().addTeamChatMessage({
            id: `chat-${Date.now()}-${agentId}-start`,
            fromAgentId: agentId,
            fromAgentName: agent.name,
            type: 'announce',
            content: `开始执行任务：${agent.taskDescription.slice(0, 100)}`,
            timestamp: Date.now(),
          })
        }
      },

      onAgentProgress: (agentId: string, event: AgentProgressEvent) => {
        const store = useStore.getState()
        store.addAgentProgressEvent(agentId, {
          type: event.type,
          content: event.content,
          toolName: event.toolName,
          timestamp: event.timestamp,
        })

        if (event.type === 'thinking') {
          store.updateWorkspaceAgent(agentId, {
            currentStep: event.content.length > 50 ? event.content.slice(0, 50) + '...' : event.content,
          })
        }

        if (event.type === 'tool_call' && event.toolName) {
          store.addAgentToolCall(agentId, {
            id: `tc-${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: event.toolName,
            arguments: {},
            status: 'running',
            timestamp: event.timestamp,
          })
        }

        if (event.type === 'tool_result' && event.toolName) {
          const agent = store.activeWorkspaceSession?.agents.find(a => a.id === agentId)
          if (agent) {
            const lastToolCall = [...agent.toolCalls].reverse().find(tc => tc.name === event.toolName && tc.status === 'running')
            if (lastToolCall) {
              store.updateAgentToolCall(agentId, lastToolCall.id, {
                status: 'completed',
                result: event.content.length > 500 ? event.content.slice(0, 500) + '...' : event.content,
              })
            }
          }
        }
      },

      onAgentRetry: (agentId: string, retryCount: number, maxRetries: number) => {
        useStore.getState().updateWorkspaceAgent(agentId, {
          retryCount,
          currentStep: `重试中 (${retryCount}/${maxRetries})...`,
        })

        const agent = plan.agents.find(a => a.id === agentId)
        if (agent) {
          agentStore.appendToAssistant(assistantId, `\n\n🔄 **${agent.icon} ${agent.name}** 正在重试 (${retryCount}/${maxRetries})`, threadId)
        }
      },

      onAgentComplete: async (agentId: string, _result: string, files: ExtractedFile[]) => {
        agentStatusMap.set(agentId, 'completed')
        const agent = plan.agents.find(a => a.id === agentId)
        const savedFiles = await saveExtractedFiles(agentId, agent?.name || agentId, _result, files, projectDir)

        const session = useStore.getState().activeWorkspaceSession
        const wsAgent = session?.agents.find(a => a.id === agentId)
        const toolCreatedFiles: string[] = []
        if (wsAgent) {
          for (const tc of wsAgent.toolCalls) {
            if ((tc.name === 'write_file' || tc.name === 'create_file_or_folder') && tc.status === 'completed') {
              try {
                const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
                const filePath = args?.path || args?.filePath || args?.file_path
                if (filePath && projectDir) {
                  const fullPath = filePath.startsWith('/') ? filePath : `${projectDir}/${filePath}`
                  if (!toolCreatedFiles.includes(fullPath)) {
                    toolCreatedFiles.push(fullPath)
                  }
                }
              } catch (e) { logger.tool.warn('Failed to track created file:', e) }
            }
          }
        }

        const allOutputFiles = [...new Set([...savedFiles, ...toolCreatedFiles])]

        const outputPreview = _result.length > 500 ? _result.slice(0, 500) + '...' : _result

        useStore.getState().updateWorkspaceAgent(agentId, {
          status: 'completed',
          completedAt: Date.now(),
          outputFiles: allOutputFiles,
          progress: 100,
          currentStep: '已完成',
          outputPreview,
        })

        if (agent) {
          const store = useStore.getState()
          store.addTeamChatMessage({
            id: `chat-${Date.now()}-${agentId}`,
            fromAgentId: agentId,
            fromAgentName: agent.name,
            type: 'announce',
            content: allOutputFiles.length > 0
              ? `任务完成！已产出 ${allOutputFiles.length} 个文件：${allOutputFiles.map(f => f.split('/').pop()).join(', ')}`
              : '任务已完成！',
            attachments: allOutputFiles,
            timestamp: Date.now(),
          })

          const fileCount = savedFiles.length
          const fileNames = savedFiles.map(f => f.split('/').pop()).join(', ')
          const fileNote = fileCount > 0
            ? `（产出 ${fileCount} 个文件: ${fileNames}）`
            : ''
          agentStore.appendToAssistant(assistantId, `\n\n✅ **${agent.icon} ${agent.name}** 已完成 ${fileNote}`, threadId)

          const nextLayerAgents = plan.executionOrder
            .flatMap(layer => layer)
            .filter(id => !agentStatusMap.has(id) || agentStatusMap.get(id) === 'waiting')
          const nextAgentId = nextLayerAgents[0]
          if (nextAgentId) {
            const nextAgent = plan.agents.find(a => a.id === nextAgentId)
            if (nextAgent) {
              collaborationProtocol.createHandoff(
                agentId,
                agent.name,
                nextAgentId,
                nextAgent.name,
                savedFiles.length > 0
                  ? `我已完成任务，产出文件：${savedFiles.map(f => f.split('/').pop()).join(', ')}，请继续。`
                  : '我已完成任务，请继续。',
                savedFiles,
              )
            }
          }
        }
      },

      onAgentError: (agentId: string, error: string) => {
        agentStatusMap.set(agentId, 'failed')
        useStore.getState().updateWorkspaceAgent(agentId, {
          status: 'failed',
          completedAt: Date.now(),
          errorMessage: error,
          currentStep: '执行失败',
        })

        const agent = plan.agents.find(a => a.id === agentId)
        if (agent) {
          agentStore.appendToAssistant(assistantId, `\n\n❌ **${agent.icon} ${agent.name}** 执行失败: ${error}`, threadId)
        }
      },

      onAllComplete: async (_results: Map<string, string>, finalAnswer: string) => {
        collaborationProtocol.startReview()

        const failedCount = [...agentStatusMap.values()].filter(s => s === 'failed').length
        const completedCount = [...agentStatusMap.values()].filter(s => s === 'completed').length
        const allCompleted = failedCount === 0 && completedCount === dedupedAgents.length
        const finalStatus = allCompleted ? 'completed' : (completedCount > 0 ? 'completed' : 'failed')

        const session = useStore.getState().activeWorkspaceSession
        const totalDuration = session ? Date.now() - session.createdAt : undefined

        const allOutputFiles = session?.agents.flatMap(a => a.outputFiles) || []

        // 产出物分类：区分用户真正需要的文件和辅助文档
        // 规则：代码文件、配置文件、样式文件、脚本文件等都是用户需要的产出物
        //       纯文档类 .md 文件（README 除外）归为辅助文档
        const CODE_EXTENSIONS = new Set([
          '.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
          '.py', '.java', '.go', '.rs', '.rb', '.php', '.swift', '.kt',
          '.c', '.cpp', '.h', '.hpp', '.cs', '.m', '.mm',
          '.sql', '.graphql', '.prisma',
          '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env', '.conf',
          '.sh', '.bash', '.zsh', '.bat', '.ps1',
          '.dockerfile', '.dockerignore', '.gitignore', '.editorconfig',
          '.scss', '.less', '.sass', '.styl',
          '.svg', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp',
        ])
        const deliverableFiles = allOutputFiles.filter(f => {
          const name = f.split('/').pop() || ''
          const ext = name.includes('.') ? '.' + name.split('.').pop()?.toLowerCase() : ''
          // README.md 是项目必要文件，算作产出物
          if (name.toLowerCase() === 'readme.md') return true
          // 代码和配置文件都是产出物
          if (CODE_EXTENSIONS.has(ext)) return true
          // 无扩展名的文件（如 Dockerfile, Makefile）也是产出物
          if (!name.includes('.')) return true
          // 其他 .md 文件归为辅助文档
          return false
        })
        const auxiliaryFiles = allOutputFiles.filter(f => !deliverableFiles.includes(f))

        let projectFilesList: string[] = []
        if (projectDir) {
          try {
            const listResult = await api.file.readDir(projectDir)
            if (Array.isArray(listResult)) {
              projectFilesList = listResult
                .filter((item: { isDirectory?: boolean }) => !item.isDirectory)
                .map((item: { name: string }) => item.name)
                .filter((name: string) => !name.startsWith('.'))
            }
          } catch (e) { logger.tool.warn('Failed to list directory:', e) }
        }
        const resultFiles = deliverableFiles.length > 0 ? deliverableFiles : projectFilesList.map((name: string) => projectDir ? `${projectDir}/${name}` : name)
        const resultFileNames = resultFiles.map(f => f.split('/').pop() || f)

        useStore.getState().updateWorkspaceSession({
          status: finalStatus,
          currentAgentId: undefined,
          totalDuration,
        })

        collaborationProtocol.complete()

        if (finalAnswer) {
          agentStore.appendToAssistant(assistantId, `\n\n---\n\n${finalAnswer}`, threadId)
        }

        const statusIcon = finalStatus === 'completed' ? '✅' : '⚠️'
        const statusText = finalStatus === 'completed' ? '全部完成' : `完成 ${completedCount} 项，失败 ${failedCount} 项`

        let resultSummary = `\n\n${statusIcon} **多智能体协作${statusText}**`

        if (projectDir) {
          resultSummary += `\n\n📁 **项目位置**: \`${projectDir}\``
        }

        if (resultFileNames.length > 0) {
          const isZh = useStore.getState().language === 'zh'
          resultSummary += isZh
            ? `\n\n📦 **项目结果文件** (${resultFileNames.length} 个):`
            : `\n\n📦 **Project Result Files** (${resultFileNames.length}):`
          const displayFiles = resultFileNames.slice(0, 15)
          for (const name of displayFiles) {
            resultSummary += `\n  - \`${name}\``
          }
          if (resultFileNames.length > 15) {
            resultSummary += `\n  - ... 及其他 ${resultFileNames.length - 15} 个文件`
          }
        }

        if (auxiliaryFiles.length > 0) {
          resultSummary += `\n\n📝 *辅助文档*: ${auxiliaryFiles.map((f: string) => f.split('/').pop()).join(', ')}`
        }

        if (projectDir) {
          const isZh = useStore.getState().language === 'zh'
          resultSummary += isZh
            ? '\n\n💡 **提示**: 点击上方项目位置路径可打开文件夹，或在"产出"标签页中点击文件名预览内容。'
            : '\n\n💡 **Tip**: Click the project path above to open the folder, or click file names in the "Output" tab to preview.'
        }

        agentStore.appendToAssistant(assistantId, resultSummary, threadId)

        try {
          playNotificationSound(finalStatus === 'completed' ? 'success' : 'attention')
        } catch (e) { logger.ui.warn('Failed to play notification sound:', e) }
      },

      callLLM,
      executeAgent,
    }, projectDir)

    agentStore.finalizeAssistant(assistantId, threadId)
    agentStore.setStreamPhase('idle', threadId)

    logger.agent.info(
      `[SmartOrchestrator] Collaboration completed: agents=${plan.agents.length}, project=${projectName}`
    )
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.agent.error('[SmartOrchestrator] Collaboration failed:', errorMsg)

    const isAborted = errorMsg === 'Aborted by user'
    useStore.getState().updateWorkspaceSession({
      status: 'failed',
      currentAgentId: undefined,
    })

    try {
      playNotificationSound('error')
    } catch (e) { logger.ui.warn('Failed to play error sound:', e) }

    if (isAborted) {
      agentStore.appendToAssistant(assistantId, '\n\n⏹️ **多智能体协作已停止**', threadId)
    } else {
      agentStore.appendToAssistant(assistantId, `\n\n❌ **多智能体协作出错**: ${errorMsg}`, threadId)
    }
    agentStore.finalizeAssistant(assistantId, threadId)
    agentStore.setStreamPhase('idle', threadId)
  }
}

/**
 * 继续已有的多 Agent 协作
 *
 * 基于现有团队和项目目录，分析用户新需求并分配任务。
 */
export async function continueMultiAgent(
  task: string,
  config: LLMConfig,
  _workspacePath: string | null,
  threadId: string,
  assistantId: string,
  existingSession: import('@renderer/state/slices/agentWorkspaceSlice').AgentWorkspaceSession,
  runningTasks: Map<string, RunningTask>
): Promise<void> {
  const agentStore = useAgentStore.getState()
  const globalStore = useStore.getState()

  agentStore.setStreamPhase('streaming', threadId)
  agentStore.setStreamState({ streamDetail: 'reasoning' }, threadId)

  const projectDir = existingSession.projectPath!
  const existingAgents = existingSession.agents

  const abortController = runningTasks.get(threadId)?.abortController
  const callLLM = createCallLLM(config, abortController)

  try {
    globalStore.updateWorkspaceSession({
      status: 'executing',
      collaborationPhase: 'discussion',
    })
    globalStore.setWorkspaceViewVisible(true)

    agentStore.appendToAssistant(assistantId, `\n\n🔄 **基于现有团队继续协作**，分析调整需求...`, threadId)

    const agentList = existingAgents.map(a => `- ${a.icon} ${a.name} (${a.role}): ${a.taskDescription.slice(0, 80)}`).join('\n')
    const lang = globalStore.language || 'zh'
    const analyzePrompt = lang === 'zh'
      ? `你是一个项目经理，团队已完成一轮协作。现在用户提出了新的需求或修改意见。

现有团队成员：
${agentList}

项目目录：${projectDir}

用户新需求：${task}

请分析需求，确定需要哪些角色来处理，以JSON格式输出：
{
  "assignments": [
    { "agentId": "角色ID", "task": "具体任务描述" }
  ],
  "summary": "简要说明调整方案"
}

只输出JSON，不要其他内容。agentId必须是现有团队成员之一。`
      : `You are a project manager. The team has completed a collaboration round. Now the user has a new request or modification.

Current team members:
${agentList}

Project directory: ${projectDir}

User's new request: ${task}

Analyze the request and determine which roles need to handle it. Output in JSON format:
{
  "assignments": [
    { "agentId": "agent-id", "task": "specific task description" }
  ],
  "summary": "brief adjustment plan"
}

Output ONLY JSON, nothing else. agentId must be one of the existing team members.`

    const analysisResult = await callLLM(analyzePrompt, task)

    let assignments: Array<{ agentId: string; task: string }> = []
    let summary = ''
    try {
      const jsonMatch = analysisResult.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        assignments = parsed.assignments || []
        summary = parsed.summary || ''
      }
    } catch {
      assignments = [{ agentId: existingAgents[0]?.id || 'pm', task }]
    }

    if (assignments.length === 0) {
      assignments = [{ agentId: existingAgents[0]?.id || 'pm', task }]
    }

    const resetAgents = existingAgents.map(a => ({
      ...a,
      status: 'waiting' as const,
      progress: 0,
      currentStep: '',
      startedAt: undefined,
      completedAt: undefined,
      errorMessage: undefined,
      retryCount: 0,
    }))

    globalStore.updateWorkspaceSession({
      agents: resetAgents,
      collaborationPhase: 'execution',
    })

    agentStore.appendToAssistant(assistantId, `\n\n📋 **调整方案**: ${summary || '基于现有团队处理新需求'}`, threadId)

    const executeAgent = createExecuteAgent(config, projectDir, abortController?.signal)

    for (const assignment of assignments) {
      const agent = existingAgents.find(a => a.id === assignment.agentId)
      if (!agent) continue

      if (abortController?.signal.aborted) {
        throw new Error('Aborted by user')
      }

      globalStore.updateWorkspaceAgent(assignment.agentId, {
        status: 'working',
        startedAt: Date.now(),
        currentStep: assignment.task.slice(0, 50),
      })
      globalStore.updateWorkspaceSession({ currentAgentId: assignment.agentId })

      const langDirective = lang === 'zh'
        ? '\n\n【语言要求】你必须使用中文进行所有交流和输出。代码变量名和文件路径保持英文。'
        : '\n\n[Language] You MUST use English for all communication and output.'

      const systemPrompt = `你是${agent.name}，负责${agent.scope}。你的职责范围：${agent.scope}。禁止做：${agent.forbidden}。项目目录：${projectDir}。你必须使用工具（write_file等）创建实际文件。${langDirective}`

      try {
        const result = await executeAgent(systemPrompt, assignment.task)

        const files = extractFilesFromOutput(result)
        const savedPaths: string[] = []

        if (projectDir && files.length > 0) {
          for (const file of files) {
            try {
              const dirPart = file.path.includes('/')
                ? file.path.substring(0, file.path.lastIndexOf('/'))
                : ''
              if (dirPart) {
                await api.file.ensureDir(`${projectDir}/${dirPart}`)
              }
              const fullPath = `${projectDir}/${file.path}`
              await api.file.write(fullPath, file.content)
              savedPaths.push(fullPath)
            } catch (err) {
              logger.agent.warn(`[ContinueMultiAgent] Failed to save file ${file.path}:`, err)
            }
          }
        }

        globalStore.updateWorkspaceAgent(assignment.agentId, {
          status: 'completed',
          completedAt: Date.now(),
          outputFiles: [...agent.outputFiles, ...savedPaths],
          progress: 100,
          currentStep: '已完成',
        })

        agentStore.appendToAssistant(
          assistantId,
          `\n\n✅ **${agent.icon} ${agent.name}** 已完成调整 ${savedPaths.length > 0 ? `（产出 ${savedPaths.length} 个文件）` : ''}`,
          threadId
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        if (errorMsg === 'Aborted by user') throw err

        globalStore.updateWorkspaceAgent(assignment.agentId, {
          status: 'failed',
          completedAt: Date.now(),
          errorMessage: errorMsg,
          currentStep: '执行失败',
        })

        agentStore.appendToAssistant(assistantId, `\n\n❌ **${agent.icon} ${agent.name}** 执行失败: ${errorMsg}`, threadId)
      }
    }

    const finalAgents = globalStore.activeWorkspaceSession?.agents || []
    const allCompleted = finalAgents.every(a => a.status === 'completed' || a.status === 'waiting')
    const hasFailed = finalAgents.some(a => a.status === 'failed')

    globalStore.updateWorkspaceSession({
      status: allCompleted && !hasFailed ? 'completed' : 'completed',
      currentAgentId: undefined,
      collaborationPhase: 'completed',
    })

    agentStore.appendToAssistant(
      assistantId,
      `\n\n✅ **团队调整任务已完成**\n\n📁 **项目位置**: \`${projectDir}\`\n\n💡 继续提出修改需求，团队将基于现有成果进行调整。`,
      threadId
    )

    try {
      playNotificationSound('success')
    } catch (e) { logger.ui.warn('Failed to play success sound:', e) }

    agentStore.finalizeAssistant(assistantId, threadId)
    agentStore.setStreamPhase('idle', threadId)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.agent.error('[ContinueMultiAgent] Failed:', errorMsg)

    const isAborted = errorMsg === 'Aborted by user'
    globalStore.updateWorkspaceSession({
      status: 'failed',
      currentAgentId: undefined,
    })

    try {
      playNotificationSound('error')
    } catch (e) { logger.ui.warn('Failed to play error sound:', e) }

    if (isAborted) {
      agentStore.appendToAssistant(assistantId, '\n\n⏹️ **团队调整已停止**', threadId)
    } else {
      agentStore.appendToAssistant(assistantId, `\n\n❌ **团队调整出错**: ${errorMsg}`, threadId)
    }
    agentStore.finalizeAssistant(assistantId, threadId)
    agentStore.setStreamPhase('idle', threadId)
  }
}

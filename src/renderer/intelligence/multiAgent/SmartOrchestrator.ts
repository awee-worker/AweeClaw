import { logger } from '@toolkit/LogEngine'

export interface SmartAgentDef {
  id: string
  name: string
  icon: string
  systemPrompt: string
  taskDescription: string
  scope: string
  forbidden: string
}

export interface SmartPlanResult {
  agents: SmartAgentDef[]
  executionOrder: string[][]
  summary: string
  projectName: string
}

export type AgentProgressEventType = 'thinking' | 'tool_call' | 'tool_result' | 'text_output' | 'error'

export interface AgentProgressEvent {
  type: AgentProgressEventType
  content: string
  toolName?: string
  timestamp: number
}

export interface SmartExecutionCallbacks {
  onPlanCreated: (plan: SmartPlanResult) => void
  onAgentStart: (agentId: string) => void
  onAgentProgress: (agentId: string, event: AgentProgressEvent) => void
  onAgentComplete: (agentId: string, result: string, files: ExtractedFile[]) => void
  onAgentError: (agentId: string, error: string) => void
  onAgentRetry: (agentId: string, retryCount: number, maxRetries: number) => void
  onAllComplete: (results: Map<string, string>, finalAnswer: string) => void
  callLLM: (systemPrompt: string, userMessage: string) => Promise<string>
  executeAgent?: (systemPrompt: string, userMessage: string, agentId?: string) => Promise<string>
}

export interface ExtractedFile {
  path: string
  content: string
}

export interface SmartOrchestratorOptions {
  maxRetries?: number
  retryDelayMs?: number
}

const FILE_BLOCK_REGEX = /```file:([^\n]+)\n([\s\S]*?)```/g

export function extractFilesFromOutput(output: string): ExtractedFile[] {
  const files: ExtractedFile[] = []
  let match: RegExpExecArray | null
  const seen = new Set<string>()

  FILE_BLOCK_REGEX.lastIndex = 0
  while ((match = FILE_BLOCK_REGEX.exec(output)) !== null) {
    const filePath = match[1].trim()
    const content = match[2]
    if (!seen.has(filePath)) {
      seen.add(filePath)
      files.push({ path: filePath, content })
    }
  }

  return files
}

const TOOL_FIRST_INSTRUCTION = 'You MUST use tools to do your job. Use write_file tool to create actual files — never put code inside markdown code blocks. Always create real files using the available tools. If you need to write code, use write_file. If you need to read files, use read_file. If you need to search, use search_files. Complete your tasks using tools, not by writing content in chat.'

const PLANNING_SYSTEM_PROMPT = [
  'You are a senior project manager who excels at assembling expert teams for complex tasks.',
  '',
  'Your job: Analyze the user\'s request, then create a team of specialized AI agents that work like a real project team.',
  '',
  '## Language Rule',
  '',
  'The "name" field of each agent MUST be in the SAME LANGUAGE as the user\'s request. If the user writes in Chinese, agent names must be in Chinese (e.g., "项目经理", "前端开发工程师", "后端开发工程师", "测试工程师"). If the user writes in English, use English names. If the user writes in another language, use that language for names.',
  '',
  '**LANGUAGE CONSISTENCY RULE (CRITICAL)**:',
  '- The agent\'s "name", "taskDescription", "scope", and "forbidden" fields MUST ALL be in the SAME LANGUAGE as the user\'s request.',
  '- The agent\'s "systemPrompt" MUST include an instruction like: "你必须使用与用户相同的语言进行所有交流和输出" (for Chinese) or "You MUST use the same language as the user for all communication and output" (for English).',
  '- If the user writes in Chinese, ALL agent outputs, discussions, file comments, README content, and documentation MUST be in Chinese. Code variable names and file paths remain in English.',
  '- If the user writes in English, all outputs are in English.',
  '- NEVER mix languages. If user speaks Chinese, do NOT output English descriptions, English task descriptions, or English documentation.',
  '',
  '## Critical Rules',
  '',
  '1. **Each agent has access to powerful tools** — including write_file, create_file_or_folder, read_file, search_files, run_command, and all MCP tools. Agents MUST use these tools to create actual files and execute real work, NOT write code inside markdown documents.',
  '',
  '2. **Tool-first approach**: Every agent\'s systemPrompt MUST instruct them to use tools to do their job. NEVER put code inside markdown code blocks — always use write_file tool to create real files.',
  '',
  '3. **Pipeline workflow**: Agents work sequentially in a pipeline. Each agent receives the results from all previous agents. This simulates a real team where work flows from one role to the next.',
  '',
  '4. **First agent is always the Project Manager**: The first agent in executionOrder must be a project manager who analyzes the task, creates a work breakdown, creates initial project structure, and provides clear guidance for subsequent agents.',
  '',
  '5. **STRICT role boundaries**: Each agent MUST have a "scope" field (what they are responsible for) and a "forbidden" field (what they must NOT do). This is the most important rule — agents must NEVER do work outside their scope.',
  '',
  '6. **Common professional roles** (adapt to the specific task, use the user\'s language for names):',
  '   - Project Manager — scope: project structure, README, work breakdown, guidance. forbidden: writing implementation code',
  '   - Solution Architect — scope: architecture docs, config files, API design. forbidden: writing business logic code',
  '   - Frontend Developer — scope: HTML/CSS/JS/UI components/pages. forbidden: backend code, database, deployment',
  '   - Backend Developer — scope: server code, API routes, business logic. forbidden: frontend HTML/CSS/JS, UI components',
  '   - Database Engineer — scope: SQL schemas, migrations, data models. forbidden: frontend code, API routes',
  '   - QA Engineer — scope: test files, test scripts. forbidden: writing production code',
  '   - DevOps Engineer — scope: Dockerfile, CI/CD, deployment. forbidden: application code',
  '',
  '7. **Only create agents that are truly needed** — A simple task may only need 2-3 agents. A complex project may need 4-6. Never exceed 6 agents.',
  '',
  '8. **projectName** — Choose a concise, professional English project folder name (lowercase, hyphens, no spaces) that reflects the task.',
  '',
  '## Output Format',
  '',
  'Respond ONLY with valid JSON (no markdown fences, no commentary):',
  '{',
  '  "projectName": "concise-english-name",',
  '  "agents": [',
  '    {',
  '      "id": "pm",',
  '      "name": "项目经理",',
  '      "icon": "📋",',
  '      "systemPrompt": "You are the Project Manager. Analyze the task, create the project structure using write_file, and provide clear instructions for the team. ' + TOOL_FIRST_INSTRUCTION + '",',
  '      "taskDescription": "Analyze the task and set up the project structure. Create initial files and provide guidance for the team.",',
  '      "scope": "Creating project directory structure, README.md, configuration files, and providing work guidance for team members.",',
  '      "forbidden": "Writing any implementation code (HTML, CSS, JS, Python, Java, etc.). Writing database schemas. Writing deployment scripts. You are a manager, not a developer."',
  '    },',
  '    {',
  '      "id": "frontend-dev",',
  '      "name": "前端开发工程师",',
  '      "icon": "💻",',
  '      "systemPrompt": "You are a senior frontend developer. Use write_file tool to create actual source code files. ' + TOOL_FIRST_INSTRUCTION + '",',
  '      "taskDescription": "Implement the frontend for this project. Use write_file to create all necessary HTML, CSS, and JavaScript files.",',
  '      "scope": "Creating frontend source code files: HTML, CSS, JavaScript, UI components, page templates, styles.",',
  '      "forbidden": "Writing backend/server code (Node.js, Python, Java, PHP, etc.). Writing database schemas or SQL. Writing Docker/deployment configs. Writing API route implementations."',
  '    }',
  '  ],',
  '  "executionOrder": [["pm"], ["frontend-dev"]],',
  '  "summary": "Brief plan description"',
  '}',
  '',
  'executionOrder: array of layers. Same-layer agents run in parallel. Each layer waits for the previous layer to complete.',
].join('\n')

function buildBoundaryWrapper(agent: SmartAgentDef): string {
  const parts: string[] = []

  parts.push('=== ROLE BOUNDARY ENFORCEMENT ===')
  parts.push('')
  parts.push('You are: ' + agent.name)
  parts.push('')
  parts.push('YOUR SCOPE (what you MUST do):')
  parts.push(agent.scope)
  parts.push('')
  parts.push('YOUR FORBIDDEN ZONE (what you MUST NEVER do):')
  parts.push(agent.forbidden)
  parts.push('')
  parts.push('VIOLATION WARNING: If you create files or write code that falls into the FORBIDDEN ZONE above, the entire project will fail because another team member is already responsible for that work. Your teammates are counting on you to stay in your lane. ONLY do what is in your SCOPE.')
  parts.push('')
  parts.push('Before creating any file, ask yourself: "Is this file within my SCOPE?" If the answer is NO, do NOT create it.')
  parts.push('')
  parts.push('=== END ROLE BOUNDARY ===')
  parts.push('')

  return parts.join('\n')
}

export class SmartOrchestrator {
  private options: Required<SmartOrchestratorOptions>

  constructor(options?: SmartOrchestratorOptions) {
    this.options = {
      maxRetries: options?.maxRetries ?? 2,
      retryDelayMs: options?.retryDelayMs ?? 2000,
    }
  }

  async plan(
    userTask: string,
    context: string,
    callLLM: (systemPrompt: string, userMessage: string) => Promise<string>
  ): Promise<SmartPlanResult> {
    const planningPrompt = 'User request: ' + userTask + '\n\n' + (context ? 'Additional context: ' + context + '\n\n' : '') + 'Design an expert agent team for this task. Remember: every agent MUST use tools (write_file, read_file, etc.) to create actual files. The first agent must be a Project Manager. Choose a professional projectName. Agent names MUST be in the same language as the user request. Each agent MUST have scope and forbidden fields.'

    logger.agent.info('[SmartOrchestrator] Planning agent team for task...')

    let rawResponse: string
    try {
      rawResponse = await callLLM(PLANNING_SYSTEM_PROMPT, planningPrompt)
    } catch (err) {
      logger.agent.error('[SmartOrchestrator] Planning LLM call failed:', err)
      return this.createFallbackPlan(userTask)
    }

    const plan = this.parsePlanResponse(rawResponse, userTask)
    logger.agent.info(
      '[SmartOrchestrator] Plan created: ' + plan.agents.length + ' agents, ' +
      plan.executionOrder.length + ' layers, project=' + plan.projectName + ' - ' + plan.summary
    )

    return plan
  }

  async execute(
    plan: SmartPlanResult,
    callbacks: SmartExecutionCallbacks,
    projectDir?: string | null
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    const completedWorkLog: Array<{ agentName: string; agentId: string; summary: string }> = []
    const retryCounts = new Map<string, number>()

    callbacks.onPlanCreated(plan)

    for (let layerIdx = 0; layerIdx < plan.executionOrder.length; layerIdx++) {
      const layer = plan.executionOrder[layerIdx]

      const layerPromises = layer.map(async (agentId) => {
        const agent = plan.agents.find(a => a.id === agentId)
        if (!agent) return

        let attemptCount = 0
        const maxAttempts = this.options.maxRetries + 1

        while (attemptCount < maxAttempts) {
          attemptCount++

          if (attemptCount > 1) {
            const currentRetry = attemptCount - 1
            callbacks.onAgentRetry(agentId, currentRetry, this.options.maxRetries)
            logger.agent.info(`[SmartOrchestrator] Retrying agent ${agent.name} (attempt ${attemptCount}/${maxAttempts})`)
            await this.delay(this.options.retryDelayMs)
          }

          callbacks.onAgentStart(agentId)

          const wrappedSystemPrompt = buildBoundaryWrapper(agent) + agent.systemPrompt
          const taskMessage = agent.taskDescription + this.buildHandoffContext(agent, completedWorkLog, layerIdx, projectDir)

          try {
            const executor: (systemPrompt: string, userMessage: string, agentId?: string) => Promise<string> = callbacks.executeAgent || callbacks.callLLM
            const result = await this.executeWithProgress(
              agentId,
              wrappedSystemPrompt,
              taskMessage,
              executor,
              callbacks.onAgentProgress
            )
            results.set(agentId, result)

            const summary = result.length > 500 ? result.slice(0, 500) + '...' : result
            completedWorkLog.push({ agentName: agent.name, agentId: agent.id, summary })

            const files = extractFilesFromOutput(result)
            callbacks.onAgentComplete(agentId, result, files)
            break
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            if (errorMsg === 'Aborted by user') {
              callbacks.onAgentError(agentId, '已停止')
              throw err
            }

            retryCounts.set(agentId, attemptCount - 1)

            callbacks.onAgentProgress(agentId, {
              type: 'error',
              content: `Attempt ${attemptCount}/${maxAttempts} failed: ${errorMsg}`,
              timestamp: Date.now(),
            })

            if (attemptCount >= maxAttempts) {
              results.set(agentId, 'Error: ' + errorMsg)
              completedWorkLog.push({ agentName: agent.name, agentId: agent.id, summary: '[Failed] ' + errorMsg })
              callbacks.onAgentError(agentId, errorMsg)
            }
          }
        }
      })

      await Promise.all(layerPromises)
    }

    const finalAnswer = this.synthesizeResults(plan, results)
    callbacks.onAllComplete(results, finalAnswer)

    return results
  }

  private async executeWithProgress(
    agentId: string,
    systemPrompt: string,
    userMessage: string,
    executor: (systemPrompt: string, userMessage: string, agentId?: string) => Promise<string>,
    onProgress: (agentId: string, event: AgentProgressEvent) => void
  ): Promise<string> {
    onProgress(agentId, {
      type: 'thinking',
      content: 'Starting task execution...',
      timestamp: Date.now(),
    })

    const result = await executor(systemPrompt, userMessage, agentId)

    onProgress(agentId, {
      type: 'text_output',
      content: result.length > 300 ? result.slice(0, 300) + '...' : result,
      timestamp: Date.now(),
    })

    return result
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private buildHandoffContext(
    agent: SmartAgentDef,
    completedWorkLog: Array<{ agentName: string; agentId: string; summary: string }>,
    _layerIdx: number,
    projectDir?: string | null
  ): string {
    const lines: string[] = ['']

    if (projectDir) {
      lines.push('## Project Directory')
      lines.push('All files must be created inside: ' + projectDir)
      lines.push('When using write_file, use paths relative to this directory or absolute paths starting with ' + projectDir)
      lines.push('')
    }

    if (completedWorkLog.length > 0) {
      lines.push('## Previous Team Work (Handoff)')
      lines.push('')
      lines.push('The following team members have completed their work before you:')
      lines.push('')

      for (const entry of completedWorkLog) {
        lines.push('### ' + entry.agentName + ' (completed)')
        lines.push(entry.summary)
        lines.push('')
      }

      lines.push('---')
      lines.push('')
      lines.push('You are ' + agent.name + '. Continue from where the previous team members left off.')
      lines.push('REMEMBER: Only do work within YOUR scope. The previous team members handled THEIR parts. You handle YOUR part only.')
    }

    return lines.join('\n')
  }

  private parsePlanResponse(raw: string, fallbackTask: string): SmartPlanResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON object found')

      const parsed = JSON.parse(jsonMatch[0])

      if (!parsed.agents || !Array.isArray(parsed.agents) || parsed.agents.length === 0) {
        throw new Error('No agents in plan')
      }

      const agents: SmartAgentDef[] = parsed.agents.map((a: Record<string, unknown>, i: number) => ({
        id: (a.id as string) || ('agent-' + i),
        name: (a.name as string) || ('Agent ' + (i + 1)),
        icon: (a.icon as string) || '💻',
        systemPrompt: (a.systemPrompt as string) || ('You are a helpful AI assistant. ' + TOOL_FIRST_INSTRUCTION),
        taskDescription: (a.taskDescription as string) || fallbackTask,
        scope: (a.scope as string) || 'Complete the assigned task.',
        forbidden: (a.forbidden as string) || 'None specified.',
      }))

      const allAgentIds = new Set(agents.map(a => a.id))

      const executionOrder: string[][] = parsed.executionOrder && Array.isArray(parsed.executionOrder)
        ? parsed.executionOrder
            .map((layer: unknown) => {
              if (Array.isArray(layer)) return layer.map(String).filter(id => allAgentIds.has(id))
              return allAgentIds.has(String(layer)) ? [String(layer)] : []
            })
            .filter((layer: string[]) => layer.length > 0)
        : [agents.map(a => a.id)]

      const coveredIds = new Set(executionOrder.flat())
      for (const agent of agents) {
        if (!coveredIds.has(agent.id)) {
          executionOrder.push([agent.id])
        }
      }

      const summary: string = (parsed.summary as string) || ('Team of ' + agents.length + ' agents')
      const projectName: string = (parsed.projectName as string) || this.inferProjectName(fallbackTask)

      return { agents, executionOrder, summary, projectName }
    } catch (err) {
      logger.agent.warn('[SmartOrchestrator] Failed to parse plan, using fallback:', err)
      return this.createFallbackPlan(fallbackTask)
    }
  }

  private inferProjectName(task: string): string {
    const keywords = task.match(/[\u4e00-\u9fa5a-zA-Z0-9]+/g)
    if (!keywords || keywords.length === 0) return 'project'
    const main = keywords.slice(0, 3).join('-').toLowerCase()
    return main.replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'project'
  }

  private createFallbackPlan(task: string): SmartPlanResult {
    return {
      agents: [
        {
          id: 'agent-main',
          name: 'Assistant',
          icon: '💻',
          systemPrompt: 'You are an expert AI assistant. Complete the task thoroughly. ' + TOOL_FIRST_INSTRUCTION,
          taskDescription: task,
          scope: 'Complete the entire task.',
          forbidden: 'None.',
        },
      ],
      executionOrder: [['agent-main']],
      summary: 'Single agent handling the task directly',
      projectName: this.inferProjectName(task),
    }
  }

  private synthesizeResults(plan: SmartPlanResult, results: Map<string, string>): string {
    if (plan.agents.length === 1) {
      return results.get(plan.agents[0].id) || ''
    }

    const parts: string[] = []
    for (const agent of plan.agents) {
      const result = results.get(agent.id)
      if (result && !result.startsWith('Error:')) {
        parts.push(result)
      }
    }

    return parts.join('\n\n')
  }
}

export const smartOrchestrator = new SmartOrchestrator()

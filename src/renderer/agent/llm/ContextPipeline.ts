/**
 * ContextPipeline - 上下文管道系统
 *
 * 将 ContextBuilder 改造为可扩展的管道架构。
 * 每个 ContextProvider 负责处理一种上下文类型，
 * 场景通过 capabilities.contextTypes 声明需要的上下文类型。
 *
 * 设计原则：
 * - Provider 即插件：每种上下文类型由一个 Provider 处理
 * - 场景声明式：场景声明需要哪些上下文类型
 * - 管道式处理：Provider 按优先级顺序处理
 * - 向后兼容：现有上下文类型自动注册为内置 Provider
 */

import type { ContextItem, ProblemsContext } from '../types'
import { getAgentConfig } from '../utils/AgentConfig'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore } from '../store/AgentStore'
import { toolRegistry } from '../tools'
import { CacheService } from '@shared/utils/CacheService'
import { useDiagnosticsStore } from '@/renderer/services/diagnosticsStore'
import { normalizePath } from '@shared/utils/pathUtils'
import { retrievalService } from '../services/retrievalService'
import { getMessageText, ChatMessage } from '../types'
import { scenarioRegistry } from '@shared/config/scenarios'

// ============================================
// ContextProvider 接口
// ============================================

export interface ContextProvider {
  type: string
  label: string
  labelZh: string
  priority: number
  process(item: ContextItem, context: ProviderContext): Promise<string | null>
}

export interface ProviderContext {
  userQuery?: string
  workspacePath: string | null
  config: ReturnType<typeof getAgentConfig>
  fileCount: number
  totalChars: number
}

// ============================================
// ContextPipeline 类
// ============================================

class ContextPipelineClass {
  private providers = new Map<string, ContextProvider>()

  register(provider: ContextProvider): void {
    this.providers.set(provider.type, provider)
  }

  unregister(type: string): boolean {
    return this.providers.delete(type)
  }

  get(type: string): ContextProvider | undefined {
    return this.providers.get(type)
  }

  /**
   * 获取当前场景支持的上下文类型列表
   */
  getSupportedTypes(): string[] {
    const scenario = scenarioRegistry.getActive()
    if (scenario) {
      return scenario.capabilities.contextTypes.map(ct => ct.type)
    }
    return Array.from(this.providers.keys())
  }

  /**
   * 通过管道处理上下文项
   */
  async processItem(
    item: ContextItem,
    context: ProviderContext
  ): Promise<string | null> {
    const provider = this.providers.get(item.type)
    if (!provider) {
      logger.agent.warn(`[ContextPipeline] No provider for context type: ${item.type}`)
      return null
    }
    return provider.process(item, context)
  }
}

export const contextPipeline = new ContextPipelineClass()

// ============================================
// 文件缓存
// ============================================

const fileContentCache = new CacheService<string>('ContextFileCache', {
  maxSize: 200,
  maxMemory: 30 * 1024 * 1024,
  defaultTTL: 5 * 60 * 1000,
  evictionPolicy: 'lru',
  slidingExpiration: true,
})

const searchResultCache = new CacheService<unknown[]>('ContextSearchCache', {
  maxSize: 50,
  maxMemory: 10 * 1024 * 1024,
  defaultTTL: 2 * 60 * 1000,
  evictionPolicy: 'lfu',
})

// ============================================
// 内置 ContextProvider 实现
// ============================================

const BINARY_EXTENSIONS = new Set([
  'xlsx', 'xls', 'xlsm', 'xlsb',
  'docx', 'doc', 'pptx', 'ppt',
  'pdf', 'odt', 'ods', 'odp',
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  'exe', 'dll', 'so', 'dylib',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
  'db', 'sqlite', 'sqlite3',
])

const FileProvider: ContextProvider = {
  type: 'File',
  label: 'File',
  labelZh: '文件',
  priority: 1,
  async process(item, _ctx) {
    const filePath = (item as { uri: string }).uri
    try {
      const ext = filePath.split('.').pop()?.toLowerCase() || ''

      if (BINARY_EXTENSIONS.has(ext)) {
        return `\n### File: ${filePath}\n[Binary file: ${ext.toUpperCase()} format. This file has been uploaded by the user and saved to this path.]\n`
      }

      const content = await fileContentCache.getOrSet(
        filePath,
        async () => {
          const fileContent = await api.file.read(filePath)
          if (!fileContent) throw new Error('File not found')
          return fileContent
        },
        { slidingExpiration: true }
      )
      if (!content) return null
      const truncated = content.length > _ctx.config.maxFileContentChars
        ? content.slice(0, _ctx.config.maxFileContentChars) + '\n...(file truncated)'
        : content
      return `\n### File: ${filePath}\n\`\`\`\n${truncated}\n\`\`\`\n`
    } catch (e) {
      logger.agent.error('[ContextPipeline] Failed to read file:', filePath, e)
      return null
    }
  },
}

const CodeSelectionProvider: ContextProvider = {
  type: 'CodeSelection',
  label: 'Code Selection',
  labelZh: '代码选择',
  priority: 2,
  async process(item, _ctx) {
    const { uri, range } = item as { uri: string; range: [number, number] }
    try {
      const content = await fileContentCache.getOrSet(uri, async () => {
        const fileContent = await api.file.read(uri)
        if (!fileContent) throw new Error('File not found')
        return fileContent
      })
      if (!content) return null
      const lines = content.split('\n')
      const selected = lines.slice(range[0] - 1, range[1]).join('\n')
      return `\n### Code Selection: ${uri} (lines ${range[0]}-${range[1]})\n\`\`\`\n${selected}\n\`\`\`\n`
    } catch (e) {
      logger.agent.error('[ContextPipeline] Failed to read code selection:', uri, e)
      return null
    }
  },
}

const FolderProvider: ContextProvider = {
  type: 'Folder',
  label: 'Folder',
  labelZh: '文件夹',
  priority: 3,
  async process(item, ctx) {
    const { uri } = item as { uri: string }
    try {
      const result = await toolRegistry.execute('get_dir_tree', { path: uri, max_depth: 3 }, { workspacePath: ctx.workspacePath })
      if (result.success) {
        return `\n### Folder: ${uri}\n\`\`\`\n${result.result}\n\`\`\`\n`
      }
      return null
    } catch (e) {
      logger.agent.error('[ContextPipeline] Failed to list folder:', uri, e)
      return null
    }
  },
}

const CodebaseProvider: ContextProvider = {
  type: 'Codebase',
  label: 'Codebase',
  labelZh: '代码库',
  priority: 4,
  async process(_item, ctx) {
    if (!ctx.workspacePath || !ctx.userQuery) return '\n[Codebase search requires workspace and query]\n'
    try {
      const cleanQuery = ctx.userQuery.replace(/@codebase\s*/i, '').trim() || ctx.userQuery
      const cacheKey = `${ctx.workspacePath}:${cleanQuery}`
      const results = await searchResultCache.getOrSet(cacheKey, async () => {
        const searchResults = await api.index.hybridSearch(ctx.workspacePath!, cleanQuery, 20)
        return searchResults || []
      }) as Array<{ relativePath: string; score: number; language: string; content: string }>

      if (results && results.length > 0) {
        const limitedResults = results.slice(0, ctx.config.maxSemanticResults)
        return `\n### Codebase Search Results for "${cleanQuery}":\n` +
          limitedResults.map(r => {
            let content = r.content
            if (content.length > 1500) {
              content = content.slice(0, 1500) + `\n... (content truncated, use read_file tool to read full file if needed)`
            }
            return `#### ${r.relativePath} (Score: ${r.score.toFixed(2)})\n\`\`\`${r.language}\n${content}\n\`\`\``
          }).join('\n\n') + '\n'
      }
      return '\n[No relevant codebase results found]\n'
    } catch (e) {
      logger.agent.error('[ContextPipeline] Codebase search failed:', e)
      return '\n[Codebase search failed]\n'
    }
  },
}

const GitProvider: ContextProvider = {
  type: 'Git',
  label: 'Git',
  labelZh: 'Git',
  priority: 5,
  async process(_item, ctx) {
    if (!ctx.workspacePath) return '\n[Git info requires workspace]\n'
    try {
      const gitStatus = await toolRegistry.execute('run_command', {
        command: 'git status --short && git log --oneline -5',
        cwd: ctx.workspacePath,
        timeout: 10
      }, { workspacePath: ctx.workspacePath })
      if (gitStatus.success) {
        return `\n### Git Status:\n\`\`\`\n${gitStatus.result}\n\`\`\`\n`
      }
      return '\n[Git info not available]\n'
    } catch (e) {
      logger.agent.error('[ContextPipeline] Git context failed:', e)
      return '\n[Git info failed]\n'
    }
  },
}

const TerminalProvider: ContextProvider = {
  type: 'Terminal',
  label: 'Terminal',
  labelZh: '终端',
  priority: 6,
  async process(_item, ctx) {
    try {
      const terminalOutput = await toolRegistry.execute('get_terminal_output', {
        terminal_id: 'default',
        lines: 50
      }, { workspacePath: ctx.workspacePath })
      if (terminalOutput.success && terminalOutput.result) {
        let output = terminalOutput.result
        if (output.length > ctx.config.maxTerminalChars) {
          output = output.slice(-ctx.config.maxTerminalChars) + '\n...(terminal output truncated)'
        }
        return `\n### Recent Terminal Output:\n\`\`\`\n${output}\n\`\`\`\n`
      }
      return '\n[No terminal output available]\n'
    } catch (e) {
      logger.agent.error('[ContextPipeline] Terminal context failed:', e)
      return '\n[Terminal output failed]\n'
    }
  },
}

const SymbolsProvider: ContextProvider = {
  type: 'Symbols',
  label: 'Symbols',
  labelZh: '符号',
  priority: 7,
  async process(_item, ctx) {
    if (!ctx.workspacePath) return '\n[Symbols require workspace]\n'
    try {
      const currentFile = useStore.getState().activeFilePath
      if (currentFile) {
        const symbols = await toolRegistry.execute('get_document_symbols', {
          path: currentFile
        }, { workspacePath: ctx.workspacePath })
        if (symbols.success && symbols.result) {
          return `\n### Symbols in ${currentFile}:\n\`\`\`\n${symbols.result}\n\`\`\`\n`
        }
        return '\n[No symbols found]\n'
      }
      return '\n[No active file for symbols]\n'
    } catch (e) {
      logger.agent.error('[ContextPipeline] Symbols context failed:', e)
      return '\n[Symbols retrieval failed]\n'
    }
  },
}

const WebProvider: ContextProvider = {
  type: 'Web',
  label: 'Web',
  labelZh: '网页',
  priority: 8,
  async process(_item, ctx) {
    if (!ctx.userQuery) return '\n[Web search requires query]\n'
    try {
      const cleanQuery = ctx.userQuery.replace(/@web\s*/i, '').trim() || ctx.userQuery
      const searchResult = await toolRegistry.execute('web_search', { query: cleanQuery }, { workspacePath: ctx.workspacePath })
      if (searchResult.success) {
        return `\n### Web Search Results for "${cleanQuery}":\n${searchResult.result}\n`
      }
      return `\n[Web search failed: ${searchResult.error}]\n`
    } catch (e) {
      logger.agent.error('[ContextPipeline] Web search failed:', e)
      return '\n[Web search failed]\n'
    }
  },
}

const ProblemsProvider: ContextProvider = {
  type: 'Problems',
  label: 'Problems',
  labelZh: '问题',
  priority: 9,
  async process(item, _ctx) {
    const diagnosticsState = useDiagnosticsStore.getState()
    const diagnostics = diagnosticsState.diagnostics
    const targetFile = (item as ProblemsContext).uri || useStore.getState().activeFilePath

    if (targetFile) {
      const normalizedTarget = normalizePath(targetFile)
      const parts: string[] = []
      for (const [uri, diags] of diagnostics) {
        let uriPath = uri
        if (uri.startsWith('file:///')) {
          uriPath = decodeURIComponent(uri.slice(8))
        } else if (uri.startsWith('file://')) {
          uriPath = decodeURIComponent(uri.slice(7))
        }
        const normalizedUri = normalizePath(uriPath)
        if (normalizedUri === normalizedTarget || normalizedUri.endsWith(normalizedTarget)) {
          if (diags.length > 0) {
            parts.push(`### Problems in ${targetFile}:`)
            diags.forEach((d, i) => {
              const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : 'Info'
              parts.push(`${i + 1}. [${severity}] Line ${d.range.start.line + 1}: ${d.message}`)
            })
          }
          break
        }
      }
      if (parts.length > 0) return '\n' + parts.join('\n') + '\n'
      return '\n[No problems found in current file]\n'
    }

    if (diagnostics.size === 0) return '\n[No problems detected in workspace]\n'

    const parts: string[] = ['### All Problems:']
    let count = 0
    for (const [uri, diags] of diagnostics) {
      if (count >= 50) {
        parts.push(`\n... and more (${diagnosticsState.errorCount} errors, ${diagnosticsState.warningCount} warnings total)`)
        break
      }
      let filePath = uri
      if (uri.startsWith('file:///')) filePath = decodeURIComponent(uri.slice(8))
      else if (uri.startsWith('file://')) filePath = decodeURIComponent(uri.slice(7))
      parts.push(`\n#### ${filePath}:`)
      for (const d of diags) {
        if (count >= 50) break
        const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : 'Info'
        parts.push(`- [${severity}] Line ${d.range.start.line + 1}: ${d.message}`)
        count++
      }
    }
    return '\n' + parts.join('\n') + '\n'
  },
}

const SkillProvider: ContextProvider = {
  type: 'Skill',
  label: 'Skill',
  labelZh: '技能',
  priority: 10,
  async process(item, _ctx) {
    const { name, description } = item as { name: string; description?: string }
    return `\n### Skill: ${name}\n${description || ''}\n`
  },
}

// ============================================
// 注册内置 Provider
// ============================================

contextPipeline.register(FileProvider)
contextPipeline.register(CodeSelectionProvider)
contextPipeline.register(FolderProvider)
contextPipeline.register(CodebaseProvider)
contextPipeline.register(GitProvider)
contextPipeline.register(TerminalProvider)
contextPipeline.register(SymbolsProvider)
contextPipeline.register(WebProvider)
contextPipeline.register(ProblemsProvider)
contextPipeline.register(SkillProvider)

// ============================================
// 管道式上下文构建（替代原 buildContextContent）
// ============================================

export async function buildContextContentViaPipeline(
  contextItems: ContextItem[],
  userQuery?: string,
  assistantId?: string,
  threadId?: string
): Promise<string> {
  const validContextItems = contextItems || []
  const parts: string[] = []
  let totalChars = 0
  let fileCount = 0
  const config = getAgentConfig()
  const workspacePath = useStore.getState().workspacePath

  const supportedTypes = contextPipeline.getSupportedTypes()

  for (const item of validContextItems) {
    if (totalChars >= config.maxTotalContextChars) {
      parts.push('\n[Additional context truncated]')
      break
    }

    if (!supportedTypes.includes(item.type)) continue

    if (item.type === 'File') {
      if (fileCount >= config.maxContextFiles) {
        parts.push('\n[Additional files truncated]')
        continue
      }
      fileCount++
    }

    const providerContext: ProviderContext = {
      userQuery,
      workspacePath,
      config,
      fileCount,
      totalChars,
    }

    const result = await contextPipeline.processItem(item, providerContext)
    if (result) {
      parts.push(result)
      totalChars += result.length
    }
  }

  updateContextStats(validContextItems, totalChars, config, threadId)

  if (totalChars < config.maxTotalContextChars) {
    const implicitContext = await processImplicitContext(userQuery, workspacePath, validContextItems, assistantId, threadId)
    if (implicitContext) {
      parts.push(implicitContext)
    }
  }

  return parts.join('')
}

async function processImplicitContext(
  userQuery: string | undefined,
  workspacePath: string | null,
  existingContextItems: ContextItem[],
  assistantId?: string,
  threadId?: string
): Promise<string | null> {
  const config = getAgentConfig()
  if (!config.enableAutoContext) return null
  if (!workspacePath || !userQuery || userQuery.length < 5) return null

  const hasExplicitCodebase = existingContextItems.some(item => item.type === 'Codebase')
  if (hasExplicitCodebase) return null

  try {
    const messages = threadId ? useAgentStore.getState().forThread(threadId).getMessages() : []
    const history = messages
      .filter(m => m.role !== 'checkpoint' && m.role !== 'interrupted_tool')
      .slice(-6)
      .map((m: ChatMessage) => {
        let text = ''
        if (m.role === 'user') {
          text = getMessageText(m.content)
        } else if (m.role === 'assistant' || m.role === 'tool') {
          text = m.content || ''
        }
        return `${m.role}: ${text.slice(0, 200)}`
      })
      .join('\n')

    const results = await retrievalService.retrieve({
      query: userQuery,
      history,
      workspacePath,
      assistantId,
      threadId,
      threshold: 0.3,
      limit: 3
    })

    if (!results || results.length === 0) return null

    return results.map(r => {
      let content = r.content
      if (content.length > 1500) {
        content = content.slice(0, 1500) + `\n... (content truncated, use read_file tool to read full file if needed)`
      }
      return `\n--- File: ${r.relativePath} (Lines ${r.startLine}-${r.endLine}) ---\n${content}\n`
    }).join('\n')
  } catch (err) {
    logger.agent.error('[ContextPipeline] Implicit context failed:', err)
    return null
  }
}

function updateContextStats(
  contextItems: ContextItem[],
  totalChars: number,
  config: ReturnType<typeof getAgentConfig>,
  threadId?: string
): void {
  const agentStore = useAgentStore.getState()
  const targetStore = threadId ? agentStore.forThread(threadId) : null
  const agentMessages = targetStore ? targetStore.getMessages() : agentStore.getMessages()
  const fileCount = contextItems.filter(item => item.type === 'File').length
  const semanticResultCount = contextItems.filter(item => item.type === 'Codebase').length

  const stats = {
    totalChars,
    maxChars: config.maxTotalContextChars,
    fileCount,
    maxFiles: 10,
    messageCount: agentMessages.length,
    maxMessages: config.maxHistoryMessages,
    semanticResultCount,
    terminalChars: 0
  }

  if (targetStore) {
    targetStore.setContextStats(stats)
    return
  }

  if (agentStore.currentThreadId) {
    agentStore.forThread(agentStore.currentThreadId).setContextStats(stats)
  }
}

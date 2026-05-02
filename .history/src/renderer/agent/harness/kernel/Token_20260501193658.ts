export class InjectToken<T = unknown> {
  readonly id: string
  readonly description: string

  private readonly _type?: T

  constructor(id: string, description: string) {
    this.id = id
    this.description = description
  }

  toString(): string {
    return `InjectToken(${this.id})`
  }
}

export const TOKENS = {
  FileService: new InjectToken<IFileService>('file.service', '文件操作服务'),
  LintService: new InjectToken<ILintService>('lint.service', '代码检查服务'),
  MemoryService: new InjectToken<IMemoryService>('memory.service', '记忆服务'),
  SkillService: new InjectToken<ISkillService>('skill.service', '技能服务'),
  StreamingEditService: new InjectToken<IStreamingEditService>('streamingEdit.service', '流式编辑服务'),
  FileCacheService: new InjectToken<IFileCacheService>('fileCache.service', '文件缓存服务'),
  ComposerService: new InjectToken<IComposerService>('composer.service', '编排器服务'),
  RulesService: new InjectToken<IRulesService>('rules.service', '规则服务'),
  RetrievalService: new InjectToken<IRetrievalService>('retrieval.service', '检索服务'),
  LlmConfigService: new InjectToken<ILlmConfigService>('llmConfig.service', 'LLM配置服务'),
  TerminalManager: new InjectToken<ITerminalManager>('terminal.manager', '终端管理器'),
  ToolRegistry: new InjectToken<IToolRegistry>('tool.registry', '工具注册表'),
  ToolManager: new InjectToken<IToolManager>('tool.manager', '工具管理器'),
  EventBus: new InjectToken<IEventBus>('event.bus', '事件总线'),
  AgentStore: new InjectToken<IAgentStore>('agent.store', 'Agent状态'),
  GlobalStore: new InjectToken<IGlobalStore>('global.store', '全局状态'),
  ElectronAPI: new InjectToken<IElectronAPI>('electron.api', 'Electron IPC桥接'),
  WorkspacePath: new InjectToken<string>('workspace.path', '工作区路径'),
}

export interface IFileService {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<boolean>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<boolean>
  delete(path: string): Promise<boolean>
  rename(oldPath: string, newPath: string): Promise<boolean>
  readDir(path: string): Promise<string[] | null>
  getDirname(path: string): string
}

export interface ILintService {
  lintFile(filePath: string): Promise<import('../../types').LintError[]>
}

export interface IMemoryService {
  getEnabled(): Promise<Array<{ id: string; content: string; createdAt: number; enabled: boolean }>>
  add(content: string): Promise<void>
  remove(id: string): Promise<void>
  toggle(id: string, enabled: boolean): Promise<void>
}

export interface ISkillService {
  getSkills(): Promise<Array<{ name: string; description: string; content: string; filePath: string; enabled: boolean; type: string; source: string }>>
  getEnabledSkills(): Promise<Array<{ name: string; description: string; content: string; filePath: string; enabled: boolean; type: string; source: string }>>
}

export interface IStreamingEditService {
  applyEdit(filePath: string, oldContent: string, newContent: string): Promise<boolean>
}

export interface IFileCacheService {
  hasValidCache(filePath: string): boolean
  markFileAsRead(filePath: string, content: string): void
  getCachedContent(filePath: string): string | null
  invalidate(filePath: string): void
  invalidateAll(): void
}

export interface IComposerService {
  start(title: string, content: string): Promise<void>
  update(id: string, content: string): Promise<void>
  complete(id: string): Promise<void>
}

export interface IRulesService {
  getProjectRules(): Promise<string[]>
  getGlobalRules(): Promise<string[]>
}

export interface IRetrievalService {
  search(query: string, limit?: number): Promise<Array<{ path: string; content: string; score: number }>>
}

export interface ILlmConfigService {
  getConfig(): import('@/shared/types/llm').LLMConfig | null
  setConfig(config: Partial<import('@/shared/types/llm').LLMConfig>): void
}

export interface ITerminalManager {
  executeCommand(command: string, cwd?: string): Promise<{ exitCode: number; output: string }>
  isRunning(id: string): boolean
  kill(id: string): void
}

export interface IToolRegistry {
  has(name: string): boolean
  get(name: string): unknown
  getAll(): Array<{ name: string; definition: unknown; schema: unknown }>
  validate(name: string, args: unknown): { success: boolean; error?: string }
  getApprovalType(name: string): string
}

export interface IToolManager {
  hasTool(name: string): boolean
  getToolDefinitions(): unknown[]
  execute(name: string, args: Record<string, unknown>, context: unknown): Promise<unknown>
}

export interface IEventBus {
  emit(event: unknown): void
  on(type: string, handler: (event: unknown) => void): () => void
}

export interface IAgentStore {
  getState(): unknown
  setState(partial: unknown): void
  forThread(threadId: string): { setExecutionMeta(meta: unknown): void; setStreamState(state: unknown): void }
}

export interface IGlobalStore {
  getState(): unknown
  setState(partial: unknown): void
}

export interface IElectronAPI {
  file: {
    read(path: string): Promise<string | null>
    write(path: string, content: string): Promise<boolean>
    exists(path: string): Promise<boolean>
    mkdir(path: string): Promise<boolean>
    delete(path: string): Promise<boolean>
    rename(oldPath: string, newPath: string): Promise<boolean>
    readDir(path: string): Promise<string[] | null>
  }
  shell: {
    execute(command: string, cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
}

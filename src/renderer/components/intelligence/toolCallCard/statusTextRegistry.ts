/**
 * 工具调用状态文案生成器
 * 采用「状态阶段 + 策略注册表」架构：
 *  - 状态阶段：将 running/success/error 三种状态抽象为 StatusPhase
 *  - 策略注册表：每个工具名注册一个状态文案构建器，消除冗长 if-else
 */
import { t } from '@renderer/i18n'
import type { Language } from '@renderer/i18n'
import type { ToolCall } from '@intelligence/providerTypes'
import { getMcpToolStatusText, getFriendlyToolName, isMcpToolName } from '@intelligence/display/toolFriendlyName'
import {
  asString,
  getPrimaryToolPath,
  getToolPathList,
  getPathSummary,
  parseResultCount,
  previewSlice,
  type ToolArgs,
} from './helpers'

/** 工具状态阶段 */
type StatusPhase = 'running' | 'success' | 'error' | 'idle'

/** 状态上下文 */
interface StatusContext {
  args: ToolArgs
  phase: StatusPhase
  language: Language
  result?: string
  /** 卡片是否展开（仅 run_command 使用：展开时显示通用文案，收起时显示具体命令） */
  isExpanded?: boolean
}

/** 状态文案构建器 */
type StatusTextBuilder = (ctx: StatusContext) => string

/** 根据工具调用状态推导阶段 */
function resolvePhase(status: ToolCall['status'], isStreaming: boolean): StatusPhase {
  if (status === 'running' || status === 'pending' || isStreaming) return 'running'
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  return 'idle'
}

/** 路径相关工具的状态文案构建器工厂 */
function createPathStatusBuilder(
  runningKey: string,
  successKey: string,
  errorKey: string,
  runningEllipsisKey: string,
): StatusTextBuilder {
  return (ctx) => {
    const { args, phase, language } = ctx
    const paths = getToolPathList(args)
    const path = getPrimaryToolPath(args)
    const pathSummary = getPathSummary(paths)

    if (paths.length > 1) {
      switch (phase) {
        case 'running':
          return t(runningKey, language as any, { target: pathSummary })
        case 'success':
          return t(successKey, language as any, { target: pathSummary })
        case 'error':
          return t(errorKey, language as any, { target: '' })
        default:
          return t(runningKey, language as any, { target: pathSummary })
      }
    }
    if (!path) return phase === 'running' ? t(runningEllipsisKey, language as any) : ''
    switch (phase) {
      case 'running':
        return t(runningKey, language as any, { target: path })
      case 'success':
        return t(successKey, language as any, { target: path })
      case 'error':
        return t(errorKey, language as any, { target: path })
      default:
        return t(runningKey, language as any, { target: path })
    }
  }
}

/** 查询类工具的状态文案构建器工厂 */
function createSearchStatusBuilder(
  runningKey: string,
  successKey: string,
  errorKey: string,
  runningEllipsisKey: string,
): StatusTextBuilder {
  return (ctx) => {
    const { args, phase, language } = ctx
    const query = asString(args.pattern) || asString(args.query)
    const value = query ? `"${query}"` : ''
    if (!value) return phase === 'running' ? t(runningEllipsisKey, language as any) : ''
    switch (phase) {
      case 'running':
        return t(runningKey, language as any, { query: value })
      case 'success':
        return t(successKey, language as any, { query: value })
      case 'error':
        return t(errorKey, language as any)
      default:
        return t(runningKey, language as any, { query: value })
    }
  }
}

/** 简单状态文案构建器工厂（无参数） */
function createSimpleStatusBuilder(
  runningKey: string,
  successKey: string,
  errorKey: string,
): StatusTextBuilder {
  return (ctx) => {
    const { phase, language } = ctx
    switch (phase) {
      case 'running':
        return t(runningKey, language as any)
      case 'success':
        return t(successKey, language as any)
      case 'error':
        return t(errorKey, language as any)
      default:
        return t(runningKey, language as any)
    }
  }
}

/** 带名称参数的状态文案构建器工厂 */
function createNamedStatusBuilder(
  nameArg: string,
  runningKey: string,
  successKey: string,
  errorKey: string,
  runningEllipsisKey: string,
): StatusTextBuilder {
  return (ctx) => {
    const { args, phase, language } = ctx
    const name = asString(args[nameArg])
    if (!name) return phase === 'running' ? t(runningEllipsisKey, language as any) : ''
    switch (phase) {
      case 'running':
        return t(runningKey, language as any, { name })
      case 'success':
        return t(successKey, language as any, { name })
      case 'error':
        return t(errorKey, language as any, { name })
      default:
        return t(runningKey, language as any, { name })
    }
  }
}

/** 带数量统计的状态文案构建器工厂 */
function createCountedStatusBuilder(
  countKey: string,
  runningKey: string,
  errorKey: string,
): StatusTextBuilder {
  return (ctx) => {
    const { phase, language, result } = ctx
    switch (phase) {
      case 'running':
        return t(runningKey, language as any)
      case 'success':
        return t(countKey, language as any, { count: parseResultCount(result, countKey.split('.').pop() || '') })
      case 'error':
        return t(errorKey, language as any)
      default:
        return t(runningKey, language as any)
    }
  }
}

/** 状态文案策略注册表 */
const STATUS_BUILDERS: Record<string, StatusTextBuilder> = {
  read_file: createPathStatusBuilder(
    'tool.status.reading', 'tool.status.read', 'tool.status.readFailed', 'tool.status.readingEllipsis',
  ),
  read_multiple_files: createPathStatusBuilder(
    'tool.status.reading', 'tool.status.read', 'tool.status.readFailed', 'tool.status.readingFiles',
  ),
  list_directory: createPathStatusBuilder(
    'tool.status.reading', 'tool.status.read', 'tool.status.readFailed', 'tool.status.readingEllipsis',
  ),
  write_file: createPathStatusBuilder(
    'tool.status.creating', 'tool.status.created', 'tool.status.createFailed', 'tool.status.creatingEllipsis',
  ),
  create_file: createPathStatusBuilder(
    'tool.status.creating', 'tool.status.created', 'tool.status.createFailed', 'tool.status.creatingEllipsis',
  ),
  create_file_or_folder: createPathStatusBuilder(
    'tool.status.creating', 'tool.status.created', 'tool.status.createFailed', 'tool.status.creatingEllipsis',
  ),
  edit_file: createPathStatusBuilder(
    'tool.status.editing', 'tool.status.updated', 'tool.status.editFailed', 'tool.status.editingEllipsis',
  ),
  delete_file_or_folder: createPathStatusBuilder(
    'tool.status.deleting', 'tool.status.deleted', 'tool.status.deleteFailed', 'tool.status.deletingEllipsis',
  ),
  search_files: createSearchStatusBuilder(
    'tool.status.searching', 'tool.status.searched', 'tool.status.searchFailed', 'tool.status.searchingEllipsis',
  ),
  codebase_search: createSearchStatusBuilder(
    'tool.status.searching', 'tool.status.searched', 'tool.status.searchFailed', 'tool.status.searchingEllipsis',
  ),
  web_search: createSearchStatusBuilder(
    'tool.status.searching', 'tool.status.searched', 'tool.status.searchFailed', 'tool.status.searchingEllipsis',
  ),
  uiux_search: createSearchStatusBuilder(
    'tool.status.searching', 'tool.status.searched', 'tool.status.searchFailed', 'tool.status.searchingEllipsis',
  ),
  get_lint_errors: createPathStatusBuilder(
    'tool.status.analyzing', 'tool.status.analyzed', 'tool.status.analysisFailed', 'tool.status.analyzingEllipsis',
  ),
  find_references: createPathStatusBuilder(
    'tool.status.analyzing', 'tool.status.analyzed', 'tool.status.analysisFailed', 'tool.status.analyzingEllipsis',
  ),
  go_to_definition: createPathStatusBuilder(
    'tool.status.analyzing', 'tool.status.analyzed', 'tool.status.analysisFailed', 'tool.status.analyzingEllipsis',
  ),
  get_hover_info: createPathStatusBuilder(
    'tool.status.analyzing', 'tool.status.analyzed', 'tool.status.analysisFailed', 'tool.status.analyzingEllipsis',
  ),
  get_document_symbols: createPathStatusBuilder(
    'tool.status.analyzing', 'tool.status.analyzed', 'tool.status.analysisFailed', 'tool.status.analyzingEllipsis',
  ),
  apply_skill: createNamedStatusBuilder(
    'skill_name', 'tool.status.applying', 'tool.status.applied', 'tool.status.applyFailed', 'tool.status.applyingEllipsis',
  ),
  todo_write: createSimpleStatusBuilder(
    'tool.status.updatingTasks', 'tool.status.tasksUpdated', 'tool.status.tasksUpdateFailed',
  ),
  uiux_recommend: createSimpleStatusBuilder(
    'tool.status.generatingRecommendation', 'tool.status.recommendationGenerated', 'tool.status.recommendationFailed',
  ),
  desktop_list_apps: createCountedStatusBuilder(
    'tool.status.listedApps', 'tool.status.listingApps', 'tool.status.listAppsFailed',
  ),
  desktop_launch_app: createNamedStatusBuilder(
    'name', 'tool.status.launchingApp', 'tool.status.launchedApp', 'tool.status.launchAppFailed', 'tool.status.launchingApp',
  ),
  desktop_quit_app: createNamedStatusBuilder(
    'name', 'tool.status.quittingApp', 'tool.status.quitApp', 'tool.status.quitAppFailed', 'tool.status.quittingApp',
  ),
  desktop_list_windows: createCountedStatusBuilder(
    'tool.status.listedWindows', 'tool.status.listingWindows', 'tool.status.listWindowsFailed',
  ),
  desktop_focus_window: createSimpleStatusBuilder(
    'tool.status.focusingWindow', 'tool.status.focusedWindow', 'tool.status.focusWindowFailed',
  ),
  desktop_close_window: createSimpleStatusBuilder(
    'tool.status.closingWindow', 'tool.status.closedWindow', 'tool.status.closeWindowFailed',
  ),
  desktop_capture_screen: createSimpleStatusBuilder(
    'tool.status.takingScreenshot', 'tool.status.tookScreenshot', 'tool.status.screenshotFailed',
  ),
  desktop_mouse_click: createSimpleStatusBuilder(
    'tool.status.clickingMouse', 'tool.status.clickedMouse', 'tool.status.clickingMouse',
  ),
  desktop_mouse_move: createSimpleStatusBuilder(
    'tool.status.movingMouse', 'tool.status.movedMouse', 'tool.status.movingMouse',
  ),
  desktop_mouse_scroll: createSimpleStatusBuilder(
    'tool.status.scrollingMouse', 'tool.status.scrolledMouse', 'tool.status.scrollingMouse',
  ),
  desktop_type_text: createSimpleStatusBuilder(
    'tool.status.typingText', 'tool.status.typedText', 'tool.status.typingText',
  ),
  desktop_press_key: createSimpleStatusBuilder(
    'tool.status.pressingKey', 'tool.status.pressedKey', 'tool.status.pressingKey',
  ),
  desktop_key_combo: createSimpleStatusBuilder(
    'tool.status.pressingKey', 'tool.status.pressedKey', 'tool.status.pressingKey',
  ),
  desktop_emergency_stop: createSimpleStatusBuilder(
    'tool.status.emergencyStopping', 'tool.status.emergencyStopped', 'tool.status.emergencyStopFailed',
  ),
}

/** URL 读取工具的专用构建器 */
function buildReadUrlStatus(ctx: StatusContext): string {
  const { args, phase, language } = ctx
  const url = asString(args.url)
  let hostname = ''
  if (url) {
    try {
      hostname = new URL(url).hostname
    } catch {
      hostname = url
    }
  }
  if (!hostname) return phase === 'running' ? t('tool.status.readingUrlEllipsis', language as any) : ''
  switch (phase) {
    case 'running':
      return t('tool.status.readingUrl', language as any, { host: hostname })
    case 'success':
      return t('tool.status.readUrl', language as any, { host: hostname })
    case 'error':
      return t('tool.status.readUrlFailed', language as any, { host: hostname })
    default:
      return t('tool.status.readingUrl', language as any, { host: hostname })
  }
}

/** 记忆工具的专用构建器 */
function buildRememberStatus(ctx: StatusContext): string {
  const { args, phase, language } = ctx
  const content = asString(args.content) || asString(args.text) || asString(args.key)
  const preview = content ? `"${previewSlice(content, 30)}"` : ''
  switch (phase) {
    case 'running':
      return preview
        ? t('tool.status.remembering', language as any, { content: preview })
        : t('tool.status.rememberingEllipsis', language as any)
    case 'success':
      return preview
        ? t('tool.status.remembered', language as any, { content: preview })
        : t('tool.status.rememberedEllipsis', language as any)
    case 'error':
      return t('tool.status.rememberFailed', language as any)
    default:
      return t('tool.status.rememberingEllipsis', language as any)
  }
}

/** 询问用户工具的专用构建器 */
function buildAskUserStatus(ctx: StatusContext): string {
  const { args, phase, language } = ctx
  const question = asString(args.question) || asString(args.message)
  const preview = question ? `"${previewSlice(question, 30)}"` : ''
  switch (phase) {
    case 'running':
      return preview
        ? t('tool.status.askingUser', language as any, { question: preview })
        : t('tool.status.askingEllipsis', language as any)
    case 'success':
      return t('tool.status.askedUser', language as any)
    case 'error':
      return t('tool.status.askFailed', language as any)
    default:
      return t('tool.status.askingEllipsis', language as any)
  }
}

/** 知识库搜索工具的专用构建器 */
function buildKnowledgeSearchStatus(ctx: StatusContext): string {
  const { args, phase, language } = ctx
  const query = asString(args.query) || asString(args.question)
  const value = query ? `"${query}"` : ''
  if (!value) return phase === 'running' ? t('tool.status.searchingKnowledgeEllipsis', language as any) : ''
  switch (phase) {
    case 'running':
      return t('tool.status.searchingKnowledge', language as any, { query: value })
    case 'success':
      return t('tool.status.searchedKnowledge', language as any, { query: value })
    case 'error':
      return t('tool.status.searchKnowledgeFailed', language as any)
    default:
      return t('tool.status.searchingKnowledge', language as any, { query: value })
  }
}

/** 命令执行工具的专用构建器 */
function buildRunCommandStatus(ctx: StatusContext): string {
  const { args, phase, language, isExpanded } = ctx
  const cmd = asString(args.command) || asString(args.cmd) || ''
  // 展开状态下：命令本身已在内容区显示，标题用通用文案避免冗余
  // 收起状态下：命令不可见，标题需要带命令预览方便用户识别
  if (isExpanded) {
    switch (phase) {
      case 'running':
        return t('tool.status.executingCommand', language as any)
      case 'success':
        return t('tool.status.executedCommand', language as any)
      case 'error':
        return t('tool.status.cmdFailedShort', language as any)
      default:
        return t('tool.label.run_command', language as any)
    }
  }
  switch (phase) {
    case 'running':
      return cmd
        ? t('tool.status.executing', language as any, { cmd: previewSlice(cmd, 40) })
        : t('tool.status.preparingCmd', language as any)
    case 'success':
      return cmd
        ? t('tool.status.executed', language as any, { cmd: previewSlice(cmd, 40) })
        : t('tool.status.executedEllipsis', language as any)
    case 'error':
      return t('tool.status.cmdFailed', language as any, { cmd: cmd || '' })
    default:
      return t('tool.label.run_command', language as any)
  }
}
/** 外部智能体委托工具的专用构建器（运行中显示 Agent 名 + 任务预览） */
function buildExternalAgentStatus(ctx: StatusContext): string {
  const { args, phase, language } = ctx
  const isZh = language === 'zh'
  const agent = asString(args.agent)
  const taskPreview = previewSlice(asString(args.task), 40)
  switch (phase) {
    case 'running':
      return `${agent ? `${agent} ` : ''}${isZh ? '执行中' : 'running'}${taskPreview ? ` "${taskPreview}"` : ''}…`
    case 'success':
      return isZh ? '外部智能体任务完成' : 'External agent task completed'
    case 'error':
      return isZh ? '外部智能体任务失败' : 'External agent task failed'
    default:
      return isZh ? '正在执行外部智能体任务…' : 'Running external agent task…'
  }
}

/** 注册专用构建器 */
STATUS_BUILDERS.read_url = buildReadUrlStatus
STATUS_BUILDERS.remember = buildRememberStatus
STATUS_BUILDERS.ask_user = buildAskUserStatus
STATUS_BUILDERS.knowledge_search = buildKnowledgeSearchStatus
STATUS_BUILDERS.run_command = buildRunCommandStatus
STATUS_BUILDERS.external_agent_delegate = buildExternalAgentStatus

/** 生成工具状态文案 */
export function getStatusText(
  name: string,
  args: ToolArgs,
  status: ToolCall['status'],
  isStreaming: boolean,
  language: Language,
  result?: string,
  isExpanded?: boolean,
): string {
  const phase = resolvePhase(status, isStreaming)
  const ctx: StatusContext = { args, phase, language, result, isExpanded }

  const builder = STATUS_BUILDERS[name]
  if (builder) return builder(ctx)

  if (isMcpToolName(name)) {
    const mcpStatus = getMcpToolStatusText(name, status, isStreaming, language)
    if (mcpStatus) return mcpStatus
  }

  if (phase === 'running') {
    return getFriendlyToolName(name, language).label
  }
  if (phase === 'success') {
    const friendlyLabel = getFriendlyToolName(name, language).label
    return t('tool.status.completedAction', language as any, { action: friendlyLabel })
  }
  if (phase === 'error') {
    const friendlyLabel = getFriendlyToolName(name, language).label
    return t('tool.status.actionFailed', language as any, { action: friendlyLabel })
  }
  return ''
}

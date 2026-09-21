/**
 * 工具结果来源分类
 *
 * 按工具名（必要时结合调用参数里的路径）判定产出的通道与信任级别。
 *
 * 判定原则：
 * - 只依据「数据从哪来」这一结构化事实，不分析内容语义
 * - 文件类工具按路径落点区分：工作区内与客户端数据目录可信，其余不可信；
 *   相对路径按工作区根解析，缺路径参数时按工具默认落点（工作区根）判定
 * - 无法识别的工具一律归为不可信 —— 漏防的代价远高于多一次确认
 */

import type { ToolOrigin, TrustChannel, TrustLevel } from '@intelligence/types/trustTypes'
import { getTrustedAppDataRoots } from '@intelligence/toolkit/trustedPathRegistry'
import { logger } from '@toolkit/LogEngine'

/** 网络检索类：产出即外部内容 */
const WEB_TOOLS = new Set([
  'web_search',
  'read_url',
  'image_search',
  'video_search',
  'get_weather',
])

/** 本地文件类：需要结合路径判定落点 */
const FILE_TOOLS = new Set([
  'read_file',
  'read_multiple_files',
  'list_directory',
  'get_dir_tree',
  'get_file_info',
  'search_files',
  'extract_document',
  'edit_file',
  'write_file',
  'replace_file_content',
  'create_file_or_folder',
  'delete_file_or_folder',
])

/** 本地执行类：终端、语言服务、本地检索、Git */
const LOCAL_COMPUTE_TOOLS = new Set([
  'run_command',
  'read_terminal_output',
  'send_terminal_input',
  'stop_terminal',
  'get_lint_errors',
  'codebase_search',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'ocr_extract',
  'vision_analyze',
  'chart_generate',
  'git_status',
  'git_diff',
  'git_log',
  'git_commit',
  'git_branch',
  'git_sync',
  'git_worktree',
  'git_audit',
])

/** 本地知识记忆与交互编排类：内容由客户端自身产生 */
const LOCAL_DATA_TOOLS = new Set([
  'remember',
  'knowledge_search',
  'calculator',
  'apply_skill',
  'ask_user',
  'todo_write',
  'create_task_plan',
  'update_task_plan',
  'start_task_execution',
  'add_node',
  'add_edge',
  'schedule',
  'companion_control',
  // 内置浏览器预览：结果只是本地开页状态，内容由客户端自身产生
  'open_preview',
  'uiux_search',
  'uiux_recommend',
])

/** MCP 工具名前缀 */
const MCP_PREFIX = 'mcp_'

/** 外部编码智能体工具名前缀 */
const EXTERNAL_AGENT_PREFIX = 'external_agent_'

/** 场景工具名前缀（数据来自本地场景库） */
const SCENE_TOOL_PREFIX = 'scene_tools_'

/** 路径归一化：统一分隔符并去掉结尾斜杠 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 判断路径是否为绝对路径 */
function isAbsolutePath(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|[/\\])/.test(p)
}

/**
 * 折叠路径中的 . 与 .. 段
 *
 * 落点判定必须先把 .. 展开，否则 `/ws/../etc/passwd` 会因为前缀仍是 `/ws/`
 * 而被判成工作区内 —— 这既是误判可信，也是一条绕过来源分级的通路。
 */
function collapseSegments(path: string): string {
  const normalized = normalizePath(path)
  const drive = normalized.match(/^([a-zA-Z]:)(\/|$)/)
  const isPosixAbs = normalized.startsWith('/')

  const parts: string[] = []
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.' || (drive && segment === drive[1])) continue
    if (segment === '..') {
      // 越过起点时保留 ..，让后续前缀比对自然失败（相对路径无法证明落在工作区内）
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!isPosixAbs && !drive) parts.push('..')
      continue
    }
    parts.push(segment)
  }

  const body = parts.join('/')
  if (drive) return body ? `${drive[1]}/${body}` : `${drive[1]}/`
  return isPosixAbs ? `/${body}` : body
}

/**
 * 把路径按语义解析为可比较的绝对路径
 *
 * 本地文件工具的路径参数通常是工作区相对路径，直接拿相对路径与工作区根比对
 * 必然判为区外，整条结果就被标成不可信来源，当轮所有写入类操作随即平白多一次确认。
 */
function resolveForContainment(target: string, workspacePath?: string | null): string {
  const trimmed = collapseSegments(target)
  if (!workspacePath) return trimmed
  const root = collapseSegments(workspacePath)
  if (!trimmed || trimmed === '.') return root
  if (isAbsolutePath(trimmed) || trimmed.startsWith('..')) return trimmed
  return `${root}/${trimmed}`
}

/** 判断 target 是否落在 root 之内（含相等） */
function isInside(target: string, root: string): boolean {
  if (!target || !root) return false
  const t = collapseSegments(target)
  const r = collapseSegments(root)
  if (!r || !t) return false
  return t === r || t.startsWith(`${r}/`)
}

/** 从工具参数中提取涉及的路径（兼容 path / filePath / _meta.filePath / paths） */
export function extractPathsFromParams(rawParams?: Record<string, unknown>): string[] {
  if (!rawParams) return []
  const out: string[] = []

  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) out.push(value)
  }

  push(rawParams.path)
  push(rawParams.filePath)
  push(rawParams.file_path)
  push(rawParams.directory)
  push(rawParams.dir)
  push(rawParams.cwd)

  const meta = rawParams._meta
  if (meta && typeof meta === 'object') {
    push((meta as { filePath?: unknown }).filePath)
  }

  const paths = rawParams.paths
  if (Array.isArray(paths)) {
    for (const p of paths) push(p)
  }
  const files = rawParams.files
  if (Array.isArray(files)) {
    for (const p of files) push(p)
  }

  return out
}

/** 构造结果 */
function build(
  toolName: string,
  channel: TrustChannel,
  trust: TrustLevel,
  locator?: string,
): ToolOrigin {
  return locator ? { toolName, channel, trust, locator } : { toolName, channel, trust }
}

/**
 * 落点判定所需的可信范围
 *
 * 判定必须与工具执行时的放行依据同源，否则会出现
 * 「AI 自己写的文件被判成外部内容」——来源分级一旦误判为不可信，
 * 当轮所有写入类操作都会平白多一次确认，而用户看到的却是「自动审批」。
 */
export interface TrustScope {
  /**
   * 工具实际执行时的基准目录
   *
   * 项目执行窗口、挂载任务里，工具把相对路径解析到项目目录（工具上下文的 workspacePath），
   * 而 store 里的 workspacePath 往往是全局工作区；挂载任务下甚至可能为空。
   * 两者不一致时只用 store 的值，会把落在项目目录里的文件一律判为区外。
   */
  executionRoot?: string | null
  /**
   * 用户授权在工作区外访问的目录
   *
   * 来自项目执行窗口的项目目录与「设置 → 安全设置」的允许目录，
   * 与 toolPathPolicy.buildToolPathPolicy 的 extraAllowedRoots 同一口径。
   */
  authorizedRoots?: readonly string[]
}

/**
 * 判定文件类工具的信任级别
 *
 * 有路径信息时按落点判定，相对路径按执行基准目录解析（缺省时回退到工作区根）；
 * 无路径信息时按工具默认落点处理（本地文件工具的默认落点是工作区根，
 * 例如 search_files 只给 pattern 时就在工作区内检索），只有连基准目录都没有时才取不可信。
 */
function classifyFileTool(
  toolName: string,
  rawParams: Record<string, unknown> | undefined,
  workspacePath: string | null | undefined,
  scope?: TrustScope,
): ToolOrigin {
  const paths = extractPathsFromParams(rawParams)

  // 相对路径的解析基准必须与工具执行时一致
  const base = scope?.executionRoot || workspacePath || null

  if (paths.length === 0) {
    return build(toolName, 'local_fs', base ? 'trusted' : 'untrusted')
  }

  const appRoots = getTrustedAppDataRoots()
  const roots = [
    ...(workspacePath ? [workspacePath] : []),
    ...(scope?.executionRoot ? [scope.executionRoot] : []),
    ...(scope?.authorizedRoots ?? []),
    ...appRoots,
  ].filter(Boolean) as string[]

  const allInside = roots.length > 0 && paths.every(p =>
    roots.some(root => isInside(resolveForContainment(p, base), root)))

  return build(
    toolName,
    'local_fs',
    allInside ? 'trusted' : 'untrusted',
    paths[0],
  )
}

/**
 * 工具的目标路径是否落在工作区与授权目录之外
 *
 * 供审批门禁判定「外部内容」：手动审批模式下，触碰工作区与授权目录之外的
 * 文件需要先过一次确认。与来源分类的差别在于「部分越界」也算 —— 来源分级要求
 * 全部路径可信才判可信，而审批只要有一个目标在区外就该让用户看见。
 *
 * 无路径参数时不判越界（例如 search_files 只给 pattern 时默认在工作区内检索），
 * 不给一个没有任何路径信息的调用平白加一次确认。
 *
 * @param toolName        工具名
 * @param rawParams       工具调用参数
 * @param workspacePath   当前工作区路径
 * @param authorizedRoots 用户授权在工作区外访问的目录（设置 → 安全设置、
 *                        项目执行窗口的项目目录），这些位置不算「外部内容」
 */
export function accessesOutsideScope(
  toolName: string,
  rawParams: Record<string, unknown> | undefined,
  workspacePath: string | null | undefined,
  authorizedRoots: readonly string[] = [],
): boolean {
  if (!FILE_TOOLS.has(toolName)) return false

  const paths = extractPathsFromParams(rawParams)
  if (paths.length === 0) return false

  const roots = [
    ...(workspacePath ? [workspacePath] : []),
    ...authorizedRoots,
    ...getTrustedAppDataRoots(),
  ].filter(Boolean) as string[]

  // 没有任何可信根可依据时按外部处理：宁可多问一次，也不默认放行
  if (roots.length === 0) return true

  return paths.some(
    path => !roots.some(root => isInside(resolveForContainment(path, workspacePath), root)),
  )
}

/**
 * 分类单个工具结果的来源
 *
 * @param toolName      工具名
 * @param rawParams     工具调用参数（文件类工具据此判定路径落点）
 * @param workspacePath 当前工作区路径
 * @param scope         执行基准目录与用户授权目录（见 TrustScope）
 */
export function classifyToolOrigin(
  toolName: string,
  rawParams?: Record<string, unknown>,
  workspacePath?: string | null,
  scope?: TrustScope,
): ToolOrigin {
  if (!toolName) {
    return build('unknown', 'external_service', 'untrusted')
  }

  if (WEB_TOOLS.has(toolName)) {
    const url = extractUrlsFromParams(rawParams)[0]
    return build(toolName, 'web', 'untrusted', url)
  }

  if (toolName.startsWith(MCP_PREFIX)) {
    return build(toolName, 'external_service', 'untrusted', toolName.slice(MCP_PREFIX.length))
  }

  if (toolName.startsWith(EXTERNAL_AGENT_PREFIX)) {
    return build(toolName, 'agent', 'untrusted')
  }

  if (toolName === 'send_file_to_channel') {
    return build(toolName, 'channel_message', 'untrusted')
  }

  if (FILE_TOOLS.has(toolName)) {
    return classifyFileTool(toolName, rawParams, workspacePath, scope)
  }

  if (LOCAL_COMPUTE_TOOLS.has(toolName)) {
    return build(toolName, 'local_compute', 'trusted')
  }

  if (LOCAL_DATA_TOOLS.has(toolName) || toolName.startsWith(SCENE_TOOL_PREFIX)) {
    return build(toolName, 'local_compute', 'trusted')
  }

  logger.agent.debug(`[TrustTag] Unclassified tool treated as untrusted: ${toolName}`)
  return build(toolName, 'external_service', 'untrusted')
}

/** 从参数中提取 URL（用于展示来源定位） */
function extractUrlsFromParams(rawParams?: Record<string, unknown>): string[] {
  if (!rawParams) return []
  const out: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) out.push(value.trim())
  }
  push(rawParams.url)
  push(rawParams.link)
  push(rawParams.query_url)

  const urls = rawParams.urls
  if (Array.isArray(urls)) {
    for (const u of urls) push(u)
  }
  return out
}

/**
 * 执行中专家切换
 *
 * 会话入场时的角色匹配只看用户消息，一轮任务里却往往横跨多个工种：
 * 同一个请求既要写页面、又要写接口、还要跑部署。整轮沿用一个专家人设，
 * 会让模型在「写后端」的阶段仍按前端的关注点做事。
 *
 * 这里补一层执行期判定：从本轮工具调用的目标文件与命令里取信号，
 * 命中与当前专家不同的角色时，向模型追加一段阶段专家指令。
 *
 * 三条边界：
 * 1. 只追加，不替换 —— 场景安全边界与会话级人设始终有效；
 * 2. 用户显式锁定专家时整体禁用（执行侧调用前判断）；
 * 3. 同一角色只切一次，总量有上限，切换需要明显胜出，避免来回跳。
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { RoleDescriptor } from './RoleDescriptor'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'

/** 单个工具调用的最小形态（只取判定所需字段） */
export interface ToolCallLike {
  name: string
  arguments?: Record<string, unknown> | string
}

/** 从工具调用中提取的执行信号 */
export interface ExecutionSignals {
  /** 涉及的路径（小写、正斜杠） */
  paths: string[]
  /** 命令文本（已小写） */
  commands: string[]
  /** 拼好的待匹配文本 */
  text: string
}

/** 执行期匹配结果 */
export interface ExecutionRoleMatch {
  role: RoleDescriptor | null
  score: number
  /** 命中依据，便于日志排查「为什么切到这个专家」 */
  hits: string[]
}

/** 参数里可能承载文件路径的字段名 */
const PATH_ARG_KEYS = [
  'path', 'file_path', 'filePath', 'file', 'filename', 'target_file',
  'targetFile', 'files', 'paths', 'source', 'destination', 'dir', 'directory',
]

/** 参数里可能承载命令的字段名 */
const COMMAND_ARG_KEYS = ['command', 'cmd', 'script', 'shell']

/** 纯查询/读取类工具不产生分工信号，直接跳过 */
const SIGNAL_IGNORED_TOOLS = new Set([
  'read_file', 'list_directory', 'search_files', 'codebase_search', 'get_lint_errors',
  'get_document_symbols', 'todo_write', 'ask_user', 'knowledge_search',
])

/** 执行期采纳阈值：宁可不切也不乱切 */
const EXECUTION_MATCH_THRESHOLD = 0.55

/**
 * 权重设计依据
 *
 * - 命令是分工最强的信号：`npm test` 只属于测试、`docker` 只属于运维，
 *   单条命中即可达标；
 * - 路径片段次之：单条（如 `/api/`）只是线索，需叠加扩展名命中才达标，
 *   避免一个 `design.md` 就把会话切成架构专家；
 * - 扩展名只作加权，单独存在永远不足以切换。
 */
const PATH_HINT_WEIGHT = 0.4
const COMMAND_HINT_WEIGHT = 0.6
const FILE_TYPE_WEIGHT = 0.2
/** 单类信号累计上限 */
const SIGNAL_CAP = 0.8
/** 最高分需领先第二名的最小差距 */
const EXECUTION_MATCH_GAP = 0.15

/** 取参数对象（字符串参数尝试解析 JSON，失败返回空对象） */
function parseArgs(raw: ToolCallLike['arguments']): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** 把参数值摊平为字符串数组（兼容字符串、字符串数组、对象里的字符串值） */
function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.flatMap(item => flattenStrings(item))
  }
  return []
}

/** 规范化路径：统一分隔符与大小写，便于片段比对 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

/**
 * 从工具调用里提取执行信号
 *
 * 只认路径与命令两类：它们直接说明「正在动哪一层代码」，
 * 比模型自己写的文字描述可靠。
 */
export function collectExecutionSignals(toolCalls: ToolCallLike[]): ExecutionSignals {
  const paths = new Set<string>()
  const commands = new Set<string>()

  for (const call of toolCalls) {
    if (!call || SIGNAL_IGNORED_TOOLS.has(call.name)) continue
    const args = parseArgs(call.arguments)

    for (const key of PATH_ARG_KEYS) {
      for (const value of flattenStrings(args[key])) {
        const normalized = normalizePath(value)
        // 只有带目录或扩展名的值才算路径，避免把「hello」当成文件
        if (normalized.includes('/') || /\.[a-z0-9]{1,8}$/.test(normalized)) {
          paths.add(normalized)
        }
      }
    }

    for (const key of COMMAND_ARG_KEYS) {
      for (const value of flattenStrings(args[key])) {
        if (value.trim()) commands.add(value.toLowerCase())
      }
    }
  }

  const text = [...paths, ...commands].join(' ')
  return { paths: [...paths], commands: [...commands], text }
}

/** 取路径的扩展名（不含点） */
function extOf(path: string): string {
  const m = path.match(/\.([a-z0-9]{1,8})$/)
  return m ? m[1] : ''
}

/** 按执行信号给单个角色打分 */
function scoreBySignals(role: RoleDescriptor, signals: ExecutionSignals): { score: number; hits: string[] } {
  const hits: string[] = []
  let pathScore = 0
  let commandScore = 0

  for (const hint of role.triggers.pathHints ?? []) {
    const needle = normalizePath(hint)
    if (!needle) continue
    const hit = signals.paths.find(p => p.includes(needle))
    if (hit) {
      pathScore += PATH_HINT_WEIGHT
      hits.push(`path:${hint}`)
      if (pathScore >= SIGNAL_CAP) break
    }
  }
  pathScore = Math.min(pathScore, SIGNAL_CAP)

  for (const hint of role.triggers.commandHints ?? []) {
    const needle = hint.toLowerCase()
    if (!needle) continue
    if (signals.commands.some(cmd => cmd.includes(needle))) {
      commandScore += COMMAND_HINT_WEIGHT
      hits.push(`cmd:${hint}`)
      if (commandScore >= SIGNAL_CAP) break
    }
  }
  commandScore = Math.min(commandScore, SIGNAL_CAP)

  // 扩展名命中只做加权，单独存在时不足以切换
  let fileTypeScore = 0
  const fileTypes = role.triggers.fileTypes ?? []
  if (fileTypes.length > 0) {
    const exts = signals.paths.map(extOf).filter(Boolean)
    const hitExt = exts.find(ext => fileTypes.includes(ext))
    if (hitExt) {
      fileTypeScore = FILE_TYPE_WEIGHT
      hits.push(`ext:${hitExt}`)
    }
  }

  return { score: pathScore + commandScore + fileTypeScore, hits }
}

/**
 * 按执行信号解析阶段专家
 *
 * @param sceneMode 当前场景（只在该场景的启用角色里挑）
 * @param signals   本轮工具调用提取出的信号
 * @param excludeRoleIds 不参与判定的角色（当前已生效的专家）
 */
export function resolveExecutionRole(
  sceneMode: SceneMode,
  signals: ExecutionSignals,
  excludeRoleIds: string[] = [],
): ExecutionRoleMatch {
  const empty: ExecutionRoleMatch = { role: null, score: 0, hits: [] }
  if (signals.paths.length === 0 && signals.commands.length === 0) return empty

  try {
    const excluded = new Set(excludeRoleIds.filter(Boolean))
    const roles = useRoleLibraryStore.getState().getEnabledRoles(sceneMode)
      .filter(role => !excluded.has(role.id))
    if (roles.length === 0) return empty

    const scored = roles
      .map(role => {
        const { score, hits } = scoreBySignals(role, signals)
        return { role, score, hits }
      })
      .filter(item => item.score >= EXECUTION_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) return empty

    const top = scored[0]
    const second = scored[1]
    // 分数接近时不做切换：多个工种同时被涉及，说明这一步本来就在跨层作业，
    // 强行指定一个专家反而会把另一层做偏
    if (second && top.score - second.score < EXECUTION_MATCH_GAP) {
      return { role: null, score: top.score, hits: [] }
    }

    return { role: top.role, score: top.score, hits: top.hits }
  } catch {
    return empty
  }
}

/**
 * 组装阶段专家指令
 *
 * 以 user 消息注入而非改写 system prompt：
 * system prompt 参与前缀缓存，中途改写会让整段上下文重新计费；
 * 追加一条短消息既能生效，也留下可追溯的切换记录。
 */
export function buildExecutionRoleSwitchMessage(role: RoleDescriptor, lang: 'zh' | 'en'): string {
  const contract = role.outputContract ? `\n${role.outputContract}` : ''
  if (lang === 'en') {
    return [
      `[Stage expert] The next step is ${role.description.toLowerCase()} work — continue as the "${role.name}" role.`,
      role.personaPrompt,
      contract,
      'Apply this role to the current step only. Keep the scene safety boundary, keep files owned by other steps untouched, and do not restate the role in the reply.',
    ].filter(Boolean).join('\n')
  }
  return [
    `【阶段专家】接下来的工作属于「${role.description}」，请以「${role.nameZh}」的方法推进这一段。`,
    role.personaPrompt,
    contract,
    '本条仅作用于当前阶段：场景边界与前述约定继续有效，不要修改其他步骤负责的文件，也不必在回复里复述这个角色。',
  ].filter(Boolean).join('\n')
}

/**
 * 工具失败反思反馈（代码开发场景编程能力增强）
 *
 * 背景：编辑 / 命令类工具失败时，裸错误文本只告诉模型「失败了」，
 * 模型常用同一策略反复重试。本模块按失败类型附加结构化反思引导，
 * 引导模型换策略而不是原样重试。
 *
 * 触发条件：
 * - 当前场景为代码开发（dev）且 failureReflection 开关开启；
 * - 工具属于高频失败集（edit_file / run_command / search_files）且执行失败。
 *
 * 文案约束：单条反思不超过 200 字符，避免污染上下文。
 */

import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { getCodingEnhancements } from '../capabilities/sceneMode/SceneModeDescriptor'

/** 高频失败工具集 */
const REFLECT_TOOLS: ReadonlySet<string> = new Set(['edit_file', 'run_command', 'search_files'])

/** 单条反思文案长度上限（字符） */
const MAX_HINT_LENGTH = 200

type ReflectionRule = {
  /** 工具名限定（未指定则对该工具集内全部生效） */
  tool?: string
  /** 错误文本命中（不区分大小写）才生效；未指定则作为该工具的兜底规则 */
  match?: RegExp
  hint: string
}

/**
 * 失败类型 → 反思引导映射表。
 * 按声明顺序匹配，先命中先用；每个工具的末位是无 match 的兜底规则。
 */
const REFLECTION_RULES: ReflectionRule[] = [
  {
    tool: 'edit_file',
    match: /old_string|not found|no match|找不到|未找到/i,
    hint: 'Reflection: the old_string did not match the file exactly. Re-read the file with read_file and copy the exact text (including whitespace), or switch to line mode (start_line/end_line) instead of retrying the same string.',
  },
  {
    tool: 'edit_file',
    match: /validation|invalid|missing|参数/i,
    hint: 'Reflection: the edit arguments failed validation. Check the required parameters (path / old_string / new_string) and the missing-path hint in the error before retrying.',
  },
  {
    tool: 'run_command',
    match: /command not found|enoent|not recognized|not found/i,
    hint: 'Reflection: the command or dependency appears missing. Verify the binary exists (which/where), or find the correct command instead of retrying verbatim.',
  },
  {
    tool: 'run_command',
    match: /permission|eacces|eperm|denied/i,
    hint: 'Reflection: this is a permission error. Do not escalate privileges; ask the user to run it manually or adjust the target location.',
  },
  {
    tool: 'run_command',
    hint: 'Reflection: distinguish environment errors (missing binary, wrong cwd) from command errors (bad arguments). Narrow the scope or fix the root cause instead of rerunning unchanged.',
  },
  {
    tool: 'search_files',
    match: /no (results|matches)|no files|无结果/i,
    hint: 'Reflection: no matches found. Try a different keyword or pattern, or use codebase_search for a semantic (meaning-based) query.',
  },
]

/**
 * 为失败的工具调用生成反思引导文本。
 *
 * @returns 附加到错误结果后的文本；不触发反思时返回 null
 */
export function buildFailureReflection(
  toolName: string,
  errorText: string | undefined | null,
): string | null {
  const { activeProfile } = useSceneModeStore.getState()
  const { failureReflection } = getCodingEnhancements(activeProfile)
  if (!failureReflection) return null
  if (!REFLECT_TOOLS.has(toolName)) return null

  const error = (errorText || '').toLowerCase()
  const rule = REFLECTION_RULES.find(
    (r) => r.tool === toolName && (!r.match || r.match.test(error)),
  )
  if (!rule) return null
  return rule.hint.slice(0, MAX_HINT_LENGTH)
}

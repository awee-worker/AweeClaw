/**
 * 工具入参归一化
 *
 * 模型偶尔会把路径参数写成别名（file_path / filePath / dir / directory），
 * 或写成空串、空数组。工具声明的参数名只有一种且多为必填，这类调用会直接卡在
 * 参数校验上并报「缺少路径」——AI 侧表现为把同一个错误反复重试
 * （例如 read_file 传 file_path，而该工具声明的是 path）。
 *
 * 这里在校验与执行之前把路径类别名归一到工具声明的那个参数名，
 * 并在路径确实为空时给出可操作的提示，让模型能自行纠正，而不是重复失败。
 */

import { getToolMetadata } from '@configuration/toolDefinitions'
import { PATH_ARG_KEYS, PATH_LIST_ARG_KEYS } from '@shared/toolkit/pathHelper'

/** 单值路径参数名候选，顺序即优先级（与工具卡片的路径展示同源） */
const PATH_PARAM_ALIASES = PATH_ARG_KEYS

/** 多值路径参数名候选 */
const PATH_LIST_ALIASES = PATH_LIST_ARG_KEYS

/** 路径值是否可用：非空字符串，或含至少一个非空字符串的数组 */
function hasUsablePathValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) {
    return value.some(item => typeof item === 'string' && item.trim().length > 0)
  }
  return false
}

/** 工具声明的路径类参数名；未声明路径参数时返回 null */
export function resolveDeclaredPathParam(toolName: string): string | null {
  const params = getToolMetadata(toolName)?.parameters
  if (!params) return null
  return Object.keys(params).find(key => PATH_PARAM_ALIASES.includes(key)) ?? null
}

/**
 * 把路径类别名归一到工具声明的参数名
 *
 * 只在声明参数缺失或为空时填充，不覆盖调用方已给出的有效值；
 * 未声明路径参数的工具原样返回。
 */
export function normalizeToolPathArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const input = args ?? {}
  const declared = resolveDeclaredPathParam(toolName)
  if (!declared) return input
  if (hasUsablePathValue(input[declared])) return input

  for (const alias of [...PATH_PARAM_ALIASES, ...PATH_LIST_ALIASES]) {
    if (alias === declared) continue
    if (hasUsablePathValue(input[alias])) {
      return { ...input, [declared]: input[alias] }
    }
  }

  return input
}

/**
 * 路径参数为空时的提示（附在校验错误之后）
 *
 * 说明工具真正期望的参数名与写法：模型据此能一次改对，
 * 用户也能从卡片上看出问题是「少传了路径」而不是工具不可用。
 */
export function buildMissingPathHint(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  const declared = resolveDeclaredPathParam(toolName)
  if (!declared) return ''

  const params = getToolMetadata(toolName)?.parameters ?? {}
  const pathParams = Object.keys(params).filter(key => PATH_PARAM_ALIASES.includes(key))

  const input = args ?? {}
  // 已给出有效路径说明问题不在路径上，不追加提示
  if (pathParams.some(key => hasUsablePathValue(input[key]))) return ''

  const example = params[declared]?.type === 'array'
    ? `${declared}=["src/a.ts", "src/b.ts"]`
    : `${declared}="src/main.ts"`

  const synonyms = pathParams.filter(key => key !== declared)
  const synonymHint = synonyms.length > 0
    ? ` (this tool does not accept ${synonyms.map(name => `"${name}"`).join(' / ')})`
    : ''

  return `\nMissing path argument: this tool expects "${declared}"${synonymHint}, e.g. ${example}.`
}

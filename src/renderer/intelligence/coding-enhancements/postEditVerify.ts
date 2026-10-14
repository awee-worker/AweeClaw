/**
 * 编辑后强制验证（代码开发场景编程能力增强）
 *
 * 背景：dev 场景人设与系统提示词都要求「改完必须验证」，但那是提示词软约束，
 * 模型跳过 get_lint_errors 没有兜底。本模块在编辑 / 写入类工具执行成功后
 * 自动取一次语言服务诊断，把结果直接附加到工具结果文本中回灌给模型，
 * 形成「编辑 → 验证 → 修复」的硬闭环，不再依赖模型自觉。
 *
 * 触发条件（三者同时满足）：
 * - 当前场景为代码开发（dev）且 postEditVerify 开关开启；
 * - 工具属于编辑 / 写入类（edit_file / write_file / create_file_or_folder）且执行成功；
 * - 目标文件扩展名参与验证（JSON 参与，Markdown 等纯文档不参与）。
 *
 * 失败策略：验证本身绝不阻塞编辑 —— lint 抛错、超时、LSP 未安装都直接透传
 * 原始结果（返回 null），编辑成功的结论不受影响。
 */

import { logger } from '@toolkit/LogEngine'
import { lintService } from '@intelligence/runtime/codeAnalysisService'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { getCodingEnhancements } from '../capabilities/sceneMode/SceneModeDescriptor'

/** 触发验证的编辑 / 写入类工具 */
const EDIT_TOOLS: ReadonlySet<string> = new Set([
  'edit_file',
  'write_file',
  'create_file_or_folder',
])

/** 参与 lint 的扩展名（全小写，含点）：代码与配置文件，Markdown 等纯文档不参与 */
const VERIFY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte',
  '.css', '.scss', '.less',
  '.json', '.py',
])

/** 验证整体超时：超过后放弃附加诊断，透传原始编辑结果 */
const VERIFY_TIMEOUT_MS = 3_000

/** 判断工具是否属于编辑 / 写入类（是否触发验证的第一道条件） */
export function isPostEditVerifyTool(toolName: string): boolean {
  return EDIT_TOOLS.has(toolName)
}

/** 从工具参数中提取目标文件路径（兼容 path / filePath 两种参数名） */
function extractVerifyPath(args: Record<string, unknown> | undefined | null): string | null {
  if (!args) return null
  const path = args.path ?? args.filePath
  return typeof path === 'string' && path.trim() ? path.trim() : null
}

function hasVerifyExtension(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return VERIFY_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** 诊断结果 → 附加到工具结果的文本（面向模型，英文，紧凑单段） */
function formatVerification(filePath: string, errors: Array<{ severity: string; message: string; startLine: number }>): string {
  if (errors.length === 0) {
    return `\n\n[Verification] ${filePath}: no lint issues.`
  }
  const errorCount = errors.filter((e) => e.severity === 'error').length
  const warningCount = errors.length - errorCount
  const summary = errorCount > 0
    ? `${errorCount} error${errorCount > 1 ? 's' : ''}${warningCount > 0 ? `, ${warningCount} warning${warningCount > 1 ? 's' : ''}` : ''} introduced by this edit — fix them before continuing.`
    : `${warningCount} warning${warningCount > 1 ? 's' : ''} (no errors).`
  const details = errors
    .slice(0, 10)
    .map((e) => `[${e.severity}] ${e.message} (Line ${e.startLine})`)
    .join('\n')
  return `\n\n[Verification] ${filePath}: ${summary}\n${details}`
}

/** 带超时的诊断获取：超时返回 null，不让验证拖慢编辑响应 */
async function getDiagnosticsWithTimeout(filePath: string): Promise<Awaited<ReturnType<typeof lintService.getLintErrors>> | null> {
  try {
    return await Promise.race([
      lintService.getLintErrors(filePath),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), VERIFY_TIMEOUT_MS)),
    ])
  } catch (error) {
    logger.agent.warn('[PostEditVerify] lint failed, skipping verification:', error)
    return null
  }
}

/**
 * 编辑 / 写入类工具执行成功后的验证入口。
 *
 * @returns 附加到工具结果文本后的验证说明；不触发验证时返回 null
 */
export async function verifyEditedFile(
  toolName: string,
  args: Record<string, unknown> | undefined | null,
  workspacePath?: string | null,
): Promise<string | null> {
  if (!isPostEditVerifyTool(toolName)) return null

  const { activeProfile } = useSceneModeStore.getState()
  const { postEditVerify } = getCodingEnhancements(activeProfile)
  if (!postEditVerify) return null

  const rawPath = extractVerifyPath(args)
  if (!rawPath || !hasVerifyExtension(rawPath)) return null

  // 绝对路径直接用；相对路径按工作区解析（与编辑工具的解析规则一致）
  const filePath = /^([A-Za-z]:[\\/]|\/)/.test(rawPath)
    ? rawPath
    : workspacePath
      ? `${workspacePath.replace(/[/\\]+$/, '')}/${rawPath.replace(/^[/\\]+/, '')}`
      : rawPath

  const result = await getDiagnosticsWithTimeout(filePath)
  if (!result) return null
  // LSP 未安装：不打扰（编辑本身已成功，装不装语言服务是环境问题）
  if (result.notInstalled) return null

  return formatVerification(filePath, result.errors)
}

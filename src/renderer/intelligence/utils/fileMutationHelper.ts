import { getToolMetadata } from '@configuration/toolDefinitions'
import { toRelativePath } from '@shared/toolkit/pathHelper'
import type { ChangeType, FileChangeDescriptor } from '../types/fileMutation'

export interface FileChangeMetaLike {
  filePath: string
  relativePath?: unknown
  postHash?: unknown
  newContent?: unknown
  oldContent?: unknown
  linesAdded?: unknown
  linesRemoved?: unknown
}

export function isFileWriteToolResult(toolName: string, meta: unknown): meta is FileChangeMetaLike {
  if (!meta || typeof meta !== 'object') return false

  // 内置工具通过 resultSemantics === 'file-write' 判定
  const tool = getToolMetadata(toolName)
  if (tool?.resultSemantics === 'file-write') {
    return typeof (meta as { filePath?: unknown }).filePath === 'string'
  }

  // 场景开发助手的文件写入工具不在 TOOL_CONFIGS 中，
  // 通过工具名硬编码识别，确保 addPendingChange 被调用（变更面板有条目）
  if (FILE_WRITE_SCENARIO_TOOLS.includes(toolName)) {
    return typeof (meta as { filePath?: unknown }).filePath === 'string'
  }

  return false
}

/**
 * 场景模块中产生文件变更的工具名列表
 *
 * 这些工具不通过 TOOL_CONFIGS 注册，无法用 resultSemantics 判定，
 * 需在此显式列出以触发 addPendingChange 流程。
 */
const FILE_WRITE_SCENARIO_TOOLS = [
  'write_scenario_file',
]

export function resolveRelativeChangePath(
  filePath: string,
  workspacePath: string | null,
  explicitRelativePath?: unknown
): string {
  if (typeof explicitRelativePath === 'string' && explicitRelativePath.trim().length > 0) {
    return explicitRelativePath
  }

  return toRelativePath(filePath, workspacePath)
}

export function buildFileChangeDescriptor(input: {
  filePath: string
  workspacePath?: string | null
  relativePath?: unknown
  oldContent: string | null
  newContent: string | null
  changeType: ChangeType
  linesAdded: number
  linesRemoved: number
  isLargeWrite?: boolean
  contentTruncated?: boolean
  oldContentLength?: number
  newContentLength?: number
  toolCallId?: string
}): FileChangeDescriptor {
  return {
    filePath: input.filePath,
    relativePath: resolveRelativeChangePath(input.filePath, input.workspacePath ?? null, input.relativePath),
    oldContent: input.oldContent,
    newContent: input.newContent,
    changeType: input.changeType,
    linesAdded: input.linesAdded,
    linesRemoved: input.linesRemoved,
    isLargeWrite: input.isLargeWrite,
    contentTruncated: input.contentTruncated,
    oldContentLength: input.oldContentLength,
    newContentLength: input.newContentLength,
    toolCallId: input.toolCallId,
  }
}

/**
 * 工具调用卡片共享辅助函数
 * 提供参数提取、路径处理、语言推断等纯函数
 */
import { getExtension, getFileName } from '@shared/toolkit/pathHelper'
import type { Language } from '@renderer/i18n'

/** 工具参数类型 */
export type ToolArgs = Record<string, unknown>

/** 工具名到国际化键的映射表 */
export const TOOL_LABEL_KEYS: Record<string, string> = {
  read_file: 'tool.label.read_file',
  read_multiple_files: 'tool.label.read_multiple_files',
  list_directory: 'tool.label.list_directory',
  search_files: 'tool.label.search_files',
  codebase_search: 'tool.label.codebase_search',
  edit_file: 'tool.label.edit_file',
  write_file: 'tool.label.write_file',
  create_file: 'tool.label.create_file',
  create_file_or_folder: 'tool.label.create_file_or_folder',
  delete_file_or_folder: 'tool.label.delete_file_or_folder',
  run_command: 'tool.label.run_command',
  get_lint_errors: 'tool.label.get_lint_errors',
  find_references: 'tool.label.find_references',
  go_to_definition: 'tool.label.go_to_definition',
  get_hover_info: 'tool.label.get_hover_info',
  get_document_symbols: 'tool.label.get_document_symbols',
  web_search: 'tool.label.web_search',
  read_url: 'tool.label.read_url',
  ask_user: 'tool.label.ask_user',
  remember: 'tool.label.remember',
  uiux_search: 'tool.label.uiux_search',
  uiux_recommend: 'tool.label.uiux_recommend',
  apply_skill: 'tool.label.apply_skill',
  todo_write: 'tool.label.todo_write',
  desktop_list_apps: 'tool.label.desktop_list_apps',
  desktop_launch_app: 'tool.label.desktop_launch_app',
  desktop_quit_app: 'tool.label.desktop_quit_app',
  desktop_list_windows: 'tool.label.desktop_list_windows',
  desktop_focus_window: 'tool.label.desktop_focus_window',
  desktop_close_window: 'tool.label.desktop_close_window',
  desktop_capture_screen: 'tool.label.desktop_capture_screen',
  desktop_mouse_click: 'tool.label.desktop_mouse_click',
  desktop_mouse_move: 'tool.label.desktop_mouse_move',
  desktop_mouse_scroll: 'tool.label.desktop_mouse_scroll',
  desktop_type_text: 'tool.label.desktop_type_text',
  desktop_press_key: 'tool.label.desktop_press_key',
  desktop_key_combo: 'tool.label.desktop_key_combo',
  desktop_emergency_stop: 'tool.label.desktop_emergency_stop',
  desktop_record_action: 'tool.label.desktop_record_action',
  desktop_recording_start: 'tool.label.desktop_recording_start',
  desktop_recording_stop: 'tool.label.desktop_recording_stop',
  desktop_replay_recording: 'tool.label.desktop_replay_recording',
  desktop_list_recordings: 'tool.label.desktop_list_recordings',
  desktop_visual_agent_step: 'tool.label.desktop_visual_agent_step',
  desktop_workflow_run: 'tool.label.desktop_workflow_run',
  desktop_workflow_list: 'tool.label.desktop_workflow_list',
}

/** 扩展名到语言标识的映射表 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
}

/** 根据文件名推断语言标识 */
export function guessLanguage(filename: string): string {
  const ext = getExtension(filename)
  return EXTENSION_LANGUAGE_MAP[ext || ''] || 'typescript'
}

/** 安全转换为字符串 */
export const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 安全转换为字符串数组 */
export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** 从未知值提取路径列表 */
export const getPathList = (value: unknown): string[] => {
  if (typeof value === 'string') return value ? [value] : []
  return asStringArray(value).filter(Boolean)
}

/** 从工具参数中提取所有路径 */
export function getToolPathList(args: ToolArgs): string[] {
  const directPaths = getPathList(args.path)
  if (directPaths.length > 0) return directPaths
  const pluralPaths = getPathList(args.paths)
  if (pluralPaths.length > 0) return pluralPaths
  return []
}

/** 获取主路径 */
export const getPrimaryToolPath = (args: ToolArgs): string => getToolPathList(args)[0] || ''

/** 获取路径的显示名 */
export const getPathDisplayName = (path: string): string => getFileName(path) || path

/** 生成路径摘要文本 */
export function getPathSummary(paths: string[], maxItems = 3): string {
  if (paths.length === 0) return ''
  if (paths.length === 1) return getPathDisplayName(paths[0])
  const preview = paths
    .slice(0, maxItems)
    .map((path) => `"${getPathDisplayName(path)}"`)
    .join(', ')
  return `${paths.length} files (${preview}${paths.length > maxItems ? ', ...' : ''})`
}

/** 从工具返回结果中解析数量 */
export function parseResultCount(result: string | undefined, key: string): string {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result)
    const arr = parsed?.[key]
    if (Array.isArray(arr)) return String(arr.length)
  } catch {
    const match = result.match(/Found\s+(\d+)\s+/i)
    if (match) return match[1]
  }
  return ''
}

/** 截取预览文本 */
export function previewSlice(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export type { Language }

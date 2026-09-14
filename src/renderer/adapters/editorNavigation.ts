/**
 * 编辑器代码导航服务
 *
 * 统一收敛「代码定位跳转」与「导航历史栈」两件事：
 *  - 导航历史栈：记录用户主动发起的代码跳转（转到定义、引用面板、符号面包屑、多定义 Quick Pick），
 *    支持前进 / 后退（Alt+← / Alt+→、鼠标侧键、编辑器导航栏按钮）。
 *  - 定位跳转：同文件直接移动光标；跨文件复用 editorNavigator 的挂起导航 + safeOpenFile。
 *  - 行预览：为「引用结果面板 / 多定义 Quick Pick」提供带缓存的目标行文本。
 */

import type { editor } from 'monaco-editor'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import { lspUriToPath } from '@shared/toolkit/uriHelper'
import { safeOpenFile } from '@utils/fileUtils'
import { api } from './electronBridge'
import { setPendingNavigation } from './editorNavigator'

/** 代码位置（line / column 均为 1-based，与 Monaco 一致） */
export interface CodeLocation {
  filePath: string
  line: number
  column: number
}

/** 多定义候选项（一个符号对应多个定义时，由 Quick Pick 展示供用户选择） */
export interface DefinitionCandidate {
  uri: string
  filePath: string
  /** 1-based */
  line: number
  /** 1-based */
  column: number
  /** 主标题（文件名:行号） */
  label: string
  /** 副标题（相对路径） */
  detail: string
}

/** 多定义 Quick Pick：跳转方 dispatch 该事件，编辑器宿主监听并渲染选择弹窗 */
export const DEFINITION_PICKER_EVENT = 'editor:definition-picker'

export interface DefinitionPickerRequest {
  items: DefinitionCandidate[]
  /** 光标屏幕坐标（client 坐标） */
  position: { x: number; y: number }
}

/** 历史栈最大长度（与 VS Code 同量级，超出丢弃最旧记录） */
const MAX_HISTORY_ENTRIES = 80
/** 行预览缓存：最多文件数 / 过期时间 */
const PREVIEW_CACHE_LIMIT = 32
const PREVIEW_CACHE_TTL_MS = 20_000
/** 超过该体积的文件不缓存内容（避免内存膨胀），仍按需读取一次 */
const PREVIEW_MAX_CONTENT_LENGTH = 4 * 1024 * 1024

export function normalizeFilePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/([A-Za-z]):/, '$1:').toLowerCase()
}

function toFilePathFromUri(uri: string): string {
  return uri.startsWith('file:') || uri.startsWith('untitled:') ? lspUriToPath(uri) : uri
}

/** LSP 位置（0-based）→ CodeLocation（1-based） */
export function lspLocationToCodeLocation(uri: string, range: { start: { line: number; character: number } }): CodeLocation {
  return {
    filePath: toFilePathFromUri(uri),
    line: range.start.line + 1,
    column: range.start.character + 1,
  }
}

function isSameLocation(a: CodeLocation, b: CodeLocation): boolean {
  return a.line === b.line && a.column === b.column && normalizeFilePath(a.filePath) === normalizeFilePath(b.filePath)
}

/* ===================== 活跃编辑器实例 ===================== */

let activeEditorInstance: editor.IStandaloneCodeEditor | null = null

/** 编辑器挂载 / 切换文件时登记当前实例（供历史导航、引用面板跨组件跳转使用） */
export function setActiveEditorInstance(instance: editor.IStandaloneCodeEditor | null): void {
  activeEditorInstance = instance
}

/** 卸载编辑器：仅当传入实例就是当前实例时才清理，避免误清后继实例 */
export function clearActiveEditorInstance(instance?: editor.IStandaloneCodeEditor | null): void {
  if (!instance || activeEditorInstance === instance) {
    activeEditorInstance = null
  }
}

export function getActiveEditorInstance(): editor.IStandaloneCodeEditor | null {
  return activeEditorInstance
}

/* ===================== 导航历史栈 ===================== */

let entries: CodeLocation[] = []
let cursorIndex = -1
/** 前进 / 后退触发的跳转不写入历史，仅移动指针 */
let suppressRecording = false
const listeners = new Set<() => void>()

export interface NavigationHistoryState {
  entries: CodeLocation[]
  index: number
  canGoBack: boolean
  canGoForward: boolean
}

function notifyHistoryChanged(): void {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch (error) {
      logger.system.warn('[EditorNavigation] 历史监听回调异常', error)
    }
  })
}

export function getNavigationHistoryState(): NavigationHistoryState {
  return {
    entries,
    index: cursorIndex,
    canGoBack: cursorIndex > 0,
    canGoForward: cursorIndex >= 0 && cursorIndex < entries.length - 1,
  }
}

export function subscribeNavigationHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearNavigationHistory(): void {
  entries = []
  cursorIndex = -1
  notifyHistoryChanged()
}

function pushEntry(location: CodeLocation): void {
  const current = entries[cursorIndex]
  if (current && isSameLocation(current, location)) return

  // 在当前位置之后发生新跳转 → 截断「前进」分支
  entries = entries.slice(0, cursorIndex + 1)
  entries.push(location)
  if (entries.length > MAX_HISTORY_ENTRIES) {
    entries = entries.slice(entries.length - MAX_HISTORY_ENTRIES)
  }
  cursorIndex = entries.length - 1
  notifyHistoryChanged()
}

/** 当前编辑器光标位置（无编辑器实例时回退到 store 记录的光标） */
export function getCurrentLocation(): CodeLocation | null {
  const { activeFilePath, cursorPosition } = useStore.getState()
  if (!activeFilePath) return null

  const instance = activeEditorInstance
  if (instance) {
    const model = instance.getModel()
    const position = instance.getPosition()
    if (model && position && normalizeFilePath(toFilePathFromUri(model.uri.toString())) === normalizeFilePath(activeFilePath)) {
      return { filePath: activeFilePath, line: position.lineNumber, column: position.column }
    }
  }

  return {
    filePath: activeFilePath,
    line: cursorPosition?.line ?? 1,
    column: cursorPosition?.column ?? 1,
  }
}

/* ===================== 定位跳转 ===================== */

function moveCursor(location: CodeLocation, focus: boolean): boolean {
  const instance = activeEditorInstance
  if (!instance) return false

  const model = instance.getModel()
  if (!model || normalizeFilePath(toFilePathFromUri(model.uri.toString())) !== normalizeFilePath(location.filePath)) {
    return false
  }

  const lineNumber = Math.min(Math.max(1, location.line), model.getLineCount())
  const column = Math.min(Math.max(1, location.column), model.getLineMaxColumn(lineNumber))
  const position = { lineNumber, column }

  instance.setPosition(position)
  instance.revealPositionInCenterIfOutsideViewport(position)
  if (focus) instance.focus()
  return true
}

export interface RevealOptions {
  /** 是否写入导航历史（前进/后退时为 false） */
  record?: boolean
  /** 跳转后是否聚焦编辑器 */
  focus?: boolean
}

/**
 * 跳转到指定代码位置。
 * 同文件直接移动光标；跨文件走挂起导航 + 安全打开流程。
 */
export async function revealLocation(location: CodeLocation, options: RevealOptions = {}): Promise<boolean> {
  const { record = true, focus = true } = options

  if (record && !suppressRecording) {
    const current = getCurrentLocation()
    if (current && !isSameLocation(current, location)) {
      pushEntry(current)
    }
    pushEntry(location)
  }

  const state = useStore.getState()
  const isSameFile = !!state.activeFilePath
    && normalizeFilePath(state.activeFilePath) === normalizeFilePath(location.filePath)

  if (isSameFile) {
    moveCursor(location, focus)
    state.setCursorPosition({ line: location.line, column: location.column })
    return true
  }

  setPendingNavigation({ filePath: location.filePath, line: location.line, col: location.column })
  const result = await safeOpenFile(location.filePath, { showWarning: false, confirmLargeFile: false })
  if (!result.success) {
    // 目标不可打开（stdlib、工作区外、超大文件）→ 清除挂起导航，静默失败
    setPendingNavigation({ filePath: '', line: 0, col: 0 })
    logger.system.info('[EditorNavigation] 跳转目标不可打开', location.filePath)
    return false
  }
  return true
}

/** 后退到上一个导航位置 */
export async function goBack(): Promise<boolean> {
  if (cursorIndex <= 0) return false
  cursorIndex -= 1
  const target = entries[cursorIndex]
  suppressRecording = true
  try {
    await revealLocation(target, { record: false })
  } finally {
    suppressRecording = false
    notifyHistoryChanged()
  }
  return true
}

/** 前进到下一个导航位置 */
export async function goForward(): Promise<boolean> {
  if (cursorIndex < 0 || cursorIndex >= entries.length - 1) return false
  cursorIndex += 1
  const target = entries[cursorIndex]
  suppressRecording = true
  try {
    await revealLocation(target, { record: false })
  } finally {
    suppressRecording = false
    notifyHistoryChanged()
  }
  return true
}

/* ===================== 行预览（带缓存） ===================== */

const contentCache = new Map<string, { content: string | null; ts: number }>()

function readCache(key: string): { content: string | null; ts: number } | undefined {
  const hit = contentCache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.ts > PREVIEW_CACHE_TTL_MS) {
    contentCache.delete(key)
    return undefined
  }
  return hit
}

function writeCache(key: string, content: string | null): void {
  if (contentCache.size >= PREVIEW_CACHE_LIMIT) {
    const oldest = contentCache.keys().next().value
    if (oldest) contentCache.delete(oldest)
  }
  contentCache.set(key, { content, ts: Date.now() })
}

/** 读取整份文件内容（带 TTL 缓存），供预览提取使用 */
export async function readFileContentForPreview(filePath: string): Promise<string | null> {
  const key = normalizeFilePath(filePath)
  const cached = readCache(key)
  if (cached) return cached.content

  try {
    const content = await api.file.read(filePath)
    if (content === null) {
      writeCache(key, null)
      return null
    }
    if (content.length > PREVIEW_MAX_CONTENT_LENGTH) return null
    writeCache(key, content)
    return content
  } catch (error) {
    logger.system.warn('[EditorNavigation] 读取预览内容失败', filePath, error)
    writeCache(key, null)
    return null
  }
}

/** 读取指定行原文（1-based），失败返回 null */
export async function readLinePreview(filePath: string, line: number): Promise<string | null> {
  const content = await readFileContentForPreview(filePath)
  if (content === null) return null
  const lines = content.split(/\r?\n/)
  const text = lines[line - 1]
  return typeof text === 'string' ? text : null
}

/** 文件内容变更后失效预览缓存 */
export function invalidatePreviewCache(filePath?: string): void {
  if (filePath) contentCache.delete(normalizeFilePath(filePath))
  else contentCache.clear()
}

/**
 * 引用结果仓库
 *
 * 承载「查找引用（Find All References）」结果，供引用结果面板（Dock Tab）渲染：
 *  - 统一归一化 LSP Location / LocationLink 两种返回结构
 *  - 同一位置的重复引用去重
 *  - 异步补齐每处引用的行预览文本（不阻塞面板打开）
 */

import { create } from 'zustand'
import { getFileName, getDirname } from '@shared/toolkit/pathHelper'
import { logger } from '@toolkit/LogEngine'
import { lspUriToPath } from '@shared/toolkit/uriHelper'
import { findReferences as lspFindReferences } from './languageServerAdapter'
import { readFileContentForPreview, normalizeFilePath } from './editorNavigation'

export interface ReferenceItem {
  id: string
  uri: string
  filePath: string
  fileName: string
  dirPath: string
  /** 1-based */
  line: number
  /** 1-based */
  column: number
  /** 1-based，匹配区间结束列 */
  endColumn: number
  preview: string | null
}

export interface ReferencesQuery {
  filePath: string
  /** 0-based（LSP 坐标） */
  line: number
  character: number
  symbol: string
}

/** 单次查询最多读取预览的文件数，避免大结果集造成 IO 抖动 */
const MAX_PREVIEW_FILES = 40

function toFilePath(uri: string): string {
  return uri.startsWith('file:') || uri.startsWith('untitled:') ? lspUriToPath(uri) : uri
}

interface NormalizedLocation {
  uri: string
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}

function normalizeLocation(raw: unknown): NormalizedLocation | null {
  if (!raw || typeof raw !== 'object') return null
  const location = raw as {
    uri?: string
    range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
    targetUri?: string
    targetSelectionRange?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
    targetRange?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
  }

  const uri = typeof location.uri === 'string' ? location.uri : location.targetUri
  const range = location.range ?? location.targetSelectionRange ?? location.targetRange
  if (typeof uri !== 'string' || !range?.start) return null

  const startLine = range.start.line ?? 0
  const startCharacter = range.start.character ?? 0
  return {
    uri,
    startLine,
    startCharacter,
    endLine: range.end?.line ?? startLine,
    endCharacter: range.end?.character ?? startCharacter,
  }
}

function buildItem(location: NormalizedLocation): ReferenceItem {
  const filePath = toFilePath(location.uri)
  return {
    id: `${location.uri}:${location.startLine}:${location.startCharacter}`,
    uri: location.uri,
    filePath,
    fileName: getFileName(filePath) || filePath,
    dirPath: getDirname(filePath) || '',
    line: location.startLine + 1,
    column: location.startCharacter + 1,
    endColumn: location.endCharacter + 1,
    preview: null,
  }
}

interface ReferencesState {
  /** 正在查询 */
  loading: boolean
  /** 查询失败信息 */
  error: string | null
  /** 查询符号名（面板标题） */
  symbol: string
  /** 最近一次查询条件，供刷新复用 */
  query: ReferencesQuery | null
  /** 引用列表 */
  items: ReferenceItem[]
  /** 结果版本号（每次查询自增，用于丢弃过期异步结果） */
  version: number
  findReferencesAt: (filePath: string, line: number, character: number, symbol?: string) => Promise<void>
  refresh: () => Promise<void>
  clear: () => void
}

export const useReferencesStore = create<ReferencesState>((set, get) => ({
  loading: false,
  error: null,
  symbol: '',
  query: null,
  items: [],
  version: 0,

  async findReferencesAt(filePath, line, character, symbol) {
    const version = get().version + 1
    set({
      loading: true,
      error: null,
      symbol: symbol ?? '',
      query: { filePath, line, character, symbol: symbol ?? '' },
      items: [],
      version,
    })

    try {
      const raw = await lspFindReferences(filePath, line, character)
      if (get().version !== version) return

      const seen = new Set<string>()
      const items: ReferenceItem[] = []
      for (const entry of Array.isArray(raw) ? raw : []) {
        const normalized = normalizeLocation(entry)
        if (!normalized) continue
        const item = buildItem(normalized)
        if (seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
      }

      items.sort((a, b) => {
        const byFile = normalizeFilePath(a.filePath).localeCompare(normalizeFilePath(b.filePath))
        return byFile !== 0 ? byFile : a.line - b.line || a.column - b.column
      })

      set({ items, loading: false })
      void hydratePreviews(version)
    } catch (error) {
      if (get().version !== version) return
      logger.lsp.error('[References] 查找引用失败', error)
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  async refresh() {
    const { query } = get()
    if (!query) return
    await get().findReferencesAt(query.filePath, query.line, query.character, query.symbol)
  },

  clear() {
    set({ items: [], error: null, loading: false, symbol: '', query: null, version: get().version + 1 })
  },
}))

/** 异步补齐行预览：按文件去重读取（每个文件只读一次），读到即刷新面板 */
async function hydratePreviews(version: number): Promise<void> {
  const items = useReferencesStore.getState().items
  if (items.length === 0) return

  const filePaths = Array.from(new Set(items.map((item) => item.filePath))).slice(0, MAX_PREVIEW_FILES)
  const lineMap = new Map<string, string[]>()

  await Promise.all(filePaths.map(async (filePath) => {
    const content = await readFileContentForPreview(filePath)
    lineMap.set(filePath, content === null ? [] : content.split(/\r?\n/))
  }))

  if (useReferencesStore.getState().version !== version) return

  const state = useReferencesStore.getState()
  useReferencesStore.setState({
    items: state.items.map((item) => {
      const lines = lineMap.get(item.filePath)
      if (lines === undefined) return item
      const text = lines[item.line - 1]
      return { ...item, preview: typeof text === 'string' ? text : null }
    }),
  })
}

/**
 * 文件系统状态切片
 *
 * 管理工作区配置、文件树、已打开文件标签页与 LRU 淘汰策略。
 */

import { StateCreator } from 'zustand'
import type { FileItem } from '@protocols'
import type { OpenPreviewMetadata } from '@shared/protocols/previewProtocol'
import { buildPreviewDocumentPath } from '@shared/protocols/previewProtocol'
import { normalizePath } from '@shared/toolkit/pathHelper'

/** 同时保留内容的最大文件数 */
const MAX_OPEN_FILES_WITH_CONTENT = 30

/** Diff 协议前缀 */
const DIFF_PREFIX = 'diff://'

/* ------------------------------------------------------------------ */
/* 类型                                                              */
/* ------------------------------------------------------------------ */

/** 工作区配置 */
export interface WorkspaceConfig {
  configPath: string | null
  roots: string[]
  restoreError?: 'missing-workspace'
  missingRoots?: string[]
  workspaceId?: string
}

/** 大文件信息 */
export interface LargeFileInfo {
  isLarge: boolean
  isVeryLarge: boolean
  size: number
  lineCount: number
  path?: string
  reason?: 'size' | 'lines' | 'both'
  warning?: string
}

/** 远程文件绑定 */
export interface RemoteBinding {
  server: {
    host: string
    port?: number
    username?: string
    password?: string
    privateKeyPath?: string
    remotePath?: string
  }
  remotePath: string
}

/** 已打开文件 */
export interface OpenFile {
  path: string
  content: string
  kind?: 'file' | 'diff' | 'preview'
  isDirty: boolean
  originalContent?: string
  savedVersionId?: number
  largeFileInfo?: LargeFileInfo
  encoding?: string
  isDeleted?: boolean
  remote?: RemoteBinding
  lastAccessed?: number
  preview?: OpenPreviewMetadata
  scrollPosition?: unknown
}

/** 打开文件时的可选参数 */
export interface OpenFileOptions {
  largeFileInfo?: LargeFileInfo
  encoding?: string
  remote?: RemoteBinding
  kind?: OpenFile['kind']
  preview?: OpenFile['preview']
}

/** 恢复文件条目 */
export interface RestoreFileEntry {
  path: string
  content: string
  originalContent?: string
  options?: OpenFileOptions
}

/** 切片接口 */
export interface FileSlice {
  workspace: WorkspaceConfig | null
  workspacePath: string | null
  files: FileItem[]
  expandedFolders: Set<string>
  openFiles: OpenFile[]
  activeFilePath: string | null
  selectedFolderPath: string | null
  showWorkspaceSystemDir: boolean

  setWorkspace: (workspace: WorkspaceConfig | null) => void
  addRoot: (path: string) => void
  removeRoot: (path: string) => void
  setFiles: (files: FileItem[]) => void
  toggleFolder: (path: string) => void
  setSelectedFolder: (path: string | null) => void
  expandFolder: (path: string) => void
  setShowWorkspaceSystemDir: (show: boolean) => void
  openFile: (path: string, content: string, originalContent?: string, options?: OpenFileOptions) => void
  openPreview: (preview: OpenPreviewMetadata, options?: { activate?: boolean }) => void
  restoreOpenFiles: (files: RestoreFileEntry[], activeFilePath?: string | null) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  updateFileDirtyState: (path: string, currentVersionId: number) => void
  markFileSaved: (path: string, versionId?: number) => void
  reloadFileFromDisk: (path: string, content: string) => void
  markFileDeleted: (path: string) => void
  markFileRestored: (path: string) => void
  updatePreviewMetadata: (path: string, preview: Partial<OpenPreviewMetadata>) => void
  setFileScrollPosition: (path: string, scrollPosition: { scrollTop: number; scrollLeft: number }) => void
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                          */
/* ------------------------------------------------------------------ */

/** 根据路径推断文件类型 */
function inferKind(path: string, explicit?: OpenFile['kind']): OpenFile['kind'] {
  if (explicit) return explicit
  return path.startsWith(DIFF_PREFIX) ? 'diff' : 'file'
}

/** 在已打开列表中插入或更新文件 */
function upsertOpenFile(openFiles: OpenFile[], nextFile: OpenFile): OpenFile[] {
  const target = normalizePath(nextFile.path)
  const exists = openFiles.some((f) => normalizePath(f.path) === target)
  if (!exists) return [...openFiles, nextFile]

  return openFiles.map((f) =>
    normalizePath(f.path) === target ? { ...f, ...nextFile, lastAccessed: Date.now() } : f,
  )
}

/** 对单个文件应用补丁 */
function patchFile(files: OpenFile[], path: string, patch: Partial<OpenFile>): OpenFile[] {
  return files.map((f) => (f.path === path ? { ...f, ...patch } : f))
}

/** LRU 淘汰：卸载最久未访问的非脏文件内容 */
function applyLruEviction(files: OpenFile[], activePath: string): OpenFile[] {
  if (files.length <= MAX_OPEN_FILES_WITH_CONTENT) return files

  const candidates = files
    .filter((f) => !f.isDirty && f.path !== activePath && f.content.length > 0)
    .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0))

  const evictCount = files.length - MAX_OPEN_FILES_WITH_CONTENT
  const evictPaths = new Set(candidates.slice(0, evictCount).map((f) => f.path))

  return files.map((f) =>
    evictPaths.has(f.path) ? { ...f, content: '', originalContent: undefined } : f,
  )
}

/* ------------------------------------------------------------------ */
/* 切片实现                                                          */
/* ------------------------------------------------------------------ */

export const createFileSlice: StateCreator<FileSlice, [], [], FileSlice> = (set) => ({
  workspace: null,
  workspacePath: null,
  files: [],
  expandedFolders: new Set(),
  openFiles: [],
  activeFilePath: null,
  selectedFolderPath: null,
  showWorkspaceSystemDir: false,

  setWorkspace: (workspace) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders)
      workspace?.roots.forEach((root) => newExpanded.add(root))
      return {
        workspace,
        workspacePath: workspace?.roots[0] || null,
        expandedFolders: newExpanded,
      }
    }),

  addRoot: (path) =>
    set((state) => {
      if (!state.workspace) {
        return { workspace: { configPath: null, roots: [path] }, workspacePath: path }
      }
      if (state.workspace.roots.includes(path)) return {}
      return {
        workspace: { ...state.workspace, roots: [...state.workspace.roots, path] },
      }
    }),

  removeRoot: (path) =>
    set((state) => {
      if (!state.workspace) return {}
      const newRoots = state.workspace.roots.filter((r) => r !== path)
      return {
        workspace: { ...state.workspace, roots: newRoots },
        workspacePath: newRoots[0] || null,
      }
    }),

  setFiles: (files) => set({ files }),
  setSelectedFolder: (path) => set({ selectedFolderPath: path }),
  setShowWorkspaceSystemDir: (show) => set({ showWorkspaceSystemDir: show }),

  expandFolder: (path) =>
    set((state) => {
      const next = new Set(state.expandedFolders)
      next.add(path)
      return { expandedFolders: next }
    }),

  toggleFolder: (path) =>
    set((state) => {
      const next = new Set(state.expandedFolders)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { expandedFolders: next }
    }),

  openFile: (path, content, originalContent, options) =>
    set((state) => {
      const normalizedPath = normalizePath(path)
      const resultFiles = upsertOpenFile(state.openFiles, {
        path: normalizedPath,
        kind: inferKind(normalizedPath, options?.kind),
        content,
        isDirty: false,
        originalContent,
        savedVersionId: 1,
        largeFileInfo: options?.largeFileInfo,
        encoding: options?.encoding,
        remote: options?.remote,
        preview: options?.preview,
        lastAccessed: Date.now(),
      })

      return {
        openFiles: applyLruEviction(resultFiles, normalizedPath),
        activeFilePath: normalizedPath,
      }
    }),

  openPreview: (preview, options) =>
    set((state) => {
      const path = buildPreviewDocumentPath(preview.sessionId)
      const resultFiles = upsertOpenFile(state.openFiles, {
        path,
        kind: 'preview',
        content: '',
        isDirty: false,
        preview,
        lastAccessed: Date.now(),
      })

      return {
        openFiles: resultFiles,
        activeFilePath: options?.activate === false ? state.activeFilePath : path,
      }
    }),

  restoreOpenFiles: (files, activeFilePath) =>
    set(() => {
      const now = Date.now()
      const restoredFiles: OpenFile[] = files.map((file, index) => {
        const normalizedPath = normalizePath(file.path)
        return {
          path: normalizedPath,
          content: file.content,
          kind: inferKind(normalizedPath, file.options?.kind),
          isDirty: false,
          originalContent: file.originalContent,
          savedVersionId: 1,
          largeFileInfo: file.options?.largeFileInfo,
          encoding: file.options?.encoding,
          remote: file.options?.remote,
          preview: file.options?.preview,
          lastAccessed: now + index,
        }
      })

      return {
        openFiles: restoredFiles,
        activeFilePath: activeFilePath
          ? normalizePath(activeFilePath)
          : restoredFiles[restoredFiles.length - 1]?.path || null,
      }
    }),

  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f.path !== path)
      const newActivePath =
        state.activeFilePath === path
          ? newOpenFiles[newOpenFiles.length - 1]?.path || null
          : state.activeFilePath
      return { openFiles: newOpenFiles, activeFilePath: newActivePath }
    }),

  setActiveFile: (path) =>
    set((state) => {
      const normalizedPath = path ? normalizePath(path) : null
      return {
        activeFilePath: normalizedPath,
        openFiles: normalizedPath
          ? patchFile(state.openFiles, normalizedPath, { lastAccessed: Date.now() })
          : state.openFiles,
      }
    }),

  updateFileContent: (path, content) =>
    set((state) => ({ openFiles: patchFile(state.openFiles, path, { content }) })),

  updateFileDirtyState: (path, currentVersionId) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, isDirty: currentVersionId !== f.savedVersionId } : f,
      ),
    })),

  markFileSaved: (path, versionId) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, isDirty: false, savedVersionId: versionId ?? f.savedVersionId }
          : f,
      ),
    })),

  reloadFileFromDisk: (path, content) =>
    set((state) => ({
      openFiles: patchFile(state.openFiles, path, {
        content,
        originalContent: undefined,
        isDirty: false,
        isDeleted: false,
      }),
    })),

  markFileDeleted: (path) =>
    set((state) => ({ openFiles: patchFile(state.openFiles, path, { isDeleted: true }) })),

  markFileRestored: (path) =>
    set((state) => ({ openFiles: patchFile(state.openFiles, path, { isDeleted: false }) })),

  updatePreviewMetadata: (path, preview) =>
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.path === path && file.kind === 'preview' && file.preview
          ? { ...file, preview: { ...file.preview, ...preview }, lastAccessed: Date.now() }
          : file,
      ),
    })),

  setFileScrollPosition: (path, scrollPosition) =>
    set((state) => ({ openFiles: patchFile(state.openFiles, path, { scrollPosition }) })),
})

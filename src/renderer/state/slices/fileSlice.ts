/**
 * 文件系统状态切片
 *
 * 管理工作区配置、文件树、已打开文件标签页与 LRU 淘汰策略。
 */

import { StateCreator } from 'zustand'
import type { FileItem } from '@protocols'
import type { OpenPreviewMetadata } from '@shared/protocols/previewProtocol'
import { buildPreviewDocumentPath } from '@shared/protocols/previewProtocol'
import {
  buildPptPreviewPath,
  type PptPresentationMeta,
  type PptSlideData,
} from '@shared/protocols/pptPreviewProtocol'
import {
  buildOoEditPath,
  type OnlyOfficeEditSessionMeta,
} from '@shared/protocols/onlyOfficeProtocol'
import { normalizePath } from '@shared/toolkit/pathHelper'
import { logger } from '@shared/toolkit/LogEngine'

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
/** 已打开文件 */
export interface OpenFile {
  path: string
  content: string
  kind?: 'file' | 'diff' | 'preview' | 'ppt-preview' | 'oo-edit'
  isDirty: boolean
  originalContent?: string
  savedVersionId?: number
  largeFileInfo?: LargeFileInfo
  encoding?: string
  isDeleted?: boolean
  remote?: RemoteBinding
  lastAccessed?: number
  /**
   * 内容是否因 LRU 淘汰被卸载（content 被清空以释放内存）
   *
   * 为 true 时 content 是空串而不是文件真实内容。重新激活该 Tab 时必须
   * 懒加载回磁盘内容，否则用户会看到「打开后文件没有内容」。
   */
  contentEvicted?: boolean
  preview?: OpenPreviewMetadata
  scrollPosition?: unknown
  /** v2.3：PPT 预览 Tab 专用数据（kind='ppt-preview' 时使用） */
  pptPreview?: {
    meta: PptPresentationMeta
    slides: Map<number, PptSlideData>
  }
  /** v2.4：ONLYOFFICE 在线编辑 Tab 专用数据（kind='oo-edit' 时使用） */
  ooEdit?: OnlyOfficeEditSessionMeta
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
  /**
   * 工具执行时额外允许访问的目录路径列表（除 workspacePath 外）
   * 用于项目执行窗口：当项目目录不在工作区内时，允许 AI 读写项目目录
   */
  allowedToolPaths: string[]

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
  openPptPreview: (meta: PptPresentationMeta, options?: { activate?: boolean }) => void
  openOnlyOfficeEdit: (meta: OnlyOfficeEditSessionMeta, options?: { activate?: boolean }) => void
  pushPptPreviewSlide: (sessionId: string, slide: PptSlideData) => void
  markPptPreviewComplete: (sessionId: string, filePath: string) => void
  restoreOpenFiles: (files: RestoreFileEntry[], activeFilePath?: string | null) => void
  closeFile: (path: string) => void
  /** 批量关闭：一次状态更新删除多个 Tab（关闭全部/关闭其他/关闭右侧） */
  closeFiles: (paths: string[]) => void
  setActiveFile: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  updateFileDirtyState: (path: string, currentVersionId: number) => void
  markFileSaved: (path: string, versionId?: number) => void
  /** 批量标记已保存：避免保存多个文件时逐个触发状态更新 */
  markFilesSaved: (entries: Array<{ path: string; versionId?: number }>) => void
  reloadFileFromDisk: (path: string, content: string) => void
  markFileDeleted: (path: string) => void
  markFileRestored: (path: string) => void
  updatePreviewMetadata: (path: string, preview: Partial<OpenPreviewMetadata>) => void
  setFileScrollPosition: (path: string, scrollPosition: { scrollTop: number; scrollLeft: number }) => void
  /** 设置工具执行时额外允许访问的目录路径列表 */
  setAllowedToolPaths: (paths: string[]) => void
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

/**
 * 从已打开列表中移除一组文件
 *
 * 关闭多个 Tab 时只允许产生一次状态更新：逐个 closeFile 会让订阅 openFiles 的
 * 组件树渲染 N 次，同时活跃文件被反复重算，Monaco 也要跟着反复切换 model，
 * Tab 一多就会出现「点关闭全部要等几秒」。
 *
 * 活跃文件只在「被关闭的文件包含当前活跃文件」时才重选，否则保持原值不动。
 */
function removeOpenFiles(
  files: OpenFile[],
  paths: Set<string>,
  activePath: string | null,
): Pick<FileSlice, 'openFiles' | 'activeFilePath'> {
  if (paths.size === 0) return { openFiles: files, activeFilePath: activePath }

  const openFiles = files.filter((f) => !paths.has(f.path))
  if (openFiles.length === files.length) return { openFiles: files, activeFilePath: activePath }

  const activeFilePath =
    activePath && paths.has(activePath)
      ? openFiles[openFiles.length - 1]?.path || null
      : activePath

  return { openFiles, activeFilePath }
}

/** LRU 淘汰：卸载最久未访问的非脏文件内容
 *
 * 被淘汰的文件会把 content 清空并标记 contentEvicted=true。
 * 重新激活该 Tab 时由 ensureFileContentLoaded 从磁盘懒加载回来，
 * 否则用户点到这些 Tab 会看到空内容。
 */
function applyLruEviction(files: OpenFile[], activePath: string): OpenFile[] {
  if (files.length <= MAX_OPEN_FILES_WITH_CONTENT) return files

  const candidates = files
    .filter((f) => !f.isDirty && f.path !== activePath && f.content.length > 0)
    .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0))

  const evictCount = files.length - MAX_OPEN_FILES_WITH_CONTENT
  const evictPaths = new Set(candidates.slice(0, evictCount).map((f) => f.path))

  return files.map((f) =>
    evictPaths.has(f.path)
      ? { ...f, content: '', originalContent: undefined, contentEvicted: true }
      : f,
  )
}

/* ------------------------------------------------------------------ */
/* 切片实现                                                          */
/* ------------------------------------------------------------------ */

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
  allowedToolPaths: [],

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
        contentEvicted: false,
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

  // v2.3：打开 PPT 预览 Tab（主窗口内嵌模式）
  openPptPreview: (meta, options) =>
    set((state) => {
      const path = buildPptPreviewPath(meta.sessionId)
      const existing = state.openFiles.find(
        (f) => f.path === path && f.kind === 'ppt-preview',
      )
      const resultFiles = upsertOpenFile(state.openFiles, {
        path,
        kind: 'ppt-preview',
        content: '',
        isDirty: false,
        lastAccessed: Date.now(),
        pptPreview: {
          meta,
          slides: existing?.pptPreview?.slides || new Map(),
        },
      })

      return {
        openFiles: applyLruEviction(resultFiles, path),
        activeFilePath: options?.activate === false ? state.activeFilePath : path,
      }
    }),

  // v2.4：打开 ONLYOFFICE 在线编辑 Tab（kind='oo-edit'）
  openOnlyOfficeEdit: (meta, options) =>
    set((state) => {
      const path = buildOoEditPath(meta.sessionId)
      const resultFiles = upsertOpenFile(state.openFiles, {
        path,
        kind: 'oo-edit',
        content: '',
        isDirty: false,
        lastAccessed: Date.now(),
        ooEdit: meta,
      })

      return {
        openFiles: applyLruEviction(resultFiles, path),
        activeFilePath: options?.activate === false ? state.activeFilePath : path,
      }
    }),

  // v2.3：推送幻灯片数据到 PPT 预览 Tab
  pushPptPreviewSlide: (sessionId, slide) =>
    set((state) => {
      const path = buildPptPreviewPath(sessionId)
      let found = false
      const openFiles = state.openFiles.map((f) => {
        if (f.path === path && f.kind === 'ppt-preview' && f.pptPreview) {
          found = true
          // 创建新的 Map 触发 React 更新
          const newSlides = new Map(f.pptPreview.slides)
          newSlides.set(slide.slideIndex, slide)
          return {
            ...f,
            pptPreview: {
              meta: {
                ...f.pptPreview.meta,
                slideCount: newSlides.size,
              },
              slides: newSlides,
            },
            lastAccessed: Date.now(),
          }
        }
        return f
      })
      if (!found) {
        logger.system.warn('[FileSlice] PPT preview Tab not found for pushSlide', { sessionId })
      }
      return { openFiles }
    }),

  // v2.3：标记 PPT 预览完成
  markPptPreviewComplete: (sessionId, filePath) =>
    set((state) => {
      const path = buildPptPreviewPath(sessionId)
      const openFiles = state.openFiles.map((f) => {
        if (f.path === path && f.kind === 'ppt-preview' && f.pptPreview) {
          return {
            ...f,
            pptPreview: {
              meta: {
                ...f.pptPreview.meta,
                completed: true,
                filePath,
              },
              slides: f.pptPreview.slides,
            },
            lastAccessed: Date.now(),
          }
        }
        return f
      })
      return { openFiles }
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
    set((state) => removeOpenFiles(state.openFiles, new Set([path]), state.activeFilePath)),

  closeFiles: (paths) =>
    set((state) => removeOpenFiles(state.openFiles, new Set(paths), state.activeFilePath)),

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
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, contentEvicted: false } : f,
      ),
    })),

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

  markFilesSaved: (entries) =>
    set((state) => {
      if (entries.length === 0) return {}
      const savedAt = new Map(entries.map((e) => [e.path, e.versionId]))
      return {
        openFiles: state.openFiles.map((f) => {
          if (!savedAt.has(f.path)) return f
          return { ...f, isDirty: false, savedVersionId: savedAt.get(f.path) ?? f.savedVersionId }
        }),
      }
    }),

  reloadFileFromDisk: (path, content) =>
    set((state) => ({
      openFiles: patchFile(state.openFiles, path, {
        content,
        originalContent: undefined,
        isDirty: false,
        isDeleted: false,
        contentEvicted: false,
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

  setAllowedToolPaths: (paths) => set({ allowedToolPaths: paths }),
})

/* ------------------------------------------------------------------ */
/* 场景感知文件切片扩展                                              */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 场景文件管理策略 */
export interface ScenarioFilePolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 最大打开文件数 */
  maxOpenFiles: number
  /** 大文件阈值（MB） */
  largeFileThresholdMB: number
  /** 超大文件阈值（行数） */
  veryLargeFileLines: number
  /** 是否启用 LRU 淘汰 */
  enableLruEviction: boolean
  /** 是否允许删除文件 */
  allowDelete: boolean
  /** 是否允许远程文件 */
  allowRemote: boolean
  /** 受限路径模式 */
  restrictedPatterns: RegExp[]
  /** 是否启用审计 */
  enableAudit: boolean
}

/** 场景文件策略预设 */
const SCENARIO_FILE_POLICIES: Record<ScenarioDomain, ScenarioFilePolicy> = {
  /** 法律场景：严格限制 + 审计 + 禁止删除 */
  legal: {
    domain: 'legal',
    maxOpenFiles: 15,
    largeFileThresholdMB: 2,
    veryLargeFileLines: 5000,
    enableLruEviction: true,
    allowDelete: false,
    allowRemote: false,
    restrictedPatterns: [
      /\.env/i,
      /\.secret/i,
      /credentials/i,
      /\.key$/i,
      /private/i,
    ],
    enableAudit: true,
  },

  /** 医疗场景：更严格限制 + 审计 + 禁止删除和远程 */
  medical: {
    domain: 'medical',
    maxOpenFiles: 10,
    largeFileThresholdMB: 2,
    veryLargeFileLines: 3000,
    enableLruEviction: true,
    allowDelete: false,
    allowRemote: false,
    restrictedPatterns: [
      /\.env/i,
      /\.secret/i,
      /patient/i,
      /hipaa/i,
      /medical-record/i,
      /\.key$/i,
    ],
    enableAudit: true,
  },

  /** 教育场景：标准限制 */
  education: {
    domain: 'education',
    maxOpenFiles: 30,
    largeFileThresholdMB: 5,
    veryLargeFileLines: 10000,
    enableLruEviction: true,
    allowDelete: true,
    allowRemote: true,
    restrictedPatterns: [/\.env/i],
    enableAudit: false,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    maxOpenFiles: 30,
    largeFileThresholdMB: 5,
    veryLargeFileLines: 50000,
    enableLruEviction: true,
    allowDelete: true,
    allowRemote: true,
    restrictedPatterns: [/\.env/i],
    enableAudit: false,
  },
}

/**
 * 场景感知文件管理器
 *
 * 在标准 FileSlice 基础上，增加场景策略：
 * - 场景感知的文件打开限制
 * - 路径安全校验（法律/医疗场景）
 * - 删除权限控制
 * - 远程文件控制
 * - 审计日志记录
 */
export class ScenarioFileManager {
  private currentDomain: ScenarioDomain = 'general'

  /**
   * 设置当前场景
   */
  setScenario(domain: ScenarioDomain): void {
    this.currentDomain = domain
  }

  /**
   * 获取当前场景策略
   */
  getPolicy(): ScenarioFilePolicy {
    return SCENARIO_FILE_POLICIES[this.currentDomain]
  }

  /**
   * 检查路径是否受限
   */
  isPathRestricted(path: string): boolean {
    const policy = SCENARIO_FILE_POLICIES[this.currentDomain]
    return policy.restrictedPatterns.some((pattern) => pattern.test(path))
  }

  /**
   * 检查是否允许打开文件
   */
  canOpenFile(path: string, openFilesCount: number): {
    allowed: boolean
    reason?: string
  } {
    const policy = SCENARIO_FILE_POLICIES[this.currentDomain]

    // 路径限制检查
    if (this.isPathRestricted(path)) {
      return {
        allowed: false,
        reason: `Path restricted by ${policy.domain} scenario policy`,
      }
    }

    // 文件数量限制检查
    if (openFilesCount >= policy.maxOpenFiles) {
      return {
        allowed: false,
        reason: `Maximum open files (${policy.maxOpenFiles}) reached for ${policy.domain} scenario`,
      }
    }

    return { allowed: true }
  }

  /**
   * 检查是否允许删除文件
   */
  canDeleteFile(): boolean {
    return SCENARIO_FILE_POLICIES[this.currentDomain].allowDelete
  }

  /**
   * 检查是否允许远程文件
   */
  canOpenRemote(): boolean {
    return SCENARIO_FILE_POLICIES[this.currentDomain].allowRemote
  }

  /**
   * 评估文件大小
   */
  evaluateFileSize(sizeBytes: number, lineCount: number): LargeFileInfo {
    const policy = SCENARIO_FILE_POLICIES[this.currentDomain]
    const sizeMB = sizeBytes / (1024 * 1024)

    const isLargeBySize = sizeMB >= policy.largeFileThresholdMB
    const isLargeByLines = lineCount >= policy.veryLargeFileLines
    const isLarge = isLargeBySize || isLargeByLines
    const isVeryLarge = isLargeBySize && isLargeByLines

    let reason: LargeFileInfo['reason']
    if (isLargeBySize && isLargeByLines) reason = 'both'
    else if (isLargeBySize) reason = 'size'
    else reason = 'lines'

    const warning = isLarge
      ? `File exceeds ${policy.domain} scenario limits (${sizeMB.toFixed(2)}MB, ${lineCount} lines)`
      : undefined

    return {
      isLarge,
      isVeryLarge,
      size: sizeBytes,
      lineCount,
      reason,
      warning,
    }
  }

  /**
   * 获取 LRU 淘汰后的最大文件数
   */
  getMaxOpenFiles(): number {
    return SCENARIO_FILE_POLICIES[this.currentDomain].maxOpenFiles
  }

  /**
   * 检查是否启用审计
   */
  isAuditEnabled(): boolean {
    return SCENARIO_FILE_POLICIES[this.currentDomain].enableAudit
  }
}

/**
 * 创建场景感知文件管理器
 */
export function createScenarioFileManager(): ScenarioFileManager {
  return new ScenarioFileManager()
}

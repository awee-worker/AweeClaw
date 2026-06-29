/**
 * 文件操作 / 工作区 / 搜索 API
 *
 * 覆盖 IPC 频道：
 * - file:*      文件读写 / 目录 / 知识库 / 文档提取
 * - dialog:*    导入 / 导出对话框
 * - workspace:* 工作区管理
 * - search:*    流式搜索结果推送
 * - file:changed 文件变更监听
 * - shell:openExternalUrl / file:openInBrowser
 */
import { invoke, send, on, onArgs } from '../ipcHelpers'
import type { SearchFilesOptions, SearchFileResult } from '../types'

export function createFileOpsApi() {
  return {
    // ── 文件打开 / 保存 ──
    openFile: invoke('file:open'),
    saveFile: (content: string, path?: string) => invoke('file:save')(content, path),

    // ── 知识库文件 ──
    openKnowledgeFiles: invoke('file:openKnowledgeFiles'),
    readKnowledgeFile: (filePath: string) => invoke('file:readKnowledgeFile')(filePath),
    extractKnowledgeDocxText: (filePath: string) => invoke('file:extractKnowledgeDocxText')(filePath),
    extractKnowledgeDocText: (filePath: string) => invoke('file:extractKnowledgeDocText')(filePath),
    extractKnowledgeXlsxText: (filePath: string) => invoke('file:extractKnowledgeXlsxText')(filePath),
    extractKnowledgePptText: (filePath: string) => invoke('file:extractKnowledgePptText')(filePath),
    extractKnowledgePdfText: (filePath: string) => invoke('file:extractKnowledgePdfText')(filePath),

    // ── 文档提取 ──
    extractDocText: (path: string) => invoke('file:extractDocText')(path),
    extractPptText: (path: string) => invoke('file:extractPptText')(path),
    extractDocxText: (path: string) => invoke('file:extractDocxText')(path),
    extractXlsxText: (path: string) => invoke('file:extractXlsxText')(path),
    extractPdfText: (path: string) => invoke('file:extractPdfText')(path),

    // ── 文件系统操作 ──
    readDir: (path: string) => invoke('file:readDir')(path),
    getFileTree: (path: string, maxDepth?: number) => invoke('file:getTree')(path, maxDepth),
    readFile: (path: string) => invoke('file:read')(path),
    readBinaryFile: (path: string) => invoke('file:readBinary')(path),
    writeFile: (path: string, content: string) => invoke('file:write')(path, content),
    writeBinaryFile: (path: string, base64Data: string) => invoke('file:writeBinary')(path, base64Data),
    ensureDir: (path: string) => invoke('file:ensureDir')(path),
    fileExists: (path: string) => invoke('file:exists')(path),
    showItemInFolder: (path: string) => invoke('file:showInFolder')(path),
    openInBrowser: (path: string) => invoke('file:openInBrowser')(path),
    mkdir: (path: string) => invoke('file:mkdir')(path),
    deleteFile: (path: string) => invoke('file:delete')(path),
    copyFile: (sourcePath: string, destinationPath: string) =>
      invoke('file:copy')(sourcePath, destinationPath),
    renameFile: (oldPath: string, newPath: string) => invoke('file:rename')(oldPath, newPath),

    // ── 外部链接 ──
    openExternalUrl: (url: string) => invoke('shell:openExternalUrl')(url),

    // ── 文件夹 / 导入导出 ──
    openFolder: invoke('file:openFolder'),
    selectFolder: invoke('dialog:selectFolder'),
    selectForImport: (options: {
      title?: string
      allowFiles?: boolean
      allowDirs?: boolean
      multiSelection?: boolean
    }) => invoke('dialog:selectForImport')(options),
    selectForExport: (options: { title?: string; defaultPath?: string }) =>
      invoke('dialog:selectForExport')(options),
    importIntoWorkspace: (sourcePaths: string[], targetDir: string) =>
      invoke('file:importIntoWorkspace')(sourcePaths, targetDir),
    exportFromWorkspace: (sourcePath: string, targetDir: string) =>
      invoke('file:exportFromWorkspace')(sourcePath, targetDir),
    shareItem: (filePaths: string[]) => invoke('file:shareItem')(filePaths),

    // ── 工作区 ──
    openWorkspace: invoke('workspace:open'),
    addFolderToWorkspace: invoke('workspace:addFolder'),
    saveWorkspace: (configPath: string, roots: string[]) =>
      invoke('workspace:save')(configPath, roots),
    restoreWorkspace: invoke('workspace:restore'),
    setActiveWorkspace: (roots: string[]) => invoke('workspace:setActive')(roots),
    getRecentWorkspaces: invoke('workspace:getRecent'),
    workspaceExists: (path: string) => invoke('workspace:exists')(path),
    clearRecentWorkspaces: invoke('workspace:clearRecent'),
    removeFromRecentWorkspaces: (path: string) => invoke('workspace:removeFromRecent')(path),

    // ── 搜索 ──
    searchFiles: (query: string, rootPath: string | string[], options?: SearchFilesOptions) =>
      invoke<SearchFileResult[]>('file:search')(query, rootPath, options),
    /** 流式搜索 — 结果通过 search:results 事件增量推送 */
    searchStream: (
      query: string,
      rootPath: string | string[],
      options: SearchFilesOptions,
      searchId: string,
    ) => invoke('file:search-stream')(query, rootPath, options, searchId),
    onSearchResults: onArgs<[string, SearchFileResult[]]>('search:results'),
    onSearchDone: onArgs<[string]>('search:done'),

    // ── 文件变更监听 ──
    onFileChanged: on<{ event: 'create' | 'update' | 'delete'; path: string }>('file:changed'),
  }
}

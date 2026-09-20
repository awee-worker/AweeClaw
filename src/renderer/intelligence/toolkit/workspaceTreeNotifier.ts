/**
 * 工作区文件树刷新通知
 *
 * 工具在磁盘上新增 / 修改 / 删除文件后，通过这里通知工作区面板刷新对应目录。
 * 独立成模块是因为落盘的不止内置写入工具：MCP 工具（Word / Excel 生成等）
 * 在自己的进程里直接写文件，同样需要走这条刷新链路，且 Windows 上
 * 「写入后目录延迟可见」的兜底节奏必须保持一致。
 */

import { platform, getDirname } from '@shared/toolkit/pathHelper'

export interface WorkspaceTreeChangeOptions {
    /** 当前工作区根路径 */
    workspacePath: string
    /** 发生变化的文件 / 目录绝对路径 */
    targetPath: string
    /** 变化类型 */
    changeType: 'create' | 'modify' | 'delete'
    /** 目标是否为目录（创建目录时需要一并刷新目录自身） */
    isDirectory?: boolean
}

function dispatchWorkspaceFilesChanged(opts: WorkspaceTreeChangeOptions): void {
    const parentPath = getDirname(opts.targetPath)
    const affectedPaths = new Set<string>()

    if (parentPath) {
        affectedPaths.add(parentPath)
    }

    if (opts.isDirectory && opts.changeType === 'create') {
        affectedPaths.add(opts.targetPath)
    }

    if (opts.workspacePath && parentPath === opts.workspacePath) {
        affectedPaths.add(opts.workspacePath)
    }

    window.dispatchEvent(new CustomEvent('workspace:files-changed', {
        detail: {
            affectedPaths: Array.from(affectedPaths),
            deletedPaths: opts.changeType === 'delete' ? [opts.targetPath] : [],
            refreshRoot: Boolean(opts.workspacePath && parentPath === opts.workspacePath),
        },
    }))
}

export function notifyWorkspaceTreeChange(opts: WorkspaceTreeChangeOptions): void {
    if (typeof window === 'undefined' || !opts.targetPath) return

    // Windows 文件系统存在写入后延迟可见的问题：
    // writeFileSync 返回后，readdir 可能暂时读不到新文件，
    // 导致工作区目录刷新后仍看不到刚写入的文件。
    // 解决方案：Windows 上延迟派发事件给文件系统 flush 时间，
    // 并在更长延迟后二次刷新作为兜底，确保文件最终可见。
    if (platform.isWindows) {
        // 首次刷新：等待 150ms 让文件系统完成 flush
        setTimeout(() => dispatchWorkspaceFilesChanged(opts), 150)
        // 二次兜底刷新：600ms 后再刷一次，覆盖 flush 较慢的情况
        setTimeout(() => dispatchWorkspaceFilesChanged(opts), 600)
        return
    }

    dispatchWorkspaceFilesChanged(opts)
}

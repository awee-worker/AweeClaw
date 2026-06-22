/**
 * 文件操作管理器（L2 文件操作层）
 * 提供跨平台的文件复制、移动、删除、重命名能力
 * 所有操作均经过路径安全校验，防止越权访问
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  FileOperationResult,
  FileOperationType,
  FileInfo,
  ActionResult,
} from './types/actions'

/** 受保护目录（禁止操作） */
const PROTECTED_PATHS: ReadonlyArray<string> = [
  '/',
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/private/etc',
  '/private/var',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
]

export class FileManager {
  /**
   * 校验路径安全性
   * - 禁止操作受保护系统目录
   * - 路径必须为绝对路径
   */
  private validatePath(targetPath: string): void {
    if (!path.isAbsolute(targetPath)) {
      throw new Error(`Path must be absolute: ${targetPath}`)
    }

    const normalized = path.resolve(targetPath)

    for (const protectedPath of PROTECTED_PATHS) {
      if (normalized === protectedPath || normalized.startsWith(protectedPath + path.sep)) {
        throw new Error(`Access denied to protected path: ${normalized}`)
      }
    }
  }

  /**
   * 校验源路径与目标路径
   * - 均需为绝对路径
   * - 均不能位于受保护目录
   * - 源路径必须存在
   */
  private async validateSourceAndTarget(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    this.validatePath(sourcePath)
    this.validatePath(targetPath)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const srcStat = await fsp.stat(sourcePath)
    if (!srcStat.isFile() && !srcStat.isDirectory()) {
      throw new Error(`Source path is neither file nor directory: ${sourcePath}`)
    }
  }

  /** 计算文件/目录大小 */
  private async calculateSize(targetPath: string): Promise<number> {
    const stat = await fsp.stat(targetPath)
    if (stat.isFile()) return stat.size

    let total = 0
    const entries = await fsp.readdir(targetPath)
    for (const entry of entries) {
      const childPath = path.join(targetPath, entry)
      const childStat = await fsp.stat(childPath)
      if (childStat.isDirectory()) {
        total += await this.calculateSize(childPath)
      } else {
        total += childStat.size
      }
    }
    return total
  }

  /** 递归复制目录 */
  private async copyDirRecursive(src: string, dest: string): Promise<void> {
    await fsp.mkdir(dest, { recursive: true })
    const entries = await fsp.readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcPath, destPath)
      } else if (entry.isFile()) {
        await fsp.copyFile(srcPath, destPath)
      }
    }
  }

  /** 复制文件或目录 */
  async copy(sourcePath: string, targetPath: string): Promise<FileOperationResult> {
    const start = Date.now()
    const op: FileOperationType = 'copy'
    try {
      await this.validateSourceAndTarget(sourcePath, targetPath)

      // 目标父目录必须存在
      const targetDir = path.dirname(targetPath)
      if (!fs.existsSync(targetDir)) {
        await fsp.mkdir(targetDir, { recursive: true })
      }

      const stat = await fsp.stat(sourcePath)
      let bytesProcessed = 0

      if (stat.isDirectory()) {
        await this.copyDirRecursive(sourcePath, targetPath)
        bytesProcessed = await this.calculateSize(targetPath)
      } else {
        await fsp.copyFile(sourcePath, targetPath)
        bytesProcessed = stat.size
      }

      logger.desktop.info(`[FileManager] copy: ${sourcePath} -> ${targetPath}`)

      return {
        success: true,
        operation: op,
        sourcePath,
        targetPath,
        bytesProcessed,
        duration: Date.now() - start,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[FileManager] copy failed: ${error}`)
      return {
        success: false,
        operation: op,
        sourcePath,
        targetPath,
        duration: Date.now() - start,
        error,
      }
    }
  }

  /** 移动文件或目录 */
  async move(sourcePath: string, targetPath: string): Promise<FileOperationResult> {
    const start = Date.now()
    const op: FileOperationType = 'move'
    try {
      await this.validateSourceAndTarget(sourcePath, targetPath)

      const targetDir = path.dirname(targetPath)
      if (!fs.existsSync(targetDir)) {
        await fsp.mkdir(targetDir, { recursive: true })
      }

      const stat = await fsp.stat(sourcePath)
      const bytesProcessed = stat.isFile() ? stat.size : await this.calculateSize(sourcePath)

      await fsp.rename(sourcePath, targetPath)

      logger.desktop.info(`[FileManager] move: ${sourcePath} -> ${targetPath}`)

      return {
        success: true,
        operation: op,
        sourcePath,
        targetPath,
        bytesProcessed,
        duration: Date.now() - start,
      }
    } catch (err) {
      // 跨设备移动时 rename 会失败，回退到复制 + 删除
      if (err instanceof Error && err.message.includes('EXDEV')) {
        logger.desktop.warn(`[FileManager] cross-device move, fallback to copy+delete`)
        const copyResult = await this.copy(sourcePath, targetPath)
        if (copyResult.success) {
          const deleteResult = await this.delete(sourcePath)
          if (deleteResult.success) {
            return {
              success: true,
              operation: op,
              sourcePath,
              targetPath,
              bytesProcessed: copyResult.bytesProcessed,
              duration: Date.now() - start,
            }
          }
        }
      }

      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[FileManager] move failed: ${error}`)
      return {
        success: false,
        operation: op,
        sourcePath,
        targetPath,
        duration: Date.now() - start,
        error,
      }
    }
  }

  /** 删除文件或目录 */
  async delete(targetPath: string): Promise<FileOperationResult> {
    const start = Date.now()
    const op: FileOperationType = 'delete'
    try {
      this.validatePath(targetPath)
      if (!fs.existsSync(targetPath)) {
        throw new Error(`Path does not exist: ${targetPath}`)
      }

      const stat = await fsp.stat(targetPath)
      if (stat.isDirectory()) {
        await fsp.rm(targetPath, { recursive: true, force: false })
      } else {
        await fsp.unlink(targetPath)
      }

      logger.desktop.info(`[FileManager] delete: ${targetPath}`)

      return {
        success: true,
        operation: op,
        sourcePath: targetPath,
        duration: Date.now() - start,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[FileManager] delete failed: ${error}`)
      return {
        success: false,
        operation: op,
        sourcePath: targetPath,
        duration: Date.now() - start,
        error,
      }
    }
  }

  /** 重命名文件或目录 */
  async rename(sourcePath: string, newName: string): Promise<FileOperationResult> {
    const start = Date.now()
    const op: FileOperationType = 'rename'
    try {
      this.validatePath(sourcePath)
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source path does not exist: ${sourcePath}`)
      }

      // 新名称不能包含路径分隔符
      if (newName.includes('/') || newName.includes('\\') || newName.includes(path.sep)) {
        throw new Error(`Invalid new name: ${newName}`)
      }

      const targetPath = path.join(path.dirname(sourcePath), newName)
      this.validatePath(targetPath)

      if (fs.existsSync(targetPath)) {
        throw new Error(`Target path already exists: ${targetPath}`)
      }

      await fsp.rename(sourcePath, targetPath)

      logger.desktop.info(`[FileManager] rename: ${sourcePath} -> ${newName}`)

      return {
        success: true,
        operation: op,
        sourcePath,
        targetPath,
        duration: Date.now() - start,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[FileManager] rename failed: ${error}`)
      return {
        success: false,
        operation: op,
        sourcePath,
        duration: Date.now() - start,
        error,
      }
    }
  }

  /** 获取文件信息 */
  async getFileInfo(targetPath: string): Promise<FileInfo> {
    this.validatePath(targetPath)
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Path does not exist: ${targetPath}`)
    }

    const stat = await fsp.stat(targetPath)
    return {
      path: path.resolve(targetPath),
      name: path.basename(targetPath),
      size: stat.isFile() ? stat.size : 0,
      isDirectory: stat.isDirectory(),
      createdAt: stat.birthtimeMs,
      modifiedAt: stat.mtimeMs,
      permissions: stat.mode.toString(8),
    }
  }

  /** 判断文件是否存在 */
  async exists(targetPath: string): Promise<boolean> {
    try {
      this.validatePath(targetPath)
      return fs.existsSync(targetPath)
    } catch {
      return false
    }
  }

  /** 创建目录 */
  async createDirectory(targetPath: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      this.validatePath(targetPath)
      await fsp.mkdir(targetPath, { recursive: true })
      logger.desktop.info(`[FileManager] createDirectory: ${targetPath}`)
      return {
        success: true,
        operation: 'createDirectory',
        target: targetPath,
        duration: Date.now() - start,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[FileManager] createDirectory failed: ${error}`)
      return {
        success: false,
        operation: 'createDirectory',
        target: targetPath,
        duration: Date.now() - start,
        error,
      }
    }
  }

  /** 列出目录内容 */
  async listDirectory(targetPath: string): Promise<FileInfo[]> {
    this.validatePath(targetPath)
    const stat = await fsp.stat(targetPath)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${targetPath}`)
    }

    const entries = await fsp.readdir(targetPath, { withFileTypes: true })
    const results: FileInfo[] = []
    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry.name)
      try {
        const entryStat = await fsp.stat(entryPath)
        results.push({
          path: entryPath,
          name: entry.name,
          size: entryStat.isFile() ? entryStat.size : 0,
          isDirectory: entry.isDirectory(),
          createdAt: entryStat.birthtimeMs,
          modifiedAt: entryStat.mtimeMs,
          permissions: entryStat.mode.toString(8),
        })
      } catch {
        // 跳过无法访问的条目（如权限不足）
      }
    }
    return results
  }
}

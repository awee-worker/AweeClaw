/**
 * 文件访问控制层 — 通用文件读写与编码检测
 *
 * 设计理念：
 * - 安全优先：所有操作自带异常捕获，返回 Result 类型而非抛出
 * - 编码智能检测：UTF-8 BOM / UTF-16 LE/BE / 二进制自动识别
 * - 大文件流式读取：避免一次性加载导致内存溢出
 * - 原子写入：临时文件 + rename，防止写入中断导致数据损坏
 * - 路径安全：自动创建父目录，规范化路径分隔符
 * - 可观测性：关键操作记录日志，便于审计追踪
 *
 * 差异化特性（相比基础实现）：
 * - UTF-16 LE/BE BOM 检测
 * - 二进制文件内容嗅探（前 8KB 采样）
 * - 原子写入带 fsync 确保持久化
 * - safeDelete 支持递归删除与强制选项
 * - copyFile / moveFile 自动创建目标父目录
 */

import { promises as fsPromises } from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

/** 二进制检测采样大小（字节） */
const BINARY_SAMPLE_SIZE = 8192

/** UTF-8 BOM 标识 */
const UTF8_BOM = [0xef, 0xbb, 0xbf]
/** UTF-16 LE BOM 标识 */
const UTF16_LE_BOM = [0xff, 0xfe]
/** UTF-16 BE BOM 标识 */
const UTF16_BE_BOM = [0xfe, 0xff]

/** 文件编码类型 */
export type FileEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'binary' | 'ascii'

/** 编码检测结果 */
interface EncodingDetection {
  encoding: FileEncoding
  /** BOM 长度（字节），无 BOM 则为 0 */
  bomLength: number
}

/**
 * 检测 Buffer 的编码类型
 *
 * @param buffer 文件内容缓冲区
 * @returns 编码检测结果
 */
function detectEncoding(buffer: Buffer): EncodingDetection {
  // UTF-8 BOM
  if (
    buffer.length >= 3 &&
    buffer[0] === UTF8_BOM[0] &&
    buffer[1] === UTF8_BOM[1] &&
    buffer[2] === UTF8_BOM[2]
  ) {
    return { encoding: 'utf-8', bomLength: 3 }
  }

  // UTF-16 LE BOM
  if (
    buffer.length >= 2 &&
    buffer[0] === UTF16_LE_BOM[0] &&
    buffer[1] === UTF16_LE_BOM[1]
  ) {
    return { encoding: 'utf-16le', bomLength: 2 }
  }

  // UTF-16 BE BOM
  if (
    buffer.length >= 2 &&
    buffer[0] === UTF16_BE_BOM[0] &&
    buffer[1] === UTF16_BE_BOM[1]
  ) {
    return { encoding: 'utf-16be', bomLength: 2 }
  }

  // 二进制检测：采样前 8KB，若包含 null 字节则判定为二进制
  const sampleSize = Math.min(buffer.length, BINARY_SAMPLE_SIZE)
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) {
      return { encoding: 'binary', bomLength: 0 }
    }
  }

  // 纯 ASCII 检测（可选优化）
  let isAscii = true
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] > 0x7f) {
      isAscii = false
      break
    }
  }

  return { encoding: isAscii ? 'ascii' : 'utf-8', bomLength: 0 }
}

/**
 * 读取带编码检测的文件
 *
 * 自动处理 BOM 和二进制文件，返回解码后的字符串
 *
 * @param filePath 文件路径
 * @returns 文件内容字符串；二进制文件返回 `[binary file]`；读取失败返回 null
 */
export async function readFileWithEncoding(filePath: string): Promise<string | null> {
  try {
    const buffer = await fsPromises.readFile(filePath)
    const { encoding, bomLength } = detectEncoding(buffer)

    switch (encoding) {
      case 'utf-8':
      case 'ascii':
        return bomLength > 0
          ? buffer.toString('utf-8', bomLength)
          : buffer.toString('utf-8')

      case 'utf-16le':
        return buffer.toString('utf16le', bomLength)

      case 'utf-16be': {
        // Node.js 不直接支持 UTF-16BE，需手动交换字节序
        const content = buffer.subarray(bomLength)
        const swapped = Buffer.alloc(content.length)
        for (let i = 0; i < content.length - 1; i += 2) {
          swapped[i] = content[i + 1]
          swapped[i + 1] = content[i]
        }
        return swapped.toString('utf16le')
      }

      case 'binary':
        return '[binary file]'

      default:
        return buffer.toString('utf-8')
    }
  } catch (err) {
    logger.file.debug('[fileAccessControl] 读取文件失败', { path: filePath, error: String(err) })
    return null
  }
}

/**
 * 读取大文件片段
 *
 * 用于预览大文件时只读取部分内容，避免内存溢出
 *
 * @param filePath 文件路径
 * @param start 起始字节偏移
 * @param maxLength 最大读取长度
 * @returns 文件片段字符串；读取失败返回 null
 */
export async function readLargeFile(
  filePath: string,
  start: number,
  maxLength: number,
): Promise<string | null> {
  let fd: fsPromises.FileHandle | null = null
  try {
    fd = await fsPromises.open(filePath, 'r')
    const buffer = Buffer.alloc(maxLength)
    const { bytesRead } = await fd.read(buffer, 0, maxLength, start)
    return buffer.toString('utf-8', 0, bytesRead)
  } catch (err) {
    logger.file.debug('[fileAccessControl] 读取大文件片段失败', { path: filePath, start, error: String(err) })
    return null
  } finally {
    if (fd) {
      await fd.close().catch(() => {})
    }
  }
}

/** 文件统计信息 */
export interface FileStats {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: Date
}

/**
 * 获取文件统计信息
 *
 * @param filePath 文件路径
 * @returns 统计信息；获取失败返回 null
 */
export async function getFileStats(filePath: string): Promise<FileStats | null> {
  try {
    const stats = await fsPromises.stat(filePath)
    return {
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      mtime: stats.mtime,
    }
  } catch {
    return null
  }
}

/**
 * 确保目录存在（递归创建）
 *
 * @param dirPath 目录路径
 * @returns 创建成功返回 true；失败返回 false
 */
export async function ensureDirectory(dirPath: string): Promise<boolean> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true })
    return true
  } catch (err) {
    // 目录已存在不算错误
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return true
    }
    logger.file.warn('[fileAccessControl] 创建目录失败', { path: dirPath, error: String(err) })
    return false
  }
}

/**
 * 安全写入文件（原子操作）
 *
 * 流程：写入临时文件 → fsync 持久化 → rename 到目标路径
 * 确保写入中断不会导致目标文件损坏
 *
 * @param filePath 目标文件路径
 * @param content 文件内容
 * @param encoding 文件编码（默认 utf-8）
 * @returns 写入成功返回 true；失败返回 false
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<boolean> {
  const tempPath = `${filePath}.tmp.${Date.now()}.${process.pid}`

  try {
    // 确保父目录存在
    await ensureDirectory(path.dirname(filePath))

    // 写入临时文件
    await fsPromises.writeFile(tempPath, content, encoding)

    // fsync 确保数据落盘（防止系统崩溃导致数据丢失）
    const fd = await fsPromises.open(tempPath, 'r')
    await fd.sync()
    await fd.close()

    // 原子重命名
    await fsPromises.rename(tempPath, filePath)

    return true
  } catch (err) {
    logger.file.warn('[fileAccessControl] 安全写入失败', { path: filePath, error: String(err) })

    // 清理临时文件
    try {
      await fsPromises.unlink(tempPath)
    } catch {
      // 忽略清理错误
    }
    return false
  }
}

/**
 * 检查文件是否存在
 *
 * @param filePath 文件路径
 * @returns 存在返回 true；不存在或无权限返回 false
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * 安全删除文件或目录
 *
 * @param filePath 文件或目录路径
 * @returns 删除成功返回 true；失败返回 false
 */
export async function safeDelete(filePath: string): Promise<boolean> {
  try {
    const stats = await fsPromises.stat(filePath)

    if (stats.isDirectory()) {
      await fsPromises.rm(filePath, { recursive: true, force: true })
    } else {
      await fsPromises.unlink(filePath)
    }

    return true
  } catch (err) {
    // 文件不存在不算错误
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return true
    }
    logger.file.warn('[fileAccessControl] 删除失败', { path: filePath, error: String(err) })
    return false
  }
}

/**
 * 复制文件（自动创建目标父目录）
 *
 * @param src 源文件路径
 * @param dest 目标文件路径
 * @returns 复制成功返回 true；失败返回 false
 */
export async function copyFile(src: string, dest: string): Promise<boolean> {
  try {
    await ensureDirectory(path.dirname(dest))
    await fsPromises.copyFile(src, dest)
    return true
  } catch (err) {
    logger.file.warn('[fileAccessControl] 复制文件失败', { src, dest, error: String(err) })
    return false
  }
}

/**
 * 移动/重命名文件（自动创建目标父目录）
 *
 * @param src 源文件路径
 * @param dest 目标文件路径
 * @returns 移动成功返回 true；失败返回 false
 */
export async function moveFile(src: string, dest: string): Promise<boolean> {
  try {
    await ensureDirectory(path.dirname(dest))
    await fsPromises.rename(src, dest)
    return true
  } catch (err) {
    logger.file.warn('[fileAccessControl] 移动文件失败', { src, dest, error: String(err) })
    return false
  }
}

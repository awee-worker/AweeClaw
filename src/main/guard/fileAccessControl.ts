/**
 * 文件操作工具函数
 * 从 secureFile.ts 拆分出来的通用文件操作
 */

import { promises as fsPromises } from 'fs'

/**
 * 读取带编码检测的文件
 * 自动处理 BOM 和二进制文件
 */
export async function readFileWithEncoding(filePath: string): Promise<string | null> {
  try {
    const buffer = await fsPromises.readFile(filePath)
    
    // 检测 UTF-8 BOM
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return buffer.toString('utf-8').substring(3)
    }
    
    // 检测二进制文件（包含 null 字节）
    if (buffer.includes(0)) {
      return '[binary file]'
    }
    
    return buffer.toString('utf-8')
  } catch {
    return null
  }
}

/**
 * 读取大文件片段
 * 用于预览大文件时只读取部分内容
 */
export async function readLargeFile(
  filePath: string,
  start: number,
  maxLength: number
): Promise<string | null> {
  try {
    const fd = await fsPromises.open(filePath, 'r')
    const buffer = Buffer.alloc(maxLength)
    const { bytesRead } = await fd.read(buffer, 0, maxLength, start)
    await fd.close()
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return null
  }
}

/**
 * 获取文件统计信息
 */
export async function getFileStats(filePath: string): Promise<{
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: Date
} | null> {
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
 * 确保目录存在
 */
export async function ensureDirectory(dirPath: string): Promise<boolean> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true })
    return true
  } catch {
    return false
  }
}

/**
 * 安全写入文件（先写入临时文件再重命名）
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<boolean> {
  const tempPath = `${filePath}.tmp.${Date.now()}`
  
  try {
    // 确保目录存在
    const path = await import('path')
    await ensureDirectory(path.dirname(filePath))
    
    // 写入临时文件
    await fsPromises.writeFile(tempPath, content, encoding)
    
    // 重命名为目标文件
    await fsPromises.rename(tempPath, filePath)
    
    return true
  } catch (error) {
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
  } catch {
    return false
  }
}

/**
 * 复制文件
 */
export async function copyFile(src: string, dest: string): Promise<boolean> {
  try {
    const path = await import('path')
    await ensureDirectory(path.dirname(dest))
    await fsPromises.copyFile(src, dest)
    return true
  } catch {
    return false
  }
}

/**
 * 移动/重命名文件
 */
export async function moveFile(src: string, dest: string): Promise<boolean> {
  try {
    const path = await import('path')
    await ensureDirectory(path.dirname(dest))
    await fsPromises.rename(src, dest)
    return true
  } catch {
    return false
  }
}

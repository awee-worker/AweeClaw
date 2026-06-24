/**
 * 文件打开与大小检测工具
 *
 * 统一处理二进制文件识别、大文件阈值确认与批量打开流程。
 */

import { api } from '../adapters/electronBridge'
import { useStore } from '@store'
import type { LargeFileInfo } from '@store/slices/fileSlice'
import {
  getFileInfo,
  getLargeFileWarning,
  isLargeFile,
} from '@services/largeFileAdapter'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '../components/foundation/DecisionOverlay'
import { getFileName } from '@shared/toolkit/pathHelper'
import { t, type Language } from '@renderer/i18n'

/* ------------------------------------------------------------------ */
/* 配置                                                              */
/* ------------------------------------------------------------------ */

/** 二进制文件扩展名集合 */
const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o', 'a', 'lib',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flv',
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'db', 'sqlite', 'sqlite3',
])

/** 需要用户确认的大文件阈值（5MB） */
const CONFIRM_THRESHOLD = 5 * 1024 * 1024

/** 拒绝打开的文件大小上限（50MB） */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 批量打开的最大文件数 */
const BATCH_LIMIT = 10

/* ------------------------------------------------------------------ */
/* 类型                                                              */
/* ------------------------------------------------------------------ */

/** 打开文件选项 */
export interface OpenFileOptions {
  showWarning?: boolean
  confirmLargeFile?: boolean
  language?: 'en' | 'zh'
  originalContent?: string
}

/** 打开文件结果 */
export interface OpenFileResult {
  success: boolean
  error?: string
  isLargeFile?: boolean
  isBinary?: boolean
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                          */
/* ------------------------------------------------------------------ */

/** 判断文件是否为二进制类型 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(ext)
}

/** 检测大文件信息 */
export function detectLargeFile(
  content: string,
  filePath: string,
  language: 'en' | 'zh' = 'en',
): LargeFileInfo | undefined {
  if (!isLargeFile(content)) return undefined

  const info = getFileInfo(filePath, content)
  const warning = getLargeFileWarning(info, language)

  return {
    isLarge: info.isLarge,
    isVeryLarge: info.isVeryLarge,
    size: info.size,
    lineCount: info.lineCount,
    warning: warning || undefined,
  }
}

/* ------------------------------------------------------------------ */
/* 打开流程                                                          */
/* ------------------------------------------------------------------ */

/** 安全打开单个文件 */
export async function safeOpenFile(
  filePath: string,
  options: OpenFileOptions = {},
): Promise<OpenFileResult> {
  const {
    showWarning = true,
    confirmLargeFile = true,
    language = 'en',
    originalContent,
  } = options

  const { openFile, setActiveFile } = useStore.getState()

  // 二进制文件拦截
  if (isBinaryFile(filePath)) {
    const msg = t('app.cannotopenbinaryfile', language as Language)
    if (showWarning) toast.warning(msg, getFileName(filePath))
    return { success: false, error: msg, isBinary: true }
  }

  try {
    const content = await api.file.read(filePath)

    if (content === null) {
      const msg = t('app.filenotfound', language as Language)
      if (showWarning) toast.error(msg, filePath)
      return { success: false, error: msg }
    }

    // 超过上限直接拒绝
    if (content.length > MAX_FILE_SIZE) {
      const msg = t('app.fileistoolargeto', language as Language)
      if (showWarning) toast.error(msg, `${(content.length / 1024 / 1024).toFixed(1)} MB`)
      return { success: false, error: msg, isLargeFile: true }
    }

    // 超过确认阈值时询问用户
    if (confirmLargeFile && content.length > CONFIRM_THRESHOLD) {
      const { t: tLocal } = await import('../i18n')
      const size = (content.length / 1024 / 1024).toFixed(1)

      const confirmed = await globalConfirm({
        title: tLocal('app.largefilewarning', language as Language),
        message: tLocal('confirmLargeFile', language, { size }),
        confirmText: tLocal('app.continue', language as Language),
        variant: 'warning',
      })

      if (!confirmed) return { success: false, error: 'Cancelled by user', isLargeFile: true }
    }

    // 检测大文件信息并提示
    const largeFileInfo = detectLargeFile(content, filePath, language)
    if (showWarning && largeFileInfo?.warning) {
      toast.warning(t('app.largefile', language as Language), largeFileInfo.warning)
    }

    // 编码检测由主进程 secureFile.ts 完成
    openFile(filePath, content, originalContent, {
      largeFileInfo,
      encoding: 'utf-8',
    })
    setActiveFile(filePath)

    return { success: true, isLargeFile: largeFileInfo?.isLarge }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    if (showWarning) toast.error(t('app.failedtoopenfile', language as Language), msg)
    return { success: false, error: msg }
  }
}

/** 批量打开文件（限制数量，静默处理单个失败） */
export async function safeOpenFiles(
  filePaths: string[],
  options: OpenFileOptions = {},
): Promise<{ opened: number; failed: number }> {
  const language = options.language || 'en'
  let paths = filePaths

  if (paths.length > BATCH_LIMIT) {
    toast.warning(t('app.canonlyopenfilesat', language as Language, { maxFiles: BATCH_LIMIT }))
    paths = paths.slice(0, BATCH_LIMIT)
  }

  let opened = 0
  let failed = 0

  for (const filePath of paths) {
    const result = await safeOpenFile(filePath, {
      ...options,
      showWarning: false,
      confirmLargeFile: false,
    })
    if (result.success) opened++
    else failed++
  }

  if (failed > 0) {
    toast.warning(
      t('app.somefilesfailedtoopen', language as Language),
      `${opened}/${paths.length}`,
    )
  }

  return { opened, failed }
}

/**
 * 本地模型缓存完整性校验与清理
 *
 * 模型下载中断时，transformers.js 可能把错误页或截断内容写成正式文件名
 * （例如只有几 KB 的 onnx 权重）。这类残留会让后续每次重试都读到同一份坏数据，
 * 仅靠失败重试无法自愈，必须主动识别并剔除。
 *
 * 本模块只依赖 fs/path，主进程与 Worker 线程均可复用。
 */

import * as fs from 'fs'
import * as path from 'path'

/** 模型缓存检查结果 */
export interface ModelCacheInspection {
  /** 模型目录是否存在 */
  present: boolean
  /** 必需文件是否齐全且体积达标 */
  complete: boolean
  /** 缺失或不合格的文件（相对模型目录） */
  invalidFiles: string[]
  /** 缓存占用字节数（目录不存在时为 0） */
  sizeBytes: number
}

/**
 * 权重文件的最小可用体积
 *
 * 量化后的嵌入模型约 22MB。下载失败时写入的往往是错误页（KB 级）或截断内容，
 * 用 5MB 作为下限可以把这类残留判为不合格，同时留足余量避免误伤。
 */
const MIN_WEIGHT_BYTES = 5 * 1024 * 1024

/** 模型目录绝对路径（transformers.js 按 modelId 逐级建目录） */
export function resolveModelDir(cacheDir: string, modelId: string): string {
  return path.join(cacheDir, ...modelId.split('/'))
}

/** 读取文件信息，失败返回 null（并发删除、权限异常等） */
function statOrNull(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

/** 递归统计目录大小 */
export function calculateDirSize(dirPath: string): number {
  let totalSize = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        totalSize += calculateDirSize(fullPath)
      } else if (entry.isFile()) {
        const stat = statOrNull(fullPath)
        if (stat) totalSize += stat.size
      }
    }
  } catch {
    // 目录可能被并发删除，忽略
  }
  return totalSize
}

/**
 * 检查模型缓存完整性
 *
 * @param cacheDir 缓存根目录（对应 transformers.js 的 cache_dir）
 * @param modelId 模型 ID，例如 Xenova/all-MiniLM-L6-v2
 * @param weightFiles 权重文件候选（相对模型目录），任一存在且体积达标即通过
 * @param metaFiles 必需的元数据文件（相对模型目录）
 * @returns 检查结果；present 为 true 但 complete 为 false 时表示存在半成品残留
 */
export function inspectModelCache(
  cacheDir: string,
  modelId: string,
  weightFiles: string[],
  metaFiles: string[],
): ModelCacheInspection {
  const empty: ModelCacheInspection = {
    present: false,
    complete: false,
    invalidFiles: [],
    sizeBytes: 0,
  }

  const modelDir = resolveModelDir(cacheDir, modelId)
  const dirStat = statOrNull(modelDir)
  if (!dirStat?.isDirectory()) return empty

  const invalidFiles: string[] = []

  const weightSatisfied = weightFiles.some((relative) => {
    const stat = statOrNull(path.join(modelDir, relative))
    return !!stat && stat.isFile() && stat.size >= MIN_WEIGHT_BYTES
  })
  if (!weightSatisfied && weightFiles.length > 0) {
    invalidFiles.push(weightFiles[0])
  }

  for (const relative of metaFiles) {
    const stat = statOrNull(path.join(modelDir, relative))
    if (!stat || !stat.isFile() || stat.size === 0) {
      invalidFiles.push(relative)
    }
  }

  return {
    present: true,
    complete: invalidFiles.length === 0,
    invalidFiles,
    sizeBytes: calculateDirSize(modelDir),
  }
}

/**
 * 删除模型缓存目录
 *
 * @returns 是否实际执行了删除（目录原本不存在时返回 false）
 * @throws 删除失败时抛出，调用方需自行决定是否降级
 */
export function removeModelCache(cacheDir: string, modelId: string): boolean {
  const modelDir = resolveModelDir(cacheDir, modelId)
  if (!fs.existsSync(modelDir)) return false
  fs.rmSync(modelDir, { recursive: true, force: true })
  return true
}

/** 文本嵌入模型的权重文件候选（相对模型目录） */
export const EMBEDDER_WEIGHT_FILES = ['onnx/model_quantized.onnx', 'onnx/model.onnx']

/** 文本嵌入模型的必需元数据文件（相对模型目录） */
export const EMBEDDER_META_FILES = ['config.json', 'tokenizer.json']

/** 清理结果 */
export interface DiscardCacheResult {
  /** 是否执行了删除 */
  removed: boolean
  /** 判定不合格的文件（缓存完整时为空数组） */
  invalidFiles: string[]
}

/**
 * 剔除不合格的模型缓存
 *
 * 只在"目录存在但必需文件缺失或体积不达标"时删除：网络故障导致的缓存若本身完整则不受影响，
 * 避免把完好模型误删造成重复下载。
 *
 * @returns removed 表示是否真的删除了目录；invalidFiles 为判定异常的相对路径列表
 */
export function discardInvalidModelCache(
  cacheDir: string,
  modelId: string,
  weightFiles: string[],
  metaFiles: string[],
): DiscardCacheResult {
  const inspection = inspectModelCache(cacheDir, modelId, weightFiles, metaFiles)
  if (!inspection.present || inspection.complete) {
    return { removed: false, invalidFiles: [] }
  }

  try {
    return {
      removed: removeModelCache(cacheDir, modelId),
      invalidFiles: inspection.invalidFiles,
    }
  } catch {
    // 删除失败（占用、权限等）：invalidFiles 非空 + removed 为 false 即表示残留仍在
    return { removed: false, invalidFiles: inspection.invalidFiles }
  }
}

/** 字节数转可读文本（用于日志与缓存信息展示） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

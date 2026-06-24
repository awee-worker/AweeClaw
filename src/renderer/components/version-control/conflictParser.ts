/**
 * Git 冲突解析工具
 *
 * 设计理念：
 * - 单一职责：仅负责冲突标记解析和内容提取
 * - 纯函数：无副作用，便于测试
 * - 类型安全：完整的类型定义
 * - 性能优化：单次遍历解析所有冲突
 * - 可扩展：支持 diff3 格式（base 部分）
 */

/** 冲突标记 */
export interface ConflictMarker {
  /** 冲突起始行（<<<<<<<） */
  startLine: number
  /** 冲突结束行（>>>>>>>） */
  endLine: number
  /** ours 部分起始行 */
  oursStart: number
  /** ours 部分结束行 */
  oursEnd: number
  /** theirs 部分起始行 */
  theirsStart: number
  /** theirs 部分结束行 */
  theirsEnd: number
  /** base 部分起始行（diff3 格式） */
  baseStart?: number
  /** base 部分结束行（diff3 格式） */
  baseEnd?: number
}

/** 冲突内容 */
export interface ConflictContent {
  /** ours 版本内容 */
  ours: string
  /** theirs 版本内容 */
  theirs: string
  /** base 版本内容（diff3 格式） */
  base?: string
}

/** 冲突标记前缀 */
const CONFLICT_START_PREFIX = '<<<<<<<'
const CONFLICT_BASE_PREFIX = '|||||||'
const CONFLICT_SEPARATOR_PREFIX = '======='
const CONFLICT_END_PREFIX = '>>>>>>>'

/**
 * 解析文件内容中的所有冲突标记
 *
 * 支持：
 * - 标准 merge 格式（<<<<<<< / ======= / >>>>>>>）
 * - diff3 格式（<<<<<<< / ||||||| / ======= / >>>>>>>）
 *
 * @param content 文件内容
 * @returns 冲突标记列表
 */
export function parseConflicts(content: string): ConflictMarker[] {
  const lines = content.split('\n')
  const conflicts: ConflictMarker[] = []

  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith(CONFLICT_START_PREFIX)) {
      const startLine = i
      let oursEnd = i
      let baseStart: number | undefined
      let baseEnd: number | undefined
      let theirsStart = i
      let endLine = i

      // 查找 ours 部分结束（||||||| 或 =======）
      i++
      while (
        i < lines.length &&
        !lines[i].startsWith(CONFLICT_BASE_PREFIX) &&
        !lines[i].startsWith(CONFLICT_SEPARATOR_PREFIX)
      ) {
        i++
      }
      oursEnd = i - 1

      // 检查是否有 base 部分（diff3 格式）
      if (lines[i]?.startsWith(CONFLICT_BASE_PREFIX)) {
        baseStart = i + 1
        i++
        while (i < lines.length && !lines[i].startsWith(CONFLICT_SEPARATOR_PREFIX)) {
          i++
        }
        baseEnd = i - 1
      }

      // 查找 theirs 部分
      if (lines[i]?.startsWith(CONFLICT_SEPARATOR_PREFIX)) {
        theirsStart = i + 1
        i++
        while (i < lines.length && !lines[i].startsWith(CONFLICT_END_PREFIX)) {
          i++
        }
        endLine = i
      }

      conflicts.push({
        startLine,
        endLine,
        oursStart: startLine + 1,
        oursEnd,
        theirsStart,
        theirsEnd: endLine - 1,
        baseStart,
        baseEnd,
      })
    }
    i++
  }

  return conflicts
}

/**
 * 提取指定冲突区域的内容
 *
 * @param content 完整文件内容
 * @param marker 冲突标记
 * @returns 冲突内容（ours, theirs, base?）
 */
export function extractConflictContent(
  content: string,
  marker: ConflictMarker,
): ConflictContent {
  const lines = content.split('\n')

  return {
    ours: lines.slice(marker.oursStart, marker.oursEnd + 1).join('\n'),
    theirs: lines.slice(marker.theirsStart, marker.theirsEnd + 1).join('\n'),
    base:
      marker.baseStart !== undefined && marker.baseEnd !== undefined
        ? lines.slice(marker.baseStart, marker.baseEnd + 1).join('\n')
        : undefined,
  }
}

/** 解决策略 */
export type ResolutionStrategy = 'ours' | 'theirs' | 'both' | 'manual'

/**
 * 应用冲突解决策略
 *
 * @param content 原始内容
 * @param marker 冲突标记
 * @param strategy 解决策略
 * @param manualContent 手动编辑内容（strategy 为 'manual' 时使用）
 * @returns 解决后的内容
 */
export function resolveConflict(
  content: string,
  marker: ConflictMarker,
  strategy: ResolutionStrategy,
  manualContent?: string,
): string {
  const { ours, theirs } = extractConflictContent(content, marker)
  const lines = content.split('\n')
  const before = lines.slice(0, marker.startLine)
  const after = lines.slice(marker.endLine + 1)

  let resolved: string
  switch (strategy) {
    case 'ours':
      resolved = ours
      break
    case 'theirs':
      resolved = theirs
      break
    case 'both':
      resolved = `${ours}\n${theirs}`
      break
    case 'manual':
      resolved = manualContent ?? ''
      break
    default:
      resolved = ours
  }

  return [...before, resolved, ...after].join('\n')
}

/**
 * 统计冲突信息
 *
 * @param conflicts 冲突列表
 * @returns 统计信息
 */
export function getConflictStats(conflicts: ConflictMarker[]): {
  total: number
  hasBase: boolean
} {
  return {
    total: conflicts.length,
    hasBase: conflicts.some((c) => c.baseStart !== undefined),
  }
}

/**
 * 场景感知文件读取参数解析器
 *
 * 设计理念：
 * - 场景驱动：不同场景应用不同读取策略
 * - 法律场景：强制审计日志，记录所有文件读取
 * - 医疗场景：敏感数据脱敏，限制读取范围
 * - 教育场景：支持课程资料批量读取
 * - 通用场景：标准读取
 * - 参数校验：完整的参数合法性检查
 * - 类型安全：完整的 TypeScript 类型
 */

// ============================================
// 场景定义
// ============================================

/** 场景类型 */
export type FileReadScenario = 'legal' | 'medical' | 'education' | 'general'

/** 场景读取配置 */
export interface ScenarioReadConfig {
  /** 场景名称 */
  scenario: FileReadScenario
  /** 最大文件大小（字节） */
  maxFileSize: number
  /** 是否启用审计日志 */
  enableAudit: boolean
  /** 敏感路径模式（禁止读取） */
  restrictedPatterns: RegExp[]
  /** 默认起始行 */
  defaultStartLine: number
  /** 默认结束行（0 表示读取到末尾） */
  defaultEndLine: number
  /** 是否支持批量读取 */
  supportBatchRead: boolean
  /** 批量读取最大文件数 */
  maxBatchSize: number
}

/** 场景读取配置预设 */
const SCENARIO_READ_CONFIGS: Record<FileReadScenario, ScenarioReadConfig> = {
  /** 法律场景：强制审计，限制大小 */
  legal: {
    scenario: 'legal',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    enableAudit: true,
    restrictedPatterns: [/\.env$/i, /\/secrets?\//i, /\/private\//i],
    defaultStartLine: 1,
    defaultEndLine: 0,
    supportBatchRead: true,
    maxBatchSize: 5,
  },

  /** 医疗场景：严格限制，敏感数据保护 */
  medical: {
    scenario: 'medical',
    maxFileSize: 5 * 1024 * 1024, // 5MB
    enableAudit: true,
    restrictedPatterns: [
      /\.env$/i,
      /\/secrets?\//i,
      /\/patient[_-]?records?\//i,
      /\/phi\//i,
      /\/hipaa\//i,
    ],
    defaultStartLine: 1,
    defaultEndLine: 0,
    supportBatchRead: false,
    maxBatchSize: 1,
  },

  /** 教育场景：宽松限制，支持批量 */
  education: {
    scenario: 'education',
    maxFileSize: 20 * 1024 * 1024, // 20MB
    enableAudit: false,
    restrictedPatterns: [/\.env$/i],
    defaultStartLine: 1,
    defaultEndLine: 0,
    supportBatchRead: true,
    maxBatchSize: 20,
  },

  /** 通用场景：默认配置 */
  general: {
    scenario: 'general',
    maxFileSize: 50 * 1024 * 1024, // 50MB
    enableAudit: false,
    restrictedPatterns: [/\.env$/i, /\/secrets?\//i],
    defaultStartLine: 1,
    defaultEndLine: 0,
    supportBatchRead: true,
    maxBatchSize: 10,
  },
}

// ============================================
// 参数类型定义
// ============================================

/** 单文件读取参数 */
export interface ReadFileSingleArgs {
  path: string
  start_line?: number
  end_line?: number
}

/** 多文件读取参数 */
export interface ReadFileMultiArgs {
  paths: string[]
}

/** 读取请求解析结果 */
export type ReadFileResolution =
  | {
      ok: true
      mode: 'single'
      normalized: Record<string, unknown>
      args: ReadFileSingleArgs
    }
  | {
      ok: true
      mode: 'multi'
      normalized: Record<string, unknown>
      args: ReadFileMultiArgs
    }
  | { ok: false; normalized: Record<string, unknown>; error: string }

/** 场景读取请求解析结果 */
export interface ScenarioReadResolution {
  /** 是否允许读取 */
  allowed: boolean
  /** 拒绝原因 */
  reason?: string
  /** 解析结果 */
  resolution: ReadFileResolution
  /** 场景配置 */
  config: ScenarioReadConfig
}

// ============================================
// 参数解析函数
// ============================================

/**
 * 解析路径值
 *
 * @param path 路径值（字符串或字符串数组）
 * @returns 解析后的路径
 */
function parsePathValue(path: unknown): string | string[] | undefined {
  if (Array.isArray(path) && path.every((item) => typeof item === 'string')) {
    return path
  }

  if (typeof path !== 'string') {
    return undefined
  }

  const trimmed = path.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return parsed
      }
    } catch {
      // Fall back to the raw string path.
    }
  }

  return path
}

/**
 * 规范化读取文件参数
 *
 * @param data 原始参数
 * @returns 规范化后的参数
 */
export function normalizeReadFileArgs(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...data }
  const parsedPath = parsePathValue(normalized.path)

  if (Array.isArray(parsedPath)) {
    normalized.path = parsedPath
    delete normalized.start_line
    delete normalized.end_line
  } else if (typeof parsedPath === 'string') {
    normalized.path = parsedPath
  }

  return normalized
}

/**
 * 解析读取文件请求
 *
 * @param data 原始参数
 * @returns 解析结果
 */
export function resolveReadFileRequest(
  data: Record<string, unknown>,
): ReadFileResolution {
  const normalized = normalizeReadFileArgs(data)
  const parsedPath = normalized.path

  if (Array.isArray(parsedPath)) {
    if (parsedPath.length === 0) {
      return { ok: false, normalized, error: 'path array must not be empty' }
    }

    return {
      ok: true,
      mode: 'multi',
      normalized,
      args: { paths: parsedPath },
    }
  }

  if (typeof parsedPath !== 'string' || parsedPath.length === 0) {
    return { ok: false, normalized, error: 'path is required' }
  }

  const start_line = normalized.start_line
  const end_line = normalized.end_line

  if (start_line !== undefined && typeof start_line !== 'number') {
    return { ok: false, normalized, error: 'start_line must be a number' }
  }

  if (end_line !== undefined && typeof end_line !== 'number') {
    return { ok: false, normalized, error: 'end_line must be a number' }
  }

  if (
    typeof start_line === 'number' &&
    typeof end_line === 'number' &&
    start_line > end_line
  ) {
    return { ok: false, normalized, error: 'start_line must be <= end_line' }
  }

  return {
    ok: true,
    mode: 'single',
    normalized,
    args: {
      path: parsedPath,
      ...(typeof start_line === 'number' ? { start_line } : {}),
      ...(typeof end_line === 'number' ? { end_line } : {}),
    },
  }
}

// ============================================
// 场景感知函数
// ============================================

/**
 * 获取场景读取配置
 *
 * @param scenario 场景类型
 * @returns 场景读取配置
 */
export function getScenarioReadConfig(
  scenario: FileReadScenario,
): ScenarioReadConfig {
  return SCENARIO_READ_CONFIGS[scenario]
}

/**
 * 检查路径是否被场景策略限制
 *
 * @param filePath 文件路径
 * @param scenario 场景类型
 * @returns 是否被限制
 */
export function isPathRestrictedByScenario(
  filePath: string,
  scenario: FileReadScenario,
): boolean {
  const config = SCENARIO_READ_CONFIGS[scenario]
  return config.restrictedPatterns.some((p) => p.test(filePath))
}

/**
 * 场景感知的读取请求解析
 *
 * 在标准解析基础上，增加场景策略校验：
 * - 敏感路径限制
 * - 批量读取限制
 * - 审计日志标记
 *
 * @param data 原始参数
 * @param scenario 场景类型
 * @returns 场景解析结果
 */
export function resolveScenarioReadRequest(
  data: Record<string, unknown>,
  scenario: FileReadScenario = 'general',
): ScenarioReadResolution {
  const config = SCENARIO_READ_CONFIGS[scenario]
  const resolution = resolveReadFileRequest(data)

  // 参数解析失败，直接返回
  if (!resolution.ok) {
    return {
      allowed: false,
      reason: resolution.error,
      resolution,
      config,
    }
  }

  // 检查路径限制
  if (resolution.mode === 'single') {
    if (isPathRestrictedByScenario(resolution.args.path, scenario)) {
      return {
        allowed: false,
        reason: `Path restricted by ${scenario} scenario policy`,
        resolution,
        config,
      }
    }
  } else {
    // 批量读取：检查场景是否支持
    if (!config.supportBatchRead) {
      return {
        allowed: false,
        reason: `${scenario} scenario does not support batch read`,
        resolution,
        config,
      }
    }

    // 检查批量大小限制
    if (resolution.args.paths.length > config.maxBatchSize) {
      return {
        allowed: false,
        reason: `Batch size ${resolution.args.paths.length} exceeds limit ${config.maxBatchSize}`,
        resolution,
        config,
      }
    }

    // 检查每个路径是否被限制
    for (const path of resolution.args.paths) {
      if (isPathRestrictedByScenario(path, scenario)) {
        return {
          allowed: false,
          reason: `Path restricted by ${scenario} scenario policy: ${path}`,
          resolution,
          config,
        }
      }
    }
  }

  return {
    allowed: true,
    resolution,
    config,
  }
}

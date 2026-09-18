/**
 * Python 解释器路径统一解析
 *
 * 为什么需要这一层：
 * Python 第三方依赖（sherpa-onnx / onnxruntime / ...）是安装在
 * PythonRuntimeManager 管理的 venv 里的，但调用方往往各自解析解释器路径
 * （例如用同步 getPythonPath() 读内存缓存，读不到就静默回退系统 python3）。
 * 一旦「装依赖的解释器」与「跑脚本的解释器」不是同一个，表现就是
 * 「模型加载失败 / No module named 'onnxruntime'」这类极具误导性的错误。
 *
 * 因此统一收敛到本函数，保证：
 * 1. 解析前先 `await ensureReady()`——避免同步读到尚未填充的内存缓存（null）
 * 2. 解析结果一定通过 `fs.existsSync` 校验
 * 3. 失败时抛出可诊断错误，**绝不静默回退**到系统 python
 *
 * @module python-runtime/resolvePythonPath
 */

import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import { pythonManager, type PythonSelectionDiagnostic, type VersionTuple } from './PythonRuntimeManager'

/** 解析结果 */
export interface ResolvedPythonPath {
  /** Python 解释器绝对路径 */
  pythonPath: string
  /** 来源：managed（受管运行时/venv）或 system（用户系统 Python） */
  source: 'managed' | 'system'
  /** venv 目录（若已创建） */
  venvDir: string | null
  /** 实际解释器版本，如 "3.11.16" */
  version: string | null
  /** venv 基底版本（没有 venv 时为 null） */
  venvBaseVersion: string | null
  /** 候选链诊断：解释器是怎么被选中的，或为何失败 */
  diagnostics?: PythonSelectionDiagnostic
}

/** 解析参数 */
export interface ResolvePythonOptions {
  /**
   * 调用方要求的最低 Python 版本，如 `[3, 10]`。
   *
   * 插件应当声明自己脚本的真实下限，而不是在脚本里等 SyntaxError：
   * 声明之后解析层会直接跳过不满足的解释器，并在没有任何候选可用时
   * 给出「需要 3.10+」这种可操作的理由。
   */
  minVersion?: VersionTuple
  /** 忽略已缓存的解释器，强制重新解析 */
  forceRefresh?: boolean
}

/** Python 运行环境不可用时抛出的统一错误（带用户引导文案） */
export class PythonRuntimeUnavailableError extends Error {
  constructor(detail?: string) {
    super(
      `Python 运行环境不可用${detail ? `：${detail}` : ''}。` +
        '请在「设置 → 运行环境」中完成 Python 初始化后重试',
    )
    this.name = 'PythonRuntimeUnavailableError'
  }
}

/**
 * 解析当前可用的 Python 解释器（按需触发环境初始化）
 *
 * @param label 调用方标识，仅用于日志
 * @param options.minVersion 调用方要求的最低版本（与全局下限取较严者）
 * @throws PythonRuntimeUnavailableError 环境不可用或解释器不存在时
 */
export async function resolveRuntimePythonPath(
  label = 'Python',
  options: ResolvePythonOptions = {},
): Promise<ResolvedPythonPath> {
  let status
  try {
    status = await pythonManager.ensureReady(options)
  } catch (error) {
    throw new PythonRuntimeUnavailableError(error instanceof Error ? error.message : String(error))
  }

  const pythonPath = status.pythonPath
  if (!pythonPath) {
    throw new PythonRuntimeUnavailableError(status.error ?? '未检测到可用的 Python 解释器')
  }
  if (!fs.existsSync(pythonPath)) {
    throw new PythonRuntimeUnavailableError(`解释器文件不存在：${pythonPath}`)
  }

  logger.system.debug(`[${label}] 使用 Python 解释器: ${pythonPath} (${status.source})`)

  return {
    pythonPath,
    source: status.source === 'managed' ? 'managed' : 'system',
    venvDir: status.venvDir,
    version: status.version ?? null,
    venvBaseVersion: status.venvBaseVersion ?? null,
    diagnostics: status.diagnostics,
  }
}

/**
 * 本地语音 Python 依赖引导
 *
 * 背景：
 * 本地 ASR / TTS 通过 Python sidecar 调用 sherpa-onnx / MOSS TTS，
 * 这些第三方库不在 PythonRuntimeManager 的基础包里，必须按需安装。
 * 缺包时脚本会静默返回「模型加载失败」，用户无法知道真正原因。
 *
 * 策略：
 * 1. 先用 `python -c "import ..."` 做一次轻量探测（约 200ms），依赖齐全则零开销
 * 2. 缺失才逐个 pip 安装（venv + 国内镜像源轮询，由 PythonRuntimeManager 负责）
 * 3. 安装完成后复检，仍失败则给出明确的手动安装指引
 *
 * @module local-voice/pythonDeps
 */

import { execFile } from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'
import { pythonManager } from '../python-runtime/PythonRuntimeManager'
import { resolveRuntimePythonPath } from '../python-runtime/resolvePythonPath'

/** 依赖描述 */
export interface SidecarDependencySpec {
  /** 引擎名称（用于提示文案） */
  label: string
  /** pip 包名列表 */
  packages: string[]
  /** import 探测语句（逗号分隔的模块名），如 `sherpa_onnx, soundfile` */
  importProbe: string
}

/** ASR 依赖：sherpa-onnx 会自动带上 onnxruntime */
export const ASR_DEPENDENCIES: SidecarDependencySpec = {
  label: '离线语音识别',
  packages: ['sherpa-onnx', 'soundfile', 'numpy', 'scipy'],
  importProbe: 'sherpa_onnx, soundfile, numpy, scipy',
}

/** TTS 依赖：MOSS TTS 运行时需要 onnxruntime + sentencepiece */
export const TTS_DEPENDENCIES: SidecarDependencySpec = {
  label: '离线语音合成',
  packages: ['onnxruntime', 'sentencepiece', 'soundfile', 'numpy', 'scipy'],
  importProbe: 'onnxruntime, sentencepiece, soundfile, numpy, scipy',
}

/** 探测指定模块是否都能导入 */
function probeImports(pythonPath: string, importProbe: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      pythonPath,
      ['-c', `import ${importProbe}`],
      { timeout: 60_000, windowsHide: true },
      (error) => resolve(!error),
    )
  })
}

/**
 * 确保 sidecar 依赖已安装
 *
 * 关键约束：这里解析出的解释器，必须与 PythonSidecar 启动脚本时使用的解释器一致。
 * 两处共用 resolveRuntimePythonPath()，从架构上杜绝「依赖装在 venv、
 * 脚本却用系统 python3 跑」的错配（历史 bug：报 No module named 'sherpa_onnx'）。
 *
 * @param spec 依赖描述
 * @param onStatus 状态回调（用于向 UI 透出「正在安装依赖」）
 */
export async function ensureSidecarDependencies(
  spec: SidecarDependencySpec,
  onStatus?: (message: string) => void,
): Promise<void> {
  const { pythonPath } = await resolveRuntimePythonPath(spec.label)

  // 快速路径：依赖齐全，直接返回
  if (await probeImports(pythonPath, spec.importProbe)) {
    logger.system.info(`[LocalVoice] ${spec.label} Python 依赖已就绪（${pythonPath}）`)
    return
  }

  const message = `首次运行需要安装${spec.label}依赖（${spec.packages.join('、')}），请耐心等待...`
  logger.system.info(`[LocalVoice] ${message}`)
  onStatus?.(message)

  for (const pkg of spec.packages) {
    logger.system.info(`[LocalVoice] 安装 Python 依赖: ${pkg}`)
    const result = await pythonManager.installPackage(pkg)
    if (!result.success) {
      throw new Error(
        `${spec.label}依赖安装失败：${pkg}${result.error ? `（${result.error}）` : ''}。` +
          `可手动执行：pip install ${spec.packages.join(' ')}`,
      )
    }
  }

  // 复检：pip 报成功但实际导入失败（如架构不匹配）时给出明确结论
  if (!(await probeImports(pythonPath, spec.importProbe))) {
    throw new Error(
      `${spec.label}依赖安装后仍无法导入（${spec.importProbe}）。` +
        `请手动执行：pip install ${spec.packages.join(' ')}`,
    )
  }

  logger.system.info(`[LocalVoice] ${spec.label} Python 依赖安装完成`)
}

/**
 * resolveRuntimePythonPath 单元测试
 *
 * 重点回归：依赖装在受管 venv 里，脚本却用系统 python3 跑，
 * 表现为「模型加载失败 / No module named 'onnxruntime'」这种误导性错误。
 * 因此解析失败必须显式抛错，绝不静默回退系统解释器。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const hoisted = vi.hoisted(() => ({ ensureReady: vi.fn() }))

vi.mock('../PythonRuntimeManager', () => ({
  pythonManager: { ensureReady: hoisted.ensureReady },
}))

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ipc: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { resolveRuntimePythonPath, PythonRuntimeUnavailableError } from '../resolvePythonPath'

describe('resolveRuntimePythonPath', () => {
  let tmpRoot: string
  let interpreter: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-pypath-'))
    interpreter = path.join(tmpRoot, 'venv', 'bin', 'python3')
    fs.mkdirSync(path.dirname(interpreter), { recursive: true })
    fs.writeFileSync(interpreter, '')
    hoisted.ensureReady.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('返回受管运行时解释器及其来源信息', async () => {
    hoisted.ensureReady.mockResolvedValue({
      pythonPath: interpreter,
      source: 'managed',
      venvDir: path.join(tmpRoot, 'venv'),
    })

    const resolved = await resolveRuntimePythonPath('SherpaAsr')

    expect(resolved).toEqual({
      pythonPath: interpreter,
      source: 'managed',
      venvDir: path.join(tmpRoot, 'venv'),
    })
    expect(hoisted.ensureReady).toHaveBeenCalledTimes(1)
  })

  it('系统 Python 也能作为来源返回（不误标为受管）', async () => {
    hoisted.ensureReady.mockResolvedValue({ pythonPath: interpreter, source: 'system', venvDir: null })

    await expect(resolveRuntimePythonPath()).resolves.toMatchObject({ source: 'system' })
  })

  it('解释器路径不存在时抛错，而不是回退到系统 python', async () => {
    hoisted.ensureReady.mockResolvedValue({
      pythonPath: path.join(tmpRoot, 'gone', 'python3'),
      source: 'managed',
      venvDir: null,
    })

    await expect(resolveRuntimePythonPath()).rejects.toBeInstanceOf(PythonRuntimeUnavailableError)
    await expect(resolveRuntimePythonPath()).rejects.toThrow(/解释器文件不存在/)
  })

  it('未检测到解释器时带上运行环境状态里的原因', async () => {
    hoisted.ensureReady.mockResolvedValue({
      pythonPath: null,
      source: 'system',
      venvDir: null,
      error: '未安装 Python 运行时',
    })

    await expect(resolveRuntimePythonPath()).rejects.toThrow(/未安装 Python 运行时/)
  })

  it('ensureReady 抛错时统一转换为带用户引导的错误文案', async () => {
    hoisted.ensureReady.mockRejectedValue(new Error('磁盘空间不足'))

    const failure = resolveRuntimePythonPath()
    await expect(failure).rejects.toBeInstanceOf(PythonRuntimeUnavailableError)
    await expect(failure).rejects.toThrow(/磁盘空间不足/)
    await expect(failure).rejects.toThrow(/设置 → 运行环境/)
  })
})

/**
 * PythonSidecar 单元测试
 *
 * 覆盖两类真实故障：
 * 1. 脚本路径解析：打包态（resources/py）与开发态（源码目录）必须都能命中，
 *    早期用 `path.join(__dirname, '..', '..')` 猜路径 → 文件不存在 → python 立刻退出，
 *    最终只报「启动超时」，把真实原因吞掉。
 * 2. 协议分发：响应必须按 requestId 精确匹配，否则并发命令会互相错配结果。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const hoisted = vi.hoisted(() => ({ appPath: '' }))

vi.mock('electron', () => ({
  app: { getAppPath: () => hoisted.appPath },
}))

vi.mock('../../python-runtime/resolvePythonPath', () => ({
  resolveRuntimePythonPath: vi.fn(),
}))

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ipc: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { PythonSidecar, resolveSidecarScript } from '../pythonSidecar'

/** 只在本测试中存在的脚本名：避免命中仓库里真实的 py 脚本 */
const SCRIPT_NAME = 'unit-test-sidecar-script.py'

/** 开发态脚本相对路径（与实现保持一致） */
const SOURCE_RELATIVE = path.join('src', 'main', 'modules', 'local-voice', 'py', SCRIPT_NAME)

function setResourcesPath(value: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', {
    value,
    configurable: true,
    writable: true,
  })
}

describe('resolveSidecarScript', () => {
  let tmpRoot: string
  let appPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-sidecar-'))
    appPath = path.join(tmpRoot, 'app')
    fs.mkdirSync(appPath, { recursive: true })
    hoisted.appPath = appPath
    setResourcesPath(undefined)
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    setResourcesPath(undefined)
  })

  it('打包态优先使用 resources/py 下的脚本', () => {
    const resourcesPath = path.join(tmpRoot, 'resources')
    const packedScript = path.join(resourcesPath, 'py', SCRIPT_NAME)
    const devScript = path.join(appPath, SOURCE_RELATIVE)
    fs.mkdirSync(path.dirname(packedScript), { recursive: true })
    fs.mkdirSync(path.dirname(devScript), { recursive: true })
    fs.writeFileSync(packedScript, '')
    fs.writeFileSync(devScript, '')
    setResourcesPath(resourcesPath)

    expect(resolveSidecarScript(SCRIPT_NAME)).toBe(packedScript)
  })

  it('开发态回退到 appPath 下的源码目录', () => {
    const devScript = path.join(appPath, SOURCE_RELATIVE)
    fs.mkdirSync(path.dirname(devScript), { recursive: true })
    fs.writeFileSync(devScript, '')

    expect(resolveSidecarScript(SCRIPT_NAME)).toBe(devScript)
  })

  it('脚本缺失时抛出含全部候选路径的错误（便于定位部署问题）', () => {
    expect(() => resolveSidecarScript(SCRIPT_NAME)).toThrowError(/未找到 Python 运行脚本/)

    try {
      resolveSidecarScript(SCRIPT_NAME)
    } catch (err) {
      const message = (err as Error).message
      // 错误信息必须列出尝试过的路径，否则「启动超时」类报错无法定位
      expect(message).toContain(path.join('py', SCRIPT_NAME))
      expect(message.split('\n').length).toBeGreaterThan(1)
    }
  })
})

describe('PythonSidecar 协议', () => {
  let sidecar: any
  let written: string[]

  /** 构造「已就绪 + 可写 stdin」的假子进程，避免真的 spawn python */
  function armReadyChild(): any {
    written = []
    const child = {
      stdin: {
        write: (payload: string, cb?: (error?: Error | null) => void): boolean => {
          written.push(payload)
          cb?.(null)
          return true
        },
      },
      kill: vi.fn(),
    }
    sidecar.child = child
    sidecar.ready = true
    return child
  }

  /** 手工挂一条待响应请求，返回其 resolve / reject 以便断言 */
  function armPending(requestId: string): { resolve: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> } {
    const resolve = vi.fn()
    const reject = vi.fn()
    sidecar.pending.set(requestId, { resolve, reject, timer: setTimeout(() => undefined, 60_000) })
    return { resolve, reject }
  }

  beforeEach(() => {
    sidecar = new PythonSidecar({ scriptFile: SCRIPT_NAME, label: 'Test' })
  })

  afterEach(() => {
    sidecar.dispose()
    vi.useRealTimers()
  })

  it('未启动时 request 抛出可诊断错误', async () => {
    await expect(sidecar.request('initialize')).rejects.toThrow(/未启动/)
  })

  it('进程存在但未就绪时 request 拒绝', async () => {
    sidecar.child = { stdin: { write: vi.fn() } }
    sidecar.ready = false

    await expect(sidecar.request('initialize')).rejects.toThrow(/尚未就绪/)
  })

  it('request 以 JSON-Lines 发送命令，并携带 requestId', async () => {
    armReadyChild()

    const promise = sidecar.request('initialize', { modelDir: '/tmp/m' })
    expect(written).toHaveLength(1)
    expect(written[0].endsWith('\n')).toBe(true)

    const payload = JSON.parse(written[0].trim())
    expect(payload).toMatchObject({ command: 'initialize', params: { modelDir: '/tmp/m' } })
    expect(typeof payload.requestId).toBe('string')

    sidecar.handleStdout(`JSON:${JSON.stringify({ type: 'result', requestId: payload.requestId })}\n`)
    await expect(promise).resolves.toMatchObject({ type: 'result' })
  })

  it('ready 消息触发启动握手，isReady 需要「就绪 + 子进程存在」同时成立', () => {
    const child = armReadyChild()
    sidecar.ready = false

    expect(sidecar.isReady()).toBe(false)

    let readyNotified = 0
    sidecar.onReady = () => {
      readyNotified++
    }
    sidecar.handleStdout('{"type":"ready"}\n')

    expect(readyNotified).toBe(1)
    expect(sidecar.isReady()).toBe(true)

    sidecar.child = null
    expect(sidecar.isReady()).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('按 requestId 精确分发响应，未匹配的响应不报错', () => {
    armReadyChild()
    const first = armPending('req_1')
    const second = armPending('req_2')

    sidecar.handleStdout('JSON:{"type":"result","requestId":"req_2","text":"second"}\n')

    expect(second.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req_2', text: 'second' }),
    )
    expect(first.resolve).not.toHaveBeenCalled()
    expect(sidecar.pending.has('req_2')).toBe(false)
    expect(sidecar.pending.has('req_1')).toBe(true)

    // 无 requestId 的主动上报（脚本内部异常）只记日志，不应抛错
    expect(() => sidecar.handleStdout('{"type":"error","message":"boom"}\n')).not.toThrow()
    expect(() => sidecar.handleStdout('JSON:{"type":"log","requestId":"nobody"}\n')).not.toThrow()
  })

  it('error 类型的响应让对应请求 reject', async () => {
    armReadyChild()
    const pending = sidecar.pending
    const promise = sidecar.request('synthesize')
    const requestId = JSON.parse(written[0].trim()).requestId

    sidecar.handleStdout(`{"type":"error","requestId":"${requestId}","message":"模型加载失败"}\n`)

    await expect(promise).rejects.toThrow('模型加载失败')
    expect(pending.size).toBe(0)
  })

  it('不完整行先缓存，拼接后再解析（stdout 分块场景）', () => {
    armReadyChild()
    const pending = armPending('req_partial')

    sidecar.handleStdout('JSON:{"type":"res')
    expect(pending.resolve).not.toHaveBeenCalled()

    sidecar.handleStdout('ult","requestId":"req_partial"}\n')
    expect(pending.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req_partial' }),
    )
  })

  it('非 JSON 输出（python 的普通 print / 警告）被安全忽略', () => {
    armReadyChild()
    const pending = armPending('req_keep')

    expect(() =>
      sidecar.handleStdout('Loading model...\n{broken json\n\nJSON:not-json\n'),
    ).not.toThrow()
    expect(pending.resolve).not.toHaveBeenCalled()
    expect(pending.reject).not.toHaveBeenCalled()
  })

  it('命令超时后有明确错误，且不再残留待响应请求', async () => {
    vi.useFakeTimers()
    armReadyChild()

    const promise = sidecar.request('initialize', {}, 1_000)
    const assertion = expect(promise).rejects.toThrow(/命令超时/)

    await vi.advanceTimersByTimeAsync(1_500)
    await assertion
    expect(sidecar.pending.size).toBe(0)
  })

  it('dispose 让所有待响应请求立即失败，并终止子进程', async () => {
    const child = armReadyChild()
    const promise = sidecar.request('recognize')
    const assertion = expect(promise).rejects.toThrow(/已停止/)

    sidecar.dispose()
    await assertion

    expect(sidecar.pending.size).toBe(0)
    expect(sidecar.isReady()).toBe(false)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

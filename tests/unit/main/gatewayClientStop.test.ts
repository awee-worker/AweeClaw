/**
 * GatewayClient.stop 的进程清理回归测试
 *
 * 关注点：停止时按「进程树」终止 Gateway，而不是只杀直接子进程。
 * Gateway 以 daemon 模式 fork 运行，只杀父进程会留下继续占用 Socket 的孤儿进程。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const killSpy = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aweeclaw-gateway-test',
    getAppPath: () => '/tmp/aweeclaw-gateway-test/app',
    getVersion: () => '0.0.0',
    isPackaged: false,
  },
}))

vi.mock('@main/process/processTree', () => ({
  hardKillProcessTree: killSpy,
  signalProcessTree: vi.fn(),
}))

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { gatewayClient } from '@main/modules/gateway/GatewayClient'

/** 通过私有字段注入 mock 子进程（测试专用） */
function setProcess(pid: number | null): void {
  ;(gatewayClient as unknown as { process: unknown }).process =
    pid === null ? null : { pid, killed: false, kill: vi.fn() }
}

describe('GatewayClient.stop 进程清理', () => {
  beforeEach(() => {
    killSpy.mockClear()
    setProcess(null)
    ;(gatewayClient as unknown as { status: string }).status = 'disconnected'
  })

  it('存在 Gateway 子进程时按进程树终止', async () => {
    setProcess(4321)

    await gatewayClient.stop()

    expect(killSpy).toHaveBeenCalledWith(4321)
    expect((gatewayClient as unknown as { process: unknown }).process).toBeNull()
  })

  it('没有子进程时不会调用进程树终止', async () => {
    await gatewayClient.stop()

    expect(killSpy).not.toHaveBeenCalled()
  })

  it('stop 后状态回到 disconnected', async () => {
    setProcess(4321)

    await gatewayClient.stop()

    expect((gatewayClient as unknown as { status: string }).status).toBe('disconnected')
  })
})

/**
 * 自定义协议特权注册测试
 *
 * 守住的约束：全部特权协议必须在**一次** registerSchemesAsPrivileged 调用里注册。
 *
 * 原因：Electron 会把 scheme 能力写进 --fetch-schemes / --cors-schemes /
 * --secure-schemes / --bypass-csp-schemes 等命令行开关供子进程复用，而 CommandLine
 * 是「开关名 → 值」结构，同名开关后写覆盖前写（switches_[key] = value，命令行里虽然
 * 叠加多条，子进程读到的是最后一条）。拆成多次注册时，只有最后一次的 scheme 能到达
 * 渲染进程，先前注册的等于没注册，症状是渲染进程 fetch：
 *   URL scheme "scenario-bundle" is not supported
 * 也就是编程式场景 / 插件 UI 的 bundle 加载失败。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const registerSchemesAsPrivileged = vi.fn()

// 主进程模块在 import 期只读 electron 的这几个入口，node 环境下需要占位
vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged },
  app: { getPath: () => '/tmp/aweeclaw-scheme-registry-test' },
  net: { fetch: vi.fn() },
}))

/** 取模块新实例，复位模块内的「已注册」标记 */
async function loadRegistry() {
  vi.resetModules()
  return import('../schemeRegistry')
}

/** 取出本次注册的 scheme 列表 */
function registeredSchemes() {
  expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
  return registerSchemesAsPrivileged.mock.calls[0][0] as Array<{
    scheme: string
    privileges: Record<string, boolean>
  }>
}

beforeEach(() => {
  registerSchemesAsPrivileged.mockClear()
})

describe('registerPrivilegedSchemes', () => {
  it('把全部特权协议合并到一次注册调用', async () => {
    const { registerPrivilegedSchemes } = await loadRegistry()
    registerPrivilegedSchemes()

    expect(registeredSchemes().map((item) => item.scheme).sort()).toEqual([
      'local-preview',
      'plugin-bundle',
      'scenario-bundle',
      'vrm-asset',
    ])
  })

  it('重复调用不会再注册一次', async () => {
    const { registerPrivilegedSchemes } = await loadRegistry()
    registerPrivilegedSchemes()
    registerPrivilegedSchemes()

    expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
  })

  it('bundle 协议保留 fetch / standard / cors 能力', async () => {
    const { registerPrivilegedSchemes } = await loadRegistry()
    registerPrivilegedSchemes()

    const byName = new Map(registeredSchemes().map((item) => [item.scheme, item.privileges]))

    for (const name of ['scenario-bundle', 'plugin-bundle']) {
      expect(byName.get(name)).toMatchObject({
        standard: true,
        secure: true,
        corsEnabled: true,
        supportFetchAPI: true,
        bypassCSP: true,
      })
    }

    expect(byName.get('vrm-asset')).toMatchObject({ standard: true, supportFetchAPI: true })
    // local-preview 只用于 <img>/<video> 等标签引用，不使用 standard 语义
    expect(byName.get('local-preview')).toMatchObject({ standard: false, supportFetchAPI: true })
  })
})

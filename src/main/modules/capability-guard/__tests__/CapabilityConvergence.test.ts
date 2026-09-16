/**
 * 能力一致性收敛单元测试
 *
 * 重点回归：「降级后不回收」——用户在 PRO 期间开启的 VTS / VMC / A2A /
 * 对外 API / 直播互动，降级后必须被自动关闭；同时**只关不删**，凭证与
 * 端口等配置必须原样保留，且重复调用不产生副作用。
 *
 * 测试策略：不走 mock 的「假模块」，而是给临时 userData 目录预置真实的
 * 配置文件，再调用真实的各模块 API —— 这样同时验证了「我理解的关闭语义
 * 与各 Manager 实际实现一致」这一最容易出错的地方（无法真机上机验证的
 * 部分，靠这层断言兜住）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'

const hoisted = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsMod = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path')
  return {
    root: fsMod.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-capability-guard-')),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
})

/**
 * 收敛过程中「向窗口广播状态」与断言无关（测试里没有窗口），但真实实现
 * 会顺着 bootstrap/windowManager → globalCleanup → IPC 模块 一路拉进
 * web-tree-sitter —— 后者是浏览器构建，在 node 环境下加载即抛
 * `document.currentScript` 未定义。此处只挡断这条与业务无关的依赖链。
 */
vi.mock('@main/bootstrap/windowManager', () => ({
  getMainWindow: () => null,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fsMod = require('fs')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path')
      const dir = path.join(hoisted.root, name)
      fsMod.mkdirSync(dir, { recursive: true })
      return dir
    },
    isPackaged: false,
  },
  // 加密不可用时 safeStorageUtil 会退回明文，测试里无需真实 Keychain
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf-8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf-8'),
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
}))

// 日志桩：主进程每个模块都会打日志，测试里只关心「有没有 error」，
// 因此把全部日志域都收敛到同一组 spy 上
vi.mock('@shared/toolkit/LogEngine', () => {
  const scope = () => ({
    info: hoisted.info,
    warn: hoisted.warn,
    error: hoisted.error,
    debug: hoisted.info,
  })
  return {
    logger: {
      ...scope(),
      security: scope(),
      system: scope(),
      ipc: scope(),
      settings: scope(),
      channel: scope(),
      agent: scope(),
      proactive: scope(),
      perception: scope(),
      iot: scope(),
    },
  }
})

import { convergeCapabilities, getLastConvergeReport } from '../CapabilityConvergence'

// ─── 测试夹具 ────────────────────────────────────────────

/** 写入一个模块配置文件（路径与各 Store 的约定一致） */
function seedConfig(dirName: string, fileName: string, content: unknown): void {
  const dir = `${hoisted.root}/userData/${dirName}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/${fileName}`, JSON.stringify(content, null, 2), 'utf-8')
}

/** 读取模块配置文件 */
function readConfig(dirName: string, fileName: string): Record<string, unknown> {
  const raw = fs.readFileSync(`${hoisted.root}/userData/${dirName}/${fileName}`, 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

const VTS_TOKEN = 'vts-secret-token'
const LIVE_SESSDATA = 'live-secret-sessdata'
const A2A_INBOUND_TOKEN = 'a2a-secret-token'

/** 造出一台「用户曾经在 PRO 期间把能力全开了」的机器 */
async function seedPaidUserMachine(): Promise<void> {
  seedConfig('live', 'live_config.json', {
    enabled: true,
    bilibiliEnabled: true,
    bilibiliType: 'web',
    bilibiliRoomId: '12345',
    bilibiliSessdata: LIVE_SESSDATA,
    bilibiliWebRiskAccepted: true,
  })
  seedConfig('vts', 'vts_config.json', {
    enabled: true,
    url: 'ws://127.0.0.1:8001',
    token: VTS_TOKEN,
  })
  seedConfig('vmc', 'vmc_config.json', {
    enabled: true,
    send: { enabled: true, host: '127.0.0.1', port: 39540 },
    receive: { enabled: true, port: 39539, allowedIps: ['127.0.0.1'], syncExpression: true },
    heartbeat: { enabled: true, intervalMs: 1000 },
  })
  seedConfig('a2a', 'a2a_config.json', {
    enabled: true,
    servers: {},
    // 端口随系统分配，避免测试环境里与其它进程抢 8790
    inbound: { enabled: true, host: '127.0.0.1', port: 0, token: A2A_INBOUND_TOKEN },
  })
  seedConfig('openapi', 'openapi_config.json', {
    enabled: true,
    host: '127.0.0.1',
    port: 8788,
    apiKey: 'openapi-key',
  })

  // VMC 与其它模块不同：它的 Store 只在 init() 时读盘（对齐 app ready 后的
  // 真实初始化顺序），因此这里必须显式初始化，否则收敛读到的是内存默认值
  const { initVmcModule } = await import('@main/modules/vmc')
  initVmcModule()
}

/** FREE 套餐：8 项能力全部无权限 */
const FREE_ENTITLEMENT = { planId: 'FREE', allowed: {} }

/** PRO 套餐：8 项能力全部放开 */
const PRO_ENTITLEMENT = {
  planId: 'PRO',
  allowed: {
    liveInteraction: true,
    vts: true,
    vmc: true,
    a2a: true,
    externalApi: true,
    iot: true,
    perception: true,
    proactive: true,
  },
}

// ─── 用例 ────────────────────────────────────────────────

describe('convergeCapabilities', () => {
  beforeEach(() => {
    // 用例之间必须清盘：否则上一个用例 seed 出来的配置会残留，
    // 让「空机器」用例读到非空状态（A2A 仍是 enabled）而误判
    fs.rmSync(`${hoisted.root}/userData`, { recursive: true, force: true })
    hoisted.info.mockClear()
    hoisted.warn.mockClear()
    hoisted.error.mockClear()
  })

  afterEach(() => {
    // 模块内有内存缓存，用例之间必须清掉，否则第二次读到的还是上一轮的值
    vi.resetModules()
  })

  it('降级到 FREE 后关闭全部已开启的能力', async () => {
    await seedPaidUserMachine()

    const report = await convergeCapabilities(FREE_ENTITLEMENT)

    expect(report.planId).toBe('FREE')
    // 只断言「付费用户确实开着的那些」被关掉；
    // iot（Bridge 未运行）/ perception（内存默认关）/ proactive（默认关）
    // 收敛前本就是关闭状态，不应产生写入
    expect(report.revokedKeys.sort()).toEqual(
      ['a2a', 'externalApi', 'liveInteraction', 'vmc', 'vts'].sort(),
    )

    // 没有任何一项失败
    expect(report.results.filter((r) => !r.ok)).toEqual([])
  })

  it('只关不删：凭证、房间号、端口等配置原样保留', async () => {
    await seedPaidUserMachine()

    await convergeCapabilities(FREE_ENTITLEMENT)

    // 直播：关开关，但凭证明文仍在（测试环境 safeStorage 不可用 → 明文落盘）
    const live = readConfig('live', 'live_config.json')
    expect(live.enabled).toBe(false)
    expect(live.bilibiliEnabled).toBe(false)
    expect(live.bilibiliRoomId).toBe('12345')
    expect(live.bilibiliSessdata).toBe(LIVE_SESSDATA)

    // VTS：关开关，token 保留
    const vts = readConfig('vts', 'vts_config.json')
    expect(vts.enabled).toBe(false)
    expect(vts.token).toBe(VTS_TOKEN)
    expect(vts.url).toBe('ws://127.0.0.1:8001')

    // VMC：三层开关都要关，端口配置保留
    const vmc = readConfig('vmc', 'vmc_config.json')
    expect(vmc.enabled).toBe(false)
    expect((vmc.send as Record<string, unknown>).enabled).toBe(false)
    expect((vmc.receive as Record<string, unknown>).enabled).toBe(false)
    expect((vmc.send as Record<string, unknown>).port).toBe(39540)
    expect((vmc.receive as Record<string, unknown>).port).toBe(39539)

    // A2A：总开关与入站都关，token 保留
    const a2a = readConfig('a2a', 'a2a_config.json')
    expect(a2a.enabled).toBe(false)
    expect((a2a.inbound as Record<string, unknown>).enabled).toBe(false)
    expect((a2a.inbound as Record<string, unknown>).token).toBe(A2A_INBOUND_TOKEN)

    // 对外 API：关开关，端口与 API Key 保留
    const openapi = readConfig('openapi', 'openapi_config.json')
    expect(openapi.enabled).toBe(false)
    expect(openapi.port).toBe(8788)
    expect(openapi.apiKey).toBe('openapi-key')
  })

  it('幂等：重复收敛不再产生写入', async () => {
    await seedPaidUserMachine()

    const first = await convergeCapabilities(FREE_ENTITLEMENT)
    expect(first.revokedKeys.length).toBe(5)

    const second = await convergeCapabilities(FREE_ENTITLEMENT)
    // 第二次全部「已关不动」，UI 也就不会重复弹提示
    expect(second.revokedKeys).toEqual([])
    expect(second.results.every((r) => r.ok)).toBe(true)
  })

  it('PRO 套餐不做任何收敛（不写盘、不报警告）', async () => {
    await seedPaidUserMachine()
    const before = readConfig('vts', 'vts_config.json')

    const report = await convergeCapabilities(PRO_ENTITLEMENT)

    expect(report.revokedKeys).toEqual([])
    expect(report.results).toEqual([])
    // 文件内容完全没动
    expect(readConfig('vts', 'vts_config.json')).toEqual(before)
    expect(hoisted.error).not.toHaveBeenCalled()
  })

  it('部分授权：只关无权限的那一项', async () => {
    await seedPaidUserMachine()

    const report = await convergeCapabilities({
      planId: 'PRO',
      // 只保留 A2A，其余仍无权限
      allowed: { a2a: true },
    })

    expect(report.revokedKeys.sort()).toEqual(
      ['externalApi', 'liveInteraction', 'vmc', 'vts'].sort(),
    )
    expect(readConfig('a2a', 'a2a_config.json').enabled).toBe(true)
  })

  it('未授权且未开启的能力不产生写入，也不记为已关闭', async () => {
    // 空机器：什么都没开
    const report = await convergeCapabilities(FREE_ENTITLEMENT)

    expect(report.revokedKeys).toEqual([])
    expect(report.results.every((r) => r.revoked === false)).toBe(true)
  })

  it('收敛报告可被读取（诊断用）', async () => {
    await seedPaidUserMachine()
    await convergeCapabilities(FREE_ENTITLEMENT)

    const report = getLastConvergeReport()
    expect(report?.planId).toBe('FREE')
    expect(report?.revokedKeys.length).toBe(5)
    expect(report?.convergedAt).toBeGreaterThan(0)
  })
})

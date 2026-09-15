/**
 * 临时验证：P1-1 防休眠（验收用，跑完即删）
 *
 * 覆盖 DoD：
 *   · macOS 下守护运行时 `pmset -g assertions` 可见 PreventUserIdleSystemSleep
 *   · 释放 / 退出后断言消失（无残留）
 *   · 并发 3 个持有者逐个释放，直到最后一个才真正释放
 *   · 去抖窗口（minDurationMs）生效
 *   · autoTriggerAgentTask 门控（关闭后 agent-task 不计入生效集合）
 *   · manualHold 独立生效
 *   · system 档位带上 -d（显示器断言）
 *   · 残留守护进程定向清理（含进程身份二次确认）
 *
 * 说明：本测试**不 mock 平台层** —— 在 macOS 上真实 spawn caffeinate，
 * 断言取自真实 `pmset`。只 mock electron（拿 userData 路径）与 windowManager（无窗口）。
 */

import { describe, it, expect, vi, afterAll } from 'vitest'
import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

// ── electron / 窗口 mock（必须在业务模块 import 之前由 vitest 提升） ──
vi.mock('electron', () => {
  const os = require('os')
  const path = require('path')
  const fss = require('fs')
  const dir = fss.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-pg-'))
  return {
    app: { getPath: () => dir, on: () => {}, off: () => {} },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

vi.mock('../src/main/bootstrap/windowManager', () => ({ getMainWindow: () => null }))

import {
  createPlatformGuard,
  isProcessAlive,
  killProcess,
  matchesGuardSignature,
  readProcessCommand,
} from '../src/main/modules/power-guard/PowerGuardPlatform'
import { getPowerGuardManager } from '../src/main/modules/power-guard/PowerGuardManager'
import {
  getPowerGuardStatePath,
  readGuardState,
  resetConfig,
  updateConfig,
} from '../src/main/modules/power-guard/PowerGuardStore'

// ============================================
// 工具
// ============================================

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function waitFor(cond: () => boolean, timeoutMs = 6000, stepMs = 60): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return true
    await sleep(stepMs)
  }
  return cond()
}

function pmsetSnapshot(): string {
  try {
    return execSync('pmset -g assertions', { encoding: 'utf-8' })
  } catch (e) {
    return `<pmset failed: ${(e as Error).message}>`
  }
}

/** 该 pid 是否在 pmset 断言列表里出现 */
function pidHasAssertion(pid: number, source: string): boolean {
  return pmsetSnapshot().includes(`pid ${pid}(${source})`)
}

/** 起一个必然会退出的进程，取其 pid 作为「已死 pid」 */
async function deadPid(): Promise<number> {
  const child = spawn('/bin/echo', ['x'])
  const pid = child.pid!
  await new Promise<void>(resolve => child.once('exit', () => resolve()))
  await sleep(100)
  return pid
}

const manager = getPowerGuardManager()
const spawnedByTest: import('child_process').ChildProcess[] = []

afterAll(async () => {
  await manager.stop()
  for (const c of spawnedByTest) {
    try {
      if (c.pid) killProcess(c.pid, true)
    } catch {
      /* ignore */
    }
  }
  // 兜底：确认没有本测试留下的断言
  for (const c of spawnedByTest) {
    if (c.pid) {
      const gone = await waitFor(() => !isProcessAlive(c.pid!), 2000)
      if (!gone) console.warn('[verify] 测试子进程未能清理：', c.pid)
    }
  }
})

// ============================================
// 1. 平台层：caffeinate 真实行为
// ============================================

describe('平台层（macOS caffeinate 真机）', () => {
  it('idle 档产生 PreventUserIdleSystemSleep，kill 后无残留', async () => {
    const guard = createPlatformGuard()
    expect(guard.supported()).toBe(true)

    const r = await guard.start('idle')
    expect(r.kind).toBe('caffeinate')
    expect(r.effectiveMode).toBe('idle')
    expect(r.pid).toBeTypeOf('number')
    expect(isProcessAlive(r.pid!)).toBe(true)

    // 真机断言：pmset 里能看到这个 pid 持有 PreventUserIdleSystemSleep
    expect(pidHasAssertion(r.pid!, 'caffeinate')).toBe(true)
    expect(pmsetSnapshot()).toContain('PreventUserIdleSystemSleep')

    // -w <pid> 进程守护：命令行里必须带上当前主进程 pid
    const command = readProcessCommand(r.pid!)
    expect(command).toContain('caffeinate')
    expect(command).toContain(`-w ${process.pid}`)

    // 身份二次确认（残留清理的安全前提）
    expect(matchesGuardSignature(r.pid!, 'caffeinate')).toBe(true)
    expect(matchesGuardSignature(r.pid!, 'powershell')).toBe(false)

    await guard.stop()
    expect(isProcessAlive(r.pid!)).toBe(false)
    expect(pidHasAssertion(r.pid!, 'caffeinate')).toBe(false)
  }, 20000)

  it('system 档额外带上 -d（显示器断言）', async () => {
    const guard = createPlatformGuard()
    const r = await guard.start('system')
    expect(r.effectiveMode).toBe('system')

    const command = readProcessCommand(r.pid!)
    expect(command).toContain('-i')
    expect(command).toContain('-d')
    // 刻意不用 -s：电池供电下断言创建失败会让 caffeinate 直接退出
    expect(command.split(/\s+/)).not.toContain('-s')

    await guard.stop()
    expect(isProcessAlive(r.pid!)).toBe(false)
  }, 20000)
})

// ============================================
// 2. 残留清理（必须在其它用例改动配置之前跑）
// ============================================

describe('残留守护进程清理', () => {
  it('上个实例被强杀留下的守护进程会被定向清理', async () => {
    await manager.stop()

    // 模拟「上次残留」：手工起一个不带 -w 的 caffeinate（父进程死后也不会自己退）
    const orphan = spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' })
    spawnedByTest.push(orphan)
    await sleep(300)
    const orphanPid = orphan.pid!
    expect(isProcessAlive(orphanPid)).toBe(true)

    const gonePid = await deadPid()
    // 生产代码走 writeGuardState（内部 ensureDir）；测试直接写文件需自己建目录
    fs.mkdirSync(path.dirname(getPowerGuardStatePath()), { recursive: true })
    fs.writeFileSync(
      getPowerGuardStatePath(),
      JSON.stringify({
        version: 1,
        ownerPid: gonePid, // owner 已死 → 典型僵尸状态
        guardPid: orphanPid,
        kind: 'caffeinate',
        mode: 'idle',
        startedAt: Date.now(),
      }),
      'utf-8',
    )

    await manager.start()

    const cleaned = await waitFor(() => !isProcessAlive(orphanPid), 4000)
    expect(cleaned).toBe(true)
    // 记录文件被清除
    expect(readGuardState()).toBeNull()
    expect(fs.existsSync(getPowerGuardStatePath())).toBe(false)
  }, 20000)

  it('owner 仍存活时不动手（避免误杀另一个实例的断言）', async () => {
    await manager.stop()

    const orphan = spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' })
    spawnedByTest.push(orphan)
    await sleep(300)
    const orphanPid = orphan.pid!

    // 生产代码走 writeGuardState（内部 ensureDir）；测试直接写文件需自己建目录
    fs.mkdirSync(path.dirname(getPowerGuardStatePath()), { recursive: true })
    fs.writeFileSync(
      getPowerGuardStatePath(),
      JSON.stringify({
        version: 1,
        ownerPid: process.pid, // owner 活着
        guardPid: orphanPid,
        kind: 'caffeinate',
        mode: 'idle',
        startedAt: Date.now(),
      }),
      'utf-8',
    )

    await manager.start()
    await sleep(500)

    expect(isProcessAlive(orphanPid)).toBe(true)
    killProcess(orphanPid, true)
  }, 20000)
})

// ============================================
// 3. 引用计数 + 去抖 + 门控
// ============================================

describe('编排层（引用计数 / 去抖 / 门控）', () => {
  /**
   * 每个用例都从「干净状态」起步。
   *
   * 必须先 `stop()` 再改配置再 `start()`：
   *   · `resetConfig/updateConfig` 只改存储、不触发重算；且 `start()` 在 `started`
   *     为真时会提前返回，导致配置改了但状态机没跟着走 —— 用例之间会互相污染。
   *   · 计数类断言一律用「前后差值」，`startCount/stopCount` 是累计值，跨用例不会归零。
   */
  async function bootWith(patch: Record<string, unknown>): Promise<{ start: number; stop: number }> {
    await manager.stop()
    resetConfig()
    updateConfig(patch)
    await manager.start()
    const s = manager.getStatus()
    return { start: s.startCount, stop: s.stopCount }
  }

  it('并发 3 个持有者，逐个释放直到最后一个才真正释放', async () => {
    const base = await bootWith({
      mode: 'idle',
      minDurationMs: 0,
      autoTriggerAgentTask: true,
      manualHold: false,
    })

    manager.acquire('t1')
    manager.acquire('t2')
    manager.acquire('t3')

    expect(await waitFor(() => manager.getStatus().active)).toBe(true)

    const status = manager.getStatus()
    expect(status.startCount).toBe(base.start + 1) // 三个持有者只起一次守护
    expect(status.source).toBe('caffeinate')
    expect(status.activeMode).toBe('idle')
    expect(status.guardPid).toBeTypeOf('number')

    const pid = status.guardPid!
    expect(isProcessAlive(pid)).toBe(true)
    expect(pidHasAssertion(pid, 'caffeinate')).toBe(true)
    expect(pmsetSnapshot()).toContain('PreventUserIdleSystemSleep')

    manager.release('t1')
    manager.release('t2')
    await sleep(400)
    // 还有 t3 持有 → 断言必须继续存在
    expect(manager.getStatus().active).toBe(true)
    expect(isProcessAlive(pid)).toBe(true)
    expect(pidHasAssertion(pid, 'caffeinate')).toBe(true)

    manager.release('t3')
    expect(await waitFor(() => !manager.getStatus().active)).toBe(true)
    expect(manager.getStatus().stopCount).toBe(base.stop + 1)

    // 断言彻底消失
    expect(await waitFor(() => !isProcessAlive(pid), 3000)).toBe(true)
    expect(pidHasAssertion(pid, 'caffeinate')).toBe(false)
    expect(fs.existsSync(getPowerGuardStatePath())).toBe(false)
  }, 30000)

  it('去抖：窗口内不启动守护，跨过窗口后自动生效', async () => {
    const base = await bootWith({
      mode: 'idle',
      minDurationMs: 800,
      autoTriggerAgentTask: true,
      manualHold: false,
    })

    manager.acquire('debounce')

    await sleep(300)
    expect(manager.getStatus().active).toBe(false) // 窗口内不生效
    expect(manager.getStatus().startCount).toBe(base.start)

    expect(await waitFor(() => manager.getStatus().active, 3000)).toBe(true) // 跨过阈值后生效
    expect(manager.getStatus().startCount).toBe(base.start + 1)

    manager.release('debounce')
    expect(await waitFor(() => !manager.getStatus().active)).toBe(true)
    expect(manager.getStatus().stopCount).toBe(base.stop + 1)
  }, 30000)

  it('autoTriggerAgentTask 关闭时 agent-task 不计入生效集合，打开后立刻生效', async () => {
    const base = await bootWith({
      mode: 'idle',
      minDurationMs: 0,
      autoTriggerAgentTask: false,
      manualHold: false,
    })

    manager.acquire('agent-task')
    await sleep(400)

    expect(manager.getStatus().active).toBe(false)
    expect(manager.getStatus().startCount).toBe(base.start)
    // 持有者仍然保留（引用计数不能丢），只是被门控
    const holders = manager.getStatus().holders
    expect(holders.map(h => h.reason)).toContain('agent-task')
    expect(holders.find(h => h.reason === 'agent-task')!.effective).toBe(false)

    // 打开开关 → 无需重新 acquire，立即生效
    await manager.applyConfig({ autoTriggerAgentTask: true })
    expect(await waitFor(() => manager.getStatus().active, 3000)).toBe(true)
    expect(manager.getStatus().startCount).toBe(base.start + 1)

    manager.release('agent-task')
    expect(await waitFor(() => !manager.getStatus().active)).toBe(true)
  }, 30000)

  it('manualHold 独立生效，且不受 minDurationMs 约束', async () => {
    await bootWith({
      mode: 'idle',
      minDurationMs: 60_000,
      autoTriggerAgentTask: true,
      manualHold: false,
    })

    expect(manager.getStatus().active).toBe(false)

    await manager.applyConfig({ manualHold: true })
    expect(await waitFor(() => manager.getStatus().active, 3000)).toBe(true)
    expect(manager.getStatus().holders.some(h => h.reason === 'manual' && h.effective)).toBe(true)

    await manager.applyConfig({ manualHold: false })
    expect(await waitFor(() => !manager.getStatus().active, 3000)).toBe(true)
  }, 30000)

  it('mode=off / enabled=false 时不生效，且不产生守护进程', async () => {
    const base = await bootWith({
      enabled: true,
      mode: 'off',
      minDurationMs: 0,
      autoTriggerAgentTask: true,
    })

    manager.acquire('x')
    await sleep(400)
    expect(manager.getStatus().active).toBe(false)
    expect(manager.getStatus().startCount).toBe(base.start)

    await manager.applyConfig({ mode: 'idle', enabled: false })
    await sleep(400)
    expect(manager.getStatus().active).toBe(false)
    expect(manager.getStatus().startCount).toBe(base.start)

    manager.releaseAll()
  }, 30000)

  it('stop() 释放一切，且无残留断言', async () => {
    await bootWith({ mode: 'idle', minDurationMs: 0, autoTriggerAgentTask: true })

    manager.acquire('y')
    expect(await waitFor(() => manager.getStatus().active, 3000)).toBe(true)
    const pid = manager.getStatus().guardPid!

    await manager.stop()

    expect(manager.getStatus().active).toBe(false)
    expect(await waitFor(() => !isProcessAlive(pid), 3000)).toBe(true)
    expect(pidHasAssertion(pid, 'caffeinate')).toBe(false)
    expect(fs.existsSync(getPowerGuardStatePath())).toBe(false)
  }, 30000)

  it('渲染层重载兜底：releaseAll 立即释放，不必等健康检查', async () => {
    await bootWith({ mode: 'idle', minDurationMs: 0, autoTriggerAgentTask: true })

    manager.acquire('agent-task')
    expect(await waitFor(() => manager.getStatus().active, 3000)).toBe(true)
    const pid = manager.getStatus().guardPid!

    // 模拟渲染层重载：主进程侧清空动态持有者
    manager.releaseAll()

    expect(await waitFor(() => !manager.getStatus().active, 3000)).toBe(true)
    expect(await waitFor(() => !isProcessAlive(pid), 3000)).toBe(true)
  }, 30000)
})


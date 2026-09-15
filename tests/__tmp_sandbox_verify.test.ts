/**
 * 临时验证：P1-2 代码解释器沙箱（验收用，跑完即删）
 *
 * 覆盖 DoD：
 *   · `off` 策略 → `handled:false`，命令不经过沙箱（行为与改造前一致）
 *   · `local` 后端：正常执行 / 超时终止（含 exitCode 与超时标记）
 *   · 输出超限 → 截断并显式标记
 *   · 环境变量白名单：宿主 secret 不进沙箱
 *   · 后端不可用 → 降级到下一级，且降级链与原因如实留痕
 *   · 严格模式（allowFallback=false）→ 拒绝执行，命令未运行
 *   · 超时后的**进程组**回收：`sh -c` 派生的子进程一并终止，无孤儿
 *   · docker 网络隔离：**同一条命令**在 `--network=none` 下失败、在 `bridge` 下成功
 *     （只看「失败」不够 —— 镜像里没有 `wget` 也会失败，必须做对照组）
 *   · 临时目录清理的前缀守卫
 *
 * 说明：本测试**不 mock 平台层** —— 真实 spawn `/bin/sh` 与真实 `docker run`，
 * 断言取自真实进程状态（`pgrep` 查孤儿、真实 stdout/stderr/exitCode）。
 * 只 mock electron（拿 userData 路径）与 safeStorage。
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ── electron mock（必须在业务模块 import 之前由 vitest 提升） ──
vi.mock('electron', () => {
  const os = require('os')
  const path = require('path')
  const fss = require('fs')
  const dir = fss.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-sbx-store-'))
  return {
    app: { getPath: () => dir, on: () => {}, off: () => {} },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: any) => Buffer.from(b).toString('utf-8'),
    },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import { SandboxRouter } from '../src/main/modules/security/sandbox/SandboxRouter'
import { clearConfigCache, resetConfig, updateConfig } from '../src/main/modules/security/sandbox/SandboxStore'
import {
  buildSandboxEnv,
  buildShellInvocation,
  createSandboxTempDir,
  removeSandboxTempDir,
  runProcess,
  SANDBOX_TMP_PREFIX,
} from '../src/main/modules/security/sandbox/SandboxProcess'

// ============================================================
// 夹具与工具
// ============================================================

/** 测试用临时目录（作为 cwd） */
let tmpCwd = ''
/** 原始 PATH（改完必须还原，否则污染其它用例） */
const originalPath = process.env.PATH

/** 唯一时长标记，避免 pgrep 误伤同名的无关进程 */
const SLEEP_MARK_A = '4.711'
const SLEEP_MARK_B = '4.712'

/**
 * 测试镜像。
 *
 * 刻意用本机已存在的 `nginx:alpine`（alpine 基础镜像，自带 busybox 的 `/bin/sh` 与 `wget`），
 * 并关掉 `pullOnDemand`：验收测试不能因为「要拉一个几百 MB 的镜像」而跑十分钟，
 * 也不能在无外网环境里必然失败。镜像不存在时相关用例如实跳过并打印原因。
 */
const TEST_IMAGE = 'nginx:alpine'

/** 网络隔离探针：`wget` 必须存在于镜像内，否则「命令找不到」会被误判成「断网成功」 */
const NET_PROBE_CMD = 'wget -q -T 8 -O- https://example.com'

/** 统计匹配某命令行模式的进程数 */
function countProcesses(pattern: string): number {
  try {
    const out = execSync(`pgrep -f "${pattern}"`, { encoding: 'utf-8' }).trim()
    return out ? out.split('\n').length : 0
  } catch {
    // pgrep 无匹配时退出码为 1
    return 0
  }
}

/** 本机是否存在测试镜像 */
function hasTestImage(): boolean {
  try {
    execSync(`docker image inspect ${TEST_IMAGE} --format '{{.Id}}'`, {
      stdio: 'ignore',
      timeout: 10_000,
    })
    return true
  } catch {
    return false
  }
}

/**
 * 构造一个干净的 Router + 指定策略。
 *
 * 先 `resetConfig()` 再打补丁：`updateConfig` 是深合并，
 * 不回默认值会让上一条用例的 `policy` / `docker.network` 泄漏到这一条。
 */
function makeRouterWith(patch: Record<string, unknown>): SandboxRouter {
  clearConfigCache()
  resetConfig()
  updateConfig(patch)
  return new SandboxRouter()
}

/** docker 用例共用的补丁（固定镜像 + 关闭自动拉取） */
function dockerPatch(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policy: 'docker',
    allowFallback: false,
    timeoutMs: 60_000,
    docker: { image: TEST_IMAGE, pullOnDemand: false, network: false },
    ...extra,
  }
}

beforeAll(() => {
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-sbx-cwd-'))
})

afterAll(() => {
  process.env.PATH = originalPath
  try {
    fs.rmSync(tmpCwd, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
})

beforeEach(() => {
  process.env.PATH = originalPath
})

// ============================================================
// 1. off 策略：完全不接管
// ============================================================

describe('off 策略（默认）', () => {
  it('handled=false，命令不经过沙箱', async () => {
    const router = makeRouterWith({ policy: 'off' })
    const outcome = await router.execute('echo should-not-run-here', tmpCwd)
    expect(outcome.handled).toBe(false)
    expect('result' in outcome).toBe(false)
  })

  it('off 状态下不累计任何执行计数', async () => {
    const router = makeRouterWith({ policy: 'off' })
    await router.execute('echo a', tmpCwd)
    const status = await router.getStatus()
    expect(status.totalRuns).toBe(0)
    expect(status.refusedRuns).toBe(0)
  })

  it('off 状态下 activeProvider 为 null（不会误报为已保护）', async () => {
    const router = makeRouterWith({ policy: 'off' })
    const status = await router.getStatus()
    expect(status.activeProvider).toBeNull()
  })

  it('默认配置即 off（新装不改变既有行为）', async () => {
    clearConfigCache()
    resetConfig()
    const router = new SandboxRouter()
    const outcome = await router.execute('echo default-off', tmpCwd)
    expect(outcome.handled).toBe(false)
  })
})

// ============================================================
// 2. local 后端：正常执行 / 超时 / 截断
// ============================================================

describe('local 后端', () => {
  it('基本执行：stdout 与 exitCode 正确', async () => {
    const router = makeRouterWith({ policy: 'local', workDirMode: 'workspace' })
    const outcome = await router.execute('echo sandbox-ok', tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.provider).toBe('local')
    expect(outcome.result.stdout.trim()).toBe('sandbox-ok')
    expect(outcome.result.exitCode).toBe(0)
    expect(outcome.result.success).toBe(true)
  })

  it('超时：命令被终止，timedOut 与超时提示都带出', async () => {
    const router = makeRouterWith({ policy: 'local', timeoutMs: 1000 })
    const started = Date.now()
    const outcome = await router.execute(`sleep ${SLEEP_MARK_A}`, tmpCwd)
    const elapsed = Date.now() - started

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.timedOut).toBe(true)
    expect(outcome.result.success).toBe(false)
    // 必须显著短于 sleep 时长，证明确实是「被终止」而不是「等它自然结束」
    expect(elapsed).toBeLessThan(4000)
    expect(outcome.result.notes.join('\n')).toMatch(/未结束|终止/)
  })

  it('超时后整个进程组被回收（无孤儿 sleep）', async () => {
    const router = makeRouterWith({ policy: 'local', timeoutMs: 1000 })
    expect(countProcesses(`sleep ${SLEEP_MARK_B}`)).toBe(0)

    // 两个后台子进程：只杀 sh 的话它们会活下来（这正是需要进程组回收的原因）
    await router.execute(`sleep ${SLEEP_MARK_B} & sleep ${SLEEP_MARK_B}`, tmpCwd)

    await new Promise((r) => setTimeout(r, 800))
    expect(countProcesses(`sleep ${SLEEP_MARK_B}`)).toBe(0)
  })

  it('输出超限：截断并显式标记，不静默丢内容', async () => {
    const router = makeRouterWith({ policy: 'local', maxOutputBytes: 4096, timeoutMs: 30_000 })
    // 20480 字节 'a'，远超 4096 上限
    const outcome = await router.execute(
      `dd if=/dev/zero bs=1024 count=20 2>/dev/null | tr '\\0' 'a'`,
      tmpCwd,
    )

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.stdoutTruncated).toBe(true)
    expect(outcome.result.stdout).toMatch(/\[truncated: output exceeded 4096 bytes\]/)
    expect(outcome.result.notes.join('\n')).toMatch(/已截断/)
  })

  it('环境变量白名单：宿主 secret 不进入沙箱', async () => {
    const router = makeRouterWith({ policy: 'local' })
    process.env.AWEE_SANDBOX_TEST_SECRET = 'leak-me'

    const outcome = await router.execute('printenv AWEE_SANDBOX_TEST_SECRET', tmpCwd)

    delete process.env.AWEE_SANDBOX_TEST_SECRET
    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    // printenv 找不到变量 → 退出码 1，且 stdout 为空
    expect(outcome.result.stdout).not.toContain('leak-me')
    expect(outcome.result.exitCode).not.toBe(0)
  })

  it('沙箱标记位与禁止 ANSI 颜色变量已注入', async () => {
    const router = makeRouterWith({ policy: 'local' })
    const outcome = await router.execute('printenv AWEE_SANDBOX; printenv NO_COLOR', tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.stdout).toContain('1')
  })

  it('运行期提示如实声明能力缺口（不假装已隔离网络）', async () => {
    const router = makeRouterWith({ policy: 'local' })
    const outcome = await router.execute('echo hi', tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.notes.join('\n')).toMatch(/未.*隔离网络/)
  })

  it('temp 工作目录模式下，命令看不到项目文件', async () => {
    const router = makeRouterWith({ policy: 'local', workDirMode: 'temp' })
    const outcome = await router.execute('pwd', tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    const cwd = outcome.result.stdout.trim()
    expect(cwd).toContain('aweeclaw-sandbox-')
    expect(cwd).not.toBe(tmpCwd)
  })
})

// ============================================================
// 3. 降级链与严格模式
// ============================================================

describe('降级链', () => {
  it('docker 不可用 → 降级 local，且原因留痕', async () => {
    // 把 PATH 指向空目录：docker 探测 ENOENT，等价于「机器上没装 docker」
    const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-nodocker-'))
    const router = makeRouterWith({ policy: 'docker', allowFallback: true })
    process.env.PATH = emptyBin

    const probes = await router.probeAll(true)
    expect(probes.find((p) => p.kind === 'docker')?.available).toBe(false)

    const outcome = await router.execute('echo degraded', tmpCwd)

    process.env.PATH = originalPath
    fs.rmSync(emptyBin, { recursive: true, force: true })

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.provider).toBe('local')
    expect(outcome.result.stdout.trim()).toBe('degraded')
    expect(outcome.result.degradations.length).toBeGreaterThan(0)
    expect(outcome.result.degradations[0].from).toBe('docker')
    expect(outcome.result.degradations[0].to).toBe('local')
    expect(outcome.result.degradations[0].reason).toMatch(/docker/)
  })

  it('严格模式（allowFallback=false）→ 拒绝执行，命令未运行', async () => {
    const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-strict-'))
    const marker = path.join(tmpCwd, 'strict-should-not-exist.txt')
    const router = makeRouterWith({ policy: 'docker', allowFallback: false })
    process.env.PATH = emptyBin

    const outcome = await router.execute(`touch ${marker}`, tmpCwd)

    process.env.PATH = originalPath
    fs.rmSync(emptyBin, { recursive: true, force: true })

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.refused).toBe(true)
    expect(outcome.result.provider).toBe('off')
    expect(fs.existsSync(marker)).toBe(false)

    const status = await router.getStatus()
    expect(status.refusedRuns).toBe(1)
  })

  it('e2b 未配置 Key / 未装 SDK 时不可用，并给出可执行的原因', async () => {
    const router = makeRouterWith({ policy: 'e2b', e2b: { apiKey: '' } })
    const probes = await router.probeAll(true)
    const e2bProbe = probes.find((p) => p.kind === 'e2b')

    expect(e2bProbe).toBeDefined()
    if (e2bProbe && !e2bProbe.available) {
      expect(e2bProbe.reason).toMatch(/E2B SDK|API Key/)
    }
  })

  it('e2b 策略在云后端不可用时沿链降级，最终落到可用后端', async () => {
    const router = makeRouterWith({
      policy: 'e2b',
      allowFallback: true,
      e2b: { apiKey: '' },
      docker: { image: TEST_IMAGE, pullOnDemand: false },
    })
    const outcome = await router.execute('echo via-e2b-chain', tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.provider).not.toBe('off')
    expect(outcome.result.degradations.length).toBeGreaterThan(0)
  }, 120_000)
})

// ============================================================
// 4. 纯工具函数
// ============================================================

describe('SandboxProcess 工具函数', () => {
  it('buildShellInvocation 把整条命令作为单个 argv 元素传入（无拼接注入面）', () => {
    const evil = 'echo "a; rm -rf /" && echo done'
    const inv = buildShellInvocation(evil)

    if (process.platform === 'win32') {
      expect(inv.file).toBe('cmd.exe')
      expect(inv.args[inv.args.length - 1]).toBe(evil)
    } else {
      expect(inv.file).toBe('/bin/sh')
      expect(inv.args).toEqual(['-c', evil])
    }
  })

  it('buildSandboxEnv：temp 模式把 HOME/TMP 指向沙箱目录，workspace 模式保留真实 HOME', () => {
    const sandboxDir = '/tmp/aweeclaw-sandbox-xyz'
    const tempEnv = buildSandboxEnv('temp', sandboxDir)
    expect(tempEnv.HOME).toBe(sandboxDir)
    expect(tempEnv.TMPDIR).toBe(sandboxDir)
    expect(tempEnv.NO_COLOR).toBe('1')
    expect(tempEnv.AWEE_SANDBOX).toBe('1')

    const wsEnv = buildSandboxEnv('workspace', sandboxDir)
    if (process.env.HOME) {
      expect(wsEnv.HOME).toBe(process.env.HOME)
    }
  })

  it('runProcess：超时返回 timedOut 且不抛异常', async () => {
    const outcome = await runProcess({
      file: '/bin/sh',
      args: ['-c', `sleep ${SLEEP_MARK_A}`],
      cwd: tmpCwd,
      env: buildSandboxEnv('workspace', tmpCwd),
      timeoutMs: 800,
      maxOutputBytes: 4096,
    })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.spawnError).toBe('')
  })

  it('runProcess：可执行文件不存在时以 spawnError 收敛而非抛异常', async () => {
    const outcome = await runProcess({
      file: 'definitely-not-a-real-binary-aweeclaw',
      args: [],
      cwd: tmpCwd,
      env: buildSandboxEnv('workspace', tmpCwd),
      timeoutMs: 2000,
      maxOutputBytes: 4096,
    })
    expect(outcome.spawnError).not.toBe('')
    expect(outcome.exitCode).toBeNull()
  })

  it('runProcess：stdin 被关闭，等待输入的命令不会挂死', async () => {
    const started = Date.now()
    const outcome = await runProcess({
      file: '/bin/sh',
      args: ['-c', 'cat'],
      cwd: tmpCwd,
      env: buildSandboxEnv('workspace', tmpCwd),
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    })
    // `cat` 读到 EOF 立即结束，而不是等到 5s 超时
    expect(outcome.timedOut).toBe(false)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('临时目录：创建的目录带沙箱前缀，删除后消失', () => {
    const dir = createSandboxTempDir()
    expect(path.basename(dir).startsWith(SANDBOX_TMP_PREFIX)).toBe(true)
    expect(fs.existsSync(dir)).toBe(true)
    removeSandboxTempDir(dir)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('临时目录：前缀不符时拒绝删除（防止误删用户目录）', () => {
    const innocent = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-innocent-'))
    removeSandboxTempDir(innocent)
    expect(fs.existsSync(innocent)).toBe(true)
    fs.rmSync(innocent, { recursive: true, force: true })
  })
})

// ============================================================
// 5. docker 真实链路
// ============================================================

describe('docker 后端', () => {
  const imageReady = hasTestImage()

  it('本机测试镜像可用性（不满足时后续用例如实跳过）', () => {
    if (!imageReady) {
      console.warn(`[sandbox-verify] 镜像 ${TEST_IMAGE} 不存在，docker 真实链路用例将跳过`)
    }
    expect(true).toBe(true)
  })

  it('容器内可见挂载的工作目录（隔离不等于不可用）', async () => {
    if (!imageReady) return
    const router = makeRouterWith(dockerPatch())
    const probes = await router.probeAll(true)
    if (!probes.find((p) => p.kind === 'docker')?.available) return

    const outcome = await router.execute('ls /work >/dev/null && echo workdir-ok', tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.provider).toBe('docker')
    expect(outcome.result.degradations).toEqual([])
    expect(outcome.result.stdout).toContain('workdir-ok')
  }, 120_000)

  it('网络隔离：同一命令在 bridge 下成功、在 --network=none 下失败', async () => {
    if (!imageReady) return

    // ① 对照组：放开网络，先证明「这条命令在这个镜像里本来是能成功的」
    const onlineRouter = makeRouterWith(dockerPatch({ docker: { image: TEST_IMAGE, pullOnDemand: false, network: true } }))
    const onlineProbes = await onlineRouter.probeAll(true)
    if (!onlineProbes.find((p) => p.kind === 'docker')?.available) return

    const online = await onlineRouter.execute(NET_PROBE_CMD, tmpCwd)
    expect(online.handled).toBe(true)
    if (!online.handled) return

    if (online.result.exitCode !== 0) {
      // 本机无外网：无法做对照，如实跳过（不把「本来就上不了网」伪装成隔离生效）
      console.warn('[sandbox-verify] 本机无外网，跳过网络隔离对照断言')
      return
    }

    // ② 实验组：同一条命令、同一个镜像，只把 network 关掉
    const offlineRouter = makeRouterWith(dockerPatch())
    const offline = await offlineRouter.execute(NET_PROBE_CMD, tmpCwd)
    expect(offline.handled).toBe(true)
    if (!offline.handled) return

    expect(offline.result.provider).toBe('docker')
    expect(offline.result.exitCode).not.toBe(0)
    // 关键区分：失败原因是「网络不通」，而不是「镜像里没有 wget」
    expect(offline.result.stderr).not.toMatch(/not found|No such file/i)
    expect(offline.result.stderr).toMatch(
      /bad address|unreachable|Temporary failure|timed out|refused|resolve/i,
    )
    expect(offline.result.notes.join('\n')).toMatch(/断网/)
  }, 300_000)

  it('超时：容器被强制删除（docker rm -f 生效，无残留容器）', async () => {
    if (!imageReady) return
    const router = makeRouterWith(dockerPatch({ timeoutMs: 3000 }))
    const probes = await router.probeAll(true)
    if (!probes.find((p) => p.kind === 'docker')?.available) return

    const outcome = await router.execute(`sleep ${SLEEP_MARK_A}`, tmpCwd)

    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return
    expect(outcome.result.timedOut).toBe(true)

    await new Promise((r) => setTimeout(r, 1500))
    const leftovers = execSync(
      `docker ps -a --filter name=aweeclaw-sbx- --format '{{.Names}}'`,
      { encoding: 'utf-8' },
    ).trim()
    expect(leftovers).toBe('')
  }, 180_000)

  it('容器内以宿主用户身份运行（挂载目录不会写成 root 所有）', async () => {
    if (!imageReady) return
    const router = makeRouterWith(dockerPatch())
    const probes = await router.probeAll(true)
    if (!probes.find((p) => p.kind === 'docker')?.available) return

    const outcome = await router.execute('id -u', tmpCwd)
    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return

    if (process.platform !== 'win32' && typeof process.getuid === 'function') {
      expect(outcome.result.stdout.trim()).toBe(String(process.getuid()))
    }
  }, 120_000)
})

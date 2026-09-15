/**
 * 本地沙箱后端（受限子进程）
 *
 * 定位：**零依赖兜底**。docker 不可用、用户没装容器运行时的情况下，
 * 它至少能提供「超时 + 输出上限 + 环境变量白名单 + 进程组回收」这四件事。
 *
 * ⚠️ 必须如实声明的能力缺口（UI 与运行期提示都要带）：
 *   · **不阻断网络**：Node 没有在裸进程层面断网的能力（没有 netns / seccomp），
 *     `curl` / `npm install` 照常出网。要真断网只能用 docker。
 *   · **不隐藏文件系统**：只换了 cwd，绝对路径依然可达（`cat /etc/passwd` 能成功）。
 *
 * 也就是说：local 后端防的是「AI 写出失控的长命令 / 死循环 / 破坏性脚本」，
 * **不防**「恶意代码主动外联或读取任意文件」。这个边界必须让用户看见，
 * 不能让「开了沙箱」给人一种「已经安全了」的错觉。
 *
 * @module security/sandbox/LocalSandboxProvider
 */

import type { SandboxConfig, SandboxProbe, SandboxProviderKind, SandboxRunResult } from '@shared/protocols/sandboxProtocol'
import { SANDBOX_CAPABILITIES } from '@shared/protocols/sandboxProtocol'
import type { SandboxProvider, SandboxRunContext, SandboxRunRequest } from './SandboxProvider'
import {
  buildSandboxEnv,
  buildShellInvocation,
  createSandboxTempDir,
  describeTruncation,
  removeSandboxTempDir,
  runProcess,
} from './SandboxProcess'

export class LocalSandboxProvider implements SandboxProvider {
  readonly kind: SandboxProviderKind = 'local'

  async probe(): Promise<SandboxProbe> {
    // 本地子进程没有外部依赖，永远可用；`detail` 用于在设置页如实呈现能力边界
    return {
      kind: this.kind,
      available: true,
      reason: '',
      detail: `受限子进程（${process.platform}）· 无网络隔离 · 无文件系统隔离`,
      capabilities: SANDBOX_CAPABILITIES.local,
    }
  }

  async run(
    req: SandboxRunRequest,
    config: SandboxConfig,
    ctx: SandboxRunContext,
  ): Promise<SandboxRunResult> {
    // 工作目录：temp 模式新建空目录（纯计算），workspace 模式在请求的 cwd 内执行
    let workDir = req.cwd
    let tempDir: string | null = null
    if (config.workDirMode === 'temp') {
      tempDir = createSandboxTempDir()
      workDir = tempDir
    }

    try {
      const env = buildSandboxEnv(config.workDirMode, workDir)
      const shell = buildShellInvocation(req.command)

      const outcome = await runProcess({
        file: shell.file,
        args: shell.args,
        cwd: workDir,
        env,
        timeoutMs: req.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
      })

      const notes = [
        'local 后端：已限制超时 / 输出 / 环境变量，但**未**隔离网络与文件系统',
      ]
      notes.push(...describeTruncation(outcome.stdoutTruncated, outcome.stderrTruncated, config.maxOutputBytes))

      if (outcome.timedOut) {
        notes.push(`命令超过 ${Math.round(req.timeoutMs / 1000)}s 未结束，已终止其整个进程组`)
      }
      if (outcome.spawnError) {
        notes.push(`子进程启动失败：${outcome.spawnError}`)
      }

      return {
        success: !outcome.timedOut && !outcome.spawnError && outcome.exitCode === 0,
        stdout: outcome.stdout,
        stderr: outcome.spawnError ? `${outcome.spawnError}\n${outcome.stderr}` : outcome.stderr,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        stdoutTruncated: outcome.stdoutTruncated,
        stderrTruncated: outcome.stderrTruncated,
        durationMs: outcome.durationMs,
        provider: this.kind,
        degradations: ctx.degradations,
        notes,
        // `sh` 起不来属于环境故障（降级链已到底，无从再降），标出来让上层如实归因
        infrastructureFailure: outcome.spawnError !== '',
      }
    } finally {
      if (tempDir) removeSandboxTempDir(tempDir)
    }
  }

  async dispose(): Promise<void> {
    // 无长驻资源：每次执行都是「起进程 → 收敛 → 回收」
    void 0
  }
}

/**
 * Docker 沙箱后端（容器隔离，**推荐**）
 *
 * 相对 local 后端，它补上了两处 Node 层面做不到的能力：
 *   · **网络隔离**：`--network=none`，`curl` / `npm install` 直接失败
 *   · **文件系统隔离**：只挂载一个工作目录，容器内看不到宿主其它路径
 *
 * 硬化的默认参数：
 *   `--rm`                        退出即销毁，不留容器
 *   `--network=none`              默认断网（放开需用户在设置里显式确认）
 *   `--memory --cpus --pids-limit` 内存 / CPU / 进程数限额（防 fork 炸弹与内存打爆）
 *   `--read-only` + `--tmpfs /tmp` 根文件系统只读，仅 /tmp 可写
 *   `--cap-drop=ALL`              丢掉全部 Linux capabilities
 *   `--security-opt no-new-privileges` 禁止提权
 *   `--user <uid>:<gid>`          以宿主用户身份运行，避免挂载目录被写成一堆 root 文件
 *
 * ⚠️ 两个真实约束（必须让用户知道，否则会以为是 bug）：
 *   1. **镜像必须自带 `/bin/sh`**。distroless 之类没有 shell 的镜像无法承载命令行，
 *      本模块固定用 `--entrypoint=/bin/sh -c <cmd>`（不做镜像探测，避免每次执行多一次往返）。
 *   2. **杀掉 docker CLI 不会停掉容器**。CLI 只是客户端，所以超时路径必须
 *      `docker rm -f <name>`；同时容器名登记在册，模块退出时统一兜底清理。
 *
 * @module security/sandbox/DockerSandboxProvider
 */

import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  SandboxConfig,
  SandboxProbe,
  SandboxProviderKind,
  SandboxRunResult,
} from '@shared/protocols/sandboxProtocol'
import { SANDBOX_CAPABILITIES } from '@shared/protocols/sandboxProtocol'
import type { SandboxProvider, SandboxRunContext, SandboxRunRequest } from './SandboxProvider'
import {
  buildSandboxEnv,
  createSandboxTempDir,
  describeTruncation,
  removeSandboxTempDir,
  runProcess,
} from './SandboxProcess'

/** 探测 `docker` 可用性的超时：本机 unix socket 调用，5s 足够 */
const PROBE_TIMEOUT_MS = 5_000
/** `docker pull` 的超时：镜像动辄几百 MB，给足 10 分钟 */
const PULL_TIMEOUT_MS = 10 * 60 * 1000
/** `docker rm -f` 的超时：本地操作，10s 足够 */
const RM_TIMEOUT_MS = 10_000

/** 容器名前缀（同时作为「这是本模块创建的容器」的识别标识） */
const CONTAINER_NAME_PREFIX = 'aweeclaw-sbx-'

/** docker CLI 需要保留的宿主环境变量（DOCKER_HOST 等，白名单之外的例外） */
const DOCKER_ENV_KEYS = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']

export class DockerSandboxProvider implements SandboxProvider {
  readonly kind: SandboxProviderKind = 'docker'

  /** 在跑的容器名（模块退出 / dispose 时统一兜底 `docker rm -f`） */
  private liveContainers = new Set<string>()

  async probe(): Promise<SandboxProbe> {
    const env = this.buildDockerEnv()
    const outcome = await runProcess({
      file: 'docker',
      args: ['version', '--format', '{{.Server.Version}}'],
      cwd: process.cwd(),
      env,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 8 * 1024,
    })

    if (outcome.spawnError) {
      return {
        kind: this.kind,
        available: false,
        reason: '未找到 docker 命令，请先安装 Docker Desktop / OrbStack / colima',
        detail: '',
        capabilities: SANDBOX_CAPABILITIES.docker,
      }
    }

    if (outcome.timedOut) {
      return {
        kind: this.kind,
        available: false,
        reason: `docker 命令超时（${PROBE_TIMEOUT_MS / 1000}s）未响应，Docker 可能未启动`,
        detail: '',
        capabilities: SANDBOX_CAPABILITIES.docker,
      }
    }

    if (outcome.exitCode !== 0) {
      // 最常见的两种情况：Docker 没启动（Cannot connect to the Docker daemon）、
      // 当前用户不在 docker 组（permission denied）。原始 stderr 直接给用户比我翻译得准。
      const raw = (outcome.stderr || outcome.stdout).trim().split('\n')[0] || '未知错误'
      return {
        kind: this.kind,
        available: false,
        reason: `docker 不可用：${raw}`,
        detail: '',
        capabilities: SANDBOX_CAPABILITIES.docker,
      }
    }

    const version = (outcome.stdout || '').trim()
    return {
      kind: this.kind,
      available: true,
      reason: '',
      detail: `Docker 引擎 ${version}`,
      capabilities: SANDBOX_CAPABILITIES.docker,
    }
  }

  async run(
    req: SandboxRunRequest,
    config: SandboxConfig,
    ctx: SandboxRunContext,
  ): Promise<SandboxRunResult> {
    const docker = config.docker
    const notes: string[] = []

    // 工作目录：temp 模式新建空目录，workspace 模式挂载请求的 cwd
    let hostDir = req.cwd
    let tempDir: string | null = null
    if (config.workDirMode === 'temp') {
      tempDir = createSandboxTempDir()
      hostDir = tempDir
    }

    // 容器名唯一化：超时清理与退出清理都靠它定位
    const containerName = `${CONTAINER_NAME_PREFIX}${randomBytes(4).toString('hex')}`

    try {
      // 镜像缺失时按需拉取（关闭则直接报错让用户自己拉，避免在模型工具调用里跑十分钟）
      if (docker.pullOnDemand) {
        const pulled = await this.ensureImage(docker.image, this.buildDockerEnv())
        if (pulled) notes.push(`镜像 ${docker.image} 不存在，已自动拉取`)
      }

      const args = this.buildRunArgs(containerName, docker, hostDir, req.command)
      this.liveContainers.add(containerName)

      const outcome = await runProcess({
        file: 'docker',
        args,
        cwd: process.cwd(),
        env: this.buildDockerEnv(),
        timeoutMs: req.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        // 关键：CLI 被杀 ≠ 容器停止，必须显式删除容器
        onTimeout: () => {
          this.removeContainer(containerName)
        },
      })

      this.liveContainers.delete(containerName)

      if (!docker.network) {
        notes.push('容器已断网（--network=none）：任何出网请求都会失败')
      } else {
        notes.push('⚠️ 容器网络已放开，本次执行不具备网络隔离')
      }
      notes.push(`镜像 ${docker.image} · 内存 ${docker.memoryMb}MB · CPU ${docker.cpus} · 进程上限 ${docker.pidsLimit}`)
      notes.push(...describeTruncation(outcome.stdoutTruncated, outcome.stderrTruncated, config.maxOutputBytes))

      if (outcome.timedOut) {
        notes.push(`命令超过 ${Math.round(req.timeoutMs / 1000)}s 未结束，容器已被强制删除`)
      }
      if (outcome.spawnError) {
        notes.push(`docker 启动失败：${outcome.spawnError}`)
        // docker CLI 本身起不来，等价于后端不可用 —— 交给上层判断是否降级
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
        // docker CLI 起不来（PATH 里没有 / 权限不足）才算后端故障；
        // 镜像拉取失败、命令返回非 0 都走正常失败路径，不触发降级
        infrastructureFailure: outcome.spawnError !== '',
      }
    } finally {
      // 兜底：无论正常结束还是异常，都确认容器已消失（`--rm` 已覆盖正常路径，
      // 这里防的是「docker CLI 崩溃但容器还在」）
      this.liveContainers.delete(containerName)
      if (tempDir) removeSandboxTempDir(tempDir)
    }
  }

  async dispose(): Promise<void> {
    // 退出时兜底清理：可能因 SIGTERM 竞态而残留的容器
    for (const name of Array.from(this.liveContainers)) {
      this.removeContainer(name)
    }
    this.liveContainers.clear()
  }

  // ============================================
  // 私有
  // ============================================

  /** 构造 docker CLI 的环境（白名单 + docker 专属变量） */
  private buildDockerEnv(): Record<string, string> {
    const env = buildSandboxEnv('workspace', process.cwd())
    for (const key of DOCKER_ENV_KEYS) {
      const value = process.env[key]
      if (typeof value === 'string' && value.length > 0) env[key] = value
    }
    return env
  }

  /**
   * 组装 `docker run` 参数。
   *
   * `command` 整体作为**单个 argv 元素**附在 `-c` 之后，不存在拼接注入面；
   * 且它只在容器内部被解释，宿主 shell 从不接触这条字符串。
   */
  private buildRunArgs(
    containerName: string,
    docker: SandboxConfig['docker'],
    hostDir: string,
    command: string,
  ): string[] {
    const args = [
      'run',
      '--rm',
      '--name', containerName,
      `--network=${docker.network ? 'bridge' : 'none'}`,
      `--memory=${docker.memoryMb}m`,
      `--cpus=${docker.cpus}`,
      `--pids-limit=${docker.pidsLimit}`,
      '--read-only',
      '--tmpfs', '/tmp:rw,size=64m',
      '--cap-drop=ALL',
      '--security-opt', 'no-new-privileges',
    ]

    // 以宿主用户身份运行：否则挂载目录会被写成一堆 root 所有文件，
    // 用户在 IDE 里连保存都做不了（macOS 上表现为「文件已锁定」）。
    const uid = typeof process.getuid === 'function' ? process.getuid() : null
    const gid = typeof process.getgid === 'function' ? process.getgid() : null
    if (uid !== null && gid !== null && process.platform !== 'win32') {
      args.push('--user', `${uid}:${gid}`)
    }

    // HOME 指向 tmpfs：`--read-only` 下进程无法写家目录，不指过去会导致
    // npm / pip / git 直接报「无法写入缓存」而非给出有用的业务错误。
    args.push('-e', 'HOME=/tmp', '-e', 'NO_COLOR=1', '-e', 'AWEE_SANDBOX=1')

    args.push('-v', `${hostDir}:/work`, '-w', '/work')
    // 固定 entrypoint：不依赖镜像的 CMD/ENTRYPOINT 约定，行为可预期
    args.push('--entrypoint', '/bin/sh', docker.image, '-c', command)

    return args
  }

  /** 确保镜像存在（不存在则拉取）。返回是否真的拉取了 */
  private async ensureImage(image: string, env: Record<string, string>): Promise<boolean> {
    const inspect = await runProcess({
      file: 'docker',
      args: ['image', 'inspect', image, '--format', '{{.Id}}'],
      cwd: process.cwd(),
      env,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 8 * 1024,
    })
    if (inspect.exitCode === 0) return false

    logger.security.info(`[Sandbox] pulling docker image: ${image}`)
    const pull = await runProcess({
      file: 'docker',
      args: ['pull', image],
      cwd: process.cwd(),
      env,
      timeoutMs: PULL_TIMEOUT_MS,
      maxOutputBytes: 256 * 1024,
    })
    if (pull.exitCode !== 0) {
      // 拉取失败不在这里抛：交给随后的 `docker run` 复现同一错误，
      // 保证错误信息来源单一（否则同一件事会有两处措辞不同的报错）
      logger.security.warn(`[Sandbox] docker pull failed: ${pull.stderr.slice(0, 500)}`)
    } else {
      logger.security.info(`[Sandbox] docker image ready: ${image}`)
    }
    return pull.exitCode === 0
  }

  /** 强制删除容器（尽力而为，不抛异常） */
  private removeContainer(name: string): void {
    if (!name.startsWith(CONTAINER_NAME_PREFIX)) return
    try {
      const child = spawn('docker', ['rm', '-f', name], {
        env: this.buildDockerEnv(),
        stdio: 'ignore',
        detached: false,
      })
      const guard = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* 已退出 */
        }
      }, RM_TIMEOUT_MS)
      guard.unref?.()
      child.on('close', () => clearTimeout(guard))
      child.on('error', () => clearTimeout(guard))
      logger.security.info(`[Sandbox] force-removed container: ${name}`)
    } catch (err) {
      logger.security.warn('[Sandbox] docker rm -f failed:', name, err)
    }
  }
}

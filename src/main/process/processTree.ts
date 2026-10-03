/**
 * 进程树终止工具（主进程专用）
 *
 * 只终止直接子进程会留下孙进程：npx / uvx 这类包装器本身只是一个壳，
 * 真正的服务进程（node / python）是它的子进程。壳被杀死后，孙进程会被 init
 * 收养并继续运行，表现为端口被占用、CPU 长期占用、应用退出后进程仍不消失。
 * 因此统一按平台终止整棵进程树。
 *
 * 依赖 child_process，只能在主进程使用，不要从 src/shared 或渲染进程引用。
 */

import { execSync } from 'child_process'

/** 子进程枚举（pgrep）的执行超时 */
const TREE_QUERY_TIMEOUT_MS = 2000
/** Windows taskkill 的执行超时 */
const TREE_KILL_TIMEOUT_MS = 5000
/** SIGTERM 之后升级为 SIGKILL 的宽限时间 */
const TREE_KILL_GRACE_MS = 800

/**
 * 枚举某个进程的全部后代 PID。
 *
 * 返回顺序保证「子进程排在父进程之前」，调用方按该顺序逐个终止时，
 * 不会出现父进程先退出、导致后代失去查询入口的情况。
 *
 * 仅用于 Unix：Windows 由 taskkill /T 负责递归。
 * pgrep 在 macOS 与 Linux 上均可用；无匹配时 pgrep 以非 0 退出，属正常情况。
 */
function listDescendantPids(rootPid: number): number[] {
  const ordered: number[] = []

  const collect = (pid: number): void => {
    let output = ''
    try {
      output = execSync(`pgrep -P ${pid}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: TREE_QUERY_TIMEOUT_MS,
      }).toString()
    } catch {
      return
    }

    for (const line of output.split('\n')) {
      const childPid = Number.parseInt(line.trim(), 10)
      if (!Number.isInteger(childPid) || childPid <= 0) continue
      collect(childPid)
      ordered.push(childPid)
    }
  }

  collect(rootPid)
  return ordered
}

/**
 * 向整棵进程树发送信号。
 *
 * - Windows：taskkill /F /T 递归终止整棵树
 * - Unix：进程组组长用 -PID 一次覆盖整组；非组长（未被 detach 启动）则递归
 *   枚举后代，按「先子后父」的顺序逐个终止，最后终止根进程
 *
 * @param pid 目标进程 PID
 * @param signal 发送的信号，默认 SIGTERM
 */
export function signalProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid || pid <= 0) return

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: TREE_KILL_TIMEOUT_MS })
      return
    } catch {
      // taskkill 失败（进程通常已退出）→ 回退为直接终止该进程
    }
    try { process.kill(pid, signal) } catch { /* 进程已退出，忽略 */ }
    return
  }

  try {
    // 以 detached 方式启动的子进程，其 PID 即进程组 ID，一次信号覆盖整组
    process.kill(-pid, signal)
    return
  } catch {
    // 不是进程组组长或进程已退出 → 递归终止后代
  }

  for (const childPid of listDescendantPids(pid)) {
    try { process.kill(childPid, signal) } catch { /* 进程已退出，忽略 */ }
  }
  try { process.kill(pid, signal) } catch { /* 进程已退出，忽略 */ }
}

/**
 * 终止进程树并确保最终被杀死：先 SIGTERM 优雅退出，宽限期后升级为 SIGKILL。
 *
 * SIGTERM 可能被目标进程忽略（如 python 的 C 扩展、守护线程），
 * 因此用于「命令超时 / 会话中止 / 断开连接 / 应用退出」等必须无残留的场景。
 *
 * @param pid 目标进程 PID
 */
export function hardKillProcessTree(pid: number | undefined | null): void {
  if (!pid || pid <= 0) return

  // 先快照整棵树的 PID：SIGTERM 发出后父进程可能先退出，届时再按父子关系枚举
  // 会丢失后代（pgrep -P 查不到已故父进程的子孙），忽略 SIGTERM 的 python / node
  // 残留就无法升级为 SIGKILL，长期占用 CPU。快照保证这些后代仍能被强杀。
  const snapshot =
    process.platform === 'win32' ? [pid] : [...listDescendantPids(pid), pid]

  signalProcessTree(pid, 'SIGTERM')

  const killer = setTimeout(() => {
    if (process.platform !== 'win32') {
      // 按「先子后父」逐个 SIGKILL：即使根进程已退出，也能清掉快照里的后代
      for (const target of snapshot) {
        try { process.kill(target, 'SIGKILL') } catch { /* 进程已退出，忽略 */ }
      }
    }
    // 兜底：进程组仍存活（detached 启动）时按组再补一次，覆盖快照后新生的子进程
    signalProcessTree(pid, 'SIGKILL')
  }, TREE_KILL_GRACE_MS)
  killer.unref?.()
}

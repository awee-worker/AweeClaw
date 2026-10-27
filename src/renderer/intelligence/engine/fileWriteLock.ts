/**
 * 文件写入锁
 *
 * 并行子任务与并行工具批次同处一个渲染进程，彼此看不到对方的执行进度。
 * 同一个文件被两个调用同时写入时，后落盘的会覆盖先落盘的内容；
 * edit_file 更麻烦，它是读—改—写三步，一旦交错就会把对方的修改整段抹掉。
 *
 * 这里给写入类工具加一层按路径的进程内互斥：
 * - 只有路径冲突的写入排队，写不同文件的调用照常并行；
 * - 锁的粒度是一次工具调用，执行完立刻释放，任务整体再久也不会长期占用；
 * - 目录锁覆盖其下所有路径，删除目录不会与目录内文件的写入同时进行。
 */

import { isDirectoryTargetPath, pathHasPrefix, resolveToolPathInput } from '@shared/toolkit/pathHelper'

/** 一次写入会涉及到的目标 */
export interface FileLockTarget {
  /** 展开并折叠后的绝对路径，作为互斥比较的基准 */
  path: string
  /** 目标是否为目录：目录锁与其下所有路径互斥 */
  directory?: boolean
}

/** 会改动文件内容的工具 */
const FILE_WRITE_TOOLS = new Set<string>([
  'write_file',
  'edit_file',
  'create_file_or_folder',
  'delete_file_or_folder',
  'write_scenario_file',
])

/** 各工具承载目标路径的参数名，按优先级排列 */
const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'targetPath', 'target_path']

interface LockHolder {
  targets: FileLockTarget[]
}

interface LockWaiter {
  targets: FileLockTarget[]
  grant: (release: () => void) => void
}

/** 当前持有锁的调用 */
const holders = new Set<LockHolder>()
/** 等待锁的调用，按到达顺序排队 */
const waiters: LockWaiter[] = []

function isTargetConflict(a: FileLockTarget, b: FileLockTarget): boolean {
  if (a.path === b.path) return true
  if (a.directory && pathHasPrefix(b.path, a.path)) return true
  if (b.directory && pathHasPrefix(a.path, b.path)) return true
  return false
}

function hasConflict(targets: FileLockTarget[], holder: LockHolder): boolean {
  return targets.some(target => holder.targets.some(other => isTargetConflict(target, other)))
}

/**
 * 尝试一次性拿到全部目标（整体获取，不会出现只拿到一半的中间态）
 *
 * @returns 释放函数；与现有持有者冲突时返回 null
 */
function tryGrant(targets: FileLockTarget[]): (() => void) | null {
  for (const holder of holders) {
    if (hasConflict(targets, holder)) return null
  }

  const holder: LockHolder = { targets }
  holders.add(holder)

  let released = false
  return () => {
    if (released) return
    released = true
    holders.delete(holder)
    drainWaiters()
  }
}

function drainWaiters(): void {
  // 逐个尝试放行：新授予的持有者会参与后续等待者的冲突判定
  for (let i = 0; i < waiters.length; ) {
    const waiter = waiters[i]
    const release = tryGrant(waiter.targets)
    if (!release) {
      i += 1
      continue
    }
    waiters.splice(i, 1)
    waiter.grant(release)
  }
}

/**
 * 申请写入锁
 *
 * @param targets 本次调用会改动到的目标；为空表示不需要互斥，立即返回空释放函数
 */
export function acquireFileWriteLock(targets: FileLockTarget[]): Promise<() => void> {
  if (targets.length === 0) return Promise.resolve(() => {})

  const release = tryGrant(targets)
  if (release) return Promise.resolve(release)

  return new Promise<() => void>(resolve => {
    waiters.push({ targets, grant: resolve })
  })
}

/** 在锁的保护下执行，执行结束（含抛错）后释放 */
export async function withFileWriteLock<T>(
  targets: FileLockTarget[],
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireFileWriteLock(targets)
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * 从工具调用里解析出需要加锁的目标
 *
 * 非写入类工具返回空数组。路径按工作空间根展开并折叠 "." / ".."，
 * 这样 "a.ts"、"a.ts"、"../ws/a.ts" 与反斜杠写法会归一到同一个 key。
 */
export function collectFileWriteLockTargets(
  toolName: string,
  args: Record<string, unknown> | undefined,
  workspacePath: string | null,
): FileLockTarget[] {
  if (!FILE_WRITE_TOOLS.has(toolName)) return []

  const rawPath = PATH_ARG_KEYS
    .map(key => args?.[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  if (!rawPath) return []

  const resolved = resolveToolPathInput(rawPath.trim(), workspacePath)
  if (!resolved) return []

  // 统一按小写比较：桌面端文件系统（macOS / Windows）不区分大小写，
  // 同一文件写成 Src/A.ts 与 src/a.ts 必须落到同一把锁上
  const lockPath = resolved.toLowerCase()

  // 创建类工具按内容判定目录：模型创建目录时经常漏写尾斜杠
  // 删除不分文件与目录，一律按目录锁处理，避免漏掉目录内正在进行的写入
  const directory = toolName === 'delete_file_or_folder'
    || (toolName === 'create_file_or_folder' && isDirectoryTargetPath(rawPath, args?.content))

  return [{ path: lockPath, directory }]
}

/** 测试辅助：清空持有者与等待队列 */
export function resetFileWriteLockForTest(): void {
  holders.clear()
  waiters.length = 0
}

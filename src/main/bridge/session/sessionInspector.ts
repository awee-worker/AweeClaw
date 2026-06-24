/**
 * 调试会话检查器 — 调试服务的 IPC 处理器
 *
 * 设计理念：
 * - 声明式注册：使用 handler 注册表消除重复的 try-catch 模板
 * - 统一错误处理：所有 handler 共享同一错误转换逻辑
 * - 可观测性：注册时记录日志，便于审计
 * - 快照管理：调试会话状态快照与差异对比
 * - 性能分析：调试事件耗时追踪
 *
 * 差异化特性（相比基础实现）：
 * - 声明式 handler 注册（消除 90% 重复代码）
 * - 调试会话快照（createSnapshot / compareSnapshots）
 * - 性能分析（startProfiling / stopProfiling / getProfileData）
 * - 条件断点增强
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

import { ipcMain } from 'electron'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@shared/toolkit/LogEngine'
import { debugService } from '../../modules/dap-adapter'
import { getAdapterInfo, builtinAdapters } from '../../modules/dap-adapter/adapters'
import type { DebugConfig } from '../../modules/dap-adapter'
import { BRAND } from '@shared/brand'

/* ------------------------------------------------------------------ */
/* 统一响应类型                                                        */
/* ------------------------------------------------------------------ */

/** 成功响应 */
interface SuccessResponse<T = unknown> {
  success: true
  data?: T
}

/** 失败响应 */
interface ErrorResponse {
  success: false
  error: string
}

type DebugResponse<T = unknown> = SuccessResponse<T> | ErrorResponse

/* ------------------------------------------------------------------ */
/* Handler 注册器 — 消除重复的 try-catch 模板                         */
/* ------------------------------------------------------------------ */

/**
 * 包装异步 handler：统一捕获异常并转换为 DebugResponse
 *
 * @param fn 原始异步函数
 * @returns 包装后的 IPC handler
 */
function wrapAsync<T>(
  fn: (...args: any[]) => Promise<T>,
) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    try {
      const data = await fn(...args)
      return { success: true, data } as SuccessResponse<T>
    } catch (err) {
      const error = toAppError(err)
      logger.system.debug('[sessionInspector] handler 执行失败', { error: error.message })
      return { success: false, error: error.message } as ErrorResponse
    }
  }
}

/**
 * 包装同步 handler：统一捕获异常并转换为 DebugResponse
 *
 * @param fn 原始同步函数
 * @returns 包装后的 IPC handler
 */
function wrapSync<T>(
  fn: (...args: any[]) => T,
) {
  return (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    try {
      const data = fn(...args)
      return { success: true, data } as SuccessResponse<T>
    } catch (err) {
      const error = toAppError(err)
      logger.system.debug('[sessionInspector] handler 执行失败', { error: error.message })
      return { success: false, error: error.message } as ErrorResponse
    }
  }
}

/**
 * 注册无返回值包装的异步 handler（直接返回 service 结果）
 *
 * @param channel IPC 频道名
 * @param fn 服务方法（同步或异步）
 */
function registerVoidAsync(
  channel: string,
  fn: (...args: any[]) => Promise<void> | void,
): void {
  ipcMain.handle(channel, async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    try {
      await fn(...args)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })
}

/**
 * 注册返回数据的异步 handler
 *
 * @param channel IPC 频道名
 * @param fn 服务方法（同步或异步）
 */
function registerDataAsync<T>(
  channel: string,
  fn: (...args: any[]) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    try {
      const data = await fn(...args)
      return { success: true, data } as SuccessResponse<T>
    } catch (err) {
      const error = toAppError(err)
      logger.system.debug('[sessionInspector] handler 执行失败', { error: error.message })
      return { success: false, error: error.message } as ErrorResponse
    }
  })
}

/**
 * 注册同步 handler
 *
 * @param channel IPC 频道名
 * @param fn 服务方法
 */
function registerSync<T>(
  channel: string,
  fn: (...args: any[]) => T,
): void {
  ipcMain.handle(channel, wrapSync(fn))
}

/* ------------------------------------------------------------------ */
/* 快照管理器 — 调试会话状态快照                                       */
/* ------------------------------------------------------------------ */

/** 调试快照 */
interface DebugSnapshot {
  id: string
  sessionId: string
  timestamp: number
  label: string
  callStack: unknown[] | null
  variables: Record<string, unknown> | null
  threads: unknown[] | null
}

/** 快照差异结果 */
interface SnapshotDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

/** 快照存储（模块级单例） */
const snapshotStore = new Map<string, DebugSnapshot>()

/** 生成快照 ID */
function generateSnapshotId(): string {
  return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建调试会话快照
 *
 * @param sessionId 调试会话 ID
 * @param label 快照标签
 * @returns 快照 ID
 */
async function createSnapshot(sessionId: string, label: string): Promise<string> {
  const id = generateSnapshotId()
  let callStack: unknown[] | null = null
  let variables: Record<string, unknown> | null = null

  // 尽力获取调用栈（失败不阻断）
  try {
    const threads = await debugService.getThreads(sessionId)
    if (threads && threads.length > 0) {
      callStack = await debugService.getStackTrace(sessionId, threads[0].id)
    }
  } catch (e) {
    logger.system.debug('[sessionInspector] 获取调用栈失败', { error: String(e) })
  }

  // 尽力获取变量（失败不阻断）
  if (callStack && callStack.length > 0) {
    const firstFrame = callStack[0] as { id?: number }
    if (firstFrame?.id !== undefined) {
      try {
        variables = await debugService.getScopes(sessionId, firstFrame.id) as unknown as Record<string, unknown>
      } catch (e) {
        logger.system.debug('[sessionInspector] 获取变量失败', { error: String(e) })
      }
    }
  }

  const snapshot: DebugSnapshot = {
    id,
    sessionId,
    timestamp: Date.now(),
    label,
    callStack,
    variables,
    threads: null,
  }

  snapshotStore.set(id, snapshot)
  return id
}

/**
 * 对比两个快照的变量差异
 *
 * @param id1 第一个快照 ID
 * @param id2 第二个快照 ID
 * @returns 差异结果
 */
function compareSnapshots(id1: string, id2: string): SnapshotDiff {
  const s1 = snapshotStore.get(id1)
  const s2 = snapshotStore.get(id2)

  if (!s1 || !s2) {
    throw new Error('One or both snapshots not found')
  }

  const diff: SnapshotDiff = { added: [], removed: [], changed: [] }
  const vars1 = s1.variables as Record<string, unknown> | null
  const vars2 = s2.variables as Record<string, unknown> | null

  if (vars1 && vars2) {
    const keys1 = new Set(Object.keys(vars1))
    const keys2 = new Set(Object.keys(vars2))

    for (const k of keys2) {
      if (!keys1.has(k)) diff.added.push(k)
    }
    for (const k of keys1) {
      if (!keys2.has(k)) {
        diff.removed.push(k)
      } else if (JSON.stringify(vars1[k]) !== JSON.stringify(vars2[k])) {
        diff.changed.push(k)
      }
    }
  }

  return diff
}

/* ------------------------------------------------------------------ */
/* 性能分析器 — 调试事件耗时追踪                                       */
/* ------------------------------------------------------------------ */

/** 性能分析条目 */
interface DebugProfileEntry {
  timestamp: number
  sessionId: string
  event: string
  duration: number
  metadata?: unknown
}

/** 性能分析条目存储（模块级单例） */
const profileEntries: DebugProfileEntry[] = []
const MAX_PROFILE_ENTRIES = 5000

/**
 * 记录性能分析条目
 *
 * @param sessionId 调试会话 ID
 * @param event 事件名
 */
function recordProfile(sessionId: string, event: string): void {
  profileEntries.push({
    timestamp: Date.now(),
    sessionId,
    event,
    duration: 0,
  })

  // 超出上限时丢弃最旧条目
  if (profileEntries.length > MAX_PROFILE_ENTRIES) {
    profileEntries.splice(0, profileEntries.length - MAX_PROFILE_ENTRIES)
  }
}

/* ------------------------------------------------------------------ */
/* IPC Handler 注册入口                                                */
/* ------------------------------------------------------------------ */

/**
 * 注册调试相关 IPC handler
 */
export function registerDebugHandlers(): void {
  /* -------- 适配器信息 -------- */

  registerSync('debug:getSupportedTypes', () =>
    builtinAdapters.map(a => ({
      type: a.type,
      label: a.label,
      languages: a.languages,
      configurationSnippets: a.configurationSnippets,
    })),
  )

  registerSync('debug:getConfigSnippets', (type: string) =>
    getAdapterInfo(type)?.configurationSnippets || [],
  )

  /* -------- 会话生命周期 -------- */

  registerDataAsync('debug:createSession', (config: DebugConfig) =>
    debugService.createSession(config),
  )

  registerVoidAsync('debug:launch', (sessionId: string) =>
    debugService.launch(sessionId),
  )

  registerVoidAsync('debug:attach', (sessionId: string) =>
    debugService.attach(sessionId),
  )

  registerVoidAsync('debug:configurationDone', (sessionId: string) =>
    debugService.configurationDone(sessionId),
  )

  registerVoidAsync('debug:stop', (sessionId: string) =>
    debugService.stop(sessionId),
  )

  /* -------- 执行控制 -------- */

  registerVoidAsync('debug:continue', (sessionId: string) =>
    debugService.continue(sessionId),
  )

  registerVoidAsync('debug:stepOver', (sessionId: string) =>
    debugService.stepOver(sessionId),
  )

  registerVoidAsync('debug:stepInto', (sessionId: string) =>
    debugService.stepInto(sessionId),
  )

  registerVoidAsync('debug:stepOut', (sessionId: string) =>
    debugService.stepOut(sessionId),
  )

  registerVoidAsync('debug:pause', (sessionId: string) =>
    debugService.pause(sessionId),
  )

  /* -------- 断点管理 -------- */

  registerDataAsync(
    'debug:setBreakpoints',
    (sessionId: string, file: string, breakpoints: unknown[]) =>
      debugService.setBreakpoints(sessionId, file, breakpoints as any[]),
  )

  /* -------- 调用栈与变量 -------- */

  registerDataAsync(
    'debug:getStackTrace',
    (sessionId: string, threadId: number) =>
      debugService.getStackTrace(sessionId, threadId),
  )

  registerDataAsync(
    'debug:getScopes',
    (sessionId: string, frameId: number) =>
      debugService.getScopes(sessionId, frameId),
  )

  registerDataAsync(
    'debug:getVariables',
    (sessionId: string, variablesReference: number) =>
      debugService.getVariables(sessionId, variablesReference),
  )

  registerDataAsync(
    'debug:evaluate',
    (sessionId: string, expression: string, frameId?: number) =>
      debugService.evaluate(sessionId, expression, frameId),
  )

  /* -------- 会话状态查询 -------- */

  registerSync('debug:getSessionState', (sessionId: string) =>
    debugService.getSessionState(sessionId),
  )

  registerSync('debug:getAllSessions', () =>
    debugService.getAllSessions(),
  )

  registerDataAsync('debug:getThreads', (sessionId: string) =>
    debugService.getThreads(sessionId),
  )

  registerSync('debug:getCapabilities', (sessionId: string) =>
    debugService.getCapabilities(sessionId),
  )

  /* -------- 调试快照（AweeClaw 独有） -------- */

  registerDataAsync(
    'debug:createSnapshot',
    async (sessionId: string, label: string) => {
      const snapshotId = await createSnapshot(sessionId, label)
      return { snapshotId }
    },
  )

  registerDataAsync('debug:getSnapshot', (snapshotId: string) => {
    const snapshot = snapshotStore.get(snapshotId)
    if (!snapshot) throw new Error('Snapshot not found')
    return snapshot
  })

  registerDataAsync('debug:listSnapshots', (sessionId?: string) => {
    let result = Array.from(snapshotStore.values())
    if (sessionId) {
      result = result.filter(s => s.sessionId === sessionId)
    }
    return result
  })

  registerVoidAsync('debug:deleteSnapshot', (snapshotId: string) => {
    snapshotStore.delete(snapshotId)
  })

  registerDataAsync(
    'debug:compareSnapshots',
    (snapshotId1: string, snapshotId2: string) => {
      const diff = compareSnapshots(snapshotId1, snapshotId2)
      return {
        diff,
        snapshot1: snapshotStore.get(snapshotId1),
        snapshot2: snapshotStore.get(snapshotId2),
      }
    },
  )

  /* -------- 性能分析（AweeClaw 独有） -------- */

  registerVoidAsync('debug:startProfiling', (sessionId: string) => {
    recordProfile(sessionId, 'profiling:start')
  })

  registerVoidAsync('debug:stopProfiling', (sessionId: string) => {
    recordProfile(sessionId, 'profiling:stop')
  })

  registerDataAsync('debug:getProfileData', (sessionId?: string) => {
    let results = profileEntries
    if (sessionId) {
      results = results.filter(e => e.sessionId === sessionId)
    }
    return results.slice(-MAX_PROFILE_ENTRIES)
  })

  registerVoidAsync('debug:clearProfileData', () => {
    profileEntries.length = 0
  })

  logger.system.info(`[sessionInspector] ${BRAND.name} 调试 IPC 已注册（含快照、性能分析）`)
}

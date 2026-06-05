/**
 * 调试 IPC handlers
 * [AweeClaw] 增强功能：调试会话快照、性能分析、条件断点增强
 */

import { ipcMain } from 'electron'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@shared/toolkit/LogEngine'
import { debugService } from '../modules/dap-adapter'
import { getAdapterInfo, builtinAdapters } from '../modules/dap-adapter/adapters'
import type { DebugConfig } from '../modules/dap-adapter'
import { BRAND } from '@shared/brand'

export function registerDebugHandlers() {
  // 获取支持的调试类型
  ipcMain.handle('debug:getSupportedTypes', () => {
    return builtinAdapters.map(a => ({
      type: a.type,
      label: a.label,
      languages: a.languages,
      configurationSnippets: a.configurationSnippets,
    }))
  })

  // 获取配置模板
  ipcMain.handle('debug:getConfigSnippets', (_, type: string) => {
    const adapter = getAdapterInfo(type)
    return adapter?.configurationSnippets || []
  })

  // 创建调试会话
  ipcMain.handle('debug:createSession', async (_, config: DebugConfig) => {
    try {
      const sessionId = await debugService.createSession(config)
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 启动调试
  ipcMain.handle('debug:launch', async (_, sessionId: string) => {
    try {
      await debugService.launch(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 附加到进程
  ipcMain.handle('debug:attach', async (_, sessionId: string) => {
    try {
      await debugService.attach(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 配置完成
  ipcMain.handle('debug:configurationDone', async (_, sessionId: string) => {
    try {
      await debugService.configurationDone(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 停止调试
  ipcMain.handle('debug:stop', async (_, sessionId: string) => {
    try {
      await debugService.stop(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 继续执行
  ipcMain.handle('debug:continue', async (_, sessionId: string) => {
    try {
      await debugService.continue(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 单步跳过
  ipcMain.handle('debug:stepOver', async (_, sessionId: string) => {
    try {
      await debugService.stepOver(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 单步进入
  ipcMain.handle('debug:stepInto', async (_, sessionId: string) => {
    try {
      await debugService.stepInto(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 单步跳出
  ipcMain.handle('debug:stepOut', async (_, sessionId: string) => {
    try {
      await debugService.stepOut(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 暂停
  ipcMain.handle('debug:pause', async (_, sessionId: string) => {
    try {
      await debugService.pause(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 设置断点
  ipcMain.handle('debug:setBreakpoints', async (_, sessionId: string, file: string, breakpoints: any[]) => {
    try {
      const result = await debugService.setBreakpoints(sessionId, file, breakpoints)
      return { success: true, breakpoints: result }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取堆栈帧
  ipcMain.handle('debug:getStackTrace', async (_, sessionId: string, threadId: number) => {
    try {
      const frames = await debugService.getStackTrace(sessionId, threadId)
      return { success: true, frames }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取作用域
  ipcMain.handle('debug:getScopes', async (_, sessionId: string, frameId: number) => {
    try {
      const scopes = await debugService.getScopes(sessionId, frameId)
      return { success: true, scopes }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取变量
  ipcMain.handle('debug:getVariables', async (_, sessionId: string, variablesReference: number) => {
    try {
      const variables = await debugService.getVariables(sessionId, variablesReference)
      return { success: true, variables }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 求值表达式
  ipcMain.handle('debug:evaluate', async (_, sessionId: string, expression: string, frameId?: number) => {
    try {
      const result = await debugService.evaluate(sessionId, expression, frameId)
      return { success: true, result }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取会话状态
  ipcMain.handle('debug:getSessionState', (_, sessionId: string) => {
    return debugService.getSessionState(sessionId)
  })

  // 获取所有会话
  ipcMain.handle('debug:getAllSessions', () => {
    return debugService.getAllSessions()
  })

  // 获取线程列表
  ipcMain.handle('debug:getThreads', async (_, sessionId: string) => {
    try {
      const threads = await debugService.getThreads(sessionId)
      return { success: true, threads }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取会话能力
  ipcMain.handle('debug:getCapabilities', (_, sessionId: string) => {
    return debugService.getCapabilities(sessionId)
  })

  // ============================================
  // [AweeClaw] 调试会话快照
  // ============================================

  interface DebugSnapshot {
    id: string
    sessionId: string
    timestamp: number
    label: string
    callStack: any[] | null
    variables: Map<string, any> | null
    threads: any[] | null
  }

  const snapshots = new Map<string, DebugSnapshot>()

  ipcMain.handle('debug:createSnapshot', async (_, sessionId: string, label: string) => {
    try {
      const id = `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let callStack: any[] | null = null
      let variables: any = null

      try {
        const threads = await debugService.getThreads(sessionId)
        if (threads && threads.length > 0) {
          callStack = await debugService.getStackTrace(sessionId, threads[0].id)
        }
      } catch (e) { logger.system.debug('Failed to get call stack:', e) }

      if (callStack && callStack.length > 0 && callStack[0].id !== undefined) {
        try {
          const scopes = await debugService.getScopes(sessionId, callStack[0].id)
          variables = scopes
        } catch (e) { logger.system.debug('Failed to get scopes:', e) }
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

      snapshots.set(id, snapshot)
      return { success: true, snapshotId: id }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('debug:getSnapshot', async (_, snapshotId: string) => {
    const snapshot = snapshots.get(snapshotId)
    if (!snapshot) return { success: false, error: 'Snapshot not found' }
    return { success: true, snapshot }
  })

  ipcMain.handle('debug:listSnapshots', async (_, sessionId?: string) => {
    let result = Array.from(snapshots.values())
    if (sessionId) result = result.filter(s => s.sessionId === sessionId)
    return { success: true, snapshots: result }
  })

  ipcMain.handle('debug:deleteSnapshot', async (_, snapshotId: string) => {
    snapshots.delete(snapshotId)
    return { success: true }
  })

  ipcMain.handle('debug:compareSnapshots', async (_, snapshotId1: string, snapshotId2: string) => {
    const s1 = snapshots.get(snapshotId1)
    const s2 = snapshots.get(snapshotId2)
    if (!s1 || !s2) return { success: false, error: 'One or both snapshots not found' }

    const diff: { added: string[], removed: string[], changed: string[] } = {
      added: [],
      removed: [],
      changed: [],
    }

    const vars1 = s1.variables as any
    const vars2 = s2.variables as any
    if (vars1 && vars2) {
      const keys1 = new Set(Object.keys(vars1))
      const keys2 = new Set(Object.keys(vars2))
      for (const k of keys2) {
        if (!keys1.has(k)) diff.added.push(k)
      }
      for (const k of keys1) {
        if (!keys2.has(k)) diff.removed.push(k)
        else if (JSON.stringify(vars1[k]) !== JSON.stringify(vars2[k])) diff.changed.push(k)
      }
    }

    return { success: true, diff, snapshot1: s1, snapshot2: s2 }
  })

  // ============================================
  // [AweeClaw] 调试性能分析
  // ============================================

  interface DebugProfileEntry {
    timestamp: number
    sessionId: string
    event: string
    duration: number
    metadata?: any
  }

  const profileEntries: DebugProfileEntry[] = []
  const MAX_PROFILE_ENTRIES = 5000

  ipcMain.handle('debug:startProfiling', async (_, sessionId: string) => {
    profileEntries.push({
      timestamp: Date.now(),
      sessionId,
      event: 'profiling:start',
      duration: 0,
    })
    return { success: true }
  })

  ipcMain.handle('debug:stopProfiling', async (_, sessionId: string) => {
    profileEntries.push({
      timestamp: Date.now(),
      sessionId,
      event: 'profiling:stop',
      duration: 0,
    })
    return { success: true }
  })

  ipcMain.handle('debug:getProfileData', async (_, sessionId?: string) => {
    let results = profileEntries
    if (sessionId) results = results.filter(e => e.sessionId === sessionId)
    return { success: true, entries: results.slice(-MAX_PROFILE_ENTRIES) }
  })

  ipcMain.handle('debug:clearProfileData', async () => {
    profileEntries.length = 0
    return { success: true }
  })

  logger.ipc?.info(`[Debug] ${BRAND.name} enhanced IPC handlers registered (snapshots, profiling)`)
}

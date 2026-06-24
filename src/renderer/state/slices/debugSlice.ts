/**
 * 调试器状态切片
 *
 * 管理断点、调试会话、调用栈、变量与控制台输出。
 */

import { StateCreator } from 'zustand'
import type {
  DebugSessionState,
  DebugStackFrame,
  DebugScope,
  DebugVariable,
} from '@renderer/types/electronBridge'

/** 控制台输出最大保留行数 */
const CONSOLE_OUTPUT_LIMIT = 200

/* ------------------------------------------------------------------ */
/* 类型                                                              */
/* ------------------------------------------------------------------ */

/** 断点定义 */
export interface Breakpoint {
  id: string
  filePath: string
  line: number
  enabled: boolean
  condition?: string
  hitCount?: number
}

/** 切片接口 */
export interface DebugSlice {
  breakpoints: Breakpoint[]
  sessions: DebugSessionState[]
  activeSessionId: string | null
  stackFrames: DebugStackFrame[]
  scopes: DebugScope[]
  variables: Map<number, DebugVariable[]>
  consoleOutput: string[]

  addBreakpoint: (filePath: string, line: number, condition?: string) => void
  removeBreakpoint: (filePath: string, line: number) => void
  toggleBreakpoint: (filePath: string, line: number) => void
  toggleBreakpointEnabled: (id: string) => void
  clearBreakpoints: (filePath?: string) => void
  getBreakpointsForFile: (filePath: string) => Breakpoint[]
  hasBreakpoint: (filePath: string, line: number) => boolean

  setSessions: (sessions: DebugSessionState[]) => void
  setActiveSessionId: (id: string | null) => void
  setStackFrames: (frames: DebugStackFrame[]) => void
  setScopes: (scopes: DebugScope[]) => void
  setVariables: (ref: number, vars: DebugVariable[]) => void
  addConsoleOutput: (text: string) => void
  clearConsoleOutput: () => void
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                          */
/* ------------------------------------------------------------------ */

/** 断点自增计数器 */
let breakpointIdCounter = 0

/** 生成断点唯一标识 */
function nextBreakpointId(): string {
  return `bp_${++breakpointIdCounter}`
}

/** 判断断点是否位于指定文件与行号 */
function isAtLocation(bp: Breakpoint, filePath: string, line: number): boolean {
  return bp.filePath === filePath && bp.line === line
}

/** 格式化控制台输出行 */
function formatConsoleLine(text: string): string {
  return `[${new Date().toLocaleTimeString()}] ${text}`
}

/* ------------------------------------------------------------------ */
/* 切片实现                                                          */
/* ------------------------------------------------------------------ */

export const createDebugSlice: StateCreator<DebugSlice, [], [], DebugSlice> = (set, get) => ({
  breakpoints: [],
  sessions: [],
  activeSessionId: null,
  stackFrames: [],
  scopes: [],
  variables: new Map(),
  consoleOutput: [],

  addBreakpoint: (filePath, line, condition) =>
    set((state) => ({
      breakpoints: [
        ...state.breakpoints,
        { id: nextBreakpointId(), filePath, line, enabled: true, condition },
      ],
    })),

  removeBreakpoint: (filePath, line) =>
    set((state) => ({
      breakpoints: state.breakpoints.filter((bp) => !isAtLocation(bp, filePath, line)),
    })),

  toggleBreakpoint: (filePath, line) => {
    const { breakpoints, addBreakpoint, removeBreakpoint } = get()
    const exists = breakpoints.some((bp) => isAtLocation(bp, filePath, line))
    if (exists) removeBreakpoint(filePath, line)
    else addBreakpoint(filePath, line)
  },

  toggleBreakpointEnabled: (id) =>
    set((state) => ({
      breakpoints: state.breakpoints.map((bp) =>
        bp.id === id ? { ...bp, enabled: !bp.enabled } : bp,
      ),
    })),

  clearBreakpoints: (filePath) =>
    set((state) => ({
      breakpoints: filePath
        ? state.breakpoints.filter((bp) => bp.filePath !== filePath)
        : [],
    })),

  getBreakpointsForFile: (filePath) =>
    get().breakpoints.filter((bp) => bp.filePath === filePath),

  hasBreakpoint: (filePath, line) =>
    get().breakpoints.some((bp) => isAtLocation(bp, filePath, line)),

  setSessions: (sessions) => set({ sessions }),

  setActiveSessionId: (id) =>
    set(() => ({
      activeSessionId: id,
      // 会话结束时清空运行时缓存
      ...(id === null ? { variables: new Map(), stackFrames: [], scopes: [] } : {}),
    })),

  setStackFrames: (frames) => set({ stackFrames: frames }),
  setScopes: (scopes) => set({ scopes }),

  setVariables: (ref, vars) =>
    set((state) => {
      const newMap = new Map(state.variables)
      newMap.set(ref, vars)
      return { variables: newMap }
    }),

  addConsoleOutput: (text) =>
    set((state) => ({
      consoleOutput: [...state.consoleOutput.slice(-(CONSOLE_OUTPUT_LIMIT - 1)), formatConsoleLine(text)],
    })),

  clearConsoleOutput: () => set({ consoleOutput: [] }),
})

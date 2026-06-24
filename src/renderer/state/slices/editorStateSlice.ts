/**
 * 编辑器运行时状态切片
 *
 * 管理编辑器初始化、LSP 就绪、光标位置与选中文本。
 */

import { StateCreator } from 'zustand'

/** 光标坐标 */
export interface CursorPosition {
  line: number
  column: number
}

/** 切片接口 */
export interface EditorStateSlice {
  isInitialized: boolean
  isLspReady: boolean
  cursorPosition: CursorPosition
  selectedCode: string

  setIsInitialized: (initialized: boolean) => void
  setIsLspReady: (ready: boolean) => void
  setCursorPosition: (pos: CursorPosition) => void
  setSelectedCode: (code: string) => void
}

/** 初始光标位置 */
const INITIAL_CURSOR: CursorPosition = { line: 1, column: 1 }

export const createEditorStateSlice: StateCreator<EditorStateSlice, [], [], EditorStateSlice> = (set) => ({
  isInitialized: false,
  isLspReady: false,
  cursorPosition: INITIAL_CURSOR,
  selectedCode: '',

  setIsInitialized: (initialized) => set({ isInitialized: initialized }),
  setIsLspReady: (ready) => set({ isLspReady: ready }),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setSelectedCode: (code) => set({ selectedCode: code }),
})

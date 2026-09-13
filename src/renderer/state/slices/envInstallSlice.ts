/**
 * 环境安装状态切片
 *
 * 追踪 Python/uv/Node.js 后台安装进度，支持：
 * - 用户关闭环境检测弹窗后继续后台安装
 * - 顶部"新对话"按钮前显示安装状态提示
 * - 点击状态提示可重新打开安装弹窗
 *
 * 注意：此状态为内存状态，不持久化。
 */

import { StateCreator } from 'zustand'

export type EnvInstallStage = 'idle' | 'installing' | 'done' | 'error'

export interface EnvInstallProgressItem {
  stage: 'downloading' | 'installing' | 'configuring' | 'done' | 'error'
  percent: number
  message: string
}

export interface EnvInstallStatus {
  /** 当前状态：idle | installing | done | error */
  state: EnvInstallStage
  /** 正在安装的运行时（第一个缺失项开始安装时设置） */
  activeId: 'python' | 'uv' | 'node' | null
  /** 各运行时的进度信息 */
  progress: Record<'python' | 'uv' | 'node', EnvInstallProgressItem | null>
  /** 整体进度百分比（0-100） */
  percent: number
  /** 整体消息 */
  message: string
  /** 是否正在安装 */
  isInstalling: boolean
}

const DEFAULT_STATUS: EnvInstallStatus = {
  state: 'idle',
  activeId: null,
  progress: { python: null, uv: null, node: null },
  percent: 0,
  message: '',
  isInstalling: false,
}

/** 更新入参：允许传部分字段，或基于当前状态计算更新内容 */
export type EnvInstallStatusUpdater =
  | Partial<EnvInstallStatus>
  | ((prev: EnvInstallStatus) => Partial<EnvInstallStatus>)

export interface EnvInstallSlice {
  envInstallStatus: EnvInstallStatus
  setEnvInstallStatus: (partial: EnvInstallStatusUpdater) => void
  resetEnvInstallStatus: () => void
}

export const createEnvInstallSlice: StateCreator<EnvInstallSlice, [], [], EnvInstallSlice> = (set) => ({
  envInstallStatus: { ...DEFAULT_STATUS },

  setEnvInstallStatus: (partial) =>
    set((state) => ({
      envInstallStatus: {
        ...state.envInstallStatus,
        ...(typeof partial === 'function' ? partial(state.envInstallStatus) : partial),
      },
    })),

  resetEnvInstallStatus: () =>
    set({ envInstallStatus: { ...DEFAULT_STATUS } }),
})

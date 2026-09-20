/**
 * 产物状态切片
 *
 * 记录 AI 执行任务过程中落盘的文件（新建 / 编辑），供「产物」面板集中展示。
 * 只保存路径与元信息，不缓存文件内容：内容统一由编辑器按需读取，
 * 避免产物一多就把内容驻留在内存里。
 */

import { StateCreator } from 'zustand'
import { normalizePath } from '@shared/toolkit/pathHelper'

/** 产物列表保留的最大条数（超出丢弃最久未更新的记录） */
const MAX_ARTIFACTS = 120

/** 产物栏高度占比下限 / 上限 */
export const ARTIFACT_RATIO_MIN = 0.15
export const ARTIFACT_RATIO_MAX = 0.7

/** 产物栏默认占比：产物 : 工作区文件 = 1 : 3 */
export const ARTIFACT_RATIO_DEFAULT = 0.25

/** 单条产物记录 */
export interface ArtifactEntry {
  /** 产物绝对路径 */
  path: string
  /** 所属工作区根路径（切换工作区后自动过滤，不需要清空列表） */
  workspacePath: string
  /** 首次落盘时间 */
  createdAt: number
  /** 最近一次落盘时间 */
  updatedAt: number
  /** 最近一次操作类型：新建 / 编辑 */
  action: 'create' | 'edit'
  /** 累计落盘次数 */
  revisions: number
  /** 目录产物（AI 建的文件夹）标记 */
  isDirectory?: boolean
}

/** 记录产物的入参 */
export interface RecordArtifactInput {
  path: string
  workspacePath: string
  action: 'create' | 'edit'
  isDirectory?: boolean
}

export interface ArtifactSlice {
  /** 产物列表，按最近更新倒序 */
  artifacts: ArtifactEntry[]
  /** 产物栏占工作区面板的高度比例，默认 0.25（产物 : 文件 = 1 : 3） */
  artifactRatio: number
  /** 产物栏是否折叠 */
  artifactCollapsed: boolean

  recordArtifact: (input: RecordArtifactInput) => void
  removeArtifact: (path: string) => void
  clearArtifacts: (workspacePath?: string) => void
  setArtifactRatio: (ratio: number) => void
  setArtifactCollapsed: (collapsed: boolean) => void
}

/** 把拖动得到的比例约束到可用区间 */
export function clampArtifactRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return ARTIFACT_RATIO_DEFAULT
  return Math.min(ARTIFACT_RATIO_MAX, Math.max(ARTIFACT_RATIO_MIN, ratio))
}

export const createArtifactSlice: StateCreator<ArtifactSlice, [], [], ArtifactSlice> = (set) => ({
  artifacts: [],
  artifactRatio: ARTIFACT_RATIO_DEFAULT,
  artifactCollapsed: false,

  recordArtifact: ({ path, workspacePath, action, isDirectory }) =>
    set((state) => {
      if (!path) return {}

      const target = normalizePath(path)
      const now = Date.now()
      const index = state.artifacts.findIndex((item) => normalizePath(item.path) === target)

      // 命中已有记录：只更新元信息并挪到队首，避免列表顺序频繁跳变
      if (index >= 0) {
        const current = state.artifacts[index]
        const existing = state.artifacts.filter((_, i) => i !== index)
        const updated: ArtifactEntry = {
          ...current,
          workspacePath: workspacePath || current.workspacePath,
          updatedAt: now,
          action,
          revisions: current.revisions + 1,
          isDirectory: isDirectory ?? current.isDirectory,
        }
        return { artifacts: [updated, ...existing] }
      }

      const entry: ArtifactEntry = {
        path: target,
        workspacePath: workspacePath || '',
        createdAt: now,
        updatedAt: now,
        action,
        revisions: 1,
        isDirectory,
      }
      return { artifacts: [entry, ...state.artifacts].slice(0, MAX_ARTIFACTS) }
    }),

  removeArtifact: (path) =>
    set((state) => {
      const target = normalizePath(path)
      return { artifacts: state.artifacts.filter((item) => normalizePath(item.path) !== target) }
    }),

  clearArtifacts: (workspacePath) =>
    set((state) => {
      if (!workspacePath) return { artifacts: [] }
      const prefix = normalizePath(workspacePath)
      return {
        artifacts: state.artifacts.filter(
          (item) => !normalizePath(item.workspacePath).startsWith(prefix),
        ),
      }
    }),

  setArtifactRatio: (ratio) => set({ artifactRatio: clampArtifactRatio(ratio) }),

  setArtifactCollapsed: (collapsed) => set({ artifactCollapsed: collapsed }),
})

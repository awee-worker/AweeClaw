/**
 * Git 状态切片
 *
 * 缓存 Git 状态、分支、Stash 与提交历史，支持批量刷新以减少渲染。
 */

import { StateCreator } from 'zustand'
import type {
  GitStatus,
  GitBranch,
  GitStashEntry,
  GitCommit,
} from '@services/gitAdapter'

/** Git 操作进行中的状态 */
export type GitOperationState = 'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'

/** 可批量更新的 Git 缓存字段 */
export type GitCacheFields = Pick<
  GitSlice,
  'gitStatus' | 'gitBranches' | 'gitStashList' | 'gitRecentCommits' | 'gitOperationState'
>

/** 切片接口 */
export interface GitSlice {
  gitStatus: GitStatus | null
  isGitRepo: boolean
  gitBranches: GitBranch[]
  gitStashList: GitStashEntry[]
  gitRecentCommits: GitCommit[]
  gitOperationState: GitOperationState
  /** 缓存上次刷新时间，用于节流 */
  _gitCacheTimestamp: number

  setGitStatus: (status: GitStatus | null) => void
  setIsGitRepo: (isRepo: boolean) => void
  setGitBranches: (branches: GitBranch[]) => void
  setGitStashList: (list: GitStashEntry[]) => void
  setGitRecentCommits: (commits: GitCommit[]) => void
  setGitOperationState: (state: GitOperationState) => void
  /** 批量更新 Git 缓存 */
  updateGitCache: (data: Partial<GitCacheFields>) => void
}

export const createGitSlice: StateCreator<GitSlice, [], [], GitSlice> = (set) => ({
  gitStatus: null,
  isGitRepo: false,
  gitBranches: [],
  gitStashList: [],
  gitRecentCommits: [],
  gitOperationState: 'normal',
  _gitCacheTimestamp: 0,

  setGitStatus: (status) => set({ gitStatus: status }),
  setIsGitRepo: (isRepo) => set({ isGitRepo: isRepo }),
  setGitBranches: (branches) => set({ gitBranches: branches }),
  setGitStashList: (list) => set({ gitStashList: list }),
  setGitRecentCommits: (commits) => set({ gitRecentCommits: commits }),
  setGitOperationState: (state) => set({ gitOperationState: state }),

  updateGitCache: (data) =>
    set({
      ...data,
      _gitCacheTimestamp: Date.now(),
    }),
})

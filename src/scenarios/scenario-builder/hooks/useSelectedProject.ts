/**
 * 共享的"当前选中项目"状态
 *
 * 通过模块级单例 + 自定义事件，让 ProjectListPanel / BuildPanel / InstallPanel /
 * PublishPanel / BuilderStatusBar 等组件共享同一个选中的项目。
 *
 * 设计要点：
 * - 不依赖 zustand store，避免污染全局 state
 * - 使用 EventTarget 派发变更事件，订阅组件自动响应
 * - 模块加载时从 localStorage 恢复上次选中
 */
import { useEffect, useState } from 'react'
import type { ScenarioProject } from '../types'
import { projectService } from '../services'

const STORAGE_KEY = 'scenario-builder:selectedProjectId'

class SelectedProjectStore {
  private current: ScenarioProject | null = null
  private loading = false
  private listeners = new Set<() => void>()
  private eventTarget = new EventTarget()

  /** 获取当前选中的项目 */
  getCurrent(): ScenarioProject | null {
    return this.current
  }

  /** 获取加载状态 */
  isLoading(): boolean {
    return this.loading
  }

  /**
   * 按 projectId 选中项目
   * @param projectId 项目 ID；传 null 表示取消选中
   */
  async selectById(projectId: string | null): Promise<void> {
    if (projectId === null) {
      this.setCurrent(null)
      return
    }

    this.loading = true
    this.notify()

    try {
      const project = await projectService.getProject(projectId)
      this.setCurrent(project)
    } catch (err) {
      console.error('[SelectedProject] Failed to load project:', err)
      this.setCurrent(null)
    } finally {
      this.loading = false
      this.notify()
    }
  }

  /** 直接设置当前项目（用于 ProjectListPanel 点击时已有完整对象） */
  setCurrent(project: ScenarioProject | null): void {
    this.current = project
    if (project) {
      try {
        localStorage.setItem(STORAGE_KEY, project.id)
      } catch {
        // 忽略 localStorage 不可用情况
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    }
    this.notify()
  }

  /**
   * 刷新当前项目（从 DB 重新读取最新数据）
   */
  async refresh(): Promise<void> {
    if (!this.current) return
    await this.selectById(this.current.id)
  }

  /** 订阅状态变更 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    const evtListener = () => listener()
    this.eventTarget.addEventListener('change', evtListener)
    return () => {
      this.listeners.delete(listener)
      this.eventTarget.removeEventListener('change', evtListener)
    }
  }

  private notify(): void {
    this.eventTarget.dispatchEvent(new Event('change'))
  }

  /**
   * 初始化：从 localStorage 恢复上次选中的项目
   */
  async initialize(): Promise<void> {
    if (this.current) return
    try {
      const savedId = localStorage.getItem(STORAGE_KEY)
      if (savedId) {
        await this.selectById(savedId)
      }
    } catch {
      // localStorage 不可用
    }
  }
}

export const selectedProjectStore = new SelectedProjectStore()

/**
 * Hook：订阅当前选中项目，自动响应变更
 */
export function useSelectedProject(): {
  project: ScenarioProject | null
  loading: boolean
  select: (project: ScenarioProject | null) => void
  refresh: () => Promise<void>
} {
  const [project, setProject] = useState<ScenarioProject | null>(selectedProjectStore.getCurrent())
  const [loading, setLoading] = useState<boolean>(selectedProjectStore.isLoading())

  useEffect(() => {
    const unsubscribe = selectedProjectStore.subscribe(() => {
      setProject(selectedProjectStore.getCurrent())
      setLoading(selectedProjectStore.isLoading())
    })
    // 首次挂载时尝试初始化
    selectedProjectStore.initialize()
    return unsubscribe
  }, [])

  return {
    project,
    loading,
    select: (p) => selectedProjectStore.setCurrent(p),
    refresh: () => selectedProjectStore.refresh(),
  }
}

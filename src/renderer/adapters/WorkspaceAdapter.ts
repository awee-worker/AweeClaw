import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { resetWorkspaceRuntimeState } from './workspaceResetAdapter'
import { loadWorkspace } from './workspaceLoader'
import { flushAgentSessionPersistence } from '@intelligence/state/IntelligenceStore'
import { workspaceStorageRuntime } from './workspaceStorageAdapter'
import type { WorkspaceConfig } from '@store'

export class WorkspaceOpenError extends Error {
  constructor(
    public readonly code: 'missing-workspace' | 'switch-failed',
    message: string,
    public readonly path: string
  ) {
    super(message)
    this.name = 'WorkspaceOpenError'
  }
}

/** 打开工作区选择器后的结果，供 UI 层决定提示文案 */
export type OpenFolderOutcome =
  | { status: 'opened' }
  | { status: 'cancelled' }
  | { status: 'redirected' }
  | { status: 'invalid' }
  | { status: 'missing'; path: string }
  | { status: 'failed' }

function normalizeWorkspaceRoots(roots: string[]): string[] {
  return roots.map(root => root.toLowerCase().replace(/\\/g, '/')).sort()
}

function normalizeFolderPath(folderPath: string): string {
  const trimmed = folderPath.trim()
  if (/^[a-zA-Z]:[\\/]*$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}\\`
  }

  return trimmed.replace(/[\\/]+$/, '')
}

function isSameWorkspace(a: WorkspaceConfig | null, b: WorkspaceConfig | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.roots.length !== b.roots.length) return false

  const aRoots = normalizeWorkspaceRoots(a.roots)
  const bRoots = normalizeWorkspaceRoots(b.roots)

  return aRoots.every((root, index) => root === bRoots[index])
}

class WorkspaceManager {
  private switching = false

  getCurrentWorkspacePath(): string | null {
    return useStore.getState().workspacePath
  }

  getCurrentWorkspace(): WorkspaceConfig | null {
    return useStore.getState().workspace
  }

  isSwitching(): boolean {
    return this.switching
  }

  async switchTo(newWorkspace: WorkspaceConfig): Promise<boolean> {
    if (this.switching) {
      logger.system.warn('[WorkspaceManager] Already switching, ignoring request')
      return false
    }

    const oldWorkspace = this.getCurrentWorkspace()
    if (isSameWorkspace(oldWorkspace, newWorkspace)) {
      logger.system.info('[WorkspaceManager] Same workspace, skipping switch')
      return true
    }

    this.switching = true
    logger.system.info('[WorkspaceManager] Switching workspace:', {
      from: oldWorkspace?.roots[0] || 'none',
      to: newWorkspace.roots[0] || 'none',
    })

    try {
      const redirected = await this.handleWorkspaceRedirection(newWorkspace)
      if (redirected) {
        api.window.close()
        return false
      }

      await this.saveCurrentWorkspace()
      this.resetRuntimeState()
      await this.loadWorkspace(newWorkspace)

      if (!oldWorkspace || oldWorkspace.roots.length === 0) {
        await api.window.resize(1600, 1000, 1200, 700)
      }

      logger.system.info('[WorkspaceManager] ToggleSwitch completed successfully')
      return true
    } catch (err) {
      const error = toAppError(err)
      logger.system.error(`[WorkspaceManager] ToggleSwitch failed: ${error.code}`, error)

      if (oldWorkspace) {
        try {
          await this.loadWorkspace(oldWorkspace)
        } catch {
          this.resetRuntimeState()
        }
      }

      return false
    } finally {
      this.switching = false
    }
  }

  /**
   * 打开工作区
   *
   * 入参兼容两种形态：字符串（已知目录路径，如最近列表、默认工作区）与主进程
   * 选择器返回的会话（含 configPath 与可能的多根 roots）。
   *
   * 打开前逐根校验目录是否存在：失效的根目录先从最近列表中剔除再抛错，
   * 避免多根工作区因单个根目录被删除就永远打不开、也无法自我修复。
   *
   * @param target 目录路径或工作区会话
   * @returns 切换成功返回 true
   */
  async openFolder(target: string | WorkspaceConfig): Promise<boolean> {
    const workspace: WorkspaceConfig =
      typeof target === 'string'
        ? { configPath: null, roots: [normalizeFolderPath(target)] }
        : target

    if (workspace.roots.length === 0) {
      throw new WorkspaceOpenError('missing-workspace', 'Workspace has no roots', '')
    }

    const missingRoots = await this.findMissingRoots(workspace.roots)
    if (missingRoots.length > 0) {
      await this.dropFromRecent(missingRoots)
      throw new WorkspaceOpenError(
        'missing-workspace',
        `Folder does not exist: ${missingRoots.join(', ')}`,
        missingRoots[0] ?? ''
      )
    }

    const switched = await this.switchTo(workspace)
    if (!switched) {
      throw new WorkspaceOpenError(
        'switch-failed',
        `Failed to open workspace: ${workspace.roots[0] ?? ''}`,
        workspace.roots[0] ?? ''
      )
    }

    return true
  }

  /**
   * 打开工作区选择器并切换到所选工作区
   *
   * 把「弹窗 → 判重定向 → 打开 → 归类失败原因」收敛到一处：UI 入口只按返回状态
   * 提示文案，不再各自 try/catch，避免漏处理导致的静默失败。
   *
   * @returns 打开结果状态
   */
  async openFolderFromDialog(): Promise<OpenFolderOutcome> {
    let picked: Awaited<ReturnType<typeof api.file.openFolder>>
    try {
      picked = await api.file.openFolder()
    } catch (err) {
      logger.system.error('[WorkspaceManager] Open folder dialog failed', err)
      return { status: 'failed' }
    }

    if (!picked) return { status: 'cancelled' }
    if ('redirected' in picked) return { status: 'redirected' }
    if ('invalid' in picked) return { status: 'invalid' }

    try {
      await this.openFolder(picked)
      return { status: 'opened' }
    } catch (err) {
      if (err instanceof WorkspaceOpenError && err.code === 'missing-workspace') {
        return { status: 'missing', path: err.path }
      }
      logger.system.error('[WorkspaceManager] Open folder failed', err)
      return { status: 'failed' }
    }
  }

  /** 返回 roots 中不存在或不是目录的部分 */
  private async findMissingRoots(roots: string[]): Promise<string[]> {
    const checked = await Promise.all(
      roots.map(async (root) => ((await api.workspace.exists(root)) ? null : root))
    )

    return checked.filter((root): root is string => root !== null)
  }

  /** 将失效路径从最近工作区列表中剔除 */
  private async dropFromRecent(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => api.workspace.removeFromRecent(p)))
  }

  async closeWorkspace(): Promise<void> {
    await this.saveCurrentWorkspace()
    this.resetRuntimeState()

    const { setWorkspace, setFiles } = useStore.getState()
    setWorkspace(null)
    setFiles([])

    workspaceStorageRuntime.reset()
  }

  async addFolder(folderPath: string): Promise<void> {
    const { addRoot } = useStore.getState()
    addRoot(folderPath)
    await workspaceStorageRuntime.initializeRoot(folderPath)
  }

  removeFolder(folderPath: string): void {
    const { removeRoot } = useStore.getState()
    removeRoot(folderPath)
  }

  private async handleWorkspaceRedirection(workspace: WorkspaceConfig): Promise<boolean> {
    if (workspace.roots.length === 0) return false

    const result = await api.workspace.setActive(workspace.roots)
    if (result && typeof result === 'object' && 'redirected' in result) {
      logger.system.info('[WorkspaceManager] Workspace already open in another window, closing this window')
      return true
    }

    return false
  }

  private async saveCurrentWorkspace(): Promise<void> {
    if (!workspaceStorageRuntime.isReady()) return

    logger.system.info('[WorkspaceManager] Saving current workspace data...')
    flushAgentSessionPersistence()
    await workspaceStorageRuntime.flush()
  }

  private resetRuntimeState(): void {
    logger.system.info('[WorkspaceManager] Resetting runtime state...')
    resetWorkspaceRuntimeState()
  }

  private async loadWorkspace(workspace: WorkspaceConfig): Promise<void> {
    await loadWorkspace(workspace)
  }
}

export const workspaceManager = new WorkspaceManager()

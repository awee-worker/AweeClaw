/**
 * 业务子窗口的运行时初始化
 *
 * 适用对象：主窗口之外的独立 BrowserWindow（项目执行窗口、邮件中心等）。
 *
 * ## 为什么必须各自初始化
 *
 * 每个 BrowserWindow 在 Electron 里是独立的渲染进程，JS 堆、模块实例、
 * 全局状态都是分开的。主窗口里建立好的 zustand store、Agent 运行时、
 * 模块级配置（例如 backendApi 的 serverUrl 与 token）在执行窗口里并不存在。
 * 因此「复用主窗口运行时」在这个架构下做不到 —— 跨进程只能传数据，
 * 传不了运行时对象。
 *
 * 要让两个窗口真正共用一个 Agent，唯一方向是把运行时下沉到主进程或
 * utilityProcess，渲染层只保留视图与 IPC 客户端。那是独立的重构，
 * 在完成之前，子窗口必须自行初始化，否则 Agent.send 会直接抛
 * "Runtime not initialized"。
 *
 * ## 这个模块解决什么
 *
 * 既然必须初始化，就把「怎么初始化」收敛成一条路径。此前每个子窗口各自抄一份
 * 顺序敏感的调用序列（先 settings、再 auth、再 workspace、最后 runtime），
 * 少一步就表现为「模型不对」或「工具报 workspace 未设置」，而且改一处不会同步到另一处。
 *
 * @module adapters/windowRuntimeBootstrap
 */

import { api } from './electronBridge'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import { setupAgentRuntime } from '@intelligence/engine/runtimeInitializer'
import { registerSettingsSync } from './appInitializer'

export interface AgentWindowRuntimeOptions {
  /** 日志前缀，便于区分是哪个窗口的初始化 */
  windowLabel: string
}

export interface AgentWindowRuntimeHandle {
  /** 释放 store 同步与运行时（窗口卸载时调用） */
  dispose: () => void
}

/**
 * 初始化一个承载 Agent 会话的业务子窗口。
 *
 * 每一步都独立容错：某一环失败只记日志，不阻断后续步骤 ——
 * 例如鉴权恢复失败时用户仍能打开窗口看到历史消息，而不是面对白屏。
 * 这与主进程模块初始化的隔离语义保持一致。
 */
export async function bootstrapAgentWindow(
  options: AgentWindowRuntimeOptions,
): Promise<AgentWindowRuntimeHandle> {
  const { windowLabel } = options
  const tag = `[${windowLabel}]`

  // 1. 设置（含 llmConfig）
  await useStore.getState().load()

  // 2. 鉴权会话：backendApi 的 serverUrl / tokens 是模块级变量，
  //    不恢复的话 API 请求会打到空地址并返回 HTML
  try {
    await useStore.getState().restoreSession()
  } catch (err) {
    logger.system.warn(`${tag} Auth restore failed:`, err)
  }

  // 3. 云端模型选择：restoreSession 内部的 selectCloudModel 是 fire-and-forget，
  //    可能在后台覆盖 load() 载入的模型选择。这里显式等待一次，确保窗口显示的
  //    模型与持久化值一致，且云端字段已补齐
  const state = useStore.getState()
  if (state.cloudMode === 'cloud' && state.isAuthenticated) {
    try {
      await state.selectCloudModel()
    } catch (err) {
      logger.system.warn(`${tag} Cloud model selection failed:`, err)
    }
  }

  // 4. 工作空间：不设置的话 workspacePath 为 null，
  //    所有依赖工作空间的工具都会报 "Workspace is required for this tool"
  try {
    const workspaceConfig = await api.workspace.restore()
    if (workspaceConfig?.roots?.length) {
      useStore.getState().setWorkspace({
        configPath: workspaceConfig.configPath ?? null,
        roots: workspaceConfig.roots,
      })
    } else {
      logger.system.warn(`${tag} Workspace restore returned empty roots`)
    }
  } catch (err) {
    logger.system.warn(`${tag} Workspace restore failed:`, err)
  }

  // 5. Agent 运行时（Agent.send 依赖它，缺失会直接抛错）
  let disposeRuntime: () => void = () => {}
  try {
    disposeRuntime = setupAgentRuntime()
  } catch (err) {
    logger.system.warn(`${tag} Agent runtime initialization failed:`, err)
  }

  // 6. 设置同步：主窗口修改模型等配置后通过 settings:changed 广播，
  //    子窗口不监听就会一直用旧配置
  let disposeSync: () => void = () => {}
  try {
    disposeSync = registerSettingsSync()
  } catch (err) {
    logger.system.warn(`${tag} Settings sync registration failed:`, err)
  }

  logger.system.info(`${tag} Agent window runtime ready`)

  return {
    dispose: () => {
      disposeSync()
      disposeRuntime()
    },
  }
}

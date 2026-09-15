/**
 * A2A 协议 IPC 处理器（主进程）
 *
 * 通道清单：
 * - a2a:get-config | update-config | reset-config   配置读写
 * - a2a:upsert-server | remove-server               单个 agent 增删改（增量，避免整表覆盖）
 * - a2a:list-servers                                全部 agent 的运行时状态
 * - a2a:test-connection                             连通性测试（拉 Agent Card）
 * - a2a:get-card                                    读取 Agent Card（force=true 时强制刷新）
 * - a2a:call                                        直接调用一次远端 agent（设置页「试跑」）
 * - a2a:get-status                                  模块状态（含入站服务与最近调用）
 * - a2a:get-tool-payload                            工具暴露载荷（渲染层工具提供者初始化用）
 * - a2a:restart-inbound                             手动重启入站服务（端口被占时）
 *
 * 事件推送：`a2a:changed`（配置或探测结果变化），由 preload 侧订阅。
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` /
 * `{ success:false, error }`；**失败信息一律中文可读**，因为它会被直接渲染到设置页。
 *
 * @module a2a/A2aIpc
 */

import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getA2aManager } from './A2aManager'
import { normalizeAgentUrl } from './A2aStore'
import type { A2aServerEntry } from '@shared/protocols/a2aProtocol'

/** 是否已注册（显式挡一层，语义更清晰） */
let registered = false

/** 统一错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 注册 A2A IPC（幂等） */
export function registerA2aIpc(): void {
  if (registered) return
  registered = true

  const manager = getA2aManager()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('a2a:get-config', async () => {
    const config = manager.getConfig()
    return { success: true, data: { config, issues: manager.getIssues() } }
  })

  safeIpcHandle('a2a:update-config', async (_event, patch: unknown) => {
    try {
      const config = await manager.applyConfig(patch)
      return { success: true, data: { config, issues: manager.getIssues() } }
    } catch (err) {
      logger.system.error('[A2A] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('a2a:reset-config', async () => {
    try {
      const config = await manager.resetConfig()
      return { success: true, data: { config, issues: manager.getIssues() } }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('a2a:upsert-server', async (_event, url: unknown, patch: unknown) => {
    const rawUrl = typeof url === 'string' ? url : ''
    if (!rawUrl) return { success: false, error: '缺少 A2A 智能体地址' }

    try {
      const config = await manager.upsertServer(rawUrl, (patch ?? {}) as Partial<A2aServerEntry>)
      const normalized = normalizeAgentUrl(rawUrl)
      const server = manager.listServerStates().find((s) => s.url === normalized) ?? null
      return { success: true, data: { config, issues: manager.getIssues(), server } }
    } catch (err) {
      logger.system.warn('[A2A] upsert-server failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('a2a:remove-server', async (_event, url: unknown) => {
    const rawUrl = typeof url === 'string' ? url : ''
    if (!rawUrl) return { success: false, error: '缺少 A2A 智能体地址' }

    try {
      const config = await manager.removeServer(rawUrl)
      return { success: true, data: { config, issues: manager.getIssues() } }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 探测与调用
  // --------------------------------------------
  safeIpcHandle('a2a:list-servers', async () => {
    return { success: true, data: { servers: manager.listServerStates(), status: manager.getStatus() } }
  })

  safeIpcHandle('a2a:test-connection', async (_event, url: unknown) => {
    const rawUrl = typeof url === 'string' ? url : ''
    if (!rawUrl) return { success: false, error: '缺少 A2A 智能体地址' }

    try {
      const server = await manager.testConnection(rawUrl)
      // 探测失败不是异常：把「不可达 + 原因」作为成功响应返回，UI 才好展示
      return { success: true, data: { server } }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('a2a:get-card', async (_event, url: unknown, force: unknown) => {
    const rawUrl = typeof url === 'string' ? url : ''
    if (!rawUrl) return { success: false, error: '缺少 A2A 智能体地址' }

    try {
      const card = await manager.getAgentCard(rawUrl, force === true)
      return { success: true, data: { card } }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('a2a:call', async (_event, url: unknown, query: unknown, contextId: unknown) => {
    const rawUrl = typeof url === 'string' ? url : ''
    const rawQuery = typeof query === 'string' ? query : ''
    if (!rawUrl) return { success: false, error: '缺少 A2A 智能体地址' }
    if (!rawQuery.trim()) return { success: false, error: '调用内容不能为空' }

    const result = await manager.callAgent(rawUrl, rawQuery, {
      contextId: typeof contextId === 'string' ? contextId : undefined,
    })
    return { success: true, data: result }
  })

  // --------------------------------------------
  // 状态
  // --------------------------------------------
  safeIpcHandle('a2a:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  safeIpcHandle('a2a:get-tool-payload', async () => {
    return { success: true, data: manager.getChangePayload() }
  })

  safeIpcHandle('a2a:restart-inbound', async () => {
    try {
      const inbound = await manager.restartInbound()
      return { success: true, data: { inbound, status: manager.getStatus() } }
    } catch (err) {
      logger.system.error('[A2A] restart-inbound failed:', err)
      return fail(err)
    }
  })
}

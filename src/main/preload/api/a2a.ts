/**
 * A2A（Agent2Agent）协议 preload API
 *
 * 暴露到 `window.electronAPI.a2a`，服务于三个消费者：
 * 1. 设置页：agent 列表、连通性测试、技能展示、入站服务开关
 * 2. 渲染层工具提供者（A2aToolProvider）：读取「工具暴露载荷」生成 `a2a_tool_call`
 * 3. 工具执行：模型调用 `a2a_tool_call` → 主进程发起 JSON-RPC
 *
 * 注意：`token` 由主进程 A2aStore 用 safeStorage 加密落盘，但**读取时会解密返回**
 * （与 LiveStore / VtsStore 的凭证行为一致），因此设置页必须用 password 输入框承载。
 *
 * @module preload/api/a2a
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'
import type {
  A2aAgentCard,
  A2aCallResult,
  A2aChangePayload,
  A2aConfig,
  A2aConfigPayload,
  A2aIpcResponse,
  A2aServerEntry,
  A2aServerState,
  A2aStatus,
} from '@shared/protocols/a2aProtocol'

/** 创建 A2A 协议 API 集合 */
export function createA2aApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    getConfig: invoke<A2aIpcResponse<A2aConfigPayload>>('a2a:get-config'),
    updateConfig: (patch: Partial<A2aConfig>) =>
      ipcRenderer.invoke('a2a:update-config', patch) as Promise<A2aIpcResponse<A2aConfigPayload>>,
    resetConfig: invoke<A2aIpcResponse<A2aConfigPayload>>('a2a:reset-config'),
    /** 新增 / 局部更新一个 agent（增量，避免整表覆盖） */
    upsertServer: (url: string, patch: Partial<A2aServerEntry>) =>
      ipcRenderer.invoke('a2a:upsert-server', url, patch) as Promise<
        A2aIpcResponse<A2aConfigPayload & { server: A2aServerState | null }>
      >,
    removeServer: (url: string) =>
      ipcRenderer.invoke('a2a:remove-server', url) as Promise<A2aIpcResponse<A2aConfigPayload>>,

    // --------------------------------------------
    // 探测与调用
    // --------------------------------------------
    /** 拉取全部 agent 的运行时状态 */
    listServers: invoke<A2aIpcResponse<{ servers: A2aServerState[]; status: A2aStatus }>>('a2a:list-servers'),
    /** 连通性测试（能拉到合法 Agent Card 即视为可用） */
    testConnection: (url: string) =>
      ipcRenderer.invoke('a2a:test-connection', url) as Promise<A2aIpcResponse<{ server: A2aServerState }>>,
    /** 读取 Agent Card（默认走 5 分钟缓存） */
    getCard: (url: string, force = false) =>
      ipcRenderer.invoke('a2a:get-card', url, force) as Promise<A2aIpcResponse<{ card: A2aAgentCard }>>,
    /** 直接调用一次远端 agent（设置页「试跑」/ 工具执行共用同一实现） */
    call: (url: string, query: string, contextId?: string) =>
      ipcRenderer.invoke('a2a:call', url, query, contextId) as Promise<A2aIpcResponse<A2aCallResult>>,

    // --------------------------------------------
    // 状态
    // --------------------------------------------
    getStatus: invoke<A2aIpcResponse<A2aStatus>>('a2a:get-status'),
    /** 工具暴露载荷（工具提供者初始化 / 手动刷新时调用） */
    getToolPayload: invoke<A2aIpcResponse<A2aChangePayload>>('a2a:get-tool-payload'),
    /** 手动重启入站服务（端口被占用时） */
    restartInbound: invoke<A2aIpcResponse<{ inbound: A2aStatus['inbound']; status: A2aStatus }>>('a2a:restart-inbound'),

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 订阅配置 / 探测结果变化（工具提供者据此刷新工具定义），返回取消订阅函数 */
    onChanged: (callback: (payload: A2aChangePayload) => void) => on<A2aChangePayload>('a2a:changed')(callback),
  }
}

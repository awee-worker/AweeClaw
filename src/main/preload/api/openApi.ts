/**
 * 对外 API 网关 preload API（P0-5）
 *
 * 暴露到 `window.electronAPI.openapi`，服务于两个消费者：
 * 1. 设置页：开关、端口、准入密钥、端点速查、运行状态
 * 2. **渲染层工具桥**：主进程通过它请求工具清单 / 执行工具（`onToolRequest` / `replyToolRequest`）
 *
 * ⚠️ `apiKey` 由主进程用 safeStorage 加密落盘，但**读取时会解密返回**
 * （与 A2aStore / LiveStore 的凭证行为一致），因此设置页必须用 password 输入框承载。
 *
 * @module preload/api/openApi
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'
import {
  OPEN_API_CHANGED_CHANNEL,
  OPEN_API_TOOL_REPLY_PREFIX,
  OPEN_API_TOOL_REQUEST_CHANNEL,
} from '@shared/protocols/openApiProtocol'
import type {
  OpenApiChangePayload,
  OpenApiConfig,
  OpenApiConfigPayload,
  OpenApiIpcResponse,
  OpenApiStatus,
  OpenApiToolRequestPayload,
} from '@shared/protocols/openApiProtocol'

/** 渲染层工具请求的应答体（形状由渲染层决定，主进程只透传） */
export type OpenApiToolReply = Record<string, unknown>

/** 创建对外 API 网关 API 集合 */
export function createOpenApiApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    getConfig: invoke<OpenApiIpcResponse<OpenApiConfigPayload>>('openapi:get-config'),
    updateConfig: (patch: Partial<OpenApiConfig>) =>
      ipcRenderer.invoke('openapi:update-config', patch) as Promise<
        OpenApiIpcResponse<OpenApiConfigPayload & { status: OpenApiStatus }>
      >,
    resetConfig: invoke<OpenApiIpcResponse<OpenApiConfigPayload & { status: OpenApiStatus }>>(
      'openapi:reset-config',
    ),
    /** 生成准入密钥（仅生成，需用户点保存才写入配置） */
    generateKey: invoke<OpenApiIpcResponse<{ apiKey: string }>>('openapi:generate-key'),

    // --------------------------------------------
    // 状态
    // --------------------------------------------
    getStatus: invoke<OpenApiIpcResponse<OpenApiStatus>>('openapi:get-status'),
    /** 强制重绑端口（端口被占后想抢回原端口） */
    restart: invoke<OpenApiIpcResponse<{ status: OpenApiStatus }>>('openapi:restart'),

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 订阅配置 / 运行态变化，返回取消订阅函数 */
    onChanged: (callback: (payload: OpenApiChangePayload) => void) =>
      on<OpenApiChangePayload>(OPEN_API_CHANGED_CHANNEL)(callback),

    // --------------------------------------------
    // 渲染层工具桥（主进程 → 渲染层）
    // --------------------------------------------
    /** 订阅主进程的工具清单 / 执行请求，返回取消订阅函数 */
    onToolRequest: (callback: (payload: OpenApiToolRequestPayload) => void) =>
      on<OpenApiToolRequestPayload>(OPEN_API_TOOL_REQUEST_CHANNEL)(callback),
    /** 应答一次工具请求 */
    replyToolRequest: (requestId: string, payload: OpenApiToolReply) => {
      ipcRenderer.send(`${OPEN_API_TOOL_REPLY_PREFIX}${requestId}`, payload)
    },
  }
}

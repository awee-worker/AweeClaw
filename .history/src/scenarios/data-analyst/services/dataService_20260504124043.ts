/**
 * 数据分析师场景 - 数据服务
 *
 * 提供场景特有的数据操作逻辑，如数据库连接管理、数据缓存等。
 * 主进程的 IPC handler 在 src/main/ipc/data.ts 中实现。
 */

import { api } from '@/renderer/services/electronAPI'
import type { DatabaseConnectionConfig, RestApiConfig } from '../types'

export async function connectDatabase(config: DatabaseConnectionConfig): Promise<{ success: boolean; error?: string }> {
  return api.data.connectDatabase(config)
}

export async function disconnectDatabase(connectionId: string): Promise<{ success: boolean }> {
  return api.data.disconnectDatabase(connectionId)
}

export async function getConnections(): Promise<Array<{ id: string; driver: string; host?: string; port?: number; database?: string; filePath?: string }>> {
  return api.data.getConnections()
}

export async function executeQuery(query: string, connectionId: string = 'default', limit: number = 100) {
  return api.data.executeQuery({ query, connectionId, limit })
}

export async function analyzeCsv(path: string, analysisType: string, sampleSize: number = 20) {
  return api.data.analyzeCsv({ path, analysisType, sampleSize })
}

export async function generateChart(chartType: string, data: Record<string, unknown>, options?: { title?: string; xLabel?: string; yLabel?: string; format?: string }) {
  return api.data.generateChart({ chartType, data, ...options })
}

export async function callRestApi(url: string, method: string = 'GET', options?: { headers?: Record<string, string>; body?: string; authType?: string; authToken?: string; authHeaderName?: string }) {
  return api.data.restApiCall({ url, method, headers: options?.headers || {}, body: options?.body, authType: options?.authType || 'none', authToken: options?.authToken, authHeaderName: options?.authHeaderName })
}

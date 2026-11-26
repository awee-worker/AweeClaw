/**
 * 工作流编辑器侧的智能体 / 编队目录。
 *
 * 只做读取：编辑节点时需要列出现有智能体与编队供选择。
 * 写入（增删改）走各自的管理页面，不在这里重复实现。
 *
 * 失败一律降级为空数组，不抛错：编辑器必须能在「未登录 / 离线 / 后端不可达」
 * 时照常使用内置角色，不能因为拉不到目录就整块报错。
 */

import { backendApi } from '@renderer/adapters/backendApi'
import { logger } from '@shared/toolkit/LogEngine'

export interface AgentCatalogItem {
  id: string
  name: string
  displayName?: string | null
  role?: string
  systemPrompt?: string
}

export interface SquadCatalogItem {
  id: string
  name: string
  displayName?: string | null
  memberIds?: string[]
  coordinatorId?: string | null
}

/** 后端可能返回数组或分页对象，两种都兼容 */
function unwrap<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  const obj = raw as { items?: T[] } | null
  if (obj && Array.isArray(obj.items)) return obj.items
  return []
}

export async function listAgents(): Promise<AgentCatalogItem[]> {
  try {
    const raw = await backendApi.get<unknown>('/api/v1/agents')
    return unwrap<AgentCatalogItem>(raw)
  } catch (e) {
    logger.ui?.warn?.('[agentCatalog] listAgents failed, fallback to empty:', e)
    return []
  }
}

export async function listSquads(): Promise<SquadCatalogItem[]> {
  try {
    const raw = await backendApi.get<unknown>('/api/v1/agent-squads')
    return unwrap<SquadCatalogItem>(raw)
  } catch (e) {
    logger.ui?.warn?.('[agentCatalog] listSquads failed, fallback to empty:', e)
    return []
  }
}

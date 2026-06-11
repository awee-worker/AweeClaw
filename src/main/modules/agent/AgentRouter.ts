/**
 * Agent 路由与隔离
 *
 * 借鉴 OpenClaw 的多 Agent 架构，实现：
 * 1. Channel → Agent 消息路由：根据 Binding 配置将消息路由到对应 Agent
 * 2. Agent 隔离：每个 Agent 拥有独立的 workspace/auth/session/bindings
 * 3. DM Pairing：私聊消息自动绑定到专属 Agent
 * 4. 群聊路由：群聊消息根据规则路由到合适的 Agent
 *
 * @module agent/AgentRouter
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import type { ChannelId } from '@shared/protocols/channel'
import type { InboundMessage } from '@shared/protocols/channel'
import type { AgentInstance } from '@shared/protocols/multiAgent'

// ============================================
// Agent 绑定定义
// ============================================

/** Agent 与 Channel 的绑定关系 */
export interface AgentBinding {
  id: string
  agentId: string
  channelId: ChannelId
  accountId: string
  /** 绑定范围：dm=仅私聊, group=仅群聊, all=所有消息 */
  scope: AgentBindingScope
  /** 路由规则（可选，用于群聊精细路由） */
  rules?: AgentRoutingRule[]
  enabled: boolean
  createdAt: number
}

export type AgentBindingScope = 'dm' | 'group' | 'all'

/** 路由规则 */
export interface AgentRoutingRule {
  /** 规则类型 */
  type: 'keyword' | 'mention' | 'regex' | 'prefix'
  /** 规则匹配值 */
  pattern: string
  /** 是否大小写敏感 */
  caseSensitive?: boolean
}

// ============================================
// Agent 工作区定义
// ============================================

/** Agent 独立工作区 */
export interface AgentWorkspace {
  agentId: string
  /** 工作目录 */
  rootDir: string
  /** 上下文文件列表 */
  contextFiles: string[]
  /** 工具权限 */
  toolPermissions: Record<string, boolean>
  /** 自定义配置 */
  config: Record<string, unknown>
}

// ============================================
// Agent 认证上下文
// ============================================

/** Agent 独立认证上下文 */
export interface AgentAuthContext {
  agentId: string
  /** 该 Agent 可用的 Provider credentials */
  providerCredentials: Record<string, Record<string, string>>
  /** 该 Agent 可用的 Channel credentials */
  channelCredentials: Record<ChannelId, Record<string, string>>
  /** 工具 OAuth tokens */
  toolTokens: Record<string, string>
}

// ============================================
// 路由结果
// ============================================

export interface RoutingResult {
  /** 匹配的 Agent ID */
  agentId: string
  /** 匹配的绑定 ID */
  bindingId: string
  /** 路由原因 */
  reason: string
  /** 是否需要创建新 Agent 实例 */
  needsSpawn: boolean
}

// ============================================
// Agent 路由器
// ============================================

class AgentRouter extends EventEmitter {
  /** Agent 绑定关系 */
  private bindings = new Map<string, AgentBinding>()
  /** Agent 工作区 */
  private workspaces = new Map<string, AgentWorkspace>()
  /** Agent 认证上下文 */
  private authContexts = new Map<string, AgentAuthContext>()
  /** DM Pairing 缓存：channelKey → agentId */
  private dmPairingCache = new Map<string, string>()
  /** Agent 实例缓存 */
  private agentInstances = new Map<string, AgentInstance>()

  // ============================================
  // 持久化
  // ============================================

  /** 从持久化存储恢复数据 */
  restoreFromStore(): void {
    const bindings = moduleDataStore.get<AgentBinding[]>(STORE_KEYS.AGENT_BINDINGS)
    if (bindings) {
      for (const binding of bindings) {
        this.bindings.set(binding.id, binding)
      }
      logger.agent.info(`[AgentRouter] Restored ${bindings.length} bindings from store`)
    }

    const workspaces = moduleDataStore.get<AgentWorkspace[]>(STORE_KEYS.AGENT_WORKSPACES)
    if (workspaces) {
      for (const ws of workspaces) {
        this.workspaces.set(ws.agentId, ws)
      }
    }

    const pairings = moduleDataStore.get<Array<{ key: string; agentId: string }>>(STORE_KEYS.AGENT_DM_PAIRINGS)
    if (pairings) {
      for (const p of pairings) {
        this.dmPairingCache.set(p.key, p.agentId)
      }
    }
  }

  /** 持久化当前数据 */
  private persistBindings(): void {
    moduleDataStore.set(STORE_KEYS.AGENT_BINDINGS, Array.from(this.bindings.values()))
  }

  private persistWorkspaces(): void {
    moduleDataStore.set(STORE_KEYS.AGENT_WORKSPACES, Array.from(this.workspaces.values()))
  }

  private persistDmPairings(): void {
    const pairings = Array.from(this.dmPairingCache.entries()).map(([key, agentId]) => ({ key, agentId }))
    moduleDataStore.set(STORE_KEYS.AGENT_DM_PAIRINGS, pairings)
  }

  // ============================================
  // 绑定管理
  // ============================================

  /**
   * 添加 Agent 绑定
   */
  addBinding(binding: AgentBinding): void {
    this.bindings.set(binding.id, binding)
    this.persistBindings()
    logger.agent.info(`[AgentRouter] Added binding: ${binding.agentId} → ${binding.channelId}:${binding.accountId} (scope=${binding.scope})`)
    this.emit('binding-added', binding)
  }

  /**
   * 移除 Agent 绑定
   */
  removeBinding(bindingId: string): boolean {
    const binding = this.bindings.get(bindingId)
    if (!binding) return false
    this.bindings.delete(bindingId)
    this.persistBindings()
    // 清理 DM pairing 缓存
    const cacheKey = this.getDmCacheKey(binding.channelId, binding.accountId)
    if (this.dmPairingCache.get(cacheKey) === binding.agentId) {
      this.dmPairingCache.delete(cacheKey)
    }
    logger.agent.info(`[AgentRouter] Removed binding: ${bindingId}`)
    this.emit('binding-removed', binding)
    return true
  }

  /**
   * 获取指定 Agent 的所有绑定
   */
  getBindingsForAgent(agentId: string): AgentBinding[] {
    return Array.from(this.bindings.values()).filter(b => b.agentId === agentId)
  }

  /**
   * 获取指定 Channel 账号的所有绑定
   */
  getBindingsForChannel(channelId: ChannelId, accountId: string): AgentBinding[] {
    return Array.from(this.bindings.values()).filter(
      b => b.channelId === channelId && b.accountId === accountId && b.enabled
    )
  }

  /**
   * 获取所有绑定
   */
  getAllBindings(): AgentBinding[] {
    return Array.from(this.bindings.values())
  }

  // ============================================
  // 消息路由
  // ============================================

  /**
   * 路由入站消息到对应的 Agent
   *
   * 路由优先级：
   * 1. DM Pairing：私聊消息优先匹配已配对的 Agent
   * 2. 精确规则匹配：按 binding 的 rules 逐条匹配
   * 3. Scope 匹配：dm/group/all 范围匹配
   * 4. 默认 Agent：如果配置了默认 Agent，路由到默认
   */
  route(message: InboundMessage): RoutingResult | null {
    const { channelId, accountId, chatType, from, text } = message
    const isDm = chatType === 'direct'

    // 1. DM Pairing 检查
    if (isDm) {
      const dmKey = this.getDmCacheKey(channelId, accountId, from)
      const pairedAgentId = this.dmPairingCache.get(dmKey)
      if (pairedAgentId) {
        logger.agent.debug(`[AgentRouter] DM pairing hit: ${from} → ${pairedAgentId}`)
        const binding = this.findBindingForAgent(pairedAgentId, channelId, accountId, 'dm')
        if (binding) {
          return {
            agentId: pairedAgentId,
            bindingId: binding.id,
            reason: 'dm-pairing',
            needsSpawn: !this.agentInstances.has(pairedAgentId),
          }
        }
      }
    }

    // 2. 获取该 Channel 账号的所有启用绑定
    const candidateBindings = this.getBindingsForChannel(channelId, accountId)
    if (candidateBindings.length === 0) {
      logger.agent.debug(`[AgentRouter] No bindings found for ${channelId}:${accountId}`)
      return null
    }

    // 3. 精确规则匹配
    for (const binding of candidateBindings) {
      if (!this.isScopeMatch(binding.scope, isDm)) continue
      if (!binding.rules || binding.rules.length === 0) continue

      for (const rule of binding.rules) {
        if (this.matchRule(rule, text)) {
          // DM 自动 pairing
          if (isDm) {
            const dmKey = this.getDmCacheKey(channelId, accountId, from)
            this.dmPairingCache.set(dmKey, binding.agentId)
          }
          return {
            agentId: binding.agentId,
            bindingId: binding.id,
            reason: `rule-match:${rule.type}:${rule.pattern}`,
            needsSpawn: !this.agentInstances.has(binding.agentId),
          }
        }
      }
    }

    // 4. Scope 匹配（无规则的绑定，按 scope 匹配）
    for (const binding of candidateBindings) {
      if (!this.isScopeMatch(binding.scope, isDm)) continue
      if (binding.rules && binding.rules.length > 0) continue // 有规则的已在上面处理

      // DM 自动 pairing
      if (isDm) {
        const dmKey = this.getDmCacheKey(channelId, accountId, from)
        this.dmPairingCache.set(dmKey, binding.agentId)
      }

      return {
        agentId: binding.agentId,
        bindingId: binding.id,
        reason: `scope-match:${binding.scope}`,
        needsSpawn: !this.agentInstances.has(binding.agentId),
      }
    }

    logger.agent.debug(`[AgentRouter] No route found for message from ${from} on ${channelId}`)
    return null
  }

  // ============================================
  // Agent 实例管理
  // ============================================

  /**
   * 注册 Agent 实例
   */
  registerInstance(instance: AgentInstance): void {
    this.agentInstances.set(instance.id, instance)
    logger.agent.info(`[AgentRouter] Registered agent instance: ${instance.id} (role=${instance.role.id})`)
  }

  /**
   * 注销 Agent 实例
   */
  unregisterInstance(agentId: string): void {
    this.agentInstances.delete(agentId)
    // 清理相关绑定
    for (const [id, binding] of this.bindings) {
      if (binding.agentId === agentId) {
        this.bindings.delete(id)
      }
    }
    // 清理 DM pairing
    for (const [key, aid] of this.dmPairingCache) {
      if (aid === agentId) {
        this.dmPairingCache.delete(key)
      }
    }
    logger.agent.info(`[AgentRouter] Unregistered agent instance: ${agentId}`)
  }

  /**
   * 获取 Agent 实例
   */
  getInstance(agentId: string): AgentInstance | undefined {
    return this.agentInstances.get(agentId)
  }

  /**
   * 获取所有 Agent 实例
   */
  getAllInstances(): AgentInstance[] {
    return Array.from(this.agentInstances.values())
  }

  // ============================================
  // 工作区管理
  // ============================================

  /**
   * 设置 Agent 工作区
   */
  setWorkspace(workspace: AgentWorkspace): void {
    this.workspaces.set(workspace.agentId, workspace)
    this.persistWorkspaces()
    logger.agent.info(`[AgentRouter] Set workspace for agent: ${workspace.agentId}`)
  }

  /**
   * 获取 Agent 工作区
   */
  getWorkspace(agentId: string): AgentWorkspace | undefined {
    return this.workspaces.get(agentId)
  }

  // ============================================
  // 认证上下文管理
  // ============================================

  /**
   * 设置 Agent 认证上下文
   */
  setAuthContext(authContext: AgentAuthContext): void {
    this.authContexts.set(authContext.agentId, authContext)
    logger.agent.info(`[AgentRouter] Set auth context for agent: ${authContext.agentId}`)
  }

  /**
   * 获取 Agent 认证上下文
   */
  getAuthContext(agentId: string): AgentAuthContext | undefined {
    return this.authContexts.get(agentId)
  }

  // ============================================
  // DM Pairing
  // ============================================

  /**
   * 手动设置 DM Pairing
   */
  setDmPairing(channelId: ChannelId, accountId: string, userId: string, agentId: string): void {
    const key = this.getDmCacheKey(channelId, accountId, userId)
    this.dmPairingCache.set(key, agentId)
    this.persistDmPairings()
    logger.agent.info(`[AgentRouter] DM pairing set: ${userId}@${channelId}:${accountId} → ${agentId}`)
  }

  /**
   * 移除 DM Pairing
   */
  removeDmPairing(channelId: ChannelId, accountId: string, userId: string): void {
    const key = this.getDmCacheKey(channelId, accountId, userId)
    this.dmPairingCache.delete(key)
    this.persistDmPairings()
  }

  // ============================================
  // 私有方法
  // ============================================

  private getDmCacheKey(channelId: ChannelId, accountId: string, userId?: string): string {
    return `${channelId}:${accountId}:${userId || 'default'}`
  }

  private isScopeMatch(scope: AgentBindingScope, isDm: boolean): boolean {
    if (scope === 'all') return true
    if (scope === 'dm' && isDm) return true
    if (scope === 'group' && !isDm) return true
    return false
  }

  private findBindingForAgent(agentId: string, channelId: ChannelId, accountId: string, scope: AgentBindingScope): AgentBinding | undefined {
    return Array.from(this.bindings.values()).find(
      b => b.agentId === agentId && b.channelId === channelId && b.accountId === accountId && b.enabled && (b.scope === scope || b.scope === 'all')
    )
  }

  private matchRule(rule: AgentRoutingRule, content: string): boolean {
    const text = rule.caseSensitive ? content : content.toLowerCase()
    const pattern = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase()

    switch (rule.type) {
      case 'keyword':
        return text.includes(pattern)
      case 'mention':
        return text.includes(`@${pattern}`)
      case 'prefix':
        return text.startsWith(pattern)
      case 'regex':
        try {
          const flags = rule.caseSensitive ? '' : 'i'
          return new RegExp(pattern, flags).test(content)
        } catch {
          return false
        }
      default:
        return false
    }
  }
}

/** 全局 Agent 路由器实例 */
export const agentRouter = new AgentRouter()

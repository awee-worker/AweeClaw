/**
 * 技能与插件在当前智能体中的可用性判断
 *
 * 聊天界面有两处可以选技能：输入框上方的技能栏（含「更多技能」面板）与 @ 提及面板。
 * 选择智能体后，只有智能体「插件与技能」里勾选过的插件才真正被授权，
 * 两处入口必须给出同一结论，因此判断逻辑集中在这里。
 *
 * 规则与执行层的 isToolAllowedForAgent 保持一致：
 * - 未选择智能体 → 不限制
 * - 智能体未配置 mcpServices（旧数据）→ 不限制
 * - 条目没有插件归属（内置 / 全局 / 工作空间技能，或不带 MCP 服务的插件）→ 不限制
 * - 其余按 mcpServices 白名单匹配插件 key 或 MCP 服务 id
 */

import type { CustomAgentProfile } from '@renderer-configuration/customAgentTools'

/** 技能或插件的插件归属 */
export interface PluginIdentity {
  /** 技能来源插件标识；插件条目为其自身 key */
  pluginKey?: string
  /** 插件注册的 MCP 服务 id，与智能体 mcpServices 的取值同源 */
  mcpServerId?: string
}

/** 插件 key 被 sanitize 后的形态，与服务 id 的命名保持可比 */
function normalizePluginId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * 智能体授权的插件范围
 *
 * 返回 null 表示不施加限制；返回空集合表示智能体明确未启用任何插件。
 */
export function resolveAgentPluginScope(profile: CustomAgentProfile | null): Set<string> | null {
  if (!profile) return null
  const services = profile.mcpServices
  if (!Array.isArray(services)) return null
  return new Set(services)
}

/** 该条目是否落在智能体的插件授权范围内 */
export function isPluginIdentityAllowed(
  identity: PluginIdentity,
  scope: Set<string> | null,
): boolean {
  if (!scope) return true
  const { pluginKey, mcpServerId } = identity

  // 显式按插件 key 授权（旧数据或已 sanitize 的写法）直接放行
  if (pluginKey && (scope.has(pluginKey) || scope.has(normalizePluginId(pluginKey)))) return true

  // 不注册 MCP 服务的纯技能插件无法通过 mcpServices 表达授权，
  // 这类插件不做限制，否则会被永久判成不可用
  if (!mcpServerId) return true

  return scope.has(mcpServerId) || scope.has(normalizePluginId(mcpServerId))
}

/** 插件 key → MCP 服务 id，用于把技能条目回溯到其来源插件的授权项 */
export function buildPluginServerIndex(
  plugins: Array<{ pluginKey?: string; mcpServerId?: string }>,
): Map<string, string | undefined> {
  const index = new Map<string, string | undefined>()
  for (const plugin of plugins) {
    if (plugin.pluginKey) index.set(plugin.pluginKey, plugin.mcpServerId)
  }
  return index
}

/** 不可用提示：技能与插件各一句，说明去哪里启用 */
export function unavailableInAgentTip(kind: 'skill' | 'plugin', isZh: boolean): string {
  if (kind === 'skill') {
    return isZh
      ? '该技能在当前智能体中不可用，请到智能体中启用该技能'
      : 'This skill is unavailable in the current agent. Enable it in the agent settings.'
  }
  return isZh
    ? '该插件在当前智能体中不可用，请到智能体中启用该插件'
    : 'This plugin is unavailable in the current agent. Enable it in the agent settings.'
}

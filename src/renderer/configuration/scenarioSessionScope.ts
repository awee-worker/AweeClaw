/**
 * 场景会话边界解析
 *
 * 边界声明写在场景插件配置里（ScenarioPlugin.sessionScope），消费方有两个：
 * - 提示词：在身份之后注入边界声明（见 PromptComposer）
 * - 工具集：按声明收窄下发给模型的内置工具（见 getToolsForContext）
 *
 * 两处必须读到同一份声明，否则会出现「提示词说没有这个工具、执行层还给下发」
 * 或反过来「工具没了但提示词还在教怎么用」。因此解析只在这里做一次，
 * 消费方各自调用，不各自读注册表。
 */

import { scenarioRegistry } from '@protocols/scenario'
import type { ScenarioSessionScope } from '@protocols/scenario'

/**
 * 取当前活跃场景声明的会话边界
 *
 * 未声明时返回 undefined —— 通用助手等场景保持全量能力，行为不变。
 */
export function resolveActiveSessionScope(): ScenarioSessionScope | undefined {
  const scope = scenarioRegistry.getActive()?.sessionScope
  if (!scope?.boundary?.trim()) return undefined
  return scope
}

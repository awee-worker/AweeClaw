/**
 * ScenarioModule - 场景模块接口
 *
 * 每个场景独立目录必须导出一个实现此接口的对象。
 * 场景加载器通过此接口动态加载场景的所有能力。
 *
 * 目录结构规范：
 * src/scenarios/{scenario-id}/
 * ├── index.ts              ← 入口，导出 ScenarioModule
 * ├── config/
 * │   └── scenario.ts       ← ScenarioPlugin 配置（身份、能力、UI、数据源）
 * ├── components/           ← 场景特有 UI 组件
 * │   └── *.tsx
 * ├── tools/                ← 场景特有工具执行器
 * │   ├── definitions.ts    ← 工具定义（补充 TOOL_CONFIGS）
 * │   └── executors.ts      ← 工具执行器实现
 * ├── services/             ← 场景特有服务（IPC handler、业务逻辑）
 * │   └── *.ts
 * └── types/                ← 场景特有类型
 *     └── *.ts
 */

import type { ScenarioPlugin } from '@shared/types/scenario'
import type { ToolExecutor, ToolDefinition, ToolExecutionResult, ToolExecutionContext } from '@shared/types'

export interface ScenarioToolDefinition {
  name: string
  definition: ToolDefinition
  executor: ToolExecutor
}

export interface ScenarioIpcHandler {
  channel: string
  handler: (...args: unknown[]) => unknown | Promise<unknown>
}

export interface ScenarioComponentRegistry {
  [componentId: string]: React.ComponentType<unknown>
}

export interface ScenarioModule {
  id: string
  version: string

  getPlugin: () => ScenarioPlugin

  getTools?: () => ScenarioToolDefinition[]

  getIpcHandlers?: () => ScenarioIpcHandler[]

  getComponents?: () => ScenarioComponentRegistry

  onActivate?: (context: ScenarioModuleContext) => Promise<void>
  onDeactivate?: () => Promise<void>
}

export interface ScenarioModuleContext {
  scenarioId: string
  workspacePath: string | null
  registerTools: (tools: ScenarioToolDefinition[]) => void
  unregisterTools: (toolNames: string[]) => void
}

/**
 * 场景组件动态解析器
 *
 * 解决场景即插即用问题：
 * - 编译期不依赖任何具体场景的 import 路径
 * - 运行时通过场景注册表查找组件
 * - 场景目录被删除时不影响编译，仅返回 undefined
 *
 * 使用场景：
 * - 主布局中需要渲染某场景的主面板（如 StoreDiagnosisDashboard）
 * - 全局浮层需要渲染某场景的特殊组件（如 OnboardingWizard）
 * - 任何需要"软依赖"场景组件的地方
 */

import type { ComponentType } from 'react'
import { scenarioLoader } from '@scenario-system/core'

/**
 * 同步获取场景组件
 *
 * 通过 scenarioLoader 已注册的场景模块查找组件。
 * 由于场景在应用启动时通过 import.meta.glob({ eager: true }) 全量加载，
 * 因此查找是同步的，无需 async。
 *
 * @param scenarioId 场景 ID（如 'store-diagnosis'、'dev-assistant'）
 * @param componentKey 组件标识（在 ScenarioComponentRegistry 中的 key）
 * @returns 组件类型，未找到时返回 undefined
 */
export function getScenarioComponent(
  scenarioId: string,
  componentKey: string,
): ComponentType<any> | undefined {
  try {
    const entry = scenarioLoader.getEntry(scenarioId)
    if (!entry?.module?.getComponents) return undefined

    const components = entry.module.getComponents()
    return components?.[componentKey]
  } catch {
    return undefined
  }
}

/**
 * 检查场景组件是否可用
 */
export function hasScenarioComponent(scenarioId: string, componentKey: string): boolean {
  return getScenarioComponent(scenarioId, componentKey) !== undefined
}

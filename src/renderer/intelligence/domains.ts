/**
 * Agent Domain Exports
 *
 * 统一导出各个领域模块
 */

// 工作模式领域（AI 推理深度：chat/agent/plan）
export * from './capabilities/mode/WorkModeDescriptor'
export * from './capabilities/mode/WorkModeRegistry'

// 场景模式领域（使用场景：work/life/study）
export * from './capabilities/sceneMode'

export * from './capabilities/budget'

export * from './contextModel'

export * from './capabilities/message'

// 应用执行层
export * from './application'


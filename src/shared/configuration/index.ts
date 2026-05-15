/**
 * 配置模块索引
 * 
 * 统一导出所有配置相关的类型和函数
 */

// 类型定义
export * from './providerTypes'

// 默认值
export * from './defaultProfile'

// Provider 配置
export * from '@shared/configuration/aiProviders'

// Agent 配置（缓存、工具截断等内部配置）
export * from '@configuration/agentProfile'

// 工具配置
export * from './toolDefinitions'
export * from './toolCategoryDefs'

// MCP 预设
export * from './toolProtocolPresets'

// 配置清理
export * from './configSanitizer'

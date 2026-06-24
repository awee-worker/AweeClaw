/**
 * 搜索引擎核心入口
 *
 * 统一导出搜索引擎各子模块：
 * - 类型定义、索引编排器
 * - 向量嵌入与向量存储
 * - 代码分块与 Tree-sitter 解析
 * - 文件变更缓冲
 * - AST 分析器
 *
 * 差异化特性（相比基础实现）：
 * - 双模式索引（structural / semantic）
 * - 场景化搜索配置
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

export * from './engineTypes'
export * from './indexOrchestrator'
export * from './vectorEmbedder'
export * from './vectorRepository'
export * from './codeChunker'
export * from './treeSitterParser'
export { FileChangeBuffer, createFileChangeHandler } from './fileChangeQueue'
export { ASTParser } from './ASTAnalyzer'

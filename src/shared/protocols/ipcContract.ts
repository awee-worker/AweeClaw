/**
 * 跨层共享的 IPC 数据契约
 *
 * 这些类型既出现在主进程（preload 暴露的 API 入参/出参），
 * 也出现在渲染进程（调用方持有的数据）。两边各写一份时，
 * 结构一旦不同步，编译器不会报错 —— 因为它们在两个互不相干的命名空间里，
 * 只有运行时才会暴露成「字段名对不上」。因此统一收敛到这里，
 * 由两端共同引用，让不一致变成编译错误。
 *
 * 约定：只放纯数据结构（可 JSON 序列化），不放类、不放方法。
 * 需要与主进程实现共享的行为逻辑，另建模块。
 *
 * @module shared/protocols/ipcContract
 */

/**
 * 嵌入模型配置入参
 *
 * 用于配置向量化服务（检索索引的知识库语义检索依赖它）。
 */
export interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  dimensions?: number
}

/** 远程主机上的目录项 */
export interface RemoteShellEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime?: number
}

/** 远程主机连接配置 */
export interface RemoteShellServer {
  host: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  remotePath?: string
}

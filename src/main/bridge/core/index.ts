/**
 * Bridge 核心模块入口
 *
 * 导出 IPC 通信基础设施：
 * - `registerAllHandlers` — 统一注册所有领域 IPC handler
 * - `cleanupAllHandlers` — 应用退出时清理资源
 * - `safeIpcHandle` — IPC 安全包装器
 * - `IpcChannelGuard` — 频道级监控与限流
 */
export * from './registerHandlers'
export * from './ipcGuard'

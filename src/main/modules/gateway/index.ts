/**
 * Gateway 模块入口
 *
 * 提供 Gateway 客户端的导出。
 * - GatewayClient: Electron 主进程中使用，与 Gateway 守护进程通信
 * - GatewayServer: 独立 Node.js 守护进程入口（自启动，无需导出）
 */

export { gatewayClient } from './GatewayClient'

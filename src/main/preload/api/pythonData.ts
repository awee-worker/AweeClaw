/**
 * Python 环境 / 数据分析 API
 *
 * 覆盖 IPC 频道：
 * - python:*  Python 解释器管理 / 脚本执行
 * - data:*    数据分析（查询 / 转换 / EDA / 可视化 / 数据库连接）
 */
import { invoke } from '../ipcHelpers'

export function createPythonDataApi() {
  return {
    // ── Python 环境 ──
    pythonGetStatus: invoke('python:getStatus'),
    pythonGetPath: invoke('python:getPath'),
    pythonGetUvPath: invoke('python:getUvPath'),
    pythonEnsureReady: (options?: {
      minVersion?: [number, number]
      forceRefresh?: boolean
    }) => invoke('python:ensureReady')(options),
    pythonReinstall: invoke('python:reinstall'),
    pythonInstallPkg: (pkg: string) => invoke('python:installPkg')(pkg),
    pythonSetCustomPath: (customPath: string | null) =>
      invoke('python:setCustomPath')(customPath),
    pythonExecuteScript: (params: {
      scriptPath: string
      args?: string[]
      cwd?: string
      timeout?: number
    }) => invoke('python:executeScript')(params),
    pythonExecuteInlineScript: (params: {
      script: string
      dependencies?: string[]
      args?: string[]
      cwd?: string
      timeout?: number
    }) => invoke('python:executeInlineScript')(params),

    // ── Node.js 环境 ──
    nodeGetStatus: invoke('node:getStatus'),
    nodeGetPath: invoke('node:getPath'),
    nodeGetNpmPath: invoke('node:getNpmPath'),
    nodeGetNpxPath: invoke('node:getNpxPath'),
    nodeEnsureReady: invoke('node:ensureReady'),
    nodeReinstall: invoke('node:reinstall'),
    nodeInstallPkg: (pkg: string) => invoke('node:installPkg')(pkg),
    nodeSetCustomPath: (customPath: string | null) =>
      invoke('node:setCustomPath')(customPath),
    nodeExecuteScript: (params: {
      scriptPath: string
      args?: string[]
      cwd?: string
      timeout?: number
    }) => invoke('node:executeScript')(params),

    // ── 数据分析 ──
    dataExecuteQuery: (params: unknown) => invoke('data:executeQuery')(params),
    dataTransform: (params: unknown) => invoke('data:transform')(params),
    dataAnalyzeCsv: (params: unknown) => invoke('data:analyzeCsv')(params),
    dataGenerateChart: (params: unknown) => invoke('data:generateChart')(params),
    dataStatisticalTest: (params: unknown) => invoke('data:statisticalTest')(params),
    dataRestApiCall: (params: unknown) => invoke('data:restApiCall')(params),
    dataConnectDatabase: (config: unknown) => invoke('data:connectDatabase')(config),
    dataDisconnectDatabase: (connectionId: string) =>
      invoke('data:disconnectDatabase')(connectionId),
    dataGetConnections: invoke('data:getConnections'),
    dataClearCache: invoke('data:clearCache'),
    dataEda: (params: unknown) => invoke('data:eda')(params),
    dataCleanData: (params: unknown) => invoke('data:cleanData')(params),
    dataBrowseSchema: (params: unknown) => invoke('data:browseSchema')(params),
    dataSaveQuery: (params: unknown) => invoke('data:saveQuery')(params),
    dataGetQueryHistory: (params?: unknown) => invoke('data:getQueryHistory')(params),
    dataExportReport: (params: unknown) => invoke('data:exportReport')(params),
  }
}

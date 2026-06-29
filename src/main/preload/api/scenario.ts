/**
 * 场景 / 开发者中心 API
 *
 * 覆盖 IPC 频道：
 * - scenario:*            场景安装 / 卸载 / 市场搜索 / 回滚
 * - scenario-db:*         场景数据库初始化 / 执行 SQL / 卸载
 * - scenario-builder:*    场景构建器（创建项目 / 校验 / 打包 / 试运行）
 * - developer:*           开发者中心认证 / 发布场景
 */
import { invoke, on } from '../ipcHelpers'

export function createScenarioApi() {
  return {
    // ── 场景数据库 ──
    scenarioDbInitialize: (params: {
      scenarioId: string
      installScripts: Array<{ id: string; description?: string; sql: string }>
    }) => invoke('scenario-db:initialize')(params),
    scenarioDbExecuteSql: (params: { scenarioId: string; sql: string }) =>
      invoke('scenario-db:executeSql')(params),
    scenarioDbDrop: (params: {
      scenarioId: string
      uninstallScripts: Array<{ id: string; description?: string; sql: string }>
    }) => invoke('scenario-db:drop')(params),
    scenarioDbGetPath: (scenarioId: string) => invoke('scenario-db:getPath')(scenarioId),

    // ── 场景安装 / 卸载 ──
    scenarioGetScenariosDir: invoke('scenario:getScenariosDir'),
    scenarioSelectScenarioDir: invoke('scenario:selectScenarioDir'),
    scenarioReadScenarioConfig: (sourceDir: string) =>
      invoke('scenario:readScenarioConfig')(sourceDir),
    scenarioInstallFromLocal: (sourceDir: string) =>
      invoke('scenario:installFromLocal')(sourceDir),
    scenarioGetInstalledScenarioDirs: invoke('scenario:getInstalledScenarioDirs'),
    scenarioDeleteScenarioDir: (scenarioId: string) =>
      invoke('scenario:deleteScenarioDir')(scenarioId),
    scenarioDeleteBuiltinSourceDir: (scenarioId: string) =>
      invoke('scenario:deleteBuiltinSourceDir')(scenarioId),
    scenarioLoadScenarioFiles: (scenarioId: string) =>
      invoke('scenario:loadScenarioFiles')(scenarioId),
    scenarioUninstall: (scenarioId: string) => invoke('scenario:uninstall')(scenarioId),

    // ── 场景市场 ──
    scenarioMarketplaceSearch: (query: string, page?: number, pageSize?: number) =>
      invoke('scenario:marketplaceSearch')(query, page, pageSize),
    scenarioMarketplaceFeatured: invoke('scenario:marketplaceFeatured'),
    scenarioMarketplaceDetails: (scenarioId: string) =>
      invoke('scenario:marketplaceDetails')(scenarioId),
    scenarioMarketplaceCategories: invoke('scenario:marketplaceCategories'),
    scenarioMarketplaceDownload: (scenarioId: string) =>
      invoke('scenario:marketplaceDownload')(scenarioId),
    scenarioMarketplaceInstall: (params: {
      scenarioId: string
      downloadUrl: string
      checksum: string
      signature?: string
      version: string
      fileSize: number
      packageType: string
    }) => invoke('scenario:marketplaceInstall')(params),
    scenarioMarketplaceCheckUpdates: (
      installedScenarios: Array<{ id: string; version: string }>,
      backendUrl?: string,
    ) => invoke('scenario:marketplaceCheckUpdates')(installedScenarios, backendUrl),
    scenarioMarketplaceUpdate: (params: {
      scenarioId: string
      downloadUrl: string
      checksum: string
      signature?: string
      version: string
      fileSize: number
      packageType: string
    }) => invoke('scenario:marketplaceUpdate')(params),

    // ── 回滚 ──
    scenarioGetRollbackInfo: (scenarioId: string) =>
      invoke('scenario:getRollbackInfo')(scenarioId),
    scenarioRollbackScenario: (scenarioId: string) =>
      invoke('scenario:rollbackScenario')(scenarioId),
    scenarioClearRollbackData: (scenarioId?: string) =>
      invoke('scenario:clearRollbackData')(scenarioId),
    onScenarioInstallProgress: on<{
      scenarioId: string
      phase: string
      bytesDownloaded: number
      bytesTotal: number
      percent: number
    }>('scenario:installProgress'),

    // ── 场景构建器 ──
    scenarioBuilderCreateProjectFiles: (params: {
      localPath: string
      scenarioId: string
      name: string
      nameZh: string
      description?: string
      descriptionZh?: string
      author?: string
      version?: string
      category?: string
      type: 'declarative' | 'programmatic'
    }) => invoke('scenario-builder:createProjectFiles')(params),
    scenarioBuilderReadFile: (params: { projectPath: string; relativePath: string }) =>
      invoke('scenario-builder:readFile')(params),
    scenarioBuilderWriteFile: (params: {
      projectPath: string
      relativePath: string
      content: string
      createDirs?: boolean
    }) => invoke('scenario-builder:writeFile')(params),
    scenarioBuilderValidate: (params: { projectPath: string }) =>
      invoke('scenario-builder:validate')(params),
    scenarioBuilderBuild: (params: { projectPath: string }) =>
      invoke('scenario-builder:build')(params),
    scenarioBuilderPack: (params: { projectPath: string; outputPath?: string }) =>
      invoke('scenario-builder:pack')(params),
    scenarioBuilderTryRunStart: (params: { projectPath: string }) =>
      invoke('scenario-builder:tryRunStart')(params),
    scenarioBuilderTryRunStop: (params: { scenarioId: string }) =>
      invoke('scenario-builder:tryRunStop')(params),
    scenarioBuilderTryRunStatus: (params: { scenarioId: string }) =>
      invoke('scenario-builder:tryRunStatus')(params),

    // ── 开发者中心 ──
    developerCheckAuth: invoke('developer:checkAuth'),
    developerSaveAuth: (auth: {
      loggedIn: boolean
      developerName?: string
      token?: string
    }) => invoke('developer:saveAuth')(auth),
    developerLogout: invoke('developer:logout'),
    developerPublishScenario: (params: {
      scenarioId: string
      version: string
      name: string
      nameZh: string
      type: string
      category: string
      permissions?: string[]
      changelog?: string
      packagePath: string
      backendUrl?: string
    }) => invoke('developer:publishScenario')(params),
  }
}

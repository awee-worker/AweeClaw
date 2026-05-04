/**
 * ScenarioDatabaseManager - 场景数据库管理器
 *
 * 渲染进程侧的场景数据库管理服务，封装 IPC 调用，
 * 为 ScenarioLoader 和 ScenarioModuleContext 提供数据库操作能力。
 *
 * 核心能力：
 * - initialize: 创建场景专属数据库 + 执行安装脚本
 * - executeSql: 在场景专属数据库中执行 SQL
 * - drop: 执行卸载脚本 + 删除数据库文件
 * - getPath: 获取场景数据库文件路径
 *
 * 数据库隔离策略：每个场景一个独立 SQLite 文件
 *   路径: {userDataPath}/scenario-data/{scenarioId}/{scenarioId}.db
 */

import type { ScenarioDbScript, ScenarioSqlResult } from '@shared/types/scenario-arch'
import { api } from '@/renderer/services/electronAPI'

class ScenarioDatabaseManagerClass {
  private initializedScenarios = new Set<string>()

  async initialize(scenarioId: string, installScripts: ScenarioDbScript[]): Promise<{
    success: boolean
    dbPath?: string
    results?: Array<{ scriptId: string; success: boolean; error?: string }>
    error?: string
  }> {
    const result = await api.scenarioDb.initialize({
      scenarioId,
      installScripts,
    })

    if (result.success) {
      this.initializedScenarios.add(scenarioId)
    }

    return result
  }

  async executeSql(scenarioId: string, sql: string): Promise<ScenarioSqlResult> {
    return api.scenarioDb.executeSql({ scenarioId, sql })
  }

  async drop(scenarioId: string, uninstallScripts: ScenarioDbScript[]): Promise<{
    success: boolean
    error?: string
  }> {
    const result = await api.scenarioDb.drop({
      scenarioId,
      uninstallScripts,
    })

    if (result.success) {
      this.initializedScenarios.delete(scenarioId)
    }

    return result
  }

  async getPath(scenarioId: string): Promise<string> {
    return api.scenarioDb.getPath(scenarioId)
  }

  isInitialized(scenarioId: string): boolean {
    return this.initializedScenarios.has(scenarioId)
  }
}

export const scenarioDatabaseManager = new ScenarioDatabaseManagerClass()

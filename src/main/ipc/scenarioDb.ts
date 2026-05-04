/**
 * 场景数据库 IPC handlers
 *
 * 为场景模块提供专属数据库的生命周期管理：
 * - scenario-db:initialize  — 创建场景专属 SQLite 数据库并执行安装脚本
 * - scenario-db:executeSql  — 在场景专属数据库中执行 SQL
 * - scenario-db:drop        — 执行卸载脚本并删除场景专属数据库文件
 * - scenario-db:getPath     — 获取场景数据库文件路径
 *
 * 数据库隔离策略：每个场景一个独立 SQLite 文件
 *   路径: {userDataPath}/scenario-data/{scenarioId}/{scenarioId}.db
 */

import { logger } from '@shared/utils/Logger'
import { safeIpcHandle } from './safeHandle'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

interface SqlScript {
  id: string
  description?: string
  sql: string
}

interface InitializeParams {
  scenarioId: string
  installScripts: SqlScript[]
}

interface ExecuteSqlParams {
  scenarioId: string
  sql: string
}

interface DropParams {
  scenarioId: string
  uninstallScripts: SqlScript[]
}

interface SqlResult {
  success: boolean
  rowsAffected?: number
  rows?: Record<string, unknown>[]
  columns?: string[]
  error?: string
  executionTime?: number
}

function getScenarioDbDir(scenarioId: string): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'scenario-data', scenarioId)
}

function getScenarioDbPath(scenarioId: string): string {
  return path.join(getScenarioDbDir(scenarioId), `${scenarioId}.db`)
}

async function executeSqlInFile(dbPath: string, sql: string): Promise<SqlResult> {
  const startTime = Date.now()
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { open: true })
    try {
      db.exec('PRAGMA journal_mode=WAL')
      db.exec('PRAGMA foreign_keys=ON')

      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)

      let totalRowsAffected = 0
      let lastRows: Record<string, unknown>[] | undefined
      let lastColumns: string[] | undefined

      for (const stmt of statements) {
        try {
          if (/^\s*(SELECT|PRAGMA)\s/i.test(stmt)) {
            const prepared = db.prepare(stmt)
            const rows = prepared.all() as Record<string, unknown>[]
            lastRows = rows
            lastColumns = rows.length > 0 ? Object.keys(rows[0]) : []
            totalRowsAffected += rows.length
          } else {
            const prepared = db.prepare(stmt)
            prepared.run()
            totalRowsAffected++
          }
        } catch (stmtErr) {
          logger.agent.warn(
            `[ScenarioDB] Statement failed: ${stmt.slice(0, 80)}... — ${stmtErr instanceof Error ? stmtErr.message : String(stmtErr)}`
          )
        }
      }

      return {
        success: true,
        rowsAffected: totalRowsAffected,
        rows: lastRows,
        columns: lastColumns,
        executionTime: Date.now() - startTime,
      }
    } finally {
      db.close()
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - startTime,
    }
  }
}

export function registerScenarioDbIpcHandlers(): void {
  safeIpcHandle('scenario-db:initialize', async (_event, params: InitializeParams) => {
    const { scenarioId, installScripts } = params
    const dbDir = getScenarioDbDir(scenarioId)
    const dbPath = getScenarioDbPath(scenarioId)

    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }

      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(dbPath)
      db.close()

      logger.agent.info(`[ScenarioDB] Created database for scenario "${scenarioId}" at ${dbPath}`)

      const results: Array<{ scriptId: string; success: boolean; error?: string }> = []
      for (const script of installScripts) {
        const result = await executeSqlInFile(dbPath, script.sql)
        results.push({
          scriptId: script.id,
          success: result.success,
          error: result.error,
        })
        if (result.success) {
          logger.agent.info(`[ScenarioDB] Executed install script "${script.id}" for scenario "${scenarioId}"`)
        } else {
          logger.agent.error(`[ScenarioDB] Install script "${script.id}" failed for scenario "${scenarioId}": ${result.error}`)
        }
      }

      const allSuccess = results.every(r => r.success)
      return {
        success: allSuccess,
        dbPath,
        results,
        error: allSuccess ? undefined : 'Some install scripts failed',
      }
    } catch (err) {
      logger.agent.error(`[ScenarioDB] Failed to initialize database for scenario "${scenarioId}":`, err)
      return {
        success: false,
        dbPath,
        results: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  safeIpcHandle('scenario-db:executeSql', async (_event, params: ExecuteSqlParams) => {
    const { scenarioId, sql } = params
    const dbPath = getScenarioDbPath(scenarioId)

    if (!fs.existsSync(dbPath)) {
      return {
        success: false,
        error: `Database not found for scenario "${scenarioId}". Please install the scenario first.`,
      }
    }

    return executeSqlInFile(dbPath, sql)
  })

  safeIpcHandle('scenario-db:drop', async (_event, params: DropParams) => {
    const { scenarioId, uninstallScripts } = params
    const dbPath = getScenarioDbPath(scenarioId)

    try {
      if (fs.existsSync(dbPath)) {
        if (uninstallScripts && uninstallScripts.length > 0) {
          for (const script of uninstallScripts) {
            const result = await executeSqlInFile(dbPath, script.sql)
            if (result.success) {
              logger.agent.info(`[ScenarioDB] Executed uninstall script "${script.id}" for scenario "${scenarioId}"`)
            } else {
              logger.agent.warn(`[ScenarioDB] Uninstall script "${script.id}" failed: ${result.error}`)
            }
          }
        }

        const dbDir = getScenarioDbDir(scenarioId)
        fs.rmSync(dbDir, { recursive: true, force: true })
        logger.agent.info(`[ScenarioDB] Dropped database for scenario "${scenarioId}"`)
      }

      return { success: true }
    } catch (err) {
      logger.agent.error(`[ScenarioDB] Failed to drop database for scenario "${scenarioId}":`, err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  safeIpcHandle('scenario-db:getPath', async (_event, scenarioId: string) => {
    return getScenarioDbPath(scenarioId)
  })

  logger.ipc.info('[ScenarioDB] IPC handlers registered')
}

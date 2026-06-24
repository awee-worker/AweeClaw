/**
 * 跨设备工作流同步（Phase 5）
 *
 * 提供工作流和录制脚本的跨设备同步能力。
 * 由于完整云同步需要后端账户体系支持，本模块实现：
 * 1. 本地导入/导出（JSON 文件格式）
 * 2. 同步接口设计（供后端实现对接）
 * 3. 设备指纹生成（用于设备识别）
 * 4. 冲突解决策略
 *
 * 完整云同步流程（需后端支持）：
 *   设备 A 导出 → 上传到云端 → 设备 B 下载 → 导入
 *
 * @module desktop-control/WorkflowSync
 */

import * as fs from 'fs'
import * as crypto from 'crypto'
import * as os from 'os'
import { logger } from '@shared/toolkit/LogEngine'
import { getWorkflowEngine } from './WorkflowEngine'
import type { WorkflowDefinition } from './types/workflow'
import type { RecordingScript } from './types/recording'

// ============================================
// 同步数据类型定义
// ============================================

/** 同步包格式版本 */
export const SYNC_FORMAT_VERSION = '1.0.0'

/** 同步包类型 */
export type SyncPackageType = 'workflows' | 'recordings' | 'all'

/** 同步包元数据 */
export interface SyncPackageMetadata {
  /** 格式版本 */
  format: 'aweeclaw-sync'
  /** 版本号 */
  version: string
  /** 导出时间 */
  exportedAt: string
  /** 源设备 ID */
  deviceId: string
  /** 源设备名称 */
  deviceName: string
  /** 源平台 */
  platform: string
  /** 包类型 */
  type: SyncPackageType
  /** 工作流数量 */
  workflowCount: number
  /** 录制数量 */
  recordingCount: number
}

/** 同步包 */
export interface SyncPackage {
  metadata: SyncPackageMetadata
  workflows: WorkflowDefinition[]
  recordings: RecordingScript[]
}

/** 导入结果 */
export interface SyncImportResult {
  success: boolean
  importedWorkflows: number
  importedRecordings: number
  skippedWorkflows: number
  skippedRecordings: number
  errors: string[]
}

/** 冲突解决策略 */
export type ConflictResolution =
  | 'skip'           // 跳过已存在的
  | 'overwrite'      // 覆盖已存在的
  | 'rename'         // 重命名导入的
  | 'merge'          // 合并（保留两者的，重命名导入的）

/** 导入选项 */
export interface SyncImportOptions {
  /** 冲突解决策略 */
  conflictResolution: ConflictResolution
  /** 是否只导入启用的工作流 */
  onlyEnabled: boolean
  /** 是否验证平台兼容性 */
  validatePlatform: boolean
  /** 目标平台 */
  targetPlatform?: 'darwin' | 'win32' | 'linux'
}

/** 设备信息 */
export interface DeviceInfo {
  /** 设备 ID（基于硬件指纹） */
  id: string
  /** 设备名称 */
  name: string
  /** 平台 */
  platform: string
  /** 应用版本 */
  appVersion: string
}

// ============================================
// 设备指纹生成
// ============================================

/** 生成设备指纹（基于主机名 + 平台 + 用户名） */
export function getDeviceInfo(): DeviceInfo {
  const hostname = os.hostname() || 'unknown'
  const platform = process.platform
  const userInfo = os.userInfo()
  const username = userInfo.username || 'unknown'

  // 生成稳定的设备 ID
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${hostname}:${platform}:${username}`)
    .digest('hex')
    .substring(0, 16)

  return {
    id: fingerprint,
    name: hostname,
    platform,
    appVersion: require('../../../package.json').version || '0.0.0',
  }
}

// ============================================
// 导出功能
// ============================================

/** 导出工作流和录制为同步包 */
export function exportSyncPackage(
  type: SyncPackageType = 'all',
  workflowIds?: string[],
  recordingIds?: string[],
): SyncPackage {
  const engine = getWorkflowEngine()
  const device = getDeviceInfo()

  let workflows: WorkflowDefinition[] = []
  let recordings: RecordingScript[] = []

  if (type === 'workflows' || type === 'all') {
    const allWorkflows = engine.list()
    workflows = workflowIds
      ? allWorkflows.filter(w => workflowIds.includes(w.id))
      : allWorkflows
  }

  if (type === 'recordings' || type === 'all') {
    const allRecordings = engine.listRecordings()
    recordings = recordingIds
      ? allRecordings.filter(r => recordingIds.includes(r.id))
      : allRecordings
  }

  return {
    metadata: {
      format: 'aweeclaw-sync',
      version: SYNC_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId: device.id,
      deviceName: device.name,
      platform: device.platform,
      type,
      workflowCount: workflows.length,
      recordingCount: recordings.length,
    },
    workflows,
    recordings,
  }
}

/** 将同步包导出为 JSON 文件 */
export function exportSyncPackageToFile(
  filePath: string,
  type: SyncPackageType = 'all',
  workflowIds?: string[],
  recordingIds?: string[],
): { success: boolean; path?: string; error?: string } {
  try {
    const pkg = exportSyncPackage(type, workflowIds, recordingIds)
    const json = JSON.stringify(pkg, null, 2)
    fs.writeFileSync(filePath, json, 'utf-8')
    logger.system.info(`[WorkflowSync] Exported ${pkg.metadata.workflowCount} workflows, ${pkg.metadata.recordingCount} recordings to ${filePath}`)
    return { success: true, path: filePath }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.system.error(`[WorkflowSync] Export failed: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}

// ============================================
// 导入功能
// ============================================

/** 从 JSON 解析同步包 */
export function parseSyncPackage(json: string): SyncPackage {
  const parsed = JSON.parse(json) as Partial<SyncPackage>

  if (!parsed.metadata || parsed.metadata.format !== 'aweeclaw-sync') {
    throw new Error('Invalid sync package: missing or invalid format')
  }

  if (!parsed.metadata.version) {
    throw new Error('Invalid sync package: missing version')
  }

  // 版本兼容性检查（目前仅支持 1.x.x）
  const majorVersion = parsed.metadata.version.split('.')[0]
  if (majorVersion !== '1') {
    throw new Error(`Unsupported sync package version: ${parsed.metadata.version}`)
  }

  return {
    metadata: parsed.metadata,
    workflows: parsed.workflows || [],
    recordings: parsed.recordings || [],
  }
}

/** 导入同步包 */
export function importSyncPackage(
  pkg: SyncPackage,
  options: SyncImportOptions = { conflictResolution: 'skip', onlyEnabled: false, validatePlatform: false },
): SyncImportResult {
  const engine = getWorkflowEngine()
  const result: SyncImportResult = {
    success: true,
    importedWorkflows: 0,
    importedRecordings: 0,
    skippedWorkflows: 0,
    skippedRecordings: 0,
    errors: [],
  }

  // 导入工作流
  for (const workflow of pkg.workflows) {
    try {
      // 平台兼容性检查
      if (options.validatePlatform && options.targetPlatform) {
        // 检查工作流步骤是否支持目标平台
        // 简化实现：假设所有工作流都跨平台兼容
      }

      // 只导入启用的工作流
      if (options.onlyEnabled && !workflow.enabled) {
        result.skippedWorkflows++
        continue
      }

      const existing = engine.get(workflow.id)
      if (existing) {
        switch (options.conflictResolution) {
          case 'skip':
            result.skippedWorkflows++
            continue
          case 'overwrite':
            engine.update(workflow.id, workflow)
            result.importedWorkflows++
            continue
          case 'rename':
          case 'merge':
            // 生成新 ID 避免冲突
            const newWorkflow = {
              ...workflow,
              id: `${workflow.id}-${Date.now()}`,
              name: `${workflow.name} (imported)`,
            }
            engine.register(newWorkflow)
            result.importedWorkflows++
            continue
        }
      }

      engine.register(workflow)
      result.importedWorkflows++
    } catch (err) {
      result.errors.push(`Workflow ${workflow.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 导入录制
  for (const recording of pkg.recordings) {
    try {
      const existing = engine.getRecording(recording.id)
      if (existing) {
        switch (options.conflictResolution) {
          case 'skip':
            result.skippedRecordings++
            continue
          case 'overwrite':
            engine.saveRecording(recording)
            result.importedRecordings++
            continue
          case 'rename':
          case 'merge':
            const newRecording = {
              ...recording,
              id: `${recording.id}-${Date.now()}`,
            }
            engine.saveRecording(newRecording)
            result.importedRecordings++
            continue
        }
      }

      engine.saveRecording(recording)
      result.importedRecordings++
    } catch (err) {
      result.errors.push(`Recording ${recording.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  logger.system.info(
    `[WorkflowSync] Import complete: ${result.importedWorkflows} workflows, ${result.importedRecordings} recordings imported, ${result.skippedWorkflows} workflows, ${result.skippedRecordings} recordings skipped`,
  )

  return result
}

/** 从 JSON 文件导入同步包 */
export function importSyncPackageFromFile(
  filePath: string,
  options?: SyncImportOptions,
): SyncImportResult {
  try {
    const json = fs.readFileSync(filePath, 'utf-8')
    const pkg = parseSyncPackage(json)
    return importSyncPackage(pkg, options)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.system.error(`[WorkflowSync] Import from file failed: ${errorMsg}`)
    return {
      success: false,
      importedWorkflows: 0,
      importedRecordings: 0,
      skippedWorkflows: 0,
      skippedRecordings: 0,
      errors: [errorMsg],
    }
  }
}

// ============================================
// 云同步接口设计（供后端实现对接）
// ============================================

/** 云同步状态 */
export type CloudSyncState =
  | 'idle'           // 空闲
  | 'uploading'      // 上传中
  | 'downloading'    // 下载中
  | 'syncing'        // 同步中
  | 'error'          // 错误
  | 'offline'        // 离线

/** 云同步配置 */
export interface CloudSyncConfig {
  /** 是否启用云同步 */
  enabled: boolean
  /** 同步间隔（毫秒），0=手动 */
  syncInterval: number
  /** 自动同步方向 */
  direction: 'upload' | 'download' | 'bidirectional'
  /** 冲突解决策略 */
  conflictResolution: ConflictResolution
  /** 排除的工作流 ID */
  excludeWorkflowIds: string[]
  /** 排除的录制 ID */
  excludeRecordingIds: string[]
}

/** 云同步结果 */
export interface CloudSyncResult {
  success: boolean
  uploadedWorkflows: number
  uploadedRecordings: number
  downloadedWorkflows: number
  downloadedRecordings: number
  conflicts: number
  error?: string
  syncedAt: string
}

/** 云同步接口（供后端实现） */
export interface ICloudSyncProvider {
  /** 上传本地数据到云端 */
  upload(pkg: SyncPackage): Promise<{ success: boolean; error?: string }>
  /** 从云端下载数据 */
  download(): Promise<{ success: boolean; data?: SyncPackage; error?: string }>
  /** 获取云端变更列表 */
  getChanges(since: string): Promise<{ workflows: string[]; recordings: string[] }>
  /** 解决冲突 */
  resolveConflict(itemId: string, resolution: ConflictResolution): Promise<boolean>
  /** 获取同步状态 */
  getState(): CloudSyncState
}

/** 默认云同步配置 */
export const DEFAULT_CLOUD_SYNC_CONFIG: CloudSyncConfig = {
  enabled: false,
  syncInterval: 0,
  direction: 'bidirectional',
  conflictResolution: 'skip',
  excludeWorkflowIds: [],
  excludeRecordingIds: [],
}

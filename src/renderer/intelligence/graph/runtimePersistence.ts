/**
 * 运行时持久化 —— Graph Runtime 阶段五
 *
 * 职责：将 graphVersion=2 图执行的运行时状态（session 元数据 + checkpoint）
 *       原子持久化到磁盘，供应用崩溃/重启后恢复执行。
 *
 * 设计要点：
 * - 独立 runtime/ 目录，与 planner/ 物理隔离（用户不可编辑）
 * - 一个 plan 一个文件（${planId}.runtime.json），原子恢复 + 原子清理
 * - 原子写入：write .tmp + rename，防崩溃中途写坏
 * - debounce 120ms（复用 savePlan 模式），避免高频写盘
 * - schemaVersion 版本控制，未来格式变更加迁移函数
 *
 * @module GraphRuntime/persistence
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { BRAND } from '@shared/brand'
import type { NodeCheckpoint } from './CheckpointManager'

// ============================================
// 常量与类型定义
// ============================================

/** 运行时持久化 schema 版本 */
export const RUNTIME_SCHEMA_VERSION = 1

/** 运行时目录名（相对 BRAND.dirName） */
export const RUNTIME_DIR_NAME = 'runtime'

/** 防抖延迟（与 savePlan 一致） */
const RUNTIME_SAVE_DEBOUNCE_MS = 120

/**
 * 持久化的 session 元数据（仅含崩溃恢复所需字段）
 */
export interface PersistedSessionMeta {
  /** session id（用于日志关联，恢复时用新 id） */
  sessionId: string
  /** session 启动时间（保留统计连续性） */
  startedAt: number
  /** session 状态：仅持久化 awaiting_approval / running */
  status: 'awaiting_approval' | 'running'
  /** HITL 等待节点 id（仅 status='awaiting_approval' 时有值） */
  awaitingNodeId?: string
  /** 最后更新时间 */
  lastUpdatedAt: number
}

/**
 * 运行时状态文件（一个 plan 一个文件）
 */
export interface RuntimeStateFile {
  /** schema 版本，用于兼容性校验 */
  schemaVersion: number
  /** 所属 plan id */
  planId: string
  /** 写入时的 plan.revision，恢复时校验 plan 是否被外部修改 */
  planRevision: number
  /** session 元数据 */
  session: PersistedSessionMeta
  /** 最新 checkpoint（直接序列化 NodeCheckpoint） */
  checkpoint: NodeCheckpoint
}

// ============================================
// 路径计算
// ============================================

/**
 * 获取运行时目录绝对路径
 */
export function getRuntimeDir(workspacePath: string): string {
  return `${workspacePath}/${BRAND.dirName}/${RUNTIME_DIR_NAME}`
}

/**
 * 获取指定 plan 的运行时文件路径
 */
export function getRuntimeFilePath(workspacePath: string, planId: string): string {
  return `${getRuntimeDir(workspacePath)}/${planId}.runtime.json`
}

/**
 * 获取临时文件路径（原子写用）
 */
function getTmpFilePath(runtimeFilePath: string): string {
  return `${runtimeFilePath}.tmp`
}

// ============================================
// Schema 校验
// ============================================

/**
 * 校验反序列化后的对象是否符合 RuntimeStateFile schema
 *
 * @returns 合法返回 RuntimeStateFile，非法返回 null
 */
export function validateRuntimeState(raw: unknown): RuntimeStateFile | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  // schemaVersion 校验
  if (obj.schemaVersion !== RUNTIME_SCHEMA_VERSION) {
    logger.agent.warn(
      `[RuntimePersistence] schemaVersion mismatch: expected ${RUNTIME_SCHEMA_VERSION}, got ${obj.schemaVersion}`,
    )
    return null
  }

  // 必填字段校验
  if (typeof obj.planId !== 'string' || !obj.planId) return null
  if (typeof obj.planRevision !== 'number') return null

  // session 校验
  const session = obj.session as Record<string, unknown> | undefined
  if (!session || typeof session !== 'object') return null
  if (typeof session.sessionId !== 'string') return null
  if (typeof session.startedAt !== 'number') return null
  if (session.status !== 'awaiting_approval' && session.status !== 'running') return null
  if (session.status === 'awaiting_approval' && typeof session.awaitingNodeId !== 'string') {
    return null
  }
  if (typeof session.lastUpdatedAt !== 'number') return null

  // checkpoint 校验
  const checkpoint = obj.checkpoint as Record<string, unknown> | undefined
  if (!checkpoint || typeof checkpoint !== 'object') return null
  if (typeof checkpoint.checkpointId !== 'string') return null
  if (typeof checkpoint.graphId !== 'string') return null
  if (typeof checkpoint.nodeId !== 'string') return null
  if (typeof checkpoint.timestamp !== 'number') return null
  if (!Array.isArray(checkpoint.completedNodes)) return null
  if (!checkpoint.stateSnapshot || typeof checkpoint.stateSnapshot !== 'object') return null

  return obj as unknown as RuntimeStateFile
}

/**
 * 序列化 RuntimeStateFile 为 JSON 字符串
 *
 * 失败时返回 null（不可序列化值如 Function/Class 实例）
 */
export function serializeRuntimeState(state: RuntimeStateFile): string | null {
  try {
    return JSON.stringify(state, null, 2)
  } catch (err) {
    logger.agent.warn(
      `[RuntimePersistence] Failed to serialize runtime state for plan ${state.planId}:`,
      err,
    )
    return null
  }
}

// ============================================
// 写入防抖（复用 savePlan 的 revision 防覆盖模式）
// ============================================

const runtimeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const runtimeLatestRevision = new Map<string, number>()

/**
 * 防抖保存运行时状态（高频调用场景）
 *
 * - 120ms 内多次调用只写一次
 * - revision 防覆盖：旧写不覆盖新状态
 * - 原子写：write .tmp + rename
 *
 * @param workspacePath 工作区路径
 * @param state 待保存的状态
 */
export function saveRuntimeStateDebounced(
  workspacePath: string,
  state: RuntimeStateFile,
): void {
  const planId = state.planId
  runtimeLatestRevision.set(planId, state.planRevision)

  const existingTimer = runtimeSaveTimers.get(planId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    runtimeSaveTimers.delete(planId)
    void doSaveRuntimeState(workspacePath, state).catch(err => {
      logger.agent.error(`[RuntimePersistence] Debounced save failed for plan ${planId}:`, err)
    })
  }, RUNTIME_SAVE_DEBOUNCE_MS)
  runtimeSaveTimers.set(planId, timer)
}

/**
 * 立即保存运行时状态（无防抖，用于 awaiting_approval 等关键状态）
 *
 * 取消该 plan 的待执行防抖写入，直接写盘。
 */
export async function saveRuntimeStateImmediate(
  workspacePath: string,
  state: RuntimeStateFile,
): Promise<void> {
  // 取消待执行的防抖写入，避免覆盖
  const planId = state.planId
  runtimeLatestRevision.set(planId, state.planRevision)
  const existingTimer = runtimeSaveTimers.get(planId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    runtimeSaveTimers.delete(planId)
  }

  await doSaveRuntimeState(workspacePath, state)
}

/**
 * 实际执行写入（原子写 + revision 防覆盖）
 */
async function doSaveRuntimeState(
  workspacePath: string,
  state: RuntimeStateFile,
): Promise<void> {
  // revision 防覆盖：检查是否已有更新的 revision 排队
  const queuedRevision = runtimeLatestRevision.get(state.planId) || 0
  if (state.planRevision < queuedRevision) {
    // 有更新的状态已排队，跳过本次写入
    return
  }

  const content = serializeRuntimeState(state)
  if (!content) return // 序列化失败已在内部日志

  const filePath = getRuntimeFilePath(workspacePath, state.planId)
  const tmpPath = getTmpFilePath(filePath)

  try {
    // 确保目录存在
    const dir = getRuntimeDir(workspacePath)
    if (!(await api.file.exists(dir))) {
      await api.file.ensureDir(dir)
    }

    // 原子写：先写 .tmp，再 rename
    await api.file.write(tmpPath, content)
    await api.file.rename(tmpPath, filePath)
  } catch (err) {
    logger.agent.error(
      `[RuntimePersistence] Failed to write runtime file for plan ${state.planId}:`,
      err,
    )
    // 清理可能残留的 .tmp
    try {
      if (await api.file.exists(tmpPath)) {
        await api.file.delete(tmpPath)
      }
    } catch {
      // 忽略清理失败
    }
  }
}

// ============================================
// 读取 / 删除 / 列举
// ============================================

/**
 * 读取指定 plan 的运行时状态
 *
 * @returns 合法状态返回 RuntimeStateFile；文件不存在/损坏/校验失败返回 null
 */
export async function loadRuntimeState(
  workspacePath: string,
  planId: string,
): Promise<RuntimeStateFile | null> {
  const filePath = getRuntimeFilePath(workspacePath, planId)
  try {
    if (!(await api.file.exists(filePath))) return null

    const content = await api.file.read(filePath)
    if (!content) return null

    const parsed = JSON.parse(content)
    return validateRuntimeState(parsed)
  } catch (err) {
    logger.agent.warn(
      `[RuntimePersistence] Failed to load runtime state for plan ${planId}:`,
      err,
    )
    return null
  }
}

/**
 * 删除指定 plan 的运行时文件（session 终态/plan 删除时调用）
 */
export async function deleteRuntimeState(
  workspacePath: string,
  planId: string,
): Promise<void> {
  const filePath = getRuntimeFilePath(workspacePath, planId)
  const tmpPath = getTmpFilePath(filePath)

  try {
    if (await api.file.exists(filePath)) {
      await api.file.delete(filePath)
    }
    if (await api.file.exists(tmpPath)) {
      await api.file.delete(tmpPath)
    }
  } catch (err) {
    logger.agent.warn(
      `[RuntimePersistence] Failed to delete runtime file for plan ${planId}:`,
      err,
    )
  }

  // 清理防抖计时器
  const timer = runtimeSaveTimers.get(planId)
  if (timer) {
    clearTimeout(timer)
    runtimeSaveTimers.delete(planId)
  }
  runtimeLatestRevision.delete(planId)
}

/**
 * 列出 runtime/ 目录下所有 .runtime.json 文件名
 *
 * @returns 文件名列表（如 ['plan-abc.runtime.json', ...]）；目录不存在返回空数组
 */
export async function listRuntimeFiles(workspacePath: string): Promise<string[]> {
  const dir = getRuntimeDir(workspacePath)
  try {
    if (!(await api.file.exists(dir))) return []

    const entries = await api.file.readDir(dir)
    if (!entries || !Array.isArray(entries)) return []

    return entries
      .filter((entry: unknown) => {
        const name = typeof entry === 'string' ? entry : (entry as { name?: string }).name
        return typeof name === 'string' && name.endsWith('.runtime.json')
      })
      .map((entry: unknown) =>
        typeof entry === 'string' ? entry : (entry as { name: string }).name,
      )
  } catch (err) {
    logger.agent.warn(`[RuntimePersistence] Failed to list runtime files:`, err)
    return []
  }
}

/**
 * 清理 .tmp 孤儿文件（应用启动时调用）
 *
 * 崩溃可能残留 .tmp 文件（write 完成 rename 未完成），启动时清理。
 */
export async function cleanupOrphanTmp(workspacePath: string): Promise<void> {
  const dir = getRuntimeDir(workspacePath)
  try {
    if (!(await api.file.exists(dir))) return

    const entries = await api.file.readDir(dir)
    if (!entries || !Array.isArray(entries)) return

    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : (entry as { name?: string }).name
      if (typeof name === 'string' && name.endsWith('.tmp')) {
        try {
          await api.file.delete(`${dir}/${name}`)
          logger.agent.debug(`[RuntimePersistence] Cleaned orphan tmp: ${name}`)
        } catch {
          // 忽略单个清理失败
        }
      }
    }
  } catch (err) {
    logger.agent.warn(`[RuntimePersistence] Failed to cleanup orphan tmp:`, err)
  }
}

/**
 * 从文件名提取 planId
 * 'plan-abc.runtime.json' → 'plan-abc'
 */
export function extractPlanIdFromFileName(fileName: string): string {
  return fileName.replace(/\.runtime\.json$/, '')
}

// ============================================
// 测试辅助：清理防抖状态（单测 beforeEach 用）
// ============================================

/**
 * 清理所有防抖计时器和 revision 缓存（测试专用）
 */
export function clearRuntimePersistenceState(): void {
  for (const timer of runtimeSaveTimers.values()) {
    clearTimeout(timer)
  }
  runtimeSaveTimers.clear()
  runtimeLatestRevision.clear()
}

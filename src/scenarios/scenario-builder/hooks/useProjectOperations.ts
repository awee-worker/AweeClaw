/**
 * 项目操作 Hook
 *
 * 统一封装校验 / 构建 / 打包 / 安装 / 发布 五大操作的执行逻辑与状态管理。
 * ProjectListPanel 与 BuildPanel 共用此 Hook，避免重复代码，保证行为一致。
 *
 * 设计要点：
 * - 以 projectId 为维度维护每项操作的运行状态（idle/running/success/failed）
 * - 操作完成后自动刷新项目数据与列表，保证 UI 与 DB 一致
 * - 通过 toast 给出明确反馈，失败时附带错误信息
 * - 安装/发布前自动解析最近一次打包产物路径，缺失时提示先打包
 */
import { useCallback, useState } from 'react'
import type React from 'react'
import { buildService, installService, publishService } from '../services'
import type { ScenarioProject, BuildRecord } from '../types'
import { useI18n } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { useSelectedProject } from './useSelectedProject'

/** 单项操作的运行状态 */
export type OpState = 'idle' | 'running' | 'success' | 'failed'

/** 一个项目的全部操作状态 */
export interface ProjectOpStates {
  validate: OpState
  build: OpState
  pack: OpState
  install: OpState
  publish: OpState
}

const IDLE_STATES: ProjectOpStates = {
  validate: 'idle',
  build: 'idle',
  pack: 'idle',
  install: 'idle',
  publish: 'idle',
}

/** 操作类型枚举（用于 setState 辅助） */
type OpKind = keyof ProjectOpStates

/** 单次操作完成的回调参数 */
export interface OpCompletePayload {
  projectId: string
  kind: OpKind
  success: boolean
}

/** 操作失败详情（用于弹窗展示） */
export interface OpErrorInfo {
  /** 操作名称（已国际化，如"构建"） */
  operationLabel: string
  /** 项目名称 */
  projectName: string
  /** 错误消息 */
  message: string
  /** 可选的错误详情/日志 */
  detail?: string
  /** 时间戳 */
  timestamp: number
}

export interface UseProjectOperations {
  /** 获取指定项目的操作状态（未记录则返回全 idle） */
  getStates: (projectId: string) => ProjectOpStates
  /** 校验项目 */
  validate: (project: ScenarioProject) => Promise<void>
  /** 构建项目 */
  build: (project: ScenarioProject) => Promise<void>
  /** 打包项目 */
  pack: (project: ScenarioProject) => Promise<void>
  /** 安装项目到本地客户端 */
  install: (project: ScenarioProject) => Promise<void>
  /** 发布项目到市场 */
  publish: (project: ScenarioProject) => Promise<void>
  /** 重置某项目某项操作的状态为 idle */
  reset: (projectId: string, kind: OpKind) => void
  /** 最近一次操作失败详情（无则为 null） */
  lastError: OpErrorInfo | null
  /** 关闭错误弹窗 */
  dismissError: () => void
}

export function useProjectOperations(
  onProjectsChanged?: () => void,
  onOpComplete?: (payload: OpCompletePayload) => void,
): UseProjectOperations {
  const { t } = useI18n()
  const { refresh: refreshSelected } = useSelectedProject()
  // 以 projectId 为键保存操作状态
  const [statesMap, setStatesMap] = useState<Record<string, ProjectOpStates>>({})
  // 最近一次操作失败详情（用于弹窗展示）
  const [lastError, setLastError] = useState<OpErrorInfo | null>(null)

  /** 关闭错误弹窗 */
  const dismissError = useCallback(() => setLastError(null), [])

  /** 读取某项目的状态（兜底返回全 idle） */
  const getStates = useCallback(
    (projectId: string): ProjectOpStates => statesMap[projectId] ?? IDLE_STATES,
    [statesMap],
  )

  /** 更新某项目某项操作的状态 */
  const setState = useCallback((projectId: string, kind: OpKind, state: OpState) => {
    setStatesMap((prev) => ({
      ...prev,
      [projectId]: {
        ...(prev[projectId] ?? IDLE_STATES),
        [kind]: state,
      },
    }))
  }, [])

  /** 操作完成后的统一处理：刷新选中项目 + 刷新列表 + 通知完成回调 */
  const afterOp = useCallback(
    async (project: ScenarioProject, kind: OpKind, success: boolean) => {
      // 刷新选中项目（若操作的不是选中项目，refresh 内部会 no-op）
      await refreshSelected()
      // 通知外部刷新项目列表（status/lastBuiltAt 等可能变更）
      onProjectsChanged?.()
      // 通知完成回调（供 BuildPanel 等刷新历史/日志）
      onOpComplete?.({ projectId: project.id, kind, success })
    },
    [refreshSelected, onProjectsChanged, onOpComplete],
  )

  /** 统一的执行包装器：自动管理 running/success/failed + toast + 失败弹窗 */
  const runOp = useCallback(
    async (
      project: ScenarioProject,
      kind: OpKind,
      operationLabel: string,
      successMsg: string,
      failedMsg: string,
      executor: () => Promise<{ ok: boolean; message?: string; detail?: string }>,
    ) => {
      setState(project.id, kind, 'running')
      try {
        const result = await executor()
        const ok = result.ok
        if (ok) {
          setState(project.id, kind, 'success')
          toast.success(successMsg, project.name)
        } else {
          setState(project.id, kind, 'failed')
          const errMsg = result.message || result.detail || project.name
          toast.error(failedMsg, errMsg)
          // 弹窗展示失败详情，便于用户定位问题
          setLastError({
            operationLabel,
            projectName: project.name,
            message: errMsg,
            detail: result.detail,
            timestamp: Date.now(),
          })
        }
        await afterOp(project, kind, ok)
      } catch (err) {
        setState(project.id, kind, 'failed')
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(failedMsg, msg)
        setLastError({
          operationLabel,
          projectName: project.name,
          message: msg,
          timestamp: Date.now(),
        })
        await afterOp(project, kind, false)
      }
    },
    [setState, afterOp],
  )

  const validate = useCallback(
    (project: ScenarioProject) =>
      runOp(
        project,
        'validate',
        t('builder.action.validate'),
        t('builder.action.validateSuccess'),
        t('builder.action.validateFailed'),
        async () => {
          const record: BuildRecord = await buildService.validateProject(project.id)
          return { ok: record.status === 'success', detail: record.output }
        },
      ),
    [runOp, t],
  )

  const build = useCallback(
    (project: ScenarioProject) =>
      runOp(
        project,
        'build',
        t('builder.action.build'),
        t('builder.action.buildSuccess'),
        t('builder.action.buildFailed'),
        async () => {
          const record: BuildRecord = await buildService.buildProject(project.id)
          return { ok: record.status === 'success', detail: record.output }
        },
      ),
    [runOp, t],
  )

  const pack = useCallback(
    (project: ScenarioProject) =>
      runOp(
        project,
        'pack',
        t('builder.action.pack'),
        t('builder.action.packSuccess'),
        t('builder.action.packFailed'),
        async () => {
          const record: BuildRecord = await buildService.packProject(project.id)
          return { ok: record.status === 'success', detail: record.output }
        },
      ),
    [runOp, t],
  )

  const install = useCallback(
    (project: ScenarioProject) =>
      runOp(
        project,
        'install',
        t('builder.action.install'),
        t('builder.install.success'),
        t('builder.install.failed'),
        async () => {
          // 先解析打包产物路径，缺失则提示先打包
          const pkgPath = await buildService.getPackagePath(project.id)
          if (!pkgPath) {
            return { ok: false, message: t('builder.action.needPackFirst') }
          }
          // installScenario 内部捕获 IPC 异常并以 record.status 返回结果，
          // 不会抛出，必须显式检查 status 判定成功/失败。
          const record = await installService.installScenario(project.id, project.version, pkgPath)
          if (record.status !== 'installed') {
            return { ok: false, message: record.error || t('builder.install.failed') }
          }
          return { ok: true }
        },
      ),
    [runOp, t],
  )

  const publish = useCallback(
    (project: ScenarioProject) =>
      runOp(
        project,
        'publish',
        t('builder.action.publish'),
        t('builder.publish.success'),
        t('builder.publish.failed'),
        async () => {
          // 1. 检查登录状态
          const status = await publishService.checkPublishStatus()
          if (!status.loggedIn) {
            return { ok: false, message: t('builder.publish.loginFirst') }
          }
          // 2. 解析打包产物路径
          const pkgPath = await buildService.getPackagePath(project.id)
          if (!pkgPath) {
            return { ok: false, message: t('builder.action.needPackFirst') }
          }
          // 3. 执行发布（包名默认使用 scenarioId）
          // publishScenario 内部捕获异常并以 record.status 返回结果，
          // 不会抛出，必须显式检查 status 判定成功/失败。
          const record = await publishService.publishScenario(
            project.id,
            project.version,
            project.scenarioId,
            pkgPath,
          )
          if (record.status !== 'published') {
            return { ok: false, message: record.error || t('builder.publish.failed') }
          }
          return { ok: true }
        },
      ),
    [runOp, t],
  )

  const reset = useCallback(
    (projectId: string, kind: OpKind) => {
      setState(projectId, kind, 'idle')
    },
    [setState],
  )

  return { getStates, validate, build, pack, install, publish, reset, lastError, dismissError }
}

/** 操作按钮配置：供 ProjectListPanel / BuildPanel 共用，保证一致性 */
export interface OpButtonConfig {
  kind: OpKind
  label: string
  icon: React.ReactNode
  /** 视觉风格 */
  variant: 'ghost' | 'primary' | 'success'
}

export default useProjectOperations

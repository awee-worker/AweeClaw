/**
 * 项目操作按钮行
 *
 * 校验 / 构建 / 打包 / 安装 / 发布 五大快捷操作的统一按钮组件。
 * 被 ProjectListPanel（项目卡片）与 BuildPanel（构建总览）共用，保证视觉与行为一致。
 *
 * 每个按钮独立显示自身运行状态（running / success / failed），
 * 避免多项目并行操作时状态混淆。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import type { ScenarioProject } from '../../types'
import type { UseProjectOperations, ProjectOpStates } from '../../hooks/useProjectOperations'

/** 单个操作按钮的渲染配置 */
interface ActionDef {
  kind: keyof ProjectOpStates
  label: string
  title: string
  /** 默认样式 */
  className: string
  /** 成功后追加样式 */
  successClassName: string
  /** 失败后追加样式 */
  failedClassName: string
  icon: React.ReactNode
}

interface Props {
  project: ScenarioProject
  operations: UseProjectOperations
  /** 尺寸：compact 用于卡片内（更小），normal 用于构建总览 */
  size?: 'compact' | 'normal'
  /** 点击按钮时额外回调（如展开日志） */
  onAfterClick?: (kind: keyof ProjectOpStates) => void
}

/** 通用 SVG 图标（内联，避免引入额外图标库依赖） */
const Icon = {
  check: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  cross: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  spinner: (
    <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ),
  validate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  build: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  pack: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  install: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  publish: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      <line x1="12" y1="13" x2="12" y2="21" />
      <polyline points="9 16 12 13 15 16" />
    </svg>
  ),
}

const ProjectActionButtons: React.FC<Props> = ({ project, operations, size = 'compact', onAfterClick }) => {
  const { t } = useI18n()
  const states = operations.getStates(project.id)

  /** 操作按钮基础样式（按尺寸区分，最小字体 12px 保证可读性） */
  const baseBtn =
    size === 'compact'
      ? 'flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100'
      : 'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100'

  /** 默认（非运行态）按钮配色：柔和边框 + hover 强调 */
  const idleClass = 'border-border/60 bg-background/40 text-text-secondary hover:border-accent/50 hover:bg-accent/8 hover:text-accent'

  /** 主操作（构建）默认配色：轻微强调，提示高频入口，但不抢视觉 */
  const primaryIdleClass = 'border-accent/30 bg-accent/5 text-accent/85 hover:border-accent/60 hover:bg-accent/12 hover:text-accent'

  /** 运行态：accent 主色填充 + 微脉冲 */
  const runningClass = 'border-accent/60 bg-accent/15 text-accent'

  /** 成功态：emerald 填充，统一带背景，视觉一致 */
  const successClass = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'

  /** 失败态：destructive 填充，统一带背景，视觉一致 */
  const failedClass = 'border-destructive/40 bg-destructive/10 text-destructive'

  const actions: ActionDef[] = [
    {
      kind: 'validate',
      label: t('builder.action.validate'),
      title: t('builder.action.validate'),
      className: idleClass,
      successClassName: successClass,
      failedClassName: failedClass,
      icon: Icon.validate,
    },
    {
      kind: 'build',
      label: t('builder.action.build'),
      title: t('builder.action.build'),
      className: primaryIdleClass,
      successClassName: successClass,
      failedClassName: failedClass,
      icon: Icon.build,
    },
    {
      kind: 'pack',
      label: t('builder.action.pack'),
      title: t('builder.action.pack'),
      className: idleClass,
      successClassName: successClass,
      failedClassName: failedClass,
      icon: Icon.pack,
    },
    {
      kind: 'install',
      label: t('builder.action.install'),
      title: t('builder.action.install'),
      className: idleClass,
      successClassName: successClass,
      failedClassName: failedClass,
      icon: Icon.install,
    },
    {
      kind: 'publish',
      label: t('builder.action.publish'),
      title: t('builder.action.publish'),
      className: idleClass,
      successClassName: successClass,
      failedClassName: failedClass,
      icon: Icon.publish,
    },
  ]

  /** 执行操作并回调 */
  const run = (kind: keyof ProjectOpStates) => {
    const fn = operations[kind]
    void fn(project)
    onAfterClick?.(kind)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {actions.map((act) => {
        const st = states[act.kind]
        const running = st === 'running'
        // 运行态统一使用 runningClass（accent 主色），避免不同按钮闪烁不一致
        const stateClass =
          st === 'success'
            ? act.successClassName
            : st === 'failed'
              ? act.failedClassName
              : st === 'running'
                ? runningClass
                : act.className
        return (
          <button
            key={act.kind}
            onClick={(e) => {
              e.stopPropagation()
              run(act.kind)
            }}
            disabled={running}
            title={act.title}
            className={`${baseBtn} ${stateClass}`}
          >
            {running ? (
              <span className="flex items-center gap-1">
                {Icon.spinner}
                <span>{act.label}</span>
              </span>
            ) : st === 'success' ? (
              <span className="flex items-center gap-1">
                {act.icon}
                <span className="opacity-70">{act.label}</span>
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
                  {Icon.check}
                </span>
              </span>
            ) : st === 'failed' ? (
              <span className="flex items-center gap-1">
                {act.icon}
                <span className="opacity-70">{act.label}</span>
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive/20 text-destructive">
                  {Icon.cross}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                {act.icon}
                <span>{act.label}</span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default ProjectActionButtons

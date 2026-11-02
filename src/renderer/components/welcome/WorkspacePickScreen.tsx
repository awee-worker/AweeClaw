/**
 * WorkspacePickScreen — 新窗口的工作空间选择入口
 *
 * 「新建窗口」不再直接继承上一窗口的工作空间，也不再直接落到新建任务页：
 * 它先停在这个界面，让用户明确选一个目录，选完才进入主界面。
 *
 * 界面取舍：
 * - 不做成欢迎页（WorkbenchHome）：那里承担工作台职责，有任务、场景卡片等
 *   与「先定目录」无关的内容，会把唯一要做的选择淹没掉。
 * - 最近列表直接可点：重复进入同一项目是最高频路径，不该再走一次系统对话框。
 * - 保留「先逛逛工作台」退路：用户只是想要一个新窗口看看，不该被卡在选目录上。
 *
 * 选完工作空间后由 store 的工作空间状态驱动界面自行退场，无需手动关闭。
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Clock3, Compass, Folder, FolderOpen, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { api } from '../../adapters/electronBridge'
import { workspaceManager, WorkspaceOpenError } from '@services/WorkspaceAdapter'
import { applyActiveScenarioToWorkspace } from '@services/scenarioEntryApplier'
import { toast } from '@components/foundation/NotificationProvider'
import { getDirname, getFileName } from '@shared/toolkit/pathHelper'
import { t } from '@renderer/i18n'

/** 最近列表最多展示条数：再多就是一屏之外，滚动反而更难找 */
const RECENT_LIMIT = 8

export default function WorkspacePickScreen() {
  const language = useStore((s) => s.language)
  const [recent, setRecent] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const loadRecent = useCallback(async () => {
    try {
      const list = await api.workspace.getRecent()
      setRecent(list.slice(0, RECENT_LIMIT))
    } catch (e) {
      logger.ui.error('[WorkspacePick] Failed to load recent workspaces:', e)
    }
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  /** 选定后的统一收尾：清掉启动闸门，界面随之退场 */
  const finish = useCallback(() => {
    useStore.getState().setWorkspacePickPending(false)
  }, [])

  const handleOpenFolder = useCallback(async () => {
    setBusy(true)
    try {
      // 选择器同时接受文件夹与 .aweeclaw-workspace 文件（多根）
      const outcome = await workspaceManager.openFolderFromDialog()
      if (outcome.status === 'opened') {
        // 把上一个窗口正在用的场景落到本窗口：不做这一步，选完目录会停在默认工作台
        applyActiveScenarioToWorkspace()
        finish()
      } else if (outcome.status === 'redirected') {
        // 该工作空间已在其他窗口打开：主进程已聚焦那个窗口
        toast.info(t('workspace.alreadyOpenElsewhere', language))
      } else if (outcome.status === 'invalid') {
        toast.error(t('workspace.invalidTarget', language))
      } else if (outcome.status === 'missing') {
        toast.error(t('workspace.folderNotExist', language), getFileName(outcome.path))
      } else if (outcome.status === 'failed') {
        toast.error(t('workspace.openFolderFailed', language))
      }
    } finally {
      setBusy(false)
    }
  }, [finish, language])

  const handleOpenRecent = useCallback(
    async (path: string) => {
      setBusy(true)
      try {
        await workspaceManager.openFolder(path)
        // 与「打开文件夹」一致：把当前场景落到本窗口，否则会停在默认工作台
        applyActiveScenarioToWorkspace()
        finish()
      } catch (e) {
        if (e instanceof WorkspaceOpenError && e.code === 'missing-workspace') {
          // 目录被移走或删除：提示后刷新列表，避免同一失效项反复被点
          toast.error(t('workspace.folderNotExist', language), getFileName(path))
          void loadRecent()
          return
        }
        if (e instanceof WorkspaceOpenError && e.code === 'redirected') {
          // 该工作空间已在另一个窗口打开：主进程已聚焦那个窗口，本窗口保持在选择界面
          toast.info(t('workspace.alreadyOpenElsewhere', language))
          return
        }
        logger.ui.error('[WorkspacePick] Failed to open recent workspace:', e)
        toast.error(t('workspace.openFolderFailed', language), getFileName(path))
      } finally {
        setBusy(false)
      }
    },
    [finish, language, loadRecent],
  )

  const handleSkip = useCallback(() => {
    // 退路：不选目录也要能进主界面，否则新窗口成了死路
    const store = useStore.getState()
    store.setWorkspacePickPending(false)
    store.setShowWelcomePage(true)
  }, [])

  return (
    <div className="flex-1 h-full flex items-center justify-center bg-background relative overflow-hidden">
      {/* 无边框窗口的拖拽区：避开左上角红绿灯，其余顶部区域用于移动窗口 */}
      <div className="drag-region absolute top-0 left-[80px] right-0 h-10" />

      {/* 背景：两团低饱和光斑，避免整屏纯色显得空 */}
      <div className="pointer-events-none absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-accent/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 w-[460px] h-[460px] rounded-full bg-accent/[0.05] blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative w-full max-w-[560px] px-8"
      >
        {/* 标题区 */}
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" strokeWidth={1.8} />
          </div>
          <h1 className="text-[19px] font-semibold text-text-primary tracking-tight">
            {t('workspace.pick.title', language)}
          </h1>
        </div>
        <p className="text-[13px] text-text-muted leading-relaxed mb-7 pl-12">
          {t('workspace.pick.subtitle', language)}
        </p>

        {/* 主操作 */}
        <button
          onClick={handleOpenFolder}
          disabled={busy}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl bg-surface border border-border hover:border-accent/50 hover:bg-surface-hover transition-all group disabled:opacity-60 disabled:cursor-not-allowed text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
            <FolderOpen className="w-4 h-4 text-accent" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-text-primary">
              {t('workspace.pick.openFolder', language)}
            </div>
            <div className="text-[11.5px] text-text-muted truncate">
              {t('workspace.pick.openFolderDesc', language)}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-text-muted/40 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0 ml-auto" />
        </button>

        {/* 最近工作空间 */}
        <div className="mt-7">
          <div className="flex items-center gap-2 px-1 mb-2">
            <Clock3 className="w-3.5 h-3.5 text-text-muted/70" strokeWidth={1.8} />
            <span className="text-[11px] font-medium text-text-muted/80 tracking-wide">
              {t('workspace.pick.recent', language)}
            </span>
          </div>

          {recent.length === 0 ? (
            <div className="px-4 py-6 rounded-xl border border-dashed border-border/60 text-center">
              <p className="text-[12px] text-text-muted/80">
                {t('workspace.pick.emptyRecent', language)}
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[260px] overflow-y-auto custom-scrollbar -mx-1 px-1">
              {recent.map((path) => (
                <button
                  key={path}
                  onClick={() => handleOpenRecent(path)}
                  disabled={busy}
                  title={path}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-surface-hover transition-colors group disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Folder
                    className="w-3.5 h-3.5 text-text-muted shrink-0 group-hover:text-accent transition-colors"
                    strokeWidth={1.8}
                  />
                  <span className="text-[12.5px] text-text-primary truncate shrink-0 max-w-[42%]">
                    {getFileName(path)}
                  </span>
                  <span className="text-[11px] text-text-muted/60 truncate min-w-0">
                    {getDirname(path)}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-text-muted/0 group-hover:text-accent/70 transition-all shrink-0 ml-auto" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 退路 */}
        <div className="mt-8 pt-5 border-t border-border/50 flex justify-center">
          <button
            onClick={handleSkip}
            className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-secondary transition-colors"
          >
            <Compass className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('workspace.pick.skip', language)}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

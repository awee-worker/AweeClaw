/**
 * AppMenuBar — Windows/Linux 顶部自绘菜单栏
 *
 * 背景：主窗口 frame:false，Windows 下原生菜单栏不显示，顶部菜单入口缺失。
 * 本组件在标题栏中绘制与 macOS 原生菜单一致的菜单结构：
 * 文件 / 编辑 / 视图 / 场景 / 会话 / 窗口 / 帮助
 *
 * 命名约定：
 * - 菜单为 Windows 专属，调用方（AppTitleBar）仅在非 macOS 渲染
 * - 菜单数据由 appMenuModel 构建，命令经 menuCommandDispatcher 执行
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight } from 'lucide-react'
import { useStore } from '@store'
import { api } from '../../adapters/electronBridge'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getFileName } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'
import { logger } from '@toolkit/LogEngine'
import { updaterService } from '@renderer/adapters/updateAdapter'
import { emitMenuCommand } from '@hooks/menuCommandDispatcher'
import {
  buildAppMenuModel,
  type AppMenuEntry,
  type AppMenuTopLevel,
  type RecentWorkspaceEntry,
  type ScenarioMenuEntry,
} from './appMenuModel'
import type { Language } from '@renderer/i18n'

export default function AppMenuBar() {
  const language = useStore((s) => s.language) as Language
  const activeScenarioId = useStore((s) => s.activeScenarioId)

  const [openId, setOpenId] = useState<string | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceEntry[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // 场景列表（每次渲染读取，保证场景安装/卸载后菜单即时更新）
  const scenarios: ScenarioMenuEntry[] = scenarioRegistry.getAll().map((s) => ({
    id: s.id,
    name: language === 'zh' ? s.nameZh || s.name : s.name,
    description: language === 'zh' ? s.descriptionZh || s.description : s.description,
    category: s.category,
  }))

  const menus: AppMenuTopLevel[] = buildAppMenuModel({
    lang: language,
    scenarios,
    activeScenarioId,
    recentWorkspaces,
    docsUrl: BRAND.links.docs,
    githubUrl: BRAND.links.github,
  })

  // 打开「文件」菜单时刷新最近工作区
  useEffect(() => {
    if (openId !== 'file') return
    let cancelled = false
    api.workspace
      .getRecent()
      .then((paths) => {
        if (cancelled) return
        setRecentWorkspaces((paths || []).map((path) => ({ path, name: getFileName(path) })))
      })
      .catch((err) => {
        logger.ui.error('[AppMenuBar] Failed to load recent workspaces:', err)
      })
    return () => {
      cancelled = true
    }
  }, [openId])

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!openId) return
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenId(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openId])

  const runEntry = (entry: AppMenuEntry): void => {
    switch (entry.kind) {
      case 'command': {
        if (entry.disabled || !entry.commandId) return
        if (entry.commandId === 'workspace.clearRecent') setRecentWorkspaces([])
        emitMenuCommand(entry.commandId, entry.payload)
        break
      }
      case 'role':
        api.menu.executeRole(entry.role)
        break
      case 'external':
        api.file.openExternalUrl(entry.url)
        break
      case 'action':
        if (entry.action === 'check-for-updates') {
          void updaterService.checkForUpdates().catch(() => {})
        }
        break
      case 'separator':
      case 'submenu':
        break
    }
    setOpenId(null)
  }

  return (
    <div ref={containerRef} className="no-drag flex items-center h-full gap-0.5">
      {menus.map((menu) => (
        <div key={menu.id} className="relative h-full flex items-center">
          <button
            onClick={() => setOpenId(openId === menu.id ? null : menu.id)}
            onMouseEnter={() => {
              if (openId) setOpenId(menu.id)
            }}
            className={`px-2 h-7 rounded-md text-[13px] leading-none transition-colors ${
              openId === menu.id
                ? 'bg-surface-hover text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            {menu.label}
          </button>

          <AnimatePresence>
            {openId === menu.id && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 2, scale: 0.98 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="absolute top-full left-0 mt-1 min-w-[220px] p-1 rounded-lg bg-background/95 backdrop-blur-xl border border-border shadow-2xl shadow-black/40 z-[100]"
              >
                {menu.entries.map((entry, index) => (
                  <MenuEntryRow key={index} entry={entry} onRun={runEntry} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

/** 单个菜单项 */
function MenuEntryRow({ entry, onRun }: { entry: AppMenuEntry; onRun: (entry: AppMenuEntry) => void }) {
  if (entry.kind === 'separator') {
    return <div className="h-px bg-border/60 my-1 mx-1" />
  }

  // 子菜单：hover 时右侧弹出
  if (entry.kind === 'submenu') {
    return (
      <div className="relative group/sub">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-default">
          <span className="flex-1 truncate">{entry.label}</span>
          <ChevronRight className="w-3.5 h-3.5 opacity-60" />
        </div>
        <div className="hidden group-hover/sub:block absolute left-full top-0 pl-1 z-[101]">
          <div className="min-w-[200px] max-h-[340px] overflow-y-auto custom-scrollbar p-1 rounded-lg bg-background/95 backdrop-blur-xl border border-border shadow-2xl shadow-black/40">
            {entry.children.map((child, index) => (
              <MenuEntryRow key={index} entry={child} onRun={onRun} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const disabled = entry.kind === 'command' && !!entry.disabled
  const checked = entry.kind === 'command' && !!entry.checked
  const accelerator = entry.kind === 'command' || entry.kind === 'role' ? entry.accelerator : undefined

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onRun(entry)}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[13px] transition-colors ${
        disabled
          ? 'text-text-muted/50 cursor-default'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      {/* 勾选指示（场景切换） */}
      <span className="w-3.5 shrink-0 flex items-center justify-center">
        {checked && <Check className="w-3.5 h-3.5 text-accent" />}
      </span>
      <span className="flex-1 truncate">{entry.label}</span>
      {accelerator && (
        <span className="ml-4 shrink-0 text-[11px] text-text-muted/70 font-mono">{accelerator}</span>
      )}
    </button>
  )
}

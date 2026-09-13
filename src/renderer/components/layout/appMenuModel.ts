/**
 * Windows/Linux 顶部自绘菜单模型
 *
 * 主窗口 frame:false，Windows 下原生菜单栏不显示；此模型把主进程菜单
 * （src/main/menu/menuItems/*）映射为渲染进程可绘制的数据结构，
 * 由 AppMenuBar 渲染，点击后：
 * - kind='command'  → emitMenuCommand 派发到 menuCommandDispatcher
 * - kind='role'     → api.menu.executeRole 请求主进程执行原生角色
 * - kind='external' → 系统浏览器打开链接
 * - kind='action'   → 本地动作（如检查更新）
 *
 * 与原生菜单保持一致：文件 / 编辑 / 视图 / 场景 / 会话 / 窗口 / 帮助
 */

import { t, type Language } from '@renderer/i18n'
import type { ScenarioCategory } from '@shared/protocols/scenario'

/** 可执行的原生角色（与主进程 windowLifecycle.ts 的 MenuRole 对齐） */
export type AppMenuRole =
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'toggleFullScreen' | 'reload' | 'toggleDevTools'
  | 'minimize' | 'maximize' | 'close' | 'quit'

/** 本地动作 */
export type AppMenuAction = 'check-for-updates' | 'open-docs' | 'open-github'

/** 菜单项 */
export type AppMenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'command'
      label: string
      accelerator?: string
      commandId: string
      payload?: unknown
      /** 勾选态（场景切换） */
      checked?: boolean
      /** 场景类条目显示为单选样式 */
      radio?: boolean
      disabled?: boolean
    }
  | { kind: 'role'; label: string; accelerator?: string; role: AppMenuRole }
  | { kind: 'external'; label: string; url: string }
  | { kind: 'action'; label: string; action: AppMenuAction }
  | { kind: 'submenu'; label: string; children: AppMenuEntry[]; disabled?: boolean }

/** 顶级菜单 */
export interface AppMenuTopLevel {
  id: string
  label: string
  entries: AppMenuEntry[]
}

/** 场景条目 */
export interface ScenarioMenuEntry {
  id: string
  name: string
  description?: string
  category?: ScenarioCategory
}

/** 最近工作区条目 */
export interface RecentWorkspaceEntry {
  path: string
  name: string
}

export interface BuildAppMenuOptions {
  lang: Language
  scenarios: ScenarioMenuEntry[]
  activeScenarioId: string | null
  recentWorkspaces: RecentWorkspaceEntry[]
  docsUrl: string
  githubUrl: string
}

/** 场景分组阈值：超过此值按 category 分组（与主进程一致） */
const SCENARIO_GROUP_THRESHOLD = 12

/** 场景分类 → i18n key */
const CATEGORY_KEY_MAP: Record<string, string> = {
  development: 'menu.catDevelopment',
  data: 'menu.catData',
  creative: 'menu.catCreative',
  productivity: 'menu.catProductivity',
  education: 'menu.catEducation',
  automation: 'menu.catAutomation',
  research: 'menu.catResearch',
  communication: 'menu.catCommunication',
  entertainment: 'menu.catEntertainment',
  business: 'menu.catBusiness',
  health: 'menu.catHealth',
  finance: 'menu.catFinance',
  legal: 'menu.catLegal',
  marketing: 'menu.catMarketing',
  energy: 'menu.catEnergy',
}

/**
 * 构建自绘菜单模型
 */
export function buildAppMenuModel(opts: BuildAppMenuOptions): AppMenuTopLevel[] {
  const tr: Tr = (key) => t(key, opts.lang)

  return [
    { id: 'file', label: tr('menu.file'), entries: buildFileMenu(tr, opts.recentWorkspaces) },
    { id: 'edit', label: tr('menu.edit'), entries: buildEditMenu(tr) },
    { id: 'view', label: tr('menu.view'), entries: buildViewMenu(tr) },
    { id: 'scenario', label: tr('menu.scenario'), entries: buildScenarioMenu(tr, opts.scenarios, opts.activeScenarioId) },
    { id: 'ai', label: tr('menu.ai'), entries: buildAiMenu(tr) },
    { id: 'window', label: tr('menu.window'), entries: buildWindowMenu(tr) },
    { id: 'help', label: tr('menu.help'), entries: buildHelpMenu(tr, opts.docsUrl, opts.githubUrl) },
  ]
}

type Tr = (key: string) => string

function buildFileMenu(tr: Tr, recentWorkspaces: RecentWorkspaceEntry[]): AppMenuEntry[] {
  const recentChildren: AppMenuEntry[] =
    recentWorkspaces.length > 0
      ? [
          ...recentWorkspaces.map<AppMenuEntry>((ws) => ({
            kind: 'command',
            label: ws.name,
            commandId: 'workspace.openRecent',
            payload: { path: ws.path },
          })),
          { kind: 'separator' },
          { kind: 'command', label: tr('menu.clearRecentWorkspaces'), commandId: 'workspace.clearRecent' },
        ]
      : [{ kind: 'command', label: tr('menu.noRecentWorkspaces'), commandId: '', disabled: true }]

  return [
    { kind: 'command', label: tr('menu.newWindow'), accelerator: 'Ctrl+Shift+N', commandId: 'new-window' },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.openFolder'), accelerator: 'Ctrl+O', commandId: 'open-folder' },
    { kind: 'command', label: tr('menu.addFolderToWorkspace'), accelerator: 'Ctrl+Shift+O', commandId: 'add-folder' },
    { kind: 'command', label: tr('menu.saveWorkspaceAs'), commandId: 'save-workspace' },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.saveFile'), accelerator: 'Ctrl+S', commandId: 'save-file' },
    { kind: 'command', label: tr('menu.refreshFiles'), accelerator: 'Ctrl+R', commandId: 'refresh-files' },
    { kind: 'separator' },
    { kind: 'submenu', label: tr('menu.recentWorkspaces'), children: recentChildren },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.settings'), accelerator: 'Ctrl+,', commandId: 'settings' },
    { kind: 'separator' },
    { kind: 'role', label: tr('menu.quit'), accelerator: 'Ctrl+Q', role: 'quit' },
  ]
}

function buildEditMenu(tr: Tr): AppMenuEntry[] {
  return [
    { kind: 'role', label: tr('menu.undo'), accelerator: 'Ctrl+Z', role: 'undo' },
    { kind: 'role', label: tr('menu.redo'), accelerator: 'Ctrl+Y', role: 'redo' },
    { kind: 'separator' },
    { kind: 'role', label: tr('menu.cut'), accelerator: 'Ctrl+X', role: 'cut' },
    { kind: 'role', label: tr('menu.copy'), accelerator: 'Ctrl+C', role: 'copy' },
    { kind: 'role', label: tr('menu.paste'), accelerator: 'Ctrl+V', role: 'paste' },
    { kind: 'separator' },
    { kind: 'role', label: tr('menu.selectAll'), accelerator: 'Ctrl+A', role: 'selectAll' },
  ]
}

function buildViewMenu(tr: Tr): AppMenuEntry[] {
  return [
    { kind: 'command', label: tr('menu.commandPalette'), accelerator: 'Ctrl+Shift+P', commandId: 'workbench.action.showCommands' },
    { kind: 'command', label: tr('menu.gotoFile'), accelerator: 'Ctrl+P', commandId: 'workbench.action.quickOpen' },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.toggleTerminal'), accelerator: 'Ctrl+`', commandId: 'toggle-terminal' },
    { kind: 'command', label: tr('menu.toggleAiPanel'), accelerator: 'Ctrl+Shift+I', commandId: 'toggle-ai-panel' },
    { kind: 'command', label: tr('menu.toggleSidebar'), accelerator: 'Ctrl+B', commandId: 'workbench.action.toggleSidebar' },
    { kind: 'separator' },
    { kind: 'role', label: tr('menu.zoomIn'), accelerator: 'Ctrl+=', role: 'zoomIn' },
    { kind: 'role', label: tr('menu.zoomOut'), accelerator: 'Ctrl+-', role: 'zoomOut' },
    { kind: 'role', label: tr('menu.resetZoom'), accelerator: 'Ctrl+0', role: 'resetZoom' },
    { kind: 'separator' },
    { kind: 'role', label: tr('menu.enterFullscreen'), accelerator: 'F11', role: 'toggleFullScreen' },
    { kind: 'role', label: tr('menu.reloadWindow'), role: 'reload' },
    { kind: 'role', label: tr('menu.devTools'), accelerator: 'Ctrl+Alt+I', role: 'toggleDevTools' },
  ]
}

function buildScenarioMenu(tr: Tr, scenarios: ScenarioMenuEntry[], activeScenarioId: string | null): AppMenuEntry[] {
  const items = buildScenarioItems(tr, scenarios, activeScenarioId)
  return [
    ...items,
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.scenarioManage'), commandId: 'scenario.openManager' },
  ]
}

function buildScenarioItems(tr: Tr, scenarios: ScenarioMenuEntry[], activeScenarioId: string | null): AppMenuEntry[] {
  if (scenarios.length === 0) {
    return [{ kind: 'command', label: tr('menu.noScenarios'), commandId: '', disabled: true }]
  }

  if (scenarios.length <= SCENARIO_GROUP_THRESHOLD) {
    return scenarios.map<AppMenuEntry>((s) => ({
      kind: 'command',
      label: s.name,
      commandId: 'scenario.switch',
      payload: { scenarioId: s.id },
      checked: s.id === activeScenarioId,
      radio: true,
    }))
  }

  // 场景较多：按 category 分组
  const grouped = new Map<string, ScenarioMenuEntry[]>()
  for (const s of scenarios) {
    const cat = s.category ?? 'custom'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(s)
  }

  return Array.from(grouped.entries()).map<AppMenuEntry>(([category, group]) => ({
    kind: 'submenu',
    label: tr(CATEGORY_KEY_MAP[category] ?? 'menu.catOther'),
    children: group.map<AppMenuEntry>((s) => ({
      kind: 'command',
      label: s.name,
      commandId: 'scenario.switch',
      payload: { scenarioId: s.id },
      checked: s.id === activeScenarioId,
      radio: true,
    })),
  }))
}

function buildAiMenu(tr: Tr): AppMenuEntry[] {
  return [
    { kind: 'command', label: tr('menu.newChat'), accelerator: 'Ctrl+Shift+L', commandId: 'ai-chat' },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.explainCurrentFile'), accelerator: 'Ctrl+Shift+E', commandId: 'ai-explain' },
    { kind: 'command', label: tr('menu.refactorFile'), accelerator: 'Ctrl+Shift+R', commandId: 'ai-refactor' },
    { kind: 'command', label: tr('menu.fixBugs'), accelerator: 'Ctrl+Shift+F', commandId: 'ai-fix' },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.clearChatHistory'), commandId: 'ai-clear-history' },
    { kind: 'command', label: tr('menu.clearCheckpoints'), commandId: 'ai-clear-checkpoints' },
  ]
}

function buildWindowMenu(tr: Tr): AppMenuEntry[] {
  return [
    { kind: 'role', label: tr('menu.minimize'), role: 'minimize' },
    { kind: 'role', label: tr('menu.maximize'), role: 'maximize' },
    { kind: 'separator' },
    { kind: 'role', label: tr('menu.closeWindow'), accelerator: 'Ctrl+W', role: 'close' },
  ]
}

function buildHelpMenu(tr: Tr, docsUrl: string, githubUrl: string): AppMenuEntry[] {
  return [
    { kind: 'command', label: tr('menu.keyboardShortcuts'), accelerator: 'Ctrl+/', commandId: 'keyboard-shortcuts' },
    { kind: 'external', label: tr('menu.documentation'), url: docsUrl },
    { kind: 'external', label: tr('menu.reportIssue'), url: githubUrl },
    { kind: 'separator' },
    { kind: 'action', label: tr('menu.checkForUpdates'), action: 'check-for-updates' },
    { kind: 'separator' },
    { kind: 'command', label: tr('menu.about'), commandId: 'about' },
  ]
}

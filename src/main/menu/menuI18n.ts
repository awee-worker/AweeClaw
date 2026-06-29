/**
 * 菜单 i18n 字典
 *
 * 设计说明：
 * - Main 进程独立 i18n，不依赖 renderer 的 i18n 体系
 * - 仅包含菜单所需文案，保持轻量
 * - 语言切换时由 menuBuilder.rebuild(lang) 重建菜单
 */

import type { Language } from '../appBootstrap'

/** 菜单文案 key */
export type MenuKey =
  // 顶级菜单
  | 'app'
  | 'file'
  | 'edit'
  | 'view'
  | 'scenario'
  | 'ai'
  | 'window'
  | 'help'
  // 应用菜单
  | 'about'
  | 'services'
  | 'hideApp'
  | 'hideOthers'
  | 'quit'
  | 'settings'
  // 文件菜单
  | 'newWindow'
  | 'openFolder'
  | 'addFolderToWorkspace'
  | 'saveWorkspaceAs'
  | 'saveFile'
  | 'refreshFiles'
  | 'recentWorkspaces'
  | 'noRecentWorkspaces'
  | 'clearRecentWorkspaces'
  // 编辑菜单
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'delete'
  // 视图菜单
  | 'commandPalette'
  | 'gotoFile'
  | 'toggleTerminal'
  | 'toggleAiPanel'
  | 'toggleSidebar'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'enterFullscreen'
  | 'reloadWindow'
  | 'devTools'
  // 场景菜单
  | 'scenarioManage'
  | 'noScenarios'
  | 'moreScenarios'
  // 场景分类
  | 'catDevelopment'
  | 'catData'
  | 'catCreative'
  | 'catProductivity'
  | 'catEducation'
  | 'catAutomation'
  | 'catResearch'
  | 'catCommunication'
  | 'catEntertainment'
  | 'catBusiness'
  | 'catHealth'
  | 'catOther'
  // AI 菜单
  | 'newChat'
  | 'explainCurrentFile'
  | 'refactorFile'
  | 'fixBugs'
  | 'clearChatHistory'
  | 'clearCheckpoints'
  // 窗口菜单
  | 'minimize'
  | 'zoom'
  | 'bringAllToFront'
  // 帮助菜单
  | 'keyboardShortcuts'
  | 'documentation'
  | 'reportIssue'
  | 'checkForUpdates'

/** 中文字典 */
const zh: Record<MenuKey, string> = {
  app: 'AweeClaw',
  file: '文件',
  edit: '编辑',
  view: '视图',
  scenario: '场景',
  ai: '会话',
  window: '窗口',
  help: '帮助',

  about: '关于 AweeClaw',
  services: '服务',
  hideApp: '隐藏 AweeClaw',
  hideOthers: '隐藏其他',
  quit: '退出 AweeClaw',
  settings: '设置...',

  newWindow: '新建窗口',
  openFolder: '打开文件夹...',
  addFolderToWorkspace: '添加文件夹到工作区...',
  saveWorkspaceAs: '保存工作区为...',
  saveFile: '保存文件',
  refreshFiles: '刷新文件资源管理器',
  recentWorkspaces: '最近打开的工作区',
  noRecentWorkspaces: '无最近的工作区',
  clearRecentWorkspaces: '清除最近的工作区',

  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
  delete: '删除',

  commandPalette: '命令面板...',
  gotoFile: '转到文件...',
  toggleTerminal: '切换终端',
  toggleAiPanel: '切换 AI 面板',
  toggleSidebar: '切换侧边栏',
  zoomIn: '放大',
  zoomOut: '缩小',
  resetZoom: '重置缩放',
  enterFullscreen: '进入全屏',
  reloadWindow: '重新加载窗口',
  devTools: '开发者工具',

  scenarioManage: '场景管理...',
  noScenarios: '暂无已安装场景',
  moreScenarios: '更多场景',
  catDevelopment: '开发',
  catData: '数据',
  catCreative: '创意',
  catProductivity: '效率',
  catEducation: '教育',
  catAutomation: '自动化',
  catResearch: '研究',
  catCommunication: '沟通',
  catEntertainment: '娱乐',
  catBusiness: '商业',
  catHealth: '健康',
  catOther: '其他',

  newChat: '新对话...',
  explainCurrentFile: '解释当前文件',
  refactorFile: '重构当前文件',
  fixBugs: '修复 Bug',
  clearChatHistory: '清除对话历史',
  clearCheckpoints: '清除所有检查点',

  minimize: '最小化',
  zoom: '缩放',
  bringAllToFront: '全部置于顶层',

  keyboardShortcuts: '键盘快捷键速查',
  documentation: '官方文档',
  reportIssue: '报告问题',
  checkForUpdates: '检查更新',
}

/** 英文字典 */
const en: Record<MenuKey, string> = {
  app: 'AweeClaw',
  file: 'File',
  edit: 'Edit',
  view: 'View',
  scenario: 'Scenario',
  ai: 'Conversation',
  window: 'Window',
  help: 'Help',

  about: 'About AweeClaw',
  services: 'Services',
  hideApp: 'Hide AweeClaw',
  hideOthers: 'Hide Others',
  quit: 'Quit AweeClaw',
  settings: 'Settings...',

  newWindow: 'New Window',
  openFolder: 'Open Folder...',
  addFolderToWorkspace: 'Add Folder to Workspace...',
  saveWorkspaceAs: 'Save Workspace As...',
  saveFile: 'Save File',
  refreshFiles: 'Refresh File Explorer',
  recentWorkspaces: 'Recent Workspaces',
  noRecentWorkspaces: 'No Recent Workspaces',
  clearRecentWorkspaces: 'Clear Recent Workspaces',

  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  delete: 'Delete',

  commandPalette: 'Command Palette...',
  gotoFile: 'Go to File...',
  toggleTerminal: 'Toggle Terminal',
  toggleAiPanel: 'Toggle AI Panel',
  toggleSidebar: 'Toggle Sidebar',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  resetZoom: 'Reset Zoom',
  enterFullscreen: 'Enter Full Screen',
  reloadWindow: 'Reload Window',
  devTools: 'Developer Tools',

  scenarioManage: 'Scenario Manager...',
  noScenarios: 'No Installed Scenarios',
  moreScenarios: 'More Scenarios',
  catDevelopment: 'Development',
  catData: 'Data',
  catCreative: 'Creative',
  catProductivity: 'Productivity',
  catEducation: 'Education',
  catAutomation: 'Automation',
  catResearch: 'Research',
  catCommunication: 'Communication',
  catEntertainment: 'Entertainment',
  catBusiness: 'Business',
  catHealth: 'Health',
  catOther: 'Other',

  newChat: 'New Chat...',
  explainCurrentFile: 'Explain Current File',
  refactorFile: 'Refactor File',
  fixBugs: 'Fix Bugs',
  clearChatHistory: 'Clear Chat History',
  clearCheckpoints: 'Clear All Checkpoints',

  minimize: 'Minimize',
  zoom: 'Zoom',
  bringAllToFront: 'Bring All to Front',

  keyboardShortcuts: 'Keyboard Shortcuts',
  documentation: 'Documentation',
  reportIssue: 'Report Issue',
  checkForUpdates: 'Check for Updates',
}

/** 字典映射 */
const dictionaries: Record<Language, Record<MenuKey, string>> = { zh, en }

/**
 * 翻译函数
 *
 * @param lang 当前语言
 * @param key 文案 key
 * @returns 翻译后的字符串
 */
export function t(lang: Language, key: MenuKey): string {
  return dictionaries[lang]?.[key] ?? dictionaries.zh[key] ?? key
}

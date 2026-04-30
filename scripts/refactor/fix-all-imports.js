/**
 * 修复所有组件导入路径
 */

const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '../../src')

// 路径替换映射
const REPLACEMENTS = [
  // @components/ 别名路径
  ["@components/ToastProvider", "@components/common/ToastProvider"],
  ["@components/ConfirmDialog", "@components/common/ConfirmDialog"],
  ["@components/ErrorBoundary", "@components/common/ErrorBoundary"],
  ["@components/Logo", "@components/common/Logo"],
  ["@components/TitleBar", "@components/layout/TitleBar"],
  ["@components/StatusBar", "@components/layout/StatusBar"],
  ["@components/ActivityBar", "@components/layout/ActivityBar"],
  ["@components/WorkspaceDropdown", "@components/layout/WorkspaceDropdown"],
  ["@components/Editor", "@components/editor/Editor"],
  ["@components/EditorContextMenu", "@components/editor/EditorContextMenu"],
  ["@components/DiffViewer", "@components/editor/DiffViewer"],
  ["@components/InlineEdit", "@components/editor/InlineEdit"],
  ["@components/GhostTextWidget", "@components/editor/GhostTextWidget"],
  ["@components/FilePreview", "@components/editor/FilePreview"],
  ["@components/ThemeManager", "@components/editor/ThemeManager"],
  ["@components/TerminalPanel", "@components/panels/TerminalPanel"],
  ["@components/CheckpointPanel", "@components/panels/CheckpointPanel"],
  ["@components/ComposerPanel", "@components/panels/ComposerPanel"],
  ["@components/KeybindingPanel", "@components/panels/KeybindingPanel"],
  ["@components/SessionList", "@components/panels/SessionList"],
  ["@components/PlanListContent", "@components/panels/PlanListContent"],
  ["@components/ToolCallLogContent", "@components/panels/ToolCallLogContent"],
  ["@components/AboutDialog", "@components/dialogs/AboutDialog"],
  ["@components/CommandPalette", "@components/dialogs/CommandPalette"],
  ["@components/QuickOpen", "@components/dialogs/QuickOpen"],
  ["@components/OnboardingWizard", "@components/dialogs/OnboardingWizard"],
  ["@components/KeyboardShortcuts", "@components/dialogs/KeyboardShortcuts"],
  ["@components/LLMAdapterConfigEditor", "@components/dialogs/LLMAdapterConfigEditor"],
  ["@components/RequestBodyEditor", "@components/dialogs/RequestBodyEditor"],
  ["@components/VirtualFileTree", "@components/tree/VirtualFileTree"],
]

// 递归获取所有 .ts/.tsx 文件
function getAllFiles(dir, files = []) {
  const items = fs.readdirSync(dir)
  for (const item of items) {
    const fullPath = path.join(dir, item)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      if (!item.includes('node_modules') && !item.startsWith('.')) {
        getAllFiles(fullPath, files)
      }
    } else if (/\.(ts|tsx)$/.test(item)) {
      files.push(fullPath)
    }
  }
  return files
}

// 更新文件中的导入
function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  
  for (const [oldPath, newPath] of REPLACEMENTS) {
    // 匹配 from 'xxx' 或 from "xxx"
    const regex = new RegExp(
      `(from\\s+['"])${oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"])`,
      'g'
    )
    if (regex.test(content)) {
      content = content.replace(regex, `$1${newPath}$2`)
      modified = true
    }
    
    // 匹配 import('xxx')
    const dynamicRegex = new RegExp(
      `(import\\(['"])${oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"]\\))`,
      'g'
    )
    if (dynamicRegex.test(content)) {
      content = content.replace(dynamicRegex, `$1${newPath}$2`)
      modified = true
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  }
  return false
}

function main() {
  console.log('Fixing all component imports...\n')
  
  const files = getAllFiles(SRC_DIR)
  let updatedCount = 0
  
  for (const file of files) {
    if (updateFile(file)) {
      console.log(`Updated: ${path.relative(SRC_DIR, file)}`)
      updatedCount++
    }
  }
  
  console.log(`\nUpdated ${updatedCount} files.`)
}

main()

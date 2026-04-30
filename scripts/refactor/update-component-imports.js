/**
 * 更新组件导入路径脚本
 * 修复移动文件后的导入路径
 */

const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '../../src')

// 导入路径映射 (旧路径 -> 新路径)
const IMPORT_MAPPINGS = {
  // common/
  '@/renderer/components/ConfirmDialog': '@/renderer/components/common/ConfirmDialog',
  '@/renderer/components/ErrorBoundary': '@/renderer/components/common/ErrorBoundary',
  '@/renderer/components/ToastProvider': '@/renderer/components/common/ToastProvider',
  '@/renderer/components/Logo': '@/renderer/components/common/Logo',
  
  // layout/
  '@/renderer/components/TitleBar': '@/renderer/components/layout/TitleBar',
  '@/renderer/components/StatusBar': '@/renderer/components/layout/StatusBar',
  '@/renderer/components/ActivityBar': '@/renderer/components/layout/ActivityBar',
  '@/renderer/components/WorkspaceDropdown': '@/renderer/components/layout/WorkspaceDropdown',
  
  // editor/
  '@/renderer/components/Editor': '@/renderer/components/editor/Editor',
  '@/renderer/components/EditorContextMenu': '@/renderer/components/editor/EditorContextMenu',
  '@/renderer/components/DiffViewer': '@/renderer/components/editor/DiffViewer',
  '@/renderer/components/InlineEdit': '@/renderer/components/editor/InlineEdit',
  '@/renderer/components/GhostTextWidget': '@/renderer/components/editor/GhostTextWidget',
  '@/renderer/components/FilePreview': '@/renderer/components/editor/FilePreview',
  '@/renderer/components/ThemeManager': '@/renderer/components/editor/ThemeManager',
  
  // panels/
  '@/renderer/components/TerminalPanel': '@/renderer/components/panels/TerminalPanel',
  '@/renderer/components/CheckpointPanel': '@/renderer/components/panels/CheckpointPanel',
  '@/renderer/components/ComposerPanel': '@/renderer/components/panels/ComposerPanel',
  '@/renderer/components/KeybindingPanel': '@/renderer/components/panels/KeybindingPanel',
  '@/renderer/components/SessionList': '@/renderer/components/panels/SessionList',
  '@/renderer/components/PlanListContent': '@/renderer/components/panels/PlanListContent',
  '@/renderer/components/ToolCallLogContent': '@/renderer/components/panels/ToolCallLogContent',
  
  // dialogs/
  '@/renderer/components/AboutDialog': '@/renderer/components/dialogs/AboutDialog',
  '@/renderer/components/CommandPalette': '@/renderer/components/dialogs/CommandPalette',
  '@/renderer/components/QuickOpen': '@/renderer/components/dialogs/QuickOpen',
  '@/renderer/components/OnboardingWizard': '@/renderer/components/dialogs/OnboardingWizard',
  '@/renderer/components/KeyboardShortcuts': '@/renderer/components/dialogs/KeyboardShortcuts',
  '@/renderer/components/LLMAdapterConfigEditor': '@/renderer/components/dialogs/LLMAdapterConfigEditor',
  '@/renderer/components/RequestBodyEditor': '@/renderer/components/dialogs/RequestBodyEditor',
  
  // tree/
  '@/renderer/components/VirtualFileTree': '@/renderer/components/tree/VirtualFileTree',
}

// 相对路径映射 (用于同目录内的相对导入)
const RELATIVE_MAPPINGS = {
  './ConfirmDialog': '../common/ConfirmDialog',
  './ErrorBoundary': '../common/ErrorBoundary',
  './ToastProvider': '../common/ToastProvider',
  './Logo': '../common/Logo',
  './TitleBar': '../layout/TitleBar',
  './StatusBar': '../layout/StatusBar',
  './ActivityBar': '../layout/ActivityBar',
  './WorkspaceDropdown': '../layout/WorkspaceDropdown',
  './Editor': '../editor/Editor',
  './EditorContextMenu': '../editor/EditorContextMenu',
  './DiffViewer': '../editor/DiffViewer',
  './InlineEdit': '../editor/InlineEdit',
  './GhostTextWidget': '../editor/GhostTextWidget',
  './FilePreview': '../editor/FilePreview',
  './ThemeManager': '../editor/ThemeManager',
  './TerminalPanel': '../panels/TerminalPanel',
  './CheckpointPanel': '../panels/CheckpointPanel',
  './ComposerPanel': '../panels/ComposerPanel',
  './KeybindingPanel': '../panels/KeybindingPanel',
  './SessionList': '../panels/SessionList',
  './PlanListContent': '../panels/PlanListContent',
  './ToolCallLogContent': '../panels/ToolCallLogContent',
  './AboutDialog': '../dialogs/AboutDialog',
  './CommandPalette': '../dialogs/CommandPalette',
  './QuickOpen': '../dialogs/QuickOpen',
  './OnboardingWizard': '../dialogs/OnboardingWizard',
  './KeyboardShortcuts': '../dialogs/KeyboardShortcuts',
  './LLMAdapterConfigEditor': '../dialogs/LLMAdapterConfigEditor',
  './RequestBodyEditor': '../dialogs/RequestBodyEditor',
  './VirtualFileTree': '../tree/VirtualFileTree',
  '../ConfirmDialog': '../common/ConfirmDialog',
  '../ErrorBoundary': '../common/ErrorBoundary',
  '../ToastProvider': '../common/ToastProvider',
  '../Logo': '../common/Logo',
  '../TitleBar': '../layout/TitleBar',
  '../StatusBar': '../layout/StatusBar',
  '../ActivityBar': '../layout/ActivityBar',
  '../WorkspaceDropdown': '../layout/WorkspaceDropdown',
  '../Editor': '../editor/Editor',
  '../EditorContextMenu': '../editor/EditorContextMenu',
  '../DiffViewer': '../editor/DiffViewer',
  '../InlineEdit': '../editor/InlineEdit',
  '../GhostTextWidget': '../editor/GhostTextWidget',
  '../FilePreview': '../editor/FilePreview',
  '../ThemeManager': '../editor/ThemeManager',
  '../TerminalPanel': '../panels/TerminalPanel',
  '../CheckpointPanel': '../panels/CheckpointPanel',
  '../ComposerPanel': '../panels/ComposerPanel',
  '../KeybindingPanel': '../panels/KeybindingPanel',
  '../SessionList': '../panels/SessionList',
  '../PlanListContent': '../panels/PlanListContent',
  '../ToolCallLogContent': '../panels/ToolCallLogContent',
  '../AboutDialog': '../dialogs/AboutDialog',
  '../CommandPalette': '../dialogs/CommandPalette',
  '../QuickOpen': '../dialogs/QuickOpen',
  '../OnboardingWizard': '../dialogs/OnboardingWizard',
  '../KeyboardShortcuts': '../dialogs/KeyboardShortcuts',
  '../LLMAdapterConfigEditor': '../dialogs/LLMAdapterConfigEditor',
  '../RequestBodyEditor': '../dialogs/RequestBodyEditor',
  '../VirtualFileTree': '../tree/VirtualFileTree',
}

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
function updateImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  
  // 更新绝对路径导入
  for (const [oldPath, newPath] of Object.entries(IMPORT_MAPPINGS)) {
    const patterns = [
      new RegExp(`from ['"]${oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g'),
      new RegExp(`import\\(['"]${oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\)`, 'g'),
    ]
    
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        content = content.replace(pattern, (match) => {
          return match.replace(oldPath, newPath)
        })
        modified = true
      }
    }
  }
  
  // 更新相对路径导入 (仅在 components 目录内的文件)
  if (filePath.includes('components')) {
    for (const [oldPath, newPath] of Object.entries(RELATIVE_MAPPINGS)) {
      const escapedOld = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const patterns = [
        new RegExp(`from ['"]${escapedOld}['"]`, 'g'),
        new RegExp(`import\\(['"]${escapedOld}['"]\\)`, 'g'),
      ]
      
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          content = content.replace(pattern, (match) => {
            return match.replace(oldPath, newPath)
          })
          modified = true
        }
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  }
  return false
}

// 主函数
function main() {
  console.log('Updating component imports...\n')
  
  const files = getAllFiles(SRC_DIR)
  let updatedCount = 0
  
  for (const file of files) {
    if (updateImports(file)) {
      console.log(`Updated: ${path.relative(SRC_DIR, file)}`)
      updatedCount++
    }
  }
  
  console.log(`\nUpdated ${updatedCount} files.`)
}

main()

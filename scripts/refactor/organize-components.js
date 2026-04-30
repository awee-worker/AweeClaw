/**
 * 组件目录整理脚本
 * 将 components/ 根目录的文件分类到子目录
 */

const fs = require('fs')
const path = require('path')

const COMPONENTS_DIR = path.join(__dirname, '../../src/renderer/components')

// 文件分类映射
const FILE_CATEGORIES = {
  // common/ - 通用组件
  'common': [
    'ConfirmDialog.tsx',
    'ErrorBoundary.tsx',
    'ToastProvider.tsx',
    'Logo.tsx',
  ],
  
  // layout/ - 布局组件
  'layout': [
    'TitleBar.tsx',
    'StatusBar.tsx',
    'ActivityBar.tsx',
    'WorkspaceDropdown.tsx',
  ],
  
  // editor/ - 编辑器相关
  'editor': [
    'Editor.tsx',
    'EditorContextMenu.tsx',
    'DiffViewer.tsx',
    'InlineEdit.tsx',
    'GhostTextWidget.ts',
    'FilePreview.tsx',
    'ThemeManager.tsx',
  ],
  
  // panels/ - 面板组件
  'panels': [
    'TerminalPanel.tsx',
    'CheckpointPanel.tsx',
    'ComposerPanel.tsx',
    'KeybindingPanel.tsx',
    'SessionList.tsx',
    'PlanListContent.tsx',
    'ToolCallLogContent.tsx',
  ],
  
  // dialogs/ - 对话框组件
  'dialogs': [
    'AboutDialog.tsx',
    'CommandPalette.tsx',
    'QuickOpen.tsx',
    'OnboardingWizard.tsx',
    'KeyboardShortcuts.tsx',
    'LLMAdapterConfigEditor.tsx',
    'RequestBodyEditor.tsx',
  ],
  
  // tree/ - 树形组件
  'tree': [
    'VirtualFileTree.tsx',
  ],
}

// 创建目录
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`Created directory: ${dir}`)
  }
}

// 移动文件
function moveFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest)
    console.log(`Moved: ${path.basename(src)} -> ${path.relative(COMPONENTS_DIR, dest)}`)
    return true
  }
  return false
}

// 主函数
function main() {
  console.log('Organizing components directory...\n')
  
  let movedCount = 0
  
  for (const [category, files] of Object.entries(FILE_CATEGORIES)) {
    const categoryDir = path.join(COMPONENTS_DIR, category)
    ensureDir(categoryDir)
    
    for (const file of files) {
      const src = path.join(COMPONENTS_DIR, file)
      const dest = path.join(categoryDir, file)
      
      if (moveFile(src, dest)) {
        movedCount++
      }
    }
  }
  
  console.log(`\nMoved ${movedCount} files.`)
  console.log('\nNext step: Run update-imports.js to fix import paths.')
}

main()

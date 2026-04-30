/**
 * 修复移动后组件的相对导入路径
 */

const fs = require('fs')
const path = require('path')

const COMPONENTS_DIR = path.join(__dirname, '../../src/renderer/components')

// 需要修复的文件和替换规则
const FIXES = [
  // common/
  {
    file: 'common/ToastProvider.tsx',
    replacements: [
      ["from './ui/Toast'", "from '../ui/Toast'"],
    ]
  },
  {
    file: 'common/ConfirmDialog.tsx',
    replacements: [
      ["from './ui/Modal'", "from '../ui/Modal'"],
      ["from './ui/Button'", "from '../ui/Button'"],
    ]
  },
  
  // editor/
  {
    file: 'editor/FilePreview.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  
  // panels/
  {
    file: 'panels/TerminalPanel.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  {
    file: 'panels/KeybindingPanel.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  {
    file: 'panels/ToolCallLogContent.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  {
    file: 'panels/PlanListContent.tsx',
    replacements: [
      ["from './ui/BottomBarPopover'", "from '../ui/BottomBarPopover'"],
    ]
  },
  
  // dialogs/
  {
    file: 'dialogs/AboutDialog.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  {
    file: 'dialogs/QuickOpen.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  {
    file: 'dialogs/OnboardingWizard.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  {
    file: 'dialogs/LLMAdapterConfigEditor.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
  
  // tree/
  {
    file: 'tree/VirtualFileTree.tsx',
    replacements: [
      ["from './ui'", "from '../ui'"],
    ]
  },
]

function fixFile(fix) {
  const filePath = path.join(COMPONENTS_DIR, fix.file)
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skip (not found): ${fix.file}`)
    return false
  }
  
  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  
  for (const [oldStr, newStr] of fix.replacements) {
    if (content.includes(oldStr)) {
      content = content.replace(oldStr, newStr)
      modified = true
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`Fixed: ${fix.file}`)
    return true
  }
  
  return false
}

function main() {
  console.log('Fixing relative imports in moved components...\n')
  
  let fixedCount = 0
  for (const fix of FIXES) {
    if (fixFile(fix)) {
      fixedCount++
    }
  }
  
  console.log(`\nFixed ${fixedCount} files.`)
}

main()

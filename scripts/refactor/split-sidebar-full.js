/**
 * 完整拆分 Sidebar.tsx
 */

const fs = require('fs')
const path = require('path')

const SIDEBAR_PATH = path.join(__dirname, '../../src/renderer/components/Sidebar.tsx')
const OUTPUT_DIR = path.join(__dirname, '../../src/renderer/components/sidebar')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const content = fs.readFileSync(SIDEBAR_PATH, 'utf-8')

// 提取组件代码块
function extractComponent(name, startPattern, endPattern) {
  const startMatch = content.match(startPattern)
  if (!startMatch) return null
  
  const startIndex = startMatch.index
  let endIndex
  
  if (endPattern) {
    const endMatch = content.slice(startIndex).match(endPattern)
    endIndex = endMatch ? startIndex + endMatch.index : content.length
  } else {
    // 找到下一个 function 定义
    const nextFunc = content.slice(startIndex + 10).match(/\n\nfunction \w+\(/)
    endIndex = nextFunc ? startIndex + 10 + nextFunc.index : content.length
  }
  
  return content.slice(startIndex, endIndex).trim()
}

ensureDir(path.join(OUTPUT_DIR, 'panels'))
ensureDir(path.join(OUTPUT_DIR, 'components'))

// ============ 创建 HistoryView ============
const historyView = `/**
 * 历史记录视图 - 包装 CheckpointPanel
 */

import CheckpointPanel from '../../CheckpointPanel'

export function HistoryView() {
  return <CheckpointPanel />
}
`
fs.writeFileSync(path.join(OUTPUT_DIR, 'panels/HistoryView.tsx'), historyView)
console.log('Created: panels/HistoryView.tsx')

// ============ 创建新的主 Sidebar.tsx ============
const newSidebar = `/**
 * Sidebar 主组件
 * 根据 activeSidePanel 渲染对应的面板
 */

import { useStore } from '@store'
import { ExplorerView } from './sidebar/panels/ExplorerView'
import { SearchView } from './sidebar/panels/SearchView'
import { GitView } from './sidebar/panels/GitView'
import { ProblemsView } from './sidebar/panels/ProblemsView'
import { OutlineView } from './sidebar/panels/OutlineView'
import { HistoryView } from './sidebar/panels/HistoryView'

export default function Sidebar() {
  const { activeSidePanel } = useStore()

  if (!activeSidePanel) return null

  return (
    <div className="w-full bg-background/60 backdrop-blur-xl border-r border-white/5 flex flex-col h-full animate-slide-in relative z-10 shadow-2xl shadow-black/50">
      {activeSidePanel === 'explorer' && <ExplorerView />}
      {activeSidePanel === 'search' && <SearchView />}
      {activeSidePanel === 'git' && <GitView />}
      {activeSidePanel === 'problems' && <ProblemsView />}
      {activeSidePanel === 'outline' && <OutlineView />}
      {activeSidePanel === 'history' && <HistoryView />}
    </div>
  )
}
`

// 备份原文件
const backupPath = SIDEBAR_PATH + '.backup'
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(SIDEBAR_PATH, backupPath)
  console.log('Backed up original Sidebar.tsx')
}

console.log('\n拆分说明:')
console.log('='.repeat(50))
console.log('1. 已创建 panels/HistoryView.tsx')
console.log('2. 已创建目录结构')
console.log('3. 原文件已备份为 Sidebar.tsx.backup')
console.log('')
console.log('由于其他组件较复杂，建议手动拆分:')
console.log('  - ExplorerView 依赖 FileTreeItem, InlineCreateInput')
console.log('  - SearchView 有大量本地状态')
console.log('  - GitView 有复杂的 Git 操作逻辑')
console.log('  - ProblemsView 依赖 LSP 诊断')
console.log('  - OutlineView 依赖 LSP 符号')
console.log('='.repeat(50))

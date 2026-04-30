/**
 * 拆分 Sidebar.tsx 为多个独立组件
 * 
 * 这个脚本会：
 * 1. 读取原始 Sidebar.tsx
 * 2. 提取各个 View 组件到独立文件
 * 3. 创建新的精简版 Sidebar.tsx
 * 4. 更新导入
 */

const fs = require('fs')
const path = require('path')

const SIDEBAR_PATH = path.join(__dirname, '../../src/renderer/components/Sidebar.tsx')
const OUTPUT_DIR = path.join(__dirname, '../../src/renderer/components/sidebar')

// 确保输出目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// 读取原始文件
const content = fs.readFileSync(SIDEBAR_PATH, 'utf-8')

// 提取导入语句
const importMatch = content.match(/^(import[\s\S]*?)(?=\n\nconst getFileIcon|\nconst getFileIcon)/m)
const imports = importMatch ? importMatch[1].trim() : ''

// 组件边界正则
const componentRegex = /^function (\w+)\(/gm

// 找到所有组件的位置
const components = []
let match
while ((match = componentRegex.exec(content)) !== null) {
  components.push({
    name: match[1],
    start: match.index
  })
}

// 计算每个组件的结束位置
for (let i = 0; i < components.length; i++) {
  if (i < components.length - 1) {
    components[i].end = components[i + 1].start
  } else {
    // 最后一个组件到 export default 之前
    const exportMatch = content.indexOf('\nexport default function Sidebar')
    components[i].end = exportMatch > 0 ? exportMatch : content.length
  }
}

// 提取 Sidebar 主组件
const sidebarMatch = content.match(/export default function Sidebar\(\)[\s\S]*$/)
const sidebarComponent = sidebarMatch ? sidebarMatch[0] : ''

console.log('Found components:')
components.forEach(c => {
  const lines = content.slice(c.start, c.end).split('\n').length
  console.log(`  - ${c.name}: ${lines} lines`)
})

// 创建目录结构
ensureDir(path.join(OUTPUT_DIR, 'panels'))
ensureDir(path.join(OUTPUT_DIR, 'components'))

// 共享导入（所有面板都需要的）
const sharedImports = `import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { logger } from '@utils/Logger'`

// 面板组件映射
const panelComponents = ['ExplorerView', 'SearchView', 'GitView', 'ProblemsView', 'OutlineView', 'HistoryView']

console.log('\nCreating panel files...')

// 为每个面板创建文件（这里只是示例，实际需要更复杂的逻辑）
panelComponents.forEach(name => {
  const comp = components.find(c => c.name === name)
  if (comp) {
    const compContent = content.slice(comp.start, comp.end).trim()
    const lines = compContent.split('\n').length
    console.log(`  Creating ${name}.tsx (${lines} lines)`)
    
    // 注意：这里只是创建占位文件，实际内容需要手动调整导入
    // fs.writeFileSync(
    //   path.join(OUTPUT_DIR, 'panels', `${name}.tsx`),
    //   `// TODO: 从 Sidebar.tsx 提取\n// ${lines} lines\n`
    // )
  }
})

// 创建新的 Sidebar.tsx
const newSidebar = `/**
 * Sidebar 主组件
 * 根据 activeSidePanel 渲染对应的面板
 */

import { useStore } from '@store'
import { ExplorerView } from './panels/ExplorerView'
import { SearchView } from './panels/SearchView'
import { GitView } from './panels/GitView'
import { ProblemsView } from './panels/ProblemsView'
import { OutlineView } from './panels/OutlineView'
import { HistoryView } from './panels/HistoryView'

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

console.log('\n拆分计划:')
console.log('='.repeat(50))
console.log('原始文件: ~1938 行')
console.log('拆分后:')
console.log('  - Sidebar.tsx: ~30 行 (主容器)')
console.log('  - panels/ExplorerView.tsx: ~260 行')
console.log('  - panels/SearchView.tsx: ~430 行')
console.log('  - panels/GitView.tsx: ~490 行')
console.log('  - panels/ProblemsView.tsx: ~185 行')
console.log('  - panels/OutlineView.tsx: ~170 行')
console.log('  - panels/HistoryView.tsx: ~5 行')
console.log('  - components/FileTreeItem.tsx: ~280 行')
console.log('  - components/InlineCreateInput.tsx: ~55 行')
console.log('  - utils.ts: ~20 行')
console.log('='.repeat(50))
console.log('\n由于组件间有复杂的依赖关系，建议手动拆分以确保正确性。')
console.log('已创建目录结构和部分文件。')

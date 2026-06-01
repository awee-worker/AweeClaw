/**
 * 移除未使用的 t 和 Language 导入
 * 
 * 用法：node scripts/i18n-remove-unused-imports-v2.js
 */

const fs = require('fs')
const path = require('path')

const filesToFix = [
  'src/renderer/components/dock-panels/DebugConsolePanel.tsx',
  'src/renderer/components/explorer/panels/knowledge/KnowledgeGraphView.tsx',
  'src/renderer/components/plan/ExecutionBoard.tsx',
  'src/renderer/components/workspace-editor/SecureDiffEditor.tsx',
  'src/renderer/components/workspace-editor/TabActionMenu.tsx',
  'src/renderer/intelligence/llm-layer/ContextPipeline.ts',
]

for (const file of filesToFix) {
  const fullPath = path.join(__dirname, '..', file)
  try {
    let content = fs.readFileSync(fullPath, 'utf-8')
    
    // Check if t is actually used (not just imported)
    const usesT = /\bt\(\s*['"`]/.test(content) || /\bt\(\s*\w/.test(content.replace(/import\s*\{[^}]*\bt\b[^}]*\}/, ''))
    
    if (!usesT) {
      // Remove t from import, keep Language if used
      const usesLanguage = /\bLanguage\b/.test(content.replace(/import\s*\{[^}]*Language[^}]*\}/, ''))
      
      if (usesLanguage) {
        content = content.replace(/import\s*\{\s*t\s*,\s*type\s+Language\s*\}\s*from\s*'@renderer\/i18n'/, 
          "import { type Language } from '@renderer/i18n'")
        content = content.replace(/import\s*\{\s*t\s*,\s*Language\s*\}\s*from\s*'@renderer\/i18n'/, 
          "import { Language } from '@renderer/i18n'")
      } else {
        content = content.replace(/import\s*\{\s*t\s*,\s*type\s+Language\s*\}\s*from\s*'@renderer\/i18n'\n?/, '')
        content = content.replace(/import\s*\{\s*t\s*,\s*Language\s*\}\s*from\s*'@renderer\/i18n'\n?/, '')
        content = content.replace(/import\s*\{\s*t\s*\}\s*from\s*'@renderer\/i18n'\n?/, '')
      }
      
      content = content.replace(/\n{3,}/g, '\n\n')
      fs.writeFileSync(fullPath, content, 'utf-8')
      console.log(`  ✓ ${file}`)
    } else {
      console.log(`  - ${file} (t is actually used)`)
    }
  } catch (err) {
    console.error(`  ✗ ${file}: ${err.message}`)
  }
}

console.log('\nDone')

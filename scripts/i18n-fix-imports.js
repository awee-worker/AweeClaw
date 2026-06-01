/**
 * 修复被错误插入到其他 import 语句中间的 i18n import
 * 
 * 用法：node scripts/i18n-fix-imports.js
 */

const fs = require('fs')
const path = require('path')

function findFiles(dir) {
  const files = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...findFiles(fullPath))
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

const i18nImport = "import { t, type Language } from '@renderer/i18n'"

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  
  // Pattern: import {\nimport { t, type Language } from '@renderer/i18n'\n  ...} from '...'
  const badPattern = /import\s*\{\s*\n\s*import\s*\{\s*t,\s*type\s+Language\s*\}\s*from\s*'@renderer\/i18n'\s*\n/
  
  if (!badPattern.test(content)) return false
  
  // Remove the misplaced import
  content = content.replace(
    /\s*import\s*\{\s*t,\s*type\s+Language\s*\}\s*from\s*'@renderer\/i18n'\s*\n(\s*)/g,
    '\n$1'
  )
  
  // Check if the file still has the import somewhere else
  if (!content.includes(i18nImport)) {
    // Add it after the last import statement
    const lines = content.split('\n')
    let lastImportIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportIdx = i
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, i18nImport)
      content = lines.join('\n')
    }
  }
  
  fs.writeFileSync(filePath, content, 'utf-8')
  return true
}

const rendererDir = path.join(__dirname, '../src/renderer')
const files = findFiles(rendererDir)

let fixed = 0
for (const file of files) {
  try {
    if (fixFile(file)) {
      console.log(`  ✓ ${path.relative(path.join(__dirname, '..'), file)}`)
      fixed++
    }
  } catch (err) {
    console.error(`  ✗ ${path.relative(path.join(__dirname, '..'), file)}: ${err.message}`)
  }
}

console.log(`\nFixed ${fixed} files with misplaced imports`)

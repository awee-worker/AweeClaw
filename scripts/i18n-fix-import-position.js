/**
 * 修复被错误放置到文件末尾或中间的 import 语句
 * 将 import 移动到文件顶部（其他 import 之后）
 * 
 * 用法：node scripts/i18n-fix-import-position.js
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
const i18nImportAlt = "import { t } from '@renderer/i18n'"

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  
  const hasI18nImport = content.includes(i18nImport) || content.includes(i18nImportAlt)
  if (!hasI18nImport) return false
  
  const lines = content.split('\n')
  
  // Find the i18n import line(s)
  const i18nImportLines = []
  const nonImportLines = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === i18nImport || line === i18nImportAlt) {
      i18nImportLines.push({ idx: i, line: lines[i] })
    }
  }
  
  if (i18nImportLines.length === 0) return false
  
  // Check if the import is already at the top (within the first 50 lines)
  const firstImportLine = i18nImportLines[0]
  if (firstImportLine.idx < 50) return false // Already at top
  
  // Remove the misplaced import lines
  const removeIndices = new Set(i18nImportLines.map(l => l.idx))
  const cleanedLines = lines.filter((_, i) => !removeIndices.has(i))
  
  // Find the last import line in the cleaned content
  let lastImportIdx = -1
  for (let i = 0; i < cleanedLines.length; i++) {
    const trimmed = cleanedLines[i].trim()
    if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
      lastImportIdx = i
    }
  }
  
  if (lastImportIdx >= 0) {
    // Insert after the last import
    cleanedLines.splice(lastImportIdx + 1, 0, i18nImportLines[0].line)
  } else {
    // Insert at the beginning
    cleanedLines.unshift(i18nImportLines[0].line)
  }
  
  // Remove duplicate blank lines
  const result = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n')
  
  fs.writeFileSync(filePath, result, 'utf-8')
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

console.log(`\nFixed ${fixed} files`)

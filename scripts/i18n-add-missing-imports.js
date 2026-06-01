/**
 * 为使用了 t() 和 Language 但缺少 import 的文件自动添加 import
 * 
 * 用法：node scripts/i18n-add-missing-imports.js
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
  
  const usesT = /\bt\(\s*'/.test(content) || /\bt\(\s*`/.test(content)
  const usesLanguage = /\bas Language\b/.test(content)
  const hasImport = content.includes("@renderer/i18n")
  
  if ((usesT || usesLanguage) && !hasImport) {
    // Find the last import line
    const lines = content.split('\n')
    let lastImportIdx = -1
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
        lastImportIdx = i
      }
      // Also check for multi-line imports ending
      if (lastImportIdx >= 0 && trimmed.startsWith('}')) {
        lastImportIdx = i
      }
    }
    
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, i18nImport)
      content = lines.join('\n')
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    }
  }
  
  return false
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

console.log(`\nAdded import to ${fixed} files`)

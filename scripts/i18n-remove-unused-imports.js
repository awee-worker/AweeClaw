/**
 * 移除未使用的 i18n import（t is declared but never read）
 * 
 * 用法：node scripts/i18n-remove-unused-imports.js
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

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  
  // Check if t is imported from @renderer/i18n
  const importLine = "import { t, type Language } from '@renderer/i18n'"
  const importLineAlt = "import { t } from '@renderer/i18n'"
  
  if (!content.includes(importLine) && !content.includes(importLineAlt)) return false
  
  // Count actual t() calls (not t as type, not in comments)
  // Match t('key' or t(`key` patterns
  const tCallCount = (content.match(/\bt\(\s*['"`]/g) || []).length
  
  // Also check for t used as a variable reference (not just calls)
  // But exclude: import line, type references, string literals
  const contentWithoutImport = content.replace(/import\s*\{[^}]*\}\s*from\s*'@renderer\/i18n'/, '')
  const tUsageCount = (contentWithoutImport.match(/\bt\b/g) || []).length
  
  if (tCallCount === 0 && tUsageCount === 0) {
    // Remove the import entirely
    content = content.replace(/\n*import\s*\{\s*t,\s*type\s+Language\s*\}\s*from\s*'@renderer\/i18n'\s*\n*/, '\n')
    content = content.replace(/\n*import\s*\{\s*t\s*\}\s*from\s*'@renderer\/i18n'\s*\n*/, '\n')
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  }
  
  // If t is used but Language is not used, simplify the import
  const languageUsageCount = (contentWithoutImport.match(/\bLanguage\b/g) || []).length
  if (languageUsageCount === 0 && content.includes(importLine)) {
    content = content.replace(
      "import { t, type Language } from '@renderer/i18n'",
      "import { t } from '@renderer/i18n'"
    )
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
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

console.log(`\nFixed ${fixed} files`)

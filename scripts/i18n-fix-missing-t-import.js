/**
 * 修复只导入了 Language 但没导入 t 的文件
 * 
 * 用法：node scripts/i18n-fix-missing-t-import.js
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
  
  // Check if file has "import { type Language }" but not "import { t"
  const hasLanguageOnly = content.includes("import { type Language } from '@renderer/i18n'")
  const hasTImport = /import\s*\{\s*t[\s,}]/.test(content) && content.includes("@renderer/i18n")
  
  if (hasLanguageOnly && !hasTImport) {
    // Check if file actually uses t()
    const usesT = /\bt\(\s*['"`]/.test(content)
    if (usesT) {
      content = content.replace(
        "import { type Language } from '@renderer/i18n'",
        "import { t, type Language } from '@renderer/i18n'"
      )
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    }
  }
  
  // Check if file has no i18n import at all but uses t()
  const hasNoI18nImport = !content.includes("@renderer/i18n")
  const usesT = /\bt\(\s*['"`]/.test(content)
  const usesLanguage = /\bas Language\b/.test(content)
  
  if (hasNoI18nImport && usesT) {
    const lines = content.split('\n')
    let lastImportIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) lastImportIdx = i
    }
    if (lastImportIdx >= 0) {
      const importLine = usesLanguage 
        ? "import { t, type Language } from '@renderer/i18n'"
        : "import { t } from '@renderer/i18n'"
      lines.splice(lastImportIdx + 1, 0, importLine)
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

console.log(`\nFixed ${fixed} files`)

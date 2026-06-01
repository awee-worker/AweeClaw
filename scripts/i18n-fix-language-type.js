/**
 * 修复组件 props 中 language: string 改为 language: Language
 * 同时添加 Language 类型导入
 * 
 * 用法：node scripts/i18n-fix-language-type.js
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
  let modified = false

  // Check if file has language: string in interface/type
  if (!/language:\s*string/.test(content)) return false

  // Check if file uses t() with language as Language
  if (!content.includes('language as Language') && !content.includes("t('") && !content.includes('t("') && !content.includes('t(`')) return false

  // Replace language: string with language: Language in interfaces/types
  const newContent = content.replace(/language:\s*string/g, 'language: Language')
  if (newContent !== content) {
    content = newContent
    modified = true
  }

  // Also fix language?: string
  const newContent2 = content.replace(/language\?:\s*string/g, 'language?: Language')
  if (newContent2 !== content) {
    content = newContent2
    modified = true
  }

  if (!modified) return false

  // Check if Language type is already imported
  const hasLanguageImport = /import\s*\{[^}]*Language[^}]*\}\s*from\s*'@renderer\/i18n'/.test(content)
  
  if (!hasLanguageImport) {
    // Check if there's already an i18n import
    const hasI18nImport = content.includes("@renderer/i18n")
    if (hasI18nImport) {
      // Add Language to existing import
      content = content.replace(
        /import\s*\{\s*t\s*\}\s*from\s*'@renderer\/i18n'/,
        "import { t, type Language } from '@renderer/i18n'"
      )
      content = content.replace(
        /import\s*\{\s*t\s*,\s*([^}]*)\}\s*from\s*'@renderer\/i18n'/,
        "import { t, type Language, $1 } from '@renderer/i18n'"
      )
    } else {
      // Add new import after last import
      const lines = content.split('\n')
      let lastImportIdx = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) lastImportIdx = i
      }
      if (lastImportIdx >= 0) {
        lines.splice(lastImportIdx + 1, 0, "import { t, type Language } from '@renderer/i18n'")
        content = lines.join('\n')
      }
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

console.log(`\nFixed ${fixed} files`)

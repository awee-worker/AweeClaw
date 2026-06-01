/**
 * 删除遮蔽 i18n import 的局部 t 函数定义
 * 匹配模式：
 *   const t = (zh: string, en: string) => language === 'zh' ? zh : en
 *   const t = (zh: string, en: string) => (language === 'zh' ? zh : en)
 *   const t = useCallback((zh: string, en: string) => (language === 'zh' ? zh : en), [language])
 *   const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language])
 * 
 * 用法：node scripts/i18n-remove-local-t.js
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

const patterns = [
  /const t = \(zh: string, en: string\) => \(language === 'zh' \? zh : en\)\s*\n?/,
  /const t = \(zh: string, en: string\) => language === 'zh' \? zh : en\s*\n?/,
  /const t = useCallback\(\(zh: string, en: string\) => \(language === 'zh' \? zh : en\), \[language\]\)\s*\n?/,
  /const t = useCallback\(\(zh: string, en: string\) => language === 'zh' \? zh : en, \[language\]\)\s*\n?/,
  /const t = \(en: string, zh: string\) => \(language === 'zh' \? zh : en\)\s*\n?/,
  /const t = \(en: string, zh: string\) => language === 'zh' \? zh : en\s*\n?/,
]

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      content = content.replace(pattern, '')
      modified = true
    }
  }
  
  if (modified) {
    // Clean up double blank lines
    content = content.replace(/\n{3,}/g, '\n\n')
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

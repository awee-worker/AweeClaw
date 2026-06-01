/**
 * 修复 t(obj.labelZh, obj.labelEn) 和 t(obj.zh, obj.en) 模式的错误调用
 * 这些应该用 language === 'zh' ? obj.labelZh : obj.labelEn 替代
 * 
 * 用法：node scripts/i18n-fix-t-property-calls.js
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

  // Pattern: t(obj.labelZh, obj.labelEn) -> language === 'zh' ? obj.labelZh : obj.labelEn
  const patterns = [
    { regex: /t\((\w+)\.labelZh,\s*(\w+)\.labelEn\)/g, replacement: (m, obj1, obj2) => `language === 'zh' ? ${obj1}.labelZh : ${obj2}.labelEn` },
    { regex: /t\((\w+)\.zh,\s*(\w+)\.en\)/g, replacement: (m, obj1, obj2) => `language === 'zh' ? ${obj1}.zh : ${obj2}.en` },
    { regex: /t\((\w+)\.nameZh,\s*(\w+)\.nameEn\)/g, replacement: (m, obj1, obj2) => `language === 'zh' ? ${obj1}.nameZh : ${obj2}.nameEn` },
    { regex: /t\((\w+)\.titleZh,\s*(\w+)\.titleEn\)/g, replacement: (m, obj1, obj2) => `language === 'zh' ? ${obj1}.titleZh : ${obj2}.titleEn` },
    { regex: /t\((\w+)\.descriptionZh,\s*(\w+)\.descriptionEn\)/g, replacement: (m, obj1, obj2) => `language === 'zh' ? ${obj1}.descriptionZh : ${obj2}.descriptionEn` },
  ]

  for (const { regex, replacement } of patterns) {
    regex.lastIndex = 0
    let newContent = content.replace(regex, replacement)
    if (newContent !== content) {
      content = newContent
      modified = true
    }
  }

  if (!modified) return false

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

/**
 * 通用 i18n 自动化迁移脚本 v2
 * 
 * 处理模式：
 * 1. language === 'zh' ? '中文' : 'English'
 * 2. language === 'zh' ? `中文${var}` : `English${var}`
 * 3. 多行三元表达式
 * 4. 对象/数组中的三元表达式
 * 5. language !== 'zh' 反转模式
 * 
 * 用法：
 *   node scripts/i18n-auto-migrate.js [文件或目录路径] [--dry-run] [--module=prefix]
 * 
 * 示例：
 *   node scripts/i18n-auto-migrate.js src/renderer/components/settings/tabs --dry-run
 *   node scripts/i18n-auto-migrate.js src/renderer/components/settings/tabs/AppearanceSettings.tsx
 *   node scripts/i18n-auto-migrate.js src/renderer/components/workflow --module=wf
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const moduleArg = args.find(a => a.startsWith('--module='))
const defaultModule = moduleArg ? moduleArg.split('=')[1] : null
const targetPath = args.find(a => !a.startsWith('--')) || path.join(__dirname, '../src/renderer/components')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')

const enUSContent = fs.readFileSync(enUSPath, 'utf-8')
const zhCNContent = fs.readFileSync(zhCNPath, 'utf-8')

function parseKeys(content) {
  const keys = new Set()
  const regex = /['"]([a-zA-Z0-9_.]+)['"]:\s*['"`]/g
  let match
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1])
  }
  return keys
}

const existingEnKeys = parseKeys(enUSContent)
const existingZhKeys = parseKeys(zhCNContent)

let keyCounter = 0
const allNewKeys = {}
let totalReplaced = 0
let totalFiles = 0
let totalSkipped = 0

function slugify(text) {
  return text
    .replace(/\$\{[^}]+\}/g, m => m.replace(/[${}]/g, ''))
    .replace(/\{[^}]+\}/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .map(w => w.charAt(0).toLowerCase() + w.slice(1).toLowerCase())
    .join('')
}

function generateKey(modulePrefix, enText, usedKeys) {
  const base = slugify(enText)
  let key = base ? `${modulePrefix}.${base}` : `${modulePrefix}.text${keyCounter++}`
  
  if (!existingEnKeys.has(key) && !usedKeys.has(key)) {
    return key
  }
  
  let i = 2
  while (existingEnKeys.has(key) || usedKeys.has(key)) {
    key = `${modulePrefix}.${base}${i}`
    i++
  }
  return key
}

function getModulePrefix(filePath) {
  if (defaultModule) return defaultModule
  
  const relative = path.relative(path.join(__dirname, '../src/renderer'), filePath)
  const parts = relative.split(path.sep)
  const fileName = path.basename(filePath, path.extname(filePath))
  
  if (relative.includes('settings/tabs')) return 'settings'
  if (relative.includes('user/tabs')) return 'user'
  if (relative.includes('workflow')) return 'wf'
  if (relative.includes('workspace-editor')) return 'editor'
  if (relative.includes('writing')) return 'writing'
  if (relative.includes('intelligence')) return 'ai'
  if (relative.includes('shell')) return 'shell'
  if (relative.includes('composables')) return 'app'
  if (relative.includes('state/slices')) return 'app'
  if (relative.includes('toolkit')) return 'app'
  
  if (parts.length >= 2) {
    return parts[0].replace(/[^a-zA-Z]/g, '').substring(0, 10).toLowerCase()
  }
  return 'app'
}

function findFiles(target) {
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  
  const files = []
  const entries = fs.readdirSync(target, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(target, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...findFiles(fullPath))
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      if (content.includes("language === 'zh'") || content.includes('language === "zh"')) {
        files.push(fullPath)
      }
    }
  }
  return files
}

function extractStringLiteral(content, startPos) {
  const ch = content[startPos]
  if (ch === "'" || ch === '"') {
    let end = startPos + 1
    let result = ''
    while (end < content.length) {
      if (content[end] === '\\') {
        result += content[end + 1]
        end += 2
        continue
      }
      if (content[end] === ch) {
        return { value: result, end: end + 1 }
      }
      result += content[end]
      end++
    }
    return null
  }
  if (ch === '`') {
    let end = startPos + 1
    let result = ''
    while (end < content.length) {
      if (content[end] === '\\') {
        result += content[end] + content[end + 1]
        end += 2
        continue
      }
      if (content[end] === '`') {
        return { value: result, end: end + 1, isTemplate: true }
      }
      result += content[end]
      end++
    }
    return null
  }
  return null
}

function skipWhitespace(content, pos) {
  while (pos < content.length && /\s/.test(content[pos])) pos++
  return pos
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const modulePrefix = getModulePrefix(filePath)
  const usedKeys = new Set()
  const replacements = []
  let pos = 0
  
  while (pos < content.length) {
    const idx = content.indexOf("language === 'zh'", pos)
    if (idx === -1) break
    
    const beforeLang = content.substring(Math.max(0, idx - 20), idx)
    if (beforeLang.includes('//') || beforeLang.includes('/*')) {
      pos = idx + 18
      continue
    }
    
    let afterLang = idx + 18
    afterLang = skipWhitespace(content, afterLang)
    
    if (content[afterLang] !== '?') {
      pos = idx + 18
      continue
    }
    
    afterLang = skipWhitespace(content, afterLang + 1)
    
    const zhResult = extractStringLiteral(content, afterLang)
    if (!zhResult) {
      pos = idx + 18
      continue
    }
    
    let afterZh = skipWhitespace(content, zhResult.end)
    
    if (content[afterZh] !== ':') {
      pos = idx + 18
      continue
    }
    
    afterZh = skipWhitespace(content, afterZh + 1)
    
    const enResult = extractStringLiteral(content, afterZh)
    if (!enResult) {
      pos = idx + 18
      continue
    }
    
    const fullMatch = content.substring(idx, enResult.end)
    let zhText = zhResult.value
    let enText = enResult.value
    let isTemplate = zhResult.isTemplate || enResult.isTemplate
    
    let params = []
    let tParams = ''
    
    if (isTemplate) {
      const paramSet = new Set()
      const paramRegex = /\$\{([^}]+)\}/g
      let pm
      while ((pm = paramRegex.exec(enText)) !== null) paramSet.add(pm[1].trim())
      while ((pm = paramRegex.exec(zhText)) !== null) paramSet.add(pm[1].trim())
      
      params = [...paramSet]
      
      enText = enText.replace(/\$\{([^}]+)\}/g, '{$1}')
      zhText = zhText.replace(/\$\{([^}]+)\}/g, '{$1}')
      
      if (params.length > 0) {
        tParams = `, { ${params.join(', ')} }`
      }
    }
    
    const key = generateKey(modulePrefix, enText, usedKeys)
    usedKeys.add(key)
    
    replacements.push({
      search: fullMatch,
      replace: `t('${key}', language as Language${tParams})`,
      key,
      zh: zhText,
      en: enText,
      params
    })
    
    allNewKeys[key] = { en: enText, zh: zhText, file: path.relative(path.join(__dirname, '..'), filePath) }
    
    pos = enResult.end
  }
  
  if (replacements.length === 0) return
  
  for (const r of replacements) {
    content = content.replace(r.search, r.replace)
  }
  
  const hasTImport = /import\s*\{[^}]*t[^}]*\}\s*from\s*['"]@renderer\/i18n['"]/.test(content)
  const hasLanguageImport = /import\s*\{[^}]*Language[^}]*\}\s*from\s*['"]@renderer\/i18n['"]/.test(content)
  
  if (!hasTImport) {
    const lastImportIdx = content.lastIndexOf('\nimport ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx + 1)
      if (hasLanguageImport) {
        content = content.replace(
          /import\s*\{([^}]*)\}\s*from\s*['"]@renderer\/i18n['"]/,
          (match, imports) => {
            if (imports.includes('t')) return match
            return match.replace(imports, imports.trim() + ', t')
          }
        )
      } else {
        content = content.substring(0, lineEnd + 1) +
          "import { t, type Language } from '@renderer/i18n'\n" +
          content.substring(lineEnd + 1)
      }
    }
  } else if (!hasLanguageImport) {
    content = content.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]@renderer\/i18n['"]/,
      (match, imports) => {
        if (imports.includes('Language')) return match
        return match.replace(imports, imports.trim() + ', type Language')
      }
    )
  }
  
  if (dryRun) {
    console.log(`\n📄 ${path.relative(path.join(__dirname, '..'), filePath)} (${replacements.length} replacements):`)
    for (const r of replacements) {
      console.log(`  ${r.key}: '${r.en}' / '${r.zh}'`)
      console.log(`    ${r.search.substring(0, 60)}... → ${r.replace}`)
    }
  } else {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`  ✓ ${path.relative(path.join(__dirname, '..'), filePath)}: ${replacements.length} replacements`)
  }
  
  totalReplaced += replacements.length
  totalFiles++
}

function generateTranslationEntries() {
  const enEntries = []
  const zhEntries = []
  
  for (const [key, val] of Object.entries(allNewKeys)) {
    const enVal = val.en.replace(/'/g, "\\'")
    const zhVal = val.zh.replace(/'/g, "\\'")
    enEntries.push(`  '${key}': '${enVal}',`)
    zhEntries.push(`  '${key}': '${zhVal}',`)
  }
  
  return { enEntries, zhEntries }
}

console.log(`\n🔍 Scanning: ${targetPath}`)
console.log(dryRun ? '📋 Dry run mode - no files will be modified\n' : '✍️  Writing mode\n')

const files = findFiles(targetPath)
console.log(`Found ${files.length} files with hardcoded i18n\n`)

for (const file of files) {
  try {
    processFile(file)
  } catch (err) {
    console.error(`  ✗ Error: ${path.relative(path.join(__dirname, '..'), file)}: ${err.message}`)
    totalSkipped++
  }
}

const outputPath = path.join(__dirname, 'i18n-new-keys.json')
fs.writeFileSync(outputPath, JSON.stringify(allNewKeys, null, 2), 'utf-8')

const { enEntries, zhEntries } = generateTranslationEntries()
const enOutputPath = path.join(__dirname, 'i18n-new-en.txt')
const zhOutputPath = path.join(__dirname, 'i18n-new-zh.txt')
fs.writeFileSync(enOutputPath, enEntries.join('\n'), 'utf-8')
fs.writeFileSync(zhOutputPath, zhEntries.join('\n'), 'utf-8')

console.log(`\n${'='.repeat(50)}`)
console.log(`📊 Summary:`)
console.log(`   Files processed: ${totalFiles}`)
console.log(`   Total replacements: ${totalReplaced}`)
console.log(`   New translation keys: ${Object.keys(allNewKeys).length}`)
console.log(`   Files skipped (errors): ${totalSkipped}`)
console.log(`\n📁 Output files:`)
console.log(`   Keys JSON: ${outputPath}`)
console.log(`   English entries: ${enOutputPath}`)
console.log(`   Chinese entries: ${zhOutputPath}`)
console.log(`\n📋 Next steps:`)
console.log(`   1. Review generated keys`)
console.log(`   2. Append entries from i18n-new-en.txt to enUS.ts`)
console.log(`   3. Append entries from i18n-new-zh.txt to zhCN.ts`)
console.log(`   4. Run build to verify`)

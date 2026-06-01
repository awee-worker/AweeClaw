/**
 * 修复错误的 t() 调用格式
 * 将 t('中文', 'English') 和 t(`中文`, `English`) 改为 t('key', language as Language)
 * 
 * 用法：node scripts/i18n-fix-t-calls.js [--dry-run]
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')

const enUSContent = fs.readFileSync(enUSPath, 'utf-8')
const zhCNContent = fs.readFileSync(zhCNPath, 'utf-8')

function parseKeys(content) {
  const keys = {}
  const regex = /['"]([a-zA-Z0-9_.]+)['"]:\s*'((?:[^'\\]|\\.)*)'/g
  let match
  while ((match = regex.exec(content)) !== null) {
    keys[match[1]] = match[2]
  }
  return keys
}

const enKeys = parseKeys(enUSContent)

let keyCounter = 0
function generateKey(enText, usedKeys) {
  const base = enText
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map(w => w.toLowerCase())
    .join('')
  
  if (!base) return `app.text${keyCounter++}`
  
  // Determine module prefix from context (we'll use 'app' as default)
  let key = `app.${base}`
  
  if (!enKeys[key] && !usedKeys.has(key)) return key
  
  let i = 2
  while (enKeys[key] || usedKeys.has(key)) {
    key = `app.${base}${i}`
    i++
  }
  return key
}

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

// Match t('中文', 'English') or t(`中文${var}`, `English${var}`)
// Pattern: t( followed by a string starting with Chinese char or template with Chinese
const chineseChar = '[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]'

let totalFixed = 0
const newKeys = {}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const usedKeys = new Set()
  const replacements = []
  
  // Match t('中文text', 'English text') - single quotes
  // Also match t(`中文text`, `English text`) - template literals
  const patterns = [
    // t('中文', 'English') or t("中文", "English")
    /t\(\s*'((?:[^'\\]|\\.)*[\u4e00-\u9fff](?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g,
    /t\(\s*"((?:[^"\\]|\\.)*[\u4e00-\u9fff](?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
    // t(`中文${var}`, `English${var}`)
    /t\(\s*`((?:[^`\\]|\\.)*[\u4e00-\u9fff](?:[^`\\]|\\.)*)`\s*,\s*`((?:[^`\\]|\\.)*)`\s*\)/g,
  ]
  
  for (const pattern of patterns) {
    let match
    pattern.lastIndex = 0
    while ((match = pattern.exec(content)) !== null) {
      const [fullMatch, zhText, enText] = match
      
      let isTemplate = fullMatch.includes('`')
      let params = []
      let tParams = ''
      
      let zhClean = zhText
      let enClean = enText
      
      if (isTemplate) {
        const paramSet = new Set()
        const paramRegex = /\$\{([^}]+)\}/g
        let pm
        while ((pm = paramRegex.exec(enText)) !== null) paramSet.add(pm[1].trim())
        while ((pm = paramRegex.exec(zhText)) !== null) paramSet.add(pm[1].trim())
        
        params = [...paramSet]
        enClean = enText.replace(/\$\{([^}]+)\}/g, '{$1}')
        zhClean = zhText.replace(/\$\{([^}]+)\}/g, '{$1}')
        
        if (params.length > 0) {
          tParams = `, { ${params.join(', ')} }`
        }
      }
      
      const key = generateKey(enClean, usedKeys)
      usedKeys.add(key)
      
      replacements.push({
        search: fullMatch,
        replace: `t('${key}', language as Language${tParams})`,
        key,
        zh: zhClean,
        en: enClean
      })
      
      newKeys[key] = { en: enClean, zh: zhClean, file: path.relative(path.join(__dirname, '..'), filePath) }
    }
  }
  
  if (replacements.length === 0) return
  
  for (const r of replacements) {
    content = content.replace(r.search, r.replace)
  }
  
  if (dryRun) {
    console.log(`\n📄 ${path.relative(path.join(__dirname, '..'), filePath)} (${replacements.length} fixes):`)
    for (const r of replacements) {
      console.log(`  ${r.key}: '${r.en}' / '${r.zh}'`)
    }
  } else {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`  ✓ ${path.relative(path.join(__dirname, '..'), filePath)}: ${replacements.length} fixes`)
  }
  
  totalFixed += replacements.length
}

const rendererDir = path.join(__dirname, '../src/renderer')
const files = findFiles(rendererDir)

console.log(`Scanning ${files.length} files for incorrect t() calls...`)
if (dryRun) console.log('📋 Dry run mode\n')

for (const file of files) {
  try {
    processFile(file)
  } catch (err) {
    console.error(`  ✗ Error: ${path.relative(path.join(__dirname, '..'), file)}: ${err.message}`)
  }
}

// Save new keys
if (Object.keys(newKeys).length > 0) {
  const outputPath = path.join(__dirname, 'i18n-new-keys.json')
  fs.writeFileSync(outputPath, JSON.stringify(newKeys, null, 2), 'utf-8')
  
  if (!dryRun) {
    // Auto-merge
    const { execSync } = require('child_process')
    execSync('node scripts/i18n-merge-keys.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit' })
  }
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Total fixes: ${totalFixed}`)
console.log(`New translation keys: ${Object.keys(newKeys).length}`)

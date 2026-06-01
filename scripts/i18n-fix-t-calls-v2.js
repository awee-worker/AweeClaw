/**
 * 修复所有 t('English', '中文') 和 t(`English`, `中文`) 格式的错误调用
 * v2: 支持更多模式，包括 (en, zh) 顺序和双引号
 * 
 * 用法：node scripts/i18n-fix-t-calls-v2.js [--dry-run]
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
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'i18n') {
      files.push(...findFiles(fullPath))
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

const chineseChar = '[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]'

let totalFixed = 0
const newKeys = {}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const usedKeys = new Set()
  const replacements = []

  // Pattern 1: t('中文', 'English') - zh first, single quotes
  // Pattern 2: t('English', '中文') - en first, single quotes (has Chinese in second arg)
  // Pattern 3: t(`中文${var}`, `English${var}`) - template literals
  // Pattern 4: t(`English${var}`, `中文${var}`) - template literals reversed

  const patterns = [
    // t('中文text', 'English text') - Chinese in first arg
    { regex: /t\(\s*'((?:[^'\\]|\\.)*[\u4e00-\u9fff](?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g, zhFirst: true },
    // t('English text', '中文text') - Chinese in second arg
    { regex: /t\(\s*'((?:[^'\\]|\\.)*?)'\s*,\s*'((?:[^'\\]|\\.)*[\u4e00-\u9fff](?:[^'\\]|\\.)*)'\s*\)/g, zhFirst: false },
    // t(`中文${var}`, `English${var}`) - template, Chinese in first
    { regex: /t\(\s*`((?:[^`\\]|\\.)*[\u4e00-\u9fff](?:[^`\\]|\\.)*)`\s*,\s*`((?:[^`\\]|\\.)*)`\s*\)/g, zhFirst: true },
    // t(`English${var}`, `中文${var}`) - template, Chinese in second
    { regex: /t\(\s*`((?:[^`\\]|\\.)*?)`\s*,\s*`((?:[^`\\]|\\.)*[\u4e00-\u9fff](?:[^`\\]|\\.)*)`\s*\)/g, zhFirst: false },
    // t("中文text", "English text") - double quotes
    { regex: /t\(\s*"((?:[^"\\]|\\.)*[\u4e00-\u9fff](?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g, zhFirst: true },
    // t("English text", "中文text") - double quotes, Chinese in second
    { regex: /t\(\s*"((?:[^"\\]|\\.)*?)"\s*,\s*"((?:[^"\\]|\\.)*[\u4e00-\u9fff](?:[^"\\]|\\.)*)"\s*\)/g, zhFirst: false },
  ]

  for (const { regex, zhFirst } of patterns) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(content)) !== null) {
      const [fullMatch, arg1, arg2] = match

      // Skip if already a valid t() call (key-based)
      if (/^[a-zA-Z0-9_.]+$/.test(arg1) && !zhFirst) continue

      let zhText, enText
      if (zhFirst) {
        zhText = arg1
        enText = arg2
      } else {
        enText = arg1
        zhText = arg2
      }

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
          const namedParams = params.map(p => {
            const name = p.split('.').pop() || p
            return `${name.replace(/[^a-zA-Z0-9_]/g, '')}: ${p}`
          })
          tParams = `, { ${namedParams.join(', ')} }`
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

  // Sort replacements by length descending to avoid partial replacements
  replacements.sort((a, b) => b.search.length - a.search.length)

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

console.log(`Scanning ${files.length} files for incorrect t() calls (v2)...`)
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
    const { execSync } = require('child_process')
    execSync('node scripts/i18n-merge-keys.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit' })
  }
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Total fixes: ${totalFixed}`)
console.log(`New translation keys: ${Object.keys(newKeys).length}`)

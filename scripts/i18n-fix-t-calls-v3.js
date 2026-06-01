/**
 * 修复所有 t('English', '中文') 格式的错误调用 - v3
 * 使用更简单直接的正则匹配
 * 
 * 用法：node scripts/i18n-fix-t-calls-v3.js [--dry-run]
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

let totalFixed = 0
const newKeys = {}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const usedKeys = new Set()
  const replacements = []

  // Match t('text1', 'text2') where either text1 or text2 contains Chinese
  // This covers both t('中文', 'English') and t('English', '中文')
  const singleQuotePattern = /t\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g
  const templatePattern = /t\(\s*`([^`]+)`\s*,\s*`([^`]+)`\s*\)/g
  const doubleQuotePattern = /t\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g

  for (const pattern of [singleQuotePattern, templatePattern, doubleQuotePattern]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(content)) !== null) {
      const [fullMatch, arg1, arg2] = match

      // Skip if arg1 looks like a valid i18n key (namespace.key format)
      if (/^[a-z]+\.[a-z]/i.test(arg1)) continue

      // Check if either arg contains Chinese
      const hasChinese1 = /[\u4e00-\u9fff]/.test(arg1)
      const hasChinese2 = /[\u4e00-\u9fff]/.test(arg2)

      if (!hasChinese1 && !hasChinese2) continue

      let zhText, enText
      if (hasChinese1 && !hasChinese2) {
        zhText = arg1
        enText = arg2
      } else if (!hasChinese1 && hasChinese2) {
        enText = arg1
        zhText = arg2
      } else {
        // Both have Chinese - assume first is zh
        zhText = arg1
        enText = arg2
      }

      let isTemplate = fullMatch.includes('`')
      let tParams = ''

      let zhClean = zhText
      let enClean = enText

      if (isTemplate) {
        const paramSet = new Set()
        const paramRegex = /\$\{([^}]+)\}/g
        let pm
        while ((pm = paramRegex.exec(enText)) !== null) paramSet.add(pm[1].trim())
        while ((pm = paramRegex.exec(zhText)) !== null) paramSet.add(pm[1].trim())

        const params = [...paramSet]
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

  // Sort by length descending
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

console.log(`Scanning ${files.length} files for incorrect t() calls (v3)...`)
if (dryRun) console.log('📋 Dry run mode\n')

for (const file of files) {
  try {
    processFile(file)
  } catch (err) {
    console.error(`  ✗ Error: ${path.relative(path.join(__dirname, '..'), file)}: ${err.message}`)
  }
}

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

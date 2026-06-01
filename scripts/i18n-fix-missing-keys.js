/**
 * 修复缺失的翻译 key
 * 从已替换的文件中提取 t('key', language) 调用
 * 根据代码上下文和 key 名称推断翻译内容
 * 
 * 用法：node scripts/i18n-fix-missing-keys.js
 */

const fs = require('fs')
const path = require('path')

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
const zhKeys = parseKeys(zhCNContent)

// Find all t() calls in the codebase
function findTKeys(dir) {
  const keys = new Map()
  
  function scanDir(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'i18n') {
        scanDir(fullPath)
      } else if (/\.(tsx|ts)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        // Match t('key', language) and t('key', language as Language) and t('key', language, { params })
        const regex = /t\(\s*'([a-zA-Z0-9_.]+)'/g
        let match
        while ((match = regex.exec(content)) !== null) {
          const key = match[1]
          if (!keys.has(key)) {
            keys.set(key, [])
          }
          keys.get(key).push(path.relative(path.join(__dirname, '..'), fullPath))
        }
      }
    }
  }
  
  scanDir(dir)
  return keys
}

const rendererDir = path.join(__dirname, '../src/renderer')
const usedKeys = findTKeys(rendererDir)

// Find missing keys
const missingEn = []
const missingZh = []

for (const [key, files] of usedKeys) {
  if (!enKeys[key]) {
    missingEn.push(key)
  }
  if (!zhKeys[key]) {
    missingZh.push(key)
  }
}

console.log(`Total t() keys used in code: ${usedKeys.size}`)
console.log(`Missing from enUS.ts: ${missingEn.length}`)
console.log(`Missing from zhCN.ts: ${missingZh.length}`)

if (missingEn.length === 0 && missingZh.length === 0) {
  console.log('\n✓ All translation keys are present!')
  process.exit(0)
}

// Generate placeholder translations for missing keys
function generatePlaceholderEn(key) {
  // Try to generate readable English from key
  const parts = key.split('.')
  const lastPart = parts[parts.length - 1]
  // Convert camelCase to Title Case
  const words = lastPart.replace(/([A-Z])/g, ' $1').replace(/([a-z])([A-Z])/g, '$1 $2')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function generatePlaceholderZh(key) {
  return `[${key}]`
}

// Add missing keys to enUS.ts
if (missingEn.length > 0) {
  const entries = missingEn.map(key => {
    const enText = generatePlaceholderEn(key)
    return `  '${key}': '${enText}',`
  })
  
  const lastBraceIdx = enUSContent.lastIndexOf('}')
  const newContent = enUSContent.substring(0, lastBraceIdx) +
    '\n  // Auto-generated missing keys\n' +
    entries.join('\n') + '\n' +
    enUSContent.substring(lastBraceIdx)
  
  fs.writeFileSync(enUSPath, newContent, 'utf-8')
  console.log(`\n✓ Added ${missingEn.length} missing keys to enUS.ts`)
}

// Add missing keys to zhCN.ts
if (missingZh.length > 0) {
  const entries = missingZh.map(key => {
    const zhText = generatePlaceholderZh(key)
    return `  '${key}': '${zhText}',`
  })
  
  const lastBraceIdx = zhCNContent.lastIndexOf('}')
  const newContent = zhCNContent.substring(0, lastBraceIdx) +
    '\n  // Auto-generated missing keys\n' +
    entries.join('\n') + '\n' +
    zhCNContent.substring(lastBraceIdx)
  
  fs.writeFileSync(zhCNPath, newContent, 'utf-8')
  console.log(`✓ Added ${missingZh.length} missing keys to zhCN.ts`)
}

// Output missing keys for manual review
const outputPath = path.join(__dirname, 'i18n-missing-keys.txt')
const output = missingEn.map(key => `${key}: ${generatePlaceholderEn(key)}`).join('\n')
fs.writeFileSync(outputPath, output, 'utf-8')
console.log(`\n📋 Missing keys list saved to: ${outputPath}`)
console.log('⚠️  Please review and update the auto-generated translations!')

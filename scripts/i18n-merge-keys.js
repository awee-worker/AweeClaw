/**
 * 将 i18n-auto-migrate 生成的翻译 key 合并到 enUS.ts 和 zhCN.ts
 * 
 * 用法：node scripts/i18n-merge-keys.js
 */

const fs = require('fs')
const path = require('path')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')
const keysJsonPath = path.join(__dirname, 'i18n-new-keys.json')

if (!fs.existsSync(keysJsonPath)) {
  console.error('No i18n-new-keys.json found. Run i18n-auto-migrate.js first.')
  process.exit(1)
}

const newKeys = JSON.parse(fs.readFileSync(keysJsonPath, 'utf-8'))
const keyCount = Object.keys(newKeys).length
if (keyCount === 0) {
  console.log('No new keys to merge.')
  process.exit(0)
}

console.log(`Merging ${keyCount} new translation keys...`)

// Parse existing keys to avoid duplicates
function parseExistingKeys(content) {
  const keys = new Set()
  const regex = /['"]([a-zA-Z0-9_.]+)['"]:\s*['"`]/g
  let match
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1])
  }
  return keys
}

function mergeIntoFile(filePath, newKeys, lang) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const existingKeys = parseExistingKeys(content)
  
  const entries = []
  let skipped = 0
  for (const [key, val] of Object.entries(newKeys)) {
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    const text = lang === 'en' ? val.en : val.zh
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    entries.push(`  '${key}': '${escaped}',`)
  }
  
  if (entries.length === 0) {
    console.log(`  No new keys to add to ${path.basename(filePath)} (${skipped} duplicates skipped)`)
    return
  }
  
  // Find the closing of the object (last } before potential export)
  const lastBraceIdx = content.lastIndexOf('}')
  if (lastBraceIdx === -1) {
    console.error(`  Could not find closing brace in ${path.basename(filePath)}`)
    return
  }
  
  // Insert before the closing brace
  const insertPos = lastBraceIdx
  const newContent = content.substring(0, insertPos) +
    '\n' + entries.join('\n') + '\n' +
    content.substring(insertPos)
  
  fs.writeFileSync(filePath, newContent, 'utf-8')
  console.log(`  ✓ ${path.basename(filePath)}: ${entries.length} keys added, ${skipped} duplicates skipped`)
}

mergeIntoFile(enUSPath, newKeys, 'en')
mergeIntoFile(zhCNPath, newKeys, 'zh')

// Clear the keys file after merge
fs.writeFileSync(keysJsonPath, '{}', 'utf-8')
console.log('\nDone! Keys file cleared.')

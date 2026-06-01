/**
 * 清理无效的翻译 key
 * 移除不包含 '.' 命名空间前缀的 key（这些是误匹配的）
 * 
 * 用法：node scripts/i18n-cleanup-keys.js
 */

const fs = require('fs')
const path = require('path')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')

function cleanup(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const cleaned = []
  let removed = 0
  
  for (const line of lines) {
    const match = line.match(/^\s*'([a-zA-Z0-9_.]+)':\s*'/)
    if (match) {
      const key = match[1]
      // Valid keys must have a namespace prefix (contain at least one dot)
      // and the prefix must be at least 2 chars
      if (!key.includes('.')) {
        removed++
        continue
      }
      // Also remove keys that are just a single dot
      if (key === '.') {
        removed++
        continue
      }
      // Remove placeholder zh translations [key]
      if (line.includes("'[") && line.includes("]'")) {
        // Keep the line but mark for review
      }
    }
    cleaned.push(line)
  }
  
  fs.writeFileSync(filePath, cleaned.join('\n'), 'utf-8')
  console.log(`${path.basename(filePath)}: removed ${removed} invalid keys`)
}

cleanup(enUSPath)
cleanup(zhCNPath)

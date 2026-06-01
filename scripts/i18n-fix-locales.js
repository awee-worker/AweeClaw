/**
 * 修复翻译文件中的多行字符串和语法错误
 * 
 * 用法：node scripts/i18n-fix-locales.js
 */

const fs = require('fs')
const path = require('path')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')

function fixLocaleFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const fixed = []
  let inMultilineValue = false
  let currentLine = ''
  let fixedCount = 0
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    if (inMultilineValue) {
      // We're inside a multi-line string value
      // Collect until we find the closing quote
      if (line.includes("',")) {
        // End of multi-line value - join and escape
        const remaining = line.replace("',", '')
        currentLine += '\\n' + remaining.replace(/'/g, "\\'")
        fixed.push(currentLine + "',")
        inMultilineValue = false
        currentLine = ''
        fixedCount++
        continue
      }
      // Still in multi-line value
      currentLine += '\\n' + line.replace(/'/g, "\\'")
      continue
    }
    
    // Check if this line starts a key-value pair but the value is not terminated
    const match = line.match(/^\s*'([a-zA-Z0-9_.]+)':\s*'(.*)$/)
    if (match) {
      const [, key, value] = match
      // Check if the value is properly terminated with ',
      if (value.endsWith("',") || value.endsWith("'")) {
        fixed.push(line)
      } else {
        // Multi-line string - start collecting
        inMultilineValue = true
        currentLine = `  '${key}': '${value.replace(/'/g, "\\'")}`
        fixedCount++
      }
    } else {
      fixed.push(line)
    }
  }
  
  if (fixedCount > 0) {
    fs.writeFileSync(filePath, fixed.join('\n'), 'utf-8')
  }
  console.log(`${path.basename(filePath)}: fixed ${fixedCount} multi-line strings`)
}

fixLocaleFile(enUSPath)
fixLocaleFile(zhCNPath)

/**
 * 修复 t() 调用中参数对象语法错误
 * 将 t('key', language as Language, { expr1, expr2 }) 改为 t('key', language as Language)
 * 并更新翻译键的值使用 {0}, {1} 等占位符
 * 
 * 用法：node scripts/i18n-fix-t-params.js [--dry-run]
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')

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

// Match t('key', language as Language, { expr1, expr2 }) where the object has invalid syntax
// i.e. it has bare expressions without key: value pairs
const tCallWithBadParams = /t\(\s*'([a-zA-Z0-9_.]+)'\s*,\s*language\s+as\s+Language\s*,\s*\{([^}]+)\}\s*\)/g

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  const keyUpdates = []
  
  content = content.replace(tCallWithBadParams, (match, key, paramsStr) => {
    const params = paramsStr.split(',').map(p => p.trim()).filter(Boolean)
    
    // Check if params are valid key:value pairs
    const allHaveKeyValue = params.every(p => /^\w+\s*:/.test(p))
    if (allHaveKeyValue) return match
    
    // These are bare expressions - need to either fix or remove params
    // Simplest fix: remove the params entirely and adjust the translation key
    modified = true
    keyUpdates.push({ key, params })
    
    // Try to convert bare expressions to named params
    const namedParams = []
    const paramNames = []
    let counter = 0
    
    for (const p of params) {
      const cleanP = p.trim()
      // If it's already a key:value pair, keep it
      if (/^\w+\s*:/.test(cleanP)) {
        namedParams.push(cleanP)
        const nameMatch = cleanP.match(/^(\w+)\s*:/)
        if (nameMatch) paramNames.push(nameMatch[1])
        continue
      }
      
      // Generate a param name from the expression
      let paramName = `p${counter}`
      // Try to extract a meaningful name
      const memberMatch = cleanP.match(/(\w+)\.(\w+)/)
      if (memberMatch) {
        paramName = memberMatch[2]
      } else if (/^\w+$/.test(cleanP)) {
        paramName = cleanP
      }
      
      // Ensure unique param name
      let finalName = paramName
      let suffix = 2
      while (paramNames.includes(finalName)) {
        finalName = `${paramName}${suffix}`
        suffix++
      }
      paramNames.push(finalName)
      namedParams.push(`${finalName}: ${cleanP}`)
      counter++
    }
    
    return `t('${key}', language as Language, { ${namedParams.join(', ')} })`
  })
  
  if (!modified) return
  
  if (dryRun) {
    console.log(`\n📄 ${path.relative(path.join(__dirname, '..'), filePath)}:`)
    for (const u of keyUpdates) {
      console.log(`  key: ${u.key}, params: ${u.params.join(', ')}`)
    }
  } else {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`  ✓ ${path.relative(path.join(__dirname, '..'), filePath)}: ${keyUpdates.length} fixes`)
  }
}

const rendererDir = path.join(__dirname, '../src/renderer')
const files = findFiles(rendererDir)

console.log(`Scanning ${files.length} files for invalid t() params...`)
if (dryRun) console.log('📋 Dry run mode\n')

for (const file of files) {
  try {
    fixFile(file)
  } catch (err) {
    console.error(`  ✗ Error: ${path.relative(path.join(__dirname, '..'), file)}: ${err.message}`)
  }
}

console.log('\nDone!')

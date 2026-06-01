/**
 * 修复翻译文件中包含代码表达式的翻译值
 * 将 {expr.prop} / {expr.method()} 等替换为 {paramName}
 * 
 * 用法：node scripts/i18n-fix-translation-values.js
 */

const fs = require('fs')
const path = require('path')

const enUSPath = path.join(__dirname, '../src/renderer/i18n/locales/enUS.ts')
const zhCNPath = path.join(__dirname, '../src/renderer/i18n/locales/zhCN.ts')

function fixTranslationValues(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let fixedCount = 0

  // Fix patterns like {expr.prop} -> {prop} (simple property access)
  content = content.replace(/\{(\w+)\.(\w+)\}/g, (match, obj, prop) => {
    fixedCount++
    return `{${prop}}`
  })

  // Fix patterns like {expr.prop.method()} -> simplified
  content = content.replace(/\{(\w+)\.(\w+)\.(\w+)\(\)\}/g, (match, obj, prop, method) => {
    fixedCount++
    return `{${prop}}`
  })

  // Fix patterns like {Number(expr).toFixed(2)} -> {price}
  content = content.replace(/\{Number\((\w+)\.(\w+)\)\.toFixed\(\d+\)\}/g, (match, obj, prop) => {
    fixedCount++
    return `{${prop}}`
  })

  // Fix patterns like {(expr / 1024 / 1024).toFixed(1)} -> {size}
  content = content.replace(/\{\([^)]+\)\.toFixed\(\d+\)\}/g, (match) => {
    fixedCount++
    return '{size}'
  })

  // Fix patterns like {expr + 1} -> {value}
  content = content.replace(/\{(\w+)\s*\+\s*\d+\}/g, (match, expr) => {
    fixedCount++
    return `{${expr}}`
  })

  // Fix patterns like {expr.length} -> {count}
  content = content.replace(/\{(\w+)\.length\}/g, (match, expr) => {
    fixedCount++
    return '{count}'
  })

  // Fix patterns like {expr.prop.length} -> {count}
  content = content.replace(/\{(\w+)\.(\w+)\.length\}/g, (match, obj, prop) => {
    fixedCount++
    return '{count}'
  })

  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`${path.basename(filePath)}: fixed ${fixedCount} translation values`)
}

fixTranslationValues(enUSPath)
fixTranslationValues(zhCNPath)

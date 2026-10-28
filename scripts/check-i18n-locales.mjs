/**
 * 文案占位符检查
 *
 * 背景：t() 只做 `{name}` → 值的字面替换，不解析表达式。若模板里写成
 * `{order.status === 'CANCELLED' ? '取消' : '过期'}` 这类 JS 代码，占位符永远
 * 替换不掉，用户界面上就会原样显示一段花括号。这类问题编译期不报错，只能靠
 * 肉眼在运行时发现，历史上已经漏出去过若干个。
 *
 * 另外，中英两份模板的占位符必须对得上：中文模板有 {count}、英文漏了，
 * 切到英文后这个参数就消失了。注意中文允许用 {nameZh} 取中文名、英文用 {name}
 * 取原名，这是有意的设计（调用处两个参数都传），比较时先把中文侧的 Zh 后缀归一。
 *
 * 用法：npm run check:i18n
 * 退出码：0 通过；1 存在 error 级问题
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = path.join(ROOT, 'src/renderer/i18n/locales')

// typescript 是 CJS 包，按本目录的解析基准加载
const require = createRequire(import.meta.url)
const ts = require('typescript')

/**
 * 合法占位符：只由标识符字符和数字构成，如 count、scenarioName、0。
 *
 * 任何 `.` `?` `(` 空格的出现都意味着模板里写了表达式或属性访问，
 * 那样的占位符 t() 永远替换不掉。放开数字是为了兼容按序索引传参的写法。
 */
const IDENTIFIER = /^[A-Za-z0-9_$]+$/

/**
 * 解析一个 locale 域文件，取出 `export const xx = {...}` 里的字符串键值。
 *
 * 用编译器 API 而不是正则：文案里存在转义引号、换行与模板字面量，
 * 正则切不干净，而误判一条就会让整套检查失去可信度。
 */
function extractEntries(file) {
  const source = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const entries = new Map()

  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue
        for (const prop of decl.initializer.properties) {
          if (!ts.isPropertyAssignment(prop)) continue

          const nameNode = prop.name
          let key = null
          if (ts.isStringLiteral(nameNode) || ts.isIdentifier(nameNode) || ts.isNumericLiteral(nameNode)) {
            key = nameNode.text
          }
          if (key === null) continue

          const init = prop.initializer
          // 只有字符串字面量参与占位符检查；引用常量（PropertyAccessExpression）跳过
          if (!ts.isStringLiteral(init) && !ts.isNoSubstitutionTemplateLiteral(init)) continue

          entries.set(key, {
            value: init.text,
            line: sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return entries
}

/** 载入某个语言的全部域，同时报告跨域重名 */
function loadLanguage(lang) {
  const dir = path.join(LOCALES, lang)
  const merged = new Map()
  const duplicates = []

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue
    for (const [key, entry] of extractEntries(path.join(dir, file))) {
      if (merged.has(key)) {
        duplicates.push({ key, file, line: entry.line, first: merged.get(key) })
        continue
      }
      merged.set(key, { ...entry, file })
    }
  }
  return { entries: merged, duplicates }
}

/**
 * 取出模板里的占位符。
 *
 * {{...}} 是载荷级占位符（留给下游替换），${...} 是代码片段示例里的模板字面量，
 * 两者都是合法字面量，先抹掉再找单层花括号，避免误报。
 */
function findPlaceholders(text) {
  const scrubbed = text
    .replace(/\{\{[^{}]*\}\}/g, (m) => ' '.repeat(m.length))
    .replace(/\$\{[^{}]*\}/g, (m) => ' '.repeat(m.length))

  const found = new Set()
  const re = /\{([^{}]+)\}/g
  let m
  while ((m = re.exec(scrubbed))) found.add(m[1])
  return found
}

/** 中文侧的 xxxZh 与英文侧的 xxx 是同一个参数，比较前归一 */
function normalizeZhPlaceholders(set) {
  return new Set([...set].map((p) => (p.length > 2 && p.endsWith('Zh') ? p.slice(0, -2) : p)))
}

const zh = loadLanguage('zhCN')
const en = loadLanguage('enUS')

const errors = []
const warnings = []

// 1. 占位符必须是纯标识符（模板里不能写表达式）
for (const [lang, { entries }] of [['zhCN', zh], ['enUS', en]]) {
  for (const [key, entry] of entries) {
    for (const placeholder of findPlaceholders(entry.value)) {
      if (!IDENTIFIER.test(placeholder)) {
        errors.push({
          kind: '表达式占位符',
          key,
          lang,
          file: entry.file,
          line: entry.line,
          detail: `{${placeholder}} 不是参数名，t() 无法替换，界面上会原样显示花括号`,
        })
      }
    }
  }
}

// 2. 中英占位符集合一致（中文侧先做 Zh 归一）
for (const [key, zhEntry] of zh.entries) {
  const enEntry = en.entries.get(key)
  if (!enEntry) continue

  const zhSet = normalizeZhPlaceholders(findPlaceholders(zhEntry.value))
  const enSet = findPlaceholders(enEntry.value)
  const missingInEn = [...zhSet].filter((p) => !enSet.has(p))
  const missingInZh = [...enSet].filter((p) => !zhSet.has(p))

  if (missingInEn.length || missingInZh.length) {
    errors.push({
      kind: '中英占位符不一致',
      key,
      lang: 'zhCN/enUS',
      file: zhEntry.file,
      line: zhEntry.line,
      detail: [
        missingInEn.length ? `英文缺少 {${missingInEn.join('} {')}}` : '',
        missingInZh.length ? `中文缺少 {${missingInZh.join('} {')}}` : '',
      ].filter(Boolean).join('；'),
    })
  }
}

// 3. 跨语言、跨域重名只提示，不阻断
for (const [lang, { duplicates }] of [['zhCN', zh], ['enUS', en]]) {
  for (const d of duplicates) {
    warnings.push({
      kind: '重复键',
      key: d.key,
      lang,
      file: d.file,
      line: d.line,
      detail: `与 ${d.first.file}:${d.first.line} 重名，后者会被前者或本文件覆盖`,
    })
  }
}

const onlyZh = [...zh.entries.keys()].filter((k) => !en.entries.has(k))
const onlyEn = [...en.entries.keys()].filter((k) => !zh.entries.has(k))
for (const key of onlyZh) {
  const e = zh.entries.get(key)
  warnings.push({ kind: '缺失英文', key, lang: 'zhCN', file: e.file, line: e.line, detail: '英文侧无此键，切到英文会显示原始 key' })
}
for (const key of onlyEn) {
  const e = en.entries.get(key)
  warnings.push({ kind: '缺失中文', key, lang: 'enUS', file: e.file, line: e.line, detail: '中文侧无此键，切到中文会退回英文文案' })
}

// ---- 输出 ----
console.log(`扫描 ${zh.entries.size} 条中文、${en.entries.size} 条英文文案`)

const report = (list) => {
  for (const e of list) {
    console.log(`\n  [${e.kind}] ${e.key}`)
    console.log(`    ${e.lang}  ${e.file}:${e.line}`)
    console.log(`    ${e.detail}`)
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} 个 error：`)
  report(errors)
}

if (warnings.length) {
  console.log(`\n! ${warnings.length} 个 warning：`)
  report(warnings)
}

if (errors.length === 0) {
  console.log('\n✓ 占位符检查通过')
  process.exit(0)
}

console.error(
  '\n模板里的 {...} 只能是参数名，不能写表达式或属性访问；' +
  '中英两份模板的占位符也必须对得上（中文可用 {nameZh} 对应英文的 {name}）。',
)
process.exit(1)

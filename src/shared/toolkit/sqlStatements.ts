/**
 * SQL 脚本切分
 *
 * 场景数据库桥接一次只接受一条语句，多语句脚本必须先切开。
 * 这里按 SQLite 的词法规则扫描，而不是用 `split(';')`：
 * 字符串字面量里带分号是合法且常见的写法（base64 编码的 data URL
 * `data:image/png;base64,...`、正文里的中文分号、生成 SQL 的文本等），
 * 裸切会把一条语句劈成两段，前半段引号不闭合直接报错，
 * 结果是「写库看似成功、数据其实停在旧版本」——这类丢失很难从现象倒查。
 *
 * 规则：
 * - 单引号、双引号、反引号、方括号内的分号不算分隔符；同类引号连写是转义
 * - `--` 行注释与 `/* *\/` 块注释原样保留，其中的分号不参与切分
 * - 切分结果已去掉首尾空白与空语句
 */

/** 引号类字符：三种引号都按成对规则跳过内部内容 */
const QUOTE_CHARS = new Set(["'", '"', '`'])

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  const source = String(sql ?? '')
  const length = source.length

  let current = ''
  let index = 0

  while (index < length) {
    const char = source[index]
    const next = source[index + 1]

    if (QUOTE_CHARS.has(char)) {
      const quote = char
      current += char
      index += 1
      while (index < length) {
        const inner = source[index]
        if (inner === quote) {
          // 同类引号连写（'' 或 ""）是 SQL 的转义写法，成对跳过
          if (source[index + 1] === quote) {
            current += inner + inner
            index += 2
            continue
          }
          current += inner
          index += 1
          break
        }
        current += inner
        index += 1
      }
      continue
    }

    if (char === '[') {
      const end = source.indexOf(']', index + 1)
      if (end === -1) {
        current += source.slice(index)
        index = length
      } else {
        current += source.slice(index, end + 1)
        index = end + 1
      }
      continue
    }

    if (char === '-' && next === '-') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? length : end
      current += source.slice(index, stop)
      index = stop
      continue
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? length : end + 2
      current += source.slice(index, stop)
      index = stop
      continue
    }

    if (char === ';') {
      const statement = current.trim()
      if (statement) statements.push(statement)
      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }

  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements
}

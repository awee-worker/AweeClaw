/**
 * SQL 语句切分测试
 *
 * 覆盖回归场景：场景数据以整页 JSON 覆盖写，图片会被内联成
 * `data:image/png;base64,...`。旧的 `split(';')` 把这条 UPDATE 劈成两段，
 * 前半段引号不闭合直接报错，字段却停在旧值上 —— 表现是「图配上了，稍后又没了」。
 */

import { describe, it, expect } from 'vitest'
import { splitSqlStatements } from '../sqlStatements'

describe('splitSqlStatements', () => {
  it('单条语句原样返回并去掉尾部分号', () => {
    expect(splitSqlStatements("UPDATE t SET a = '1';")).toEqual(["UPDATE t SET a = '1'"])
    expect(splitSqlStatements("UPDATE t SET a = '1'")).toEqual(["UPDATE t SET a = '1'"])
  })

  it('字符串字面量里的分号不参与切分', () => {
    const sql = `UPDATE proto_page SET root_json = '{"src":"data:image/png;base64,iVBORw0KGgo="}' WHERE id = 'p1';`
    const result = splitSqlStatements(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(result[0].endsWith("WHERE id = 'p1'")).toBe(true)
  })

  it('多张内联图片与中文正文里的分号都保留在语句内', () => {
    const sql = `UPDATE t SET j = '{"a":"data:image/jpeg;base64,AAA","b":"data:image/png;base64,BBB","c":"步骤一；步骤二"}';`
    expect(splitSqlStatements(sql)).toHaveLength(1)
  })

  it('同类引号连写按转义处理', () => {
    const sql = "UPDATE t SET a = 'it''s; fine'; SELECT 1;"
    expect(splitSqlStatements(sql)).toEqual(["UPDATE t SET a = 'it''s; fine'", 'SELECT 1'])
  })

  it('多条语句按顶层分号切开', () => {
    const sql = 'CREATE TABLE a (id TEXT); INSERT INTO a VALUES (\'x\'); SELECT * FROM a;'
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE a (id TEXT)',
      "INSERT INTO a VALUES ('x')",
      'SELECT * FROM a',
    ])
  })

  it('行注释与块注释里的分号不切分', () => {
    const sql = 'SELECT 1; -- 说明; 不要切\n/* 块; 注释 */ SELECT 2;'
    const result = splitSqlStatements(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('SELECT 1')
    expect(result[1]).toContain('SELECT 2')
  })

  it('方括号标识符里的分号不切分', () => {
    expect(splitSqlStatements("SELECT [a;b] FROM t")).toEqual(['SELECT [a;b] FROM t'])
  })

  it('空脚本与纯分号不产生语句', () => {
    expect(splitSqlStatements('')).toEqual([])
    expect(splitSqlStatements(' ; ; ')).toEqual([])
  })

  it('引号未闭合时整段保留，交给 SQLite 报错', () => {
    expect(splitSqlStatements("UPDATE t SET a = 'oops")).toEqual(["UPDATE t SET a = 'oops"])
  })
})

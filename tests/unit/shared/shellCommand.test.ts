/**
 * Shell 命令结构化解析（@shared/configuration/shellCommand）
 *
 * 覆盖边界：分段的分隔符与引号语义、命令替换提取（含嵌套与未闭合）、
 * 命令名提取（环境变量前缀 / 路径 / 纯赋值段）。
 */

import { describe, it, expect } from 'vitest'
import {
  collectCommandNames,
  extractSegmentCommandName,
  extractSubstitutions,
  splitCommandSegments,
} from '../../../src/shared/configuration/shellCommand'

describe('splitCommandSegments', () => {
  it('按分号、&&、||、管道拆段', () => {
    expect(splitCommandSegments('echo a; rm -rf b')).toHaveLength(2)
    expect(splitCommandSegments('npm i && npm t')).toHaveLength(2)
    expect(splitCommandSegments('a || b')).toHaveLength(2)
    expect(splitCommandSegments('cat x | tail -1')).toHaveLength(2)
  })

  it('引号内的分隔符不拆段', () => {
    expect(splitCommandSegments('echo "a; b | c"')).toHaveLength(1)
    expect(splitCommandSegments("echo 'a; b'")).toHaveLength(1)
  })

  it('命令替换整体折叠，不因内部管道拆碎外层', () => {
    const segments = splitCommandSegments('echo "$(cat a | tail -1)"')
    expect(segments).toHaveLength(1)
  })

  it('空命令返回空数组', () => {
    expect(splitCommandSegments('   ')).toHaveLength(0)
  })
})

describe('extractSubstitutions', () => {
  it('提取 $() 与反引号内容', () => {
    expect(extractSubstitutions('echo "$(date +%F)"')).toEqual(['date +%F'])
    expect(extractSubstitutions('echo `date`')).toEqual(['date'])
  })

  it('单引号内是字面量，不提取', () => {
    expect(extractSubstitutions("echo '$(date)'")).toEqual([])
  })

  it('嵌套替换逐层返回', () => {
    const found = extractSubstitutions('echo "$(echo "$(date)")"')
    expect(found).toContain('date')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('未闭合的替换不抛异常', () => {
    expect(() => extractSubstitutions('echo $(date')).not.toThrow()
    expect(extractSubstitutions('echo $(date')).toEqual([])
  })
})

describe('命令名提取', () => {
  it('去掉环境变量前缀', () => {
    expect(extractSegmentCommandName('FOO=1 BAR=2 npm test')).toBe('npm')
  })

  it('去掉可执行文件路径', () => {
    expect(extractSegmentCommandName('/usr/bin/git status')).toBe('git')
  })

  it('纯赋值段返回空串', () => {
    expect(extractSegmentCommandName('r=$(lsof -i:8080)')).toBe('')
  })

  it('collectCommandNames 汇总各段与替换体内的命令', () => {
    const names = collectCommandNames('r=$(lsof -i:8080); echo "$(date)"')
    expect(names).toContain('echo')
    expect(names).toContain('lsof')
    expect(names).toContain('date')
  })
})

import { describe, expect, it } from 'vitest'
import { splitMarkdownBlocks } from '../markdownBlocks'

describe('splitMarkdownBlocks', () => {
  it('按空行切分普通段落', () => {
    expect(splitMarkdownBlocks('第一段\n\n第二段\n\n第三段')).toEqual([
      '第一段\n',
      '第二段\n',
      '第三段',
    ])
  })

  it('空白内容不产生块', () => {
    expect(splitMarkdownBlocks('')).toEqual([])
    expect(splitMarkdownBlocks('\n\n')).toEqual([])
    expect(splitMarkdownBlocks('   \n\n  ')).toEqual([])
  })

  it('围栏代码块内部的空行不切分', () => {
    const blocks = splitMarkdownBlocks('说明\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n结尾')

    expect(blocks).toHaveLength(3)
    expect(blocks[1]).toContain('const a = 1')
    expect(blocks[1]).toContain('const b = 2')
    expect(blocks[2]).toBe('结尾')
  })

  it('未闭合的围栏不会把后续内容切碎', () => {
    const blocks = splitMarkdownBlocks('说明\n\n```ts\n第一行\n\n第二行\n\n第三行')

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toContain('第三行')
  })

  it('波浪号围栏同样受保护', () => {
    const blocks = splitMarkdownBlocks('说明\n\n~~~\n第一行\n\n第二行\n~~~\n\n结尾')

    expect(blocks).toHaveLength(3)
    expect(blocks[1]).toContain('第二行')
  })

  it('松散列表不会被空行拆开', () => {
    const blocks = splitMarkdownBlocks('前言\n\n- 项目一\n\n- 项目二\n\n收尾')

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toContain('项目一')
    expect(blocks[1]).toContain('项目二')
  })

  it('多行引用不会被空行拆开', () => {
    const blocks = splitMarkdownBlocks('前言\n\n> 第一行\n>\n> 第二行\n\n后段')

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toContain('第二行')
    expect(blocks[1]).toContain('后段')
  })

  it('数学块内部的空行不切分', () => {
    const blocks = splitMarkdownBlocks('前言\n\n$$\na = b\n\nc = d\n$$\n\n后段')

    expect(blocks).toHaveLength(3)
    expect(blocks[1]).toContain('a = b')
    expect(blocks[1]).toContain('c = d')
    expect(blocks[2]).toBe('后段')
  })


  it('表格行被视为结构续行，不会在表格后立即切分', () => {
    const blocks = splitMarkdownBlocks('| a | b |\n| - | - |\n| 1 | 2 |\n\n后段')

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('| 1 | 2 |')
    expect(blocks[0]).toContain('后段')
  })

  it('缩进代码块与其后的内容保持在同一块', () => {
    const blocks = splitMarkdownBlocks('前言\n\n    缩进代码\n\n后段')

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toContain('缩进代码')
    expect(blocks[1]).toContain('后段')
  })

  it('HTML 标签行不会与其后的内容分离', () => {
    const blocks = splitMarkdownBlocks('前言\n\n<div>\n\n内容\n\n</div>\n\n后段')

    expect(blocks[0]).toBe('前言\n')
    expect(blocks[1]).toContain('<div>')
    expect(blocks[1]).toContain('内容')
  })

  it('切分后重新拼接可完整还原原文', () => {
    const samples = [
      '第一段\n\n第二段\n\n第三段',
      '说明\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n结尾',
      '前言\n\n- 项目一\n\n- 项目二\n\n收尾',
      '前言\n\n> 第一行\n>\n> 第二行\n\n后段',
      '| a | b |\n| - | - |\n| 1 | 2 |\n\n后段',
      '前言\n\n$$\na = b\n\nc = d\n$$\n\n后段',
      '前言\n\n<div>\n\n内容\n\n</div>\n\n后段',
      'A\n\n\n\nB',
      'A\n\nB\n',
      '单段无空行',
    ]

    for (const sample of samples) {
      // 切分只负责分段，不得丢弃或改写任何字符
      expect(splitMarkdownBlocks(sample).join('\n')).toBe(sample)
    }
  })
})

describe('splitMarkdownBlocks 前缀稳定性', () => {
  /**
   * 除最后一块外，已生成的块内容必须逐字不变。
   * 这是分块渲染能复用已完成块的前提：一旦前缀块内容变化，记忆化失效，
   * 优化就退化成「每帧重新解析全文」。
   */
  function expectPrefixStable(previous: string[], current: string[]): void {
    const stableCount = Math.max(0, previous.length - 1)
    expect(current.slice(0, stableCount)).toEqual(previous.slice(0, stableCount))
  }

  it('单次追加后已生成的块不变', () => {
    const base = '第一段内容\n\n第二段内容'
    const previous = splitMarkdownBlocks(base)

    expectPrefixStable(previous, splitMarkdownBlocks(`${base}\n\n第三段内容`))
  })

  it('多轮追加过程中前缀始终稳定', () => {
    const chunks = [
      '\n\n第二段',
      '\n\n- 列表项',
      '\n\n### 标题',
      '\n\n| a | b |\n| - | - |\n| 1 | 2 |',
      '\n\n```ts\nconst x = 1\n```',
      '\n\n> 引用内容',
      '\n\n结尾',
    ]

    let text = '开头段落'
    let previous = splitMarkdownBlocks(text)

    for (const chunk of chunks) {
      text += chunk
      const current = splitMarkdownBlocks(text)
      expectPrefixStable(previous, current)
      previous = current
    }
  })

  it('逐字符累积时前缀始终稳定', () => {
    const full = '第一段文字\n\n```ts\ncode line\n```\n\n- 列表\n\n结尾段落'
    let previous = splitMarkdownBlocks('')

    for (let i = 1; i <= full.length; i++) {
      const current = splitMarkdownBlocks(full.slice(0, i))
      expectPrefixStable(previous, current)
      previous = current
    }
  })
})

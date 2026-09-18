import { describe, expect, it } from 'vitest'
import {
  containsEmotionTags,
  convertLineBreaks,
  preprocessUrls,
} from '../textPreprocessor'

describe('preprocessUrls', () => {
  it('把裸 URL 转成 Markdown 链接', () => {
    expect(preprocessUrls('见 https://example.com/a 说明')).toBe(
      '见 [https://example.com/a](https://example.com/a) 说明',
    )
  })

  it('同一条文本里的多个 URL 全部转换', () => {
    expect(preprocessUrls('a https://a.com b https://b.com')).toBe(
      'a [https://a.com](https://a.com) b [https://b.com](https://b.com)',
    )
  })

  it('不含 http 的文本原样返回', () => {
    const text = '这是一段普通正文，没有任何链接。'
    expect(preprocessUrls(text)).toBe(text)
  })

  it('围栏代码块内的 URL 不转换', () => {
    const text = '```\nhttps://example.com/a\n```'
    expect(preprocessUrls(text)).toBe(text)
  })

  it('行内代码中的 URL 不转换', () => {
    const text = '用 `https://example.com/a` 访问'
    expect(preprocessUrls(text)).toBe(text)
  })

  it('已是 Markdown 链接的 URL 不重复包装', () => {
    const text = '[x](https://example.com/a)'
    expect(preprocessUrls(text)).toBe(text)
  })

  it('被括号包裹的 URL 不处理', () => {
    const text = '(https://example.com/a)'
    expect(preprocessUrls(text)).toBe(text)
  })

  it('代码块之后出现的裸 URL 仍会被转换', () => {
    expect(preprocessUrls('```\ncode\n```\n\n见 https://example.com/a')).toBe(
      '```\ncode\n```\n\n见 [https://example.com/a](https://example.com/a)',
    )
  })
})

describe('convertLineBreaks', () => {
  it('普通文本行尾追加硬换行标记', () => {
    expect(convertLineBreaks('第一行\n第二行')).toBe('第一行  \n第二行  ')
  })

  it('空行不追加标记', () => {
    expect(convertLineBreaks('a\n\nb')).toBe('a  \n\nb  ')
  })

  it('Markdown 结构行不追加标记', () => {
    expect(convertLineBreaks('# 标题')).toBe('# 标题')
    expect(convertLineBreaks('- 项目')).toBe('- 项目')
    expect(convertLineBreaks('1. 项目')).toBe('1. 项目')
    expect(convertLineBreaks('> 引用')).toBe('> 引用')
    expect(convertLineBreaks('---')).toBe('---')
    expect(convertLineBreaks('| a | b |')).toBe('| a | b |')
  })

  it('列表行允许前导空白', () => {
    expect(convertLineBreaks('  - 项目')).toBe('  - 项目')
    expect(convertLineBreaks('  1. 项目')).toBe('  1. 项目')
  })

  it('带前导空白的引用行不算结构行（沿用既有判定）', () => {
    expect(convertLineBreaks('  > 引用')).toBe('  > 引用  ')
  })

  it('代码块内部不追加标记', () => {
    expect(convertLineBreaks('```\ncode\n```')).toBe('```\ncode\n```')
  })
})

describe('containsEmotionTags', () => {
  it('识别 [emo:xxx] 与 :xxx: 两种标记', () => {
    expect(containsEmotionTags('[emo:开心]')).toBe(true)
    expect(containsEmotionTags('你好 :happy:')).toBe(true)
  })

  it('既无方括号也无比冒号的普通正文直接判否', () => {
    expect(containsEmotionTags('这是一段普通正文')).toBe(false)
  })

  it('只出现单个冒号时不算表情标记', () => {
    expect(containsEmotionTags('时间 12:30 了')).toBe(false)
  })
})

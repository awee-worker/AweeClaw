import { describe, expect, it } from 'vitest'
import { IncrementalBlockSplitter, splitMarkdownBlocks } from '../markdownBlocks'
import { IncrementalTextCleaner } from '../incrementalTextCleaner'
import {
  containsEmotionTags,
  convertLineBreaks,
  preprocessUrls,
  replaceEmotionTagsWithHtml,
} from '../textPreprocessor'
import { stripToolCallLeaks } from '@intelligence/utils/toolCallSanitizer'

/**
 * 增量实现必须与全文实现等价，否则「快」就失去意义。
 * 这里的做法是逐字符喂养增量版本，每一步都与全文版本逐字比对。
 */

const SPLIT_SAMPLES = [
  '第一段\n\n第二段\n\n第三段',
  '说明\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n结尾',
  '说明\n\n```ts\n第一行\n\n第二行\n\n第三行',
  '前言\n\n- 项目一\n\n- 项目二\n\n收尾',
  '前言\n\n> 第一行\n>\n> 第二行\n\n后段',
  '| a | b |\n| - | - |\n| 1 | 2 |\n\n后段',
  '前言\n\n$$\na = b\n\nc = d\n$$\n\n后段',
  '前言\n\n<div>\n\n内容\n\n</div>\n\n后段',
  '前言\n\n    缩进代码\n\n后段',
  'A\n\n\n\nB',
  'A\n\nB\n',
  '   \n\n  ',
  '单段无空行',
]

describe('IncrementalBlockSplitter', () => {
  it('逐字符推入时结果与全文分块完全一致', () => {
    for (const sample of SPLIT_SAMPLES) {
      const splitter = new IncrementalBlockSplitter()

      for (let i = 1; i <= sample.length; i++) {
        const prefix = sample.slice(0, i)
        expect(splitter.update(prefix), `sample=${JSON.stringify(sample)} i=${i}`).toEqual(
          splitMarkdownBlocks(prefix),
        )
      }
    }
  })

  it('分片追加时结果与全文分块完全一致', () => {
    const sample = SPLIT_SAMPLES.join('\n\n')

    for (const chunkSize of [1, 3, 7, 16, 64]) {
      const splitter = new IncrementalBlockSplitter()
      for (let i = 0; i < sample.length; i += chunkSize) {
        const prefix = sample.slice(0, Math.min(sample.length, i + chunkSize))
        expect(splitter.update(prefix)).toEqual(splitMarkdownBlocks(prefix))
      }
    }
  })

  it('已提交的块在后续追加中逐字不变', () => {
    const splitter = new IncrementalBlockSplitter()
    const chunks = [
      '第一段\n\n第二段\n\n第三段',
      '\n\n第四段',
      '\n\n- 列表项',
      '\n\n```ts\ncode\n```',
      '\n\n结尾',
    ]

    let text = ''
    let previous: string[] = []

    for (const chunk of chunks) {
      text += chunk
      const current = splitter.update(text)

      // 既与全文分块一致，也保证前缀块未被改写（记忆化复用的前提）
      expect(current).toEqual(splitMarkdownBlocks(text))
      const stable = Math.max(0, previous.length - 1)
      expect(current.slice(0, stable)).toEqual(previous.slice(0, stable))
      previous = current
    }
  })

  it('内容被改写（非只追加）时退化为全量重扫', () => {
    const splitter = new IncrementalBlockSplitter()
    splitter.update('第一段\n\n第二段')

    // 长度回退且前缀不同：必须识别为改写，而不能把旧块带过来
    expect(splitter.update('完全不同的内容')).toEqual(splitMarkdownBlocks('完全不同的内容'))
    expect(splitter.update('')).toEqual([])
  })

  it('空内容不产生块', () => {
    const splitter = new IncrementalBlockSplitter()
    expect(splitter.update('')).toEqual([])
    expect(splitter.update('\n\n')).toEqual([])
  })
})

/** 全文版清洗链路：增量实现要对齐的基准 */
function referenceClean(
  raw: string,
  options: { streaming: boolean; preserveLineBreaks: boolean },
): string {
  let result = options.streaming ? stripToolCallLeaks(raw) : raw
  result = preprocessUrls(result)
  if (options.preserveLineBreaks) {
    result = convertLineBreaks(result)
  }
  if (containsEmotionTags(result)) {
    result = replaceEmotionTagsWithHtml(result)
  }
  return result
}

const CLEAN_SAMPLES = [
  '见 https://example.com/a 说明',
  '第一行\n第二行\n第三行',
  'a https://a.com b https://b.com',
  '用 `https://example.com/a` 访问，另见 https://b.com/x',
  '[x](https://example.com/a) 与 https://b.com/y',
  '## 标题\n\n- 项目一\n- 项目二\n\n| a | b |\n| - | - |',
  '你好 :happy: 世界\n\n[emo:开心] 后续文字',
  '多行\n\n\n\n空行段落',
  '',
  '\n\n',
]

describe('IncrementalTextCleaner', () => {
  it('逐字符推入时与全文清洗链路一致（保留换行）', () => {
    for (const sample of CLEAN_SAMPLES) {
      for (const streaming of [true, false]) {
        const cleaner = new IncrementalTextCleaner()
        const options = { streaming, preserveLineBreaks: true }

        for (let i = 1; i <= sample.length; i++) {
          const prefix = sample.slice(0, i)
          expect(
            cleaner.update(prefix, options),
            `sample=${JSON.stringify(sample)} streaming=${streaming} i=${i}`,
          ).toBe(referenceClean(prefix, options))
        }
      }
    }
  })

  it('逐字符推入时与全文清洗链路一致（不保留换行）', () => {
    for (const sample of CLEAN_SAMPLES) {
      const cleaner = new IncrementalTextCleaner()
      const options = { streaming: true, preserveLineBreaks: false }

      for (let i = 1; i <= sample.length; i++) {
        const prefix = sample.slice(0, i)
        expect(cleaner.update(prefix, options), `sample=${JSON.stringify(sample)} i=${i}`).toBe(
          referenceClean(prefix, options),
        )
      }
    }
  })

  it('同一输入重复调用结果不变（渲染可能被重复触发）', () => {
    const cleaner = new IncrementalTextCleaner()
    const options = { streaming: true, preserveLineBreaks: true }
    const text = '说明\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n见 https://a.com/b'

    const once = cleaner.update(text, options)
    expect(cleaner.update(text, options)).toBe(once)
    expect(cleaner.update(text, options)).toBe(once)
  })

  it('完整文本（含围栏）与全文清洗链路一致', () => {
    const sample = '```ts\nconst url = "https://example.com"\n```\n\n正文 https://after.com/z'

    for (const streaming of [true, false]) {
      const options = { streaming, preserveLineBreaks: true }
      const cleaner = new IncrementalTextCleaner()
      expect(cleaner.update(sample, options)).toBe(referenceClean(sample, options))
    }
  })

  it('围栏尚未闭合时，围栏内的 URL 不按正文处理', () => {
    // 全文链路靠「已闭合围栏」的正则来保护代码块，围栏还没闭合时保护区间不存在，
    // 于是会把代码文本里的 URL 改写成 [url](url)。增量实现按行判定围栏状态，
    // 未闭合同样是围栏，因此不会把链接语法塞进代码文本——这里固定这一差异。
    const cleaner = new IncrementalTextCleaner()
    const options = { streaming: true, preserveLineBreaks: true }

    expect(cleaner.update('```ts\nconst url = "https://example.com', options)).toBe(
      '```ts\nconst url = "https://example.com',
    )
  })

  it('围栏内的 URL 与换行标记不被改写', () => {
    const cleaner = new IncrementalTextCleaner()
    const options = { streaming: true, preserveLineBreaks: true }

    expect(cleaner.update('```\nhttps://a.com/b\n```', options)).toBe('```\nhttps://a.com/b\n```')
  })

  it('围栏结束后恢复行内处理', () => {
    const cleaner = new IncrementalTextCleaner()
    const options = { streaming: true, preserveLineBreaks: true }

    expect(cleaner.update('```\ncode\n```\n见 https://a.com/b', options)).toBe(
      '```\ncode\n```\n见 [https://a.com/b](https://a.com/b)  ',
    )
  })

  it('流式与非流式切换时重新计算（泄漏标记只在流式期间剥离）', () => {
    const cleaner = new IncrementalTextCleaner()
    const raw = '正文 <tool_call>{"name":"x"}</tool_call> 结尾'

    expect(cleaner.update(raw, { streaming: true, preserveLineBreaks: false })).toBe('正文  结尾')
    expect(cleaner.update(raw, { streaming: false, preserveLineBreaks: false })).toBe(
      referenceClean(raw, { streaming: false, preserveLineBreaks: false }),
    )
  })

  it('内容回退（重新生成）时重置缓存', () => {
    const cleaner = new IncrementalTextCleaner()
    const options = { streaming: true, preserveLineBreaks: true }

    cleaner.update('第一段\n\n第二段\n\n第三段', options)

    const rewritten = '全新的第一段\n\n全新的第二段'
    expect(cleaner.update(rewritten, options)).toBe(referenceClean(rewritten, options))
  })

  it('统计已复用行数，说明增量确实生效', () => {
    const cleaner = new IncrementalTextCleaner()
    const options = { streaming: true, preserveLineBreaks: true }
    const line = '这是一行足够长的正文内容，用来确认复用计数'

    let text = ''
    for (let i = 0; i < 20; i++) {
      text += `${line}${i}\n`
      cleaner.update(text, options)
    }

    // 流式清洗先做一次 trim（剥离泄漏标记那一步的既有行为），末尾换行因此被去掉，
    // 最后一行永远留在「未定稿」状态，只有下一行到达时才定稿。
    // 因此每轮恰好新增 1 行定稿：第 20 轮调用时已定稿 18 行，本轮只需重算 1 行。
    expect(cleaner.reused).toBe(18)
  })
})

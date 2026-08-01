/**
 * AI Web Scraper 插件 - 单元测试
 *
 * 重点测试 HTML→Markdown 转换逻辑（插件最复杂、最易出错的部分），
 * 覆盖各种 HTML 标签、实体解码、主体提取、噪声移除、边界情况。
 *
 * 注：插件 index.js 顶部会调用 getHost() 获取 McpServer/InMemoryTransport/z，
 * 测试需在 import 前设置 globalThis.__AWEECLAW_HOST__ mock。
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ============================================================
// Mock Host 桥（必须在 import 插件前同步设置，因为插件顶层会调用 getHost()）
// ============================================================
;(globalThis as any).__AWEECLAW_HOST__ = {
  // 真实 zod（插件用 z.string() 等构建 schema）
  z,
  // MCP SDK mock（纯函数测试不涉及 MCP 连接）
  McpServer: class McpServer {
    constructor() {}
    tool() {}
    connect() { return Promise.resolve() }
  },
  InMemoryTransport: {
    createLinkedPair: () => [
      { send() {}, close() {} },
      { send() {}, close() {} },
    ],
  },
  logger: {
    mcp: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  },
}

// 动态 import 插件（host mock 已在上方同步设置）
const {
  htmlToMarkdown,
  htmlToText,
  decodeEntities,
  extractMetadata,
  removeNoise,
  extractMainContent,
} = await import(/* @vite-ignore */ '../../../../aweeclaw-plugins/plugins/ai-web-scraper/index.js')

// ============================================================
// 测试用例
// ============================================================

describe('ai-web-scraper: decodeEntities', () => {
  it('解码常见命名实体', () => {
    expect(decodeEntities('&amp;')).toBe('&')
    expect(decodeEntities('&lt;')).toBe('<')
    expect(decodeEntities('&gt;')).toBe('>')
    expect(decodeEntities('&quot;')).toBe('"')
    expect(decodeEntities('&#39;')).toBe("'")
    expect(decodeEntities('&nbsp;')).toBe(' ')
    expect(decodeEntities('&copy;')).toBe('©')
    expect(decodeEntities('&euro;')).toBe('€')
  })

  it('解码左右引号实体（unicode 转义）', () => {
    expect(decodeEntities('&ldquo;')).toBe('\u201C')
    expect(decodeEntities('&rdquo;')).toBe('\u201D')
    expect(decodeEntities('&lsquo;')).toBe('\u2018')
    expect(decodeEntities('&rsquo;')).toBe('\u2019')
  })

  it('解码数字实体（十进制和十六进制）', () => {
    expect(decodeEntities('&#65;')).toBe('A')
    expect(decodeEntities('&#x41;')).toBe('A')
    expect(decodeEntities('&#x263A;')).toBe('☺')
  })

  it('混合实体解码', () => {
    expect(decodeEntities('a &amp; b &lt; c &gt; d')).toBe('a & b < c > d')
    expect(decodeEntities('价格 &pound;100 &euro;200')).toBe('价格 £100 €200')
  })

  it('无实体的文本保持不变', () => {
    expect(decodeEntities('hello world')).toBe('hello world')
    expect(decodeEntities('')).toBe('')
  })
})

describe('ai-web-scraper: removeNoise', () => {
  it('移除 script 标签及内容', () => {
    const html = '<p>text</p><script>alert(1)</script><p>more</p>'
    expect(removeNoise(html)).toBe('<p>text</p><p>more</p>')
  })

  it('移除 style 标签及内容', () => {
    const html = '<style>.a{color:red}</style><p>text</p>'
    expect(removeNoise(html)).toBe('<p>text</p>')
  })

  it('移除 nav/footer/aside/header', () => {
    const html = '<nav>menu</nav><article>content</article><footer>bottom</footer>'
    const result = removeNoise(html)
    expect(result).toContain('content')
    expect(result).not.toContain('menu')
    expect(result).not.toContain('bottom')
  })

  it('移除 HTML 注释', () => {
    const html = '<!-- comment --><p>text</p>'
    expect(removeNoise(html)).toBe('<p>text</p>')
  })

  it('移除 iframe 和 svg', () => {
    const html = '<iframe src="x"></iframe><svg></svg><p>text</p>'
    expect(removeNoise(html)).toBe('<p>text</p>')
  })
})

describe('ai-web-scraper: extractMainContent', () => {
  it('优先提取 article 标签', () => {
    // article 内容需超过 200 字符才会被 extractMainContent 采纳（避免误匹配小 article）
    const longContent = 'article content '.repeat(20)
    const html = `<body><div>nav</div><article><p>${longContent}</p></article></body>`
    const result = extractMainContent(html)
    expect(result).toContain('article content')
    expect(result).not.toContain('nav')
  })

  it('无 article 时提取 main 标签', () => {
    const html = '<body><div>nav</div><main><p>main content</p></main></body>'
    const result = extractMainContent(html)
    expect(result).toContain('main content')
  })

  it('无 article/main 时提取 body', () => {
    const html = '<body><div>fallback content</div></body>'
    const result = extractMainContent(html)
    expect(result).toContain('fallback content')
  })

  it('article 太短时回退到 body', () => {
    const html = '<body><article>短</article><div>这里是更长的主体内容区域用于回退提取</div></body>'
    const result = extractMainContent(html)
    expect(result).toContain('主体内容')
  })
})

describe('ai-web-scraper: extractMetadata', () => {
  it('提取 title', () => {
    const html = '<html><head><title>页面标题</title></head><body></body></html>'
    expect(extractMetadata(html).title).toBe('页面标题')
  })

  it('提取 meta description', () => {
    const html = '<meta name="description" content="页面描述">'
    expect(extractMetadata(html).description).toBe('页面描述')
  })

  it('提取 og:title 作为 title 兜底', () => {
    const html = '<meta property="og:title" content="OG标题">'
    expect(extractMetadata(html).title).toBe('OG标题')
  })

  it('提取 charset', () => {
    const html = '<meta charset="utf-8">'
    expect(extractMetadata(html).charset).toBe('utf-8')
  })

  it('无元数据时返回空字符串', () => {
    const html = '<html><body>content</body></html>'
    const meta = extractMetadata(html)
    expect(meta.title).toBe('')
    expect(meta.description).toBe('')
  })
})

describe('ai-web-scraper: htmlToMarkdown', () => {
  it('转换标题 h1-h6', () => {
    expect(htmlToMarkdown('<h1>标题1</h1>')).toBe('# 标题1')
    expect(htmlToMarkdown('<h2>标题2</h2>')).toBe('## 标题2')
    expect(htmlToMarkdown('<h3>标题3</h3>')).toBe('### 标题3')
    expect(htmlToMarkdown('<h6>标题6</h6>')).toBe('###### 标题6')
  })

  it('转换段落', () => {
    const result = htmlToMarkdown('<p>第一段</p><p>第二段</p>')
    expect(result).toContain('第一段')
    expect(result).toContain('第二段')
    // 两段之间应有空行
    expect(result).toMatch(/第一段\n\n第二段/)
  })

  it('转换链接为 markdown 链接', () => {
    const result = htmlToMarkdown('<a href="https://example.com">链接文本</a>')
    expect(result).toBe('[链接文本](https://example.com)')
  })

  it('转换图片为 markdown 图片', () => {
    const result = htmlToMarkdown('<img src="https://example.com/img.png" alt="图片">')
    expect(result).toBe('![图片](https://example.com/img.png)')
  })

  it('转换无序列表', () => {
    const result = htmlToMarkdown('<ul><li>项目1</li><li>项目2</li></ul>')
    expect(result).toContain('- 项目1')
    expect(result).toContain('- 项目2')
  })

  it('转换有序列表', () => {
    const result = htmlToMarkdown('<ol><li>第一</li><li>第二</li></ol>')
    expect(result).toContain('1. 第一')
    expect(result).toContain('2. 第二')
  })

  it('转换 strong/b 为粗体', () => {
    expect(htmlToMarkdown('<strong>粗体</strong>')).toBe('**粗体**')
    expect(htmlToMarkdown('<b>粗体</b>')).toBe('**粗体**')
  })

  it('转换 em/i 为斜体', () => {
    expect(htmlToMarkdown('<em>斜体</em>')).toBe('*斜体*')
    expect(htmlToMarkdown('<i>斜体</i>')).toBe('*斜体*')
  })

  it('转换行内 code', () => {
    expect(htmlToMarkdown('<code>code</code>')).toBe('`code`')
  })

  it('转换 pre 代码块', () => {
    const result = htmlToMarkdown('<pre>line1\nline2</pre>')
    expect(result).toContain('```')
    expect(result).toContain('line1')
    expect(result).toContain('line2')
  })

  it('转换 blockquote 为引用', () => {
    const result = htmlToMarkdown('<blockquote>引用文本</blockquote>')
    expect(result).toContain('> 引用文本')
  })

  it('转换 hr 为分隔线', () => {
    const result = htmlToMarkdown('<hr>')
    expect(result).toContain('---')
  })

  it('转换 del/strike 为删除线', () => {
    expect(htmlToMarkdown('<del>删除</del>')).toBe('~~删除~~')
  })

  it('自动移除 script/style 噪声', () => {
    const result = htmlToMarkdown('<script>alert(1)</script><p>正文</p>')
    expect(result).toBe('正文')
    expect(result).not.toContain('alert')
  })

  it('解码 HTML 实体', () => {
    const result = htmlToMarkdown('<p>a &amp; b</p>')
    expect(result).toBe('a & b')
  })

  it('处理嵌套标签', () => {
    const result = htmlToMarkdown('<p>这是<strong>粗体</strong>文本</p>')
    expect(result).toContain('**粗体**')
    expect(result).toContain('这是')
    expect(result).toContain('文本')
  })

  it('处理完整 HTML 页面', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>测试页</title></head>
      <body>
        <nav>导航菜单</nav>
        <article>
          <h1>文章标题</h1>
          <p>这是<strong>正文</strong>内容，包含<a href="https://example.com">链接</a>。</p>
          <ul><li>列表项1</li><li>列表项2</li></ul>
        </article>
        <footer>页脚信息</footer>
      </body>
      </html>
    `
    const result = htmlToMarkdown(html)
    expect(result).toContain('# 文章标题')
    expect(result).toContain('**正文**')
    expect(result).toContain('[链接](https://example.com)')
    expect(result).toContain('- 列表项1')
    expect(result).not.toContain('导航菜单')
    expect(result).not.toContain('页脚信息')
  })

  it('空 HTML 返回空字符串', () => {
    expect(htmlToMarkdown('')).toBe('')
  })

  it('纯文本（无标签）保持不变', () => {
    expect(htmlToMarkdown('just plain text')).toBe('just plain text')
  })

  it('压缩多余空白', () => {
    const result = htmlToMarkdown('<p>  多余空格  </p>')
    expect(result).toBe('多余空格')
  })
})

describe('ai-web-scraper: htmlToText', () => {
  it('移除所有标签保留文本', () => {
    const result = htmlToText('<p>段落</p><strong>粗体</strong>')
    expect(result).toContain('段落')
    expect(result).toContain('粗体')
    expect(result).not.toContain('<')
  })

  it('移除 script 内容', () => {
    const result = htmlToText('<script>alert(1)</script><p>正文</p>')
    expect(result).toBe('正文')
  })

  it('解码实体', () => {
    const result = htmlToText('<p>a &amp; b</p>')
    expect(result).toBe('a & b')
  })
})

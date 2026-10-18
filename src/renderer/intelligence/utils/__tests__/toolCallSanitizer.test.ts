import { describe, expect, it } from 'vitest'
import { filterToolCallLeakChunk, flushToolCallLeakBuffer, stripToolCallLeaks } from '../toolCallSanitizer'

describe('stripToolCallLeaks', () => {
  it('普通正文只去首尾空白', () => {
    expect(stripToolCallLeaks('  正常回答内容  ')).toBe('正常回答内容')
  })

  it('空输入返回空串', () => {
    expect(stripToolCallLeaks('')).toBe('')
  })

  it('包含尖括号但不是标签的文本不被改动', () => {
    expect(stripToolCallLeaks('比较 a < b 的结果')).toBe('比较 a < b 的结果')
  })

  it('移除完整闭合的工具调用块', () => {
    expect(stripToolCallLeaks('前文<tool_call>{"name":"x"}</tool_call>后文')).toBe('前文后文')
  })

  it('移除未闭合的开标签及其后的全部内容', () => {
    expect(stripToolCallLeaks('前文<tool_call>{"name":"x"}')).toBe('前文')
  })

  it('带属性的开标签同样被移除', () => {
    expect(stripToolCallLeaks('a<tool_call id="1">x</tool_call>b')).toBe('ab')
  })

  it('覆盖 tool_calls / function_call / function_calls 标签名', () => {
    expect(stripToolCallLeaks('a<tool_calls>[]</tool_calls>b')).toBe('ab')
    expect(stripToolCallLeaks('a<function_call>[]</function_call>b')).toBe('ab')
    expect(stripToolCallLeaks('a<function_calls>[]</function_calls>b')).toBe('ab')
  })

  it('只出现标签名前缀时不误删内容', () => {
    expect(stripToolCallLeaks('a<tool_calling>b')).toBe('a<tool_calling>b')
  })

  it('只清理泄漏标签，保留同一段文本里的其它标签', () => {
    expect(stripToolCallLeaks('a<tool_call>x</tool_call><b>粗体</b>')).toBe('a<b>粗体</b>')
  })

  it('移除孤立的闭合标签残片', () => {
    expect(stripToolCallLeaks('正文已结束</tool_call>')).toBe('正文已结束')
    expect(stripToolCallLeaks('a</function_calls>b')).toBe('ab')
  })

  it('移除模型结束符残片', () => {
    expect(stripToolCallLeaks('回答完毕</s>')).toBe('回答完毕')
    expect(stripToolCallLeaks('回答完毕<|im_end|>')).toBe('回答完毕')
    expect(stripToolCallLeaks('回答完毕<|endoftext|>')).toBe('回答完毕')
  })

  it('清掉末尾被截断的标签残片', () => {
    expect(stripToolCallLeaks('回答完毕</')).toBe('回答完毕')
    expect(stripToolCallLeaks('回答完毕</too')).toBe('回答完毕')
    expect(stripToolCallLeaks('回答完毕<|im_en')).toBe('回答完毕')
    expect(stripToolCallLeaks('回答完毕<')).toBe('回答完毕')
  })

  it('末尾残片规则不波及正文中间的尖括号', () => {
    expect(stripToolCallLeaks('比较 a < b 的结果')).toBe('比较 a < b 的结果')
    expect(stripToolCallLeaks('a < b\n后面还有内容')).toBe('a < b\n后面还有内容')
    expect(stripToolCallLeaks('见 <README 文件')).toBe('见 <README 文件')
  })
})

describe('filterToolCallLeakChunk', () => {
  it('跨块未闭合的标签进入缓冲而不是直接输出', () => {
    const chunk = filterToolCallLeakChunk('a<tool_call>')
    expect(chunk.visibleText).toBe('a')
    expect(chunk.buffer).toBe('<tool_call>')
  })

  it('缓冲与后续块拼合后整段被吞掉', () => {
    const first = filterToolCallLeakChunk('a<tool_call>')
    const second = filterToolCallLeakChunk('</tool_call>b', first.buffer)
    expect(second.visibleText).toBe('b')
    expect(second.buffer).toBe('')
  })

  it('不含标签的块原样输出且不留缓冲', () => {
    const chunk = filterToolCallLeakChunk('普通文本')
    expect(chunk.visibleText).toBe('普通文本')
    expect(chunk.buffer).toBe('')
  })

  it('末尾单独的尖括号进入缓冲而不是输出', () => {
    const chunk = filterToolCallLeakChunk('一段回答<')
    expect(chunk.visibleText).toBe('一段回答')
    expect(chunk.buffer).toBe('<')
  })

  it('末尾的标签名前缀进入缓冲，补齐后正常输出', () => {
    const first = filterToolCallLeakChunk('响应结束<tool_c')
    expect(first.visibleText).toBe('响应结束')
    expect(first.buffer).toBe('<tool_c')

    const second = filterToolCallLeakChunk('alling>不是标签', first.buffer)
    expect(second.visibleText).toBe('<tool_calling>不是标签')
    expect(second.buffer).toBe('')
  })

  it('不是标签名的尖括号内容照常输出', () => {
    const chunk = filterToolCallLeakChunk('比较 a <b 与 c')
    expect(chunk.visibleText).toBe('比较 a <b 与 c')
    expect(chunk.buffer).toBe('')
  })

  it('闭合标签前缀进入缓冲，补齐后连同标签一起被吞掉', () => {
    const first = filterToolCallLeakChunk('正文</')
    expect(first.visibleText).toBe('正文')
    expect(first.buffer).toBe('</')

    const second = filterToolCallLeakChunk('tool_call>尾巴', first.buffer)
    expect(second.visibleText).toBe('尾巴')
    expect(second.buffer).toBe('')
  })

  it('模型结束符前缀进入缓冲而不是先输出残片', () => {
    const first = filterToolCallLeakChunk('回答完毕<|im')
    expect(first.visibleText).toBe('回答完毕')
    expect(first.buffer).toBe('<|im')

    const second = filterToolCallLeakChunk('_end|>尾巴', first.buffer)
    expect(second.visibleText).toBe('尾巴')
    expect(second.buffer).toBe('')
  })

  it('完整的孤立闭合标签在同一块内被清掉', () => {
    const chunk = filterToolCallLeakChunk('正文</tool_calls>尾巴')
    expect(chunk.visibleText).toBe('正文尾巴')
    expect(chunk.buffer).toBe('')
  })
})

describe('flushToolCallLeakBuffer', () => {
  it('空缓冲不产出内容', () => {
    expect(flushToolCallLeakBuffer('')).toBe('')
  })

  it('纯标签残片整体丢弃', () => {
    expect(flushToolCallLeakBuffer('</')).toBe('')
    expect(flushToolCallLeakBuffer('</tool_ca')).toBe('')
    expect(flushToolCallLeakBuffer('<|im_en')).toBe('')
    expect(flushToolCallLeakBuffer('<')).toBe('')
  })

  it('缓冲里被误拦的正文照常输出', () => {
    expect(flushToolCallLeakBuffer('正文<')).toBe('正文')
  })

  it('未闭合的工具调用块不冲进正文', () => {
    expect(flushToolCallLeakBuffer('<tool_call>{"name":"x"')).toBe('')
    expect(flushToolCallLeakBuffer('<function_calls>[{"name":"y"}]')).toBe('')
  })

  it('流结束在闭合标签前缀处时，正文不会随之丢失', () => {
    // 模拟真实场景：末块切在 `原实现若先把 `</` 处，之后流就结束了
    const chunk = filterToolCallLeakChunk('原实现若先把 `</')
    expect(chunk.visibleText).toBe('原实现若先把 `')
    expect(chunk.buffer).toBe('</')

    // 冲刷后正文完整保留，只有残片被丢弃
    expect(flushToolCallLeakBuffer(chunk.buffer)).toBe('')
    expect(chunk.visibleText + flushToolCallLeakBuffer(chunk.buffer)).toBe('原实现若先把 `')
  })
})

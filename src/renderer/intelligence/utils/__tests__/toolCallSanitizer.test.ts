import { describe, expect, it } from 'vitest'
import { filterToolCallLeakChunk, stripToolCallLeaks } from '../toolCallSanitizer'

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
})

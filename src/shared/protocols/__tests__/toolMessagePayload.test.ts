/**
 * 三通道分离的守门测试
 *
 * 保护的是一条不该被顺手破坏的约束：工具结果里的 `record` 只进运行记录，
 * 永远不进模型上下文。一旦泄漏，截屏帧会直接把上下文撑爆。
 */
import { describe, it, expect } from 'vitest'
import { buildToolMessagePayload } from '../toolMessagePayload'

describe('buildToolMessagePayload', () => {
  it('只带 content，不带 record / changed / screenElements', () => {
    const payload = buildToolMessagePayload('call_1', 'screenshot', {
      content: 'captured',
      record: { frames: ['base64-frame-1', 'base64-frame-2'] },
      changed: true,
      screenElements: [{ id: 1, text: 'button' }],
    })

    expect(payload).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'screenshot',
      content: 'captured',
    })
    // 显式断言：这三个字段一个都不能出现在消息上
    expect('record' in payload).toBe(false)
    expect('changed' in payload).toBe(false)
    expect('screenElements' in payload).toBe(false)
  })

  it('内容原样保留，不做截断或改写', () => {
    const longContent = 'x'.repeat(5000)
    const payload = buildToolMessagePayload('call_2', 'read_file', { content: longContent })
    expect(payload.content).toBe(longContent)
  })
})

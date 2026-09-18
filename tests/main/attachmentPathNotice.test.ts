import { describe, expect, it } from 'vitest'
import { MessageConverter } from '@modules/ai-provider/core/MessageAdapter'

const converter = new MessageConverter()

const IMAGE_PATH = '/Users/demo/project/.aweeclaw/uploads/1734567890_photo.png'

function convertUserParts(parts: unknown[]) {
  const result = converter.convert([
    { role: 'user', content: parts } as any,
  ])
  const message = result.find(m => m.role === 'user')
  expect(message).toBeDefined()
  return (message as { content: unknown }).content as Array<Record<string, unknown>>
}

describe('MessageConverter attachment path notice', () => {
  it('sends the absolute path alongside image pixels', () => {
    const content = convertUserParts([
      { type: 'text', text: '帮我把这张图建成 3D 模型' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        localPath: IMAGE_PATH,
        fileName: 'photo.png',
      },
    ])

    // 图片像素照常发出
    const imagePart = content.find(p => (p as { type?: string }).type === 'image')
    expect(imagePart).toBeDefined()

    // 路径必须随消息一并给出，且位于图片之前
    const imageIndex = content.findIndex(p => (p as { type?: string }).type === 'image')
    const pathIndex = content.findIndex(p => typeof p.text === 'string' && p.text.includes(IMAGE_PATH))
    expect(pathIndex).toBeGreaterThanOrEqual(0)
    expect(pathIndex).toBeLessThan(imageIndex)

    // 明确禁止去上传目录里挑"最新的一张"
    expect(content[pathIndex].text as string).toContain('do not scan the uploads directory')
  })

  it('keeps the path notice for reference-only images without pixels', () => {
    const content = convertUserParts([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        referenceOnly: true,
        localPath: IMAGE_PATH,
        fileName: 'photo.png',
      },
    ])

    expect(content.some(p => (p as { type?: string }).type === 'image')).toBe(false)
    const pathPart = content.find(p => typeof p.text === 'string' && p.text.includes(IMAGE_PATH))
    expect(pathPart).toBeDefined()
  })

  it('adds no path noise when the attachment was never persisted', () => {
    const content = convertUserParts([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        fileName: 'photo.png',
      },
    ])

    expect(content).toHaveLength(1)
    expect((content[0] as { type?: string }).type).toBe('image')
  })
})

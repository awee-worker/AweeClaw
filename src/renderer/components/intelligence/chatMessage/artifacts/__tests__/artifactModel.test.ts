/**
 * 会话产物提取逻辑测试
 *
 * 守住三条规则：只认本轮成功调用的产物、只认绝对路径、同一产物不重复成卡。
 */

import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@intelligence/providerTypes'
import { collectArtifacts } from '../artifactModel'

/** 构造一个成功的工具调用 */
function tool(partial: Partial<ToolCall> & Pick<ToolCall, 'name'>): ToolCall {
  return {
    id: partial.name,
    arguments: {},
    status: 'success',
    ...partial,
  } as ToolCall
}

describe('collectArtifacts', () => {
  it('从富内容里提取图片产物，data 直接作为可渲染地址', () => {
    const artifacts = collectArtifacts([
      tool({
        name: 'mcp_plugin_design-image-gen__generate_image',
        richContent: [{ type: 'image', data: 'AAAA', mimeType: 'image/png', title: '海报' }],
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      kind: 'image',
      title: '海报',
      src: 'data:image/png;base64,AAAA',
      sourceTool: 'mcp_plugin_design-image-gen__generate_image',
    })
  })

  it('从结果文本里提取本地视频路径，并转成 local-preview 地址', () => {
    const artifacts = collectArtifacts([
      tool({
        name: 'mcp_plugin_design-video-gen__generate_video',
        result: '视频已保存到 /Users/me/videos/demo.mp4',
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('video')
    expect(artifacts[0].filePath).toBe('/Users/me/videos/demo.mp4')
    // URL 由 `local-preview:///` 拼接编码后的绝对路径得到：编码结果里的 %2F 会被还原，
    // 于是绝对路径的首个 / 与前缀的三个 / 叠加成四个。这与 FilePreviewPanel、
    // GenerateImagePreview 两处既有构造逐字节一致，不要为了「好看」单独改这里。
    expect(artifacts[0].src).toBe('local-preview:////Users/me/videos/demo.mp4')
  })

  it('文档类产物没有渲染地址，交给编辑器打开', () => {
    const artifacts = collectArtifacts([
      tool({ name: 'export_report', result: '{"path":"/Users/me/reports/q3.pdf"}' }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ kind: 'document', src: null })
  })

  it('同一路径只成一张卡', () => {
    const artifacts = collectArtifacts([
      tool({ name: 'generate_video', result: '/Users/me/a.mp4' }),
      tool({ name: 'generate_video_2', result: '/Users/me/a.mp4' }),
    ])

    expect(artifacts).toHaveLength(1)
  })

  it('视图类工具不产出卡片', () => {
    const artifacts = collectArtifacts([
      tool({ name: 'read_file', result: '读取成功 /Users/me/a.png' }),
      tool({ name: 'list_directory', result: '/Users/me/a.png\n/Users/me/b.mp4' }),
    ])

    expect(artifacts).toHaveLength(0)
  })

  it('失败的调用不产出卡片', () => {
    const artifacts = collectArtifacts([
      tool({ name: 'generate_video', status: 'error', result: '/Users/me/a.mp4' }),
    ])

    expect(artifacts).toHaveLength(0)
  })

  it('相对路径与代码文件不算产物', () => {
    const artifacts = collectArtifacts([
      tool({ name: 'some_generator', result: './output/a.png 与 /Users/me/src/index.ts' }),
    ])

    expect(artifacts).toHaveLength(0)
  })

  it('音频与视频能从同一段结果里分别成卡', () => {
    const artifacts = collectArtifacts([
      tool({
        name: 'render_media',
        result: 'audio=/Users/me/a.mp3 video=/Users/me/b.webm',
      }),
    ])

    expect(artifacts.map((a) => a.kind).sort()).toEqual(['audio', 'video'])
  })
})

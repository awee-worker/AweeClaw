/**
 * 预览标签页关闭策略测试
 *
 * 「页面被删除后收起对应标签页」依赖两件事：命中口径要准（删目录要连带收掉目录下的
 * 各个页面），又不能误伤名字相近的兄弟路径。这两条都在这里钉住。
 *
 * 用例之间用不同端口与目录隔离：previewSessionService 是单例，状态会跨用例累积。
 */

import { describe, it, expect } from 'vitest'
import { previewSessionService } from '../previewSessionManager'

describe('预览标签页关闭', () => {
  it('按单个会话关闭会把它从会话表里移除', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15201/', {
      source: 'port-probe',
    })

    expect(previewSessionService.closeSession(session.id, 'test')).toBe(true)
    expect(previewSessionService.getSession(session.id)).toBeNull()
    // 重复关闭无副作用
    expect(previewSessionService.closeSession(session.id, 'test')).toBe(false)
  })

  it('删除页面文件时收掉打开它的标签页', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15202/report.html', {
      previewRoot: '/tmp/awe-preview-one',
      localPath: '/tmp/awe-preview-one/report.html',
    })

    const closed = previewSessionService.closeSessionsUnderPath(
      '/tmp/awe-preview-one/report.html',
      'test',
    )

    expect(closed).toBe(1)
    expect(previewSessionService.getSession(session.id)).toBeNull()
  })

  it('删除目录时目录下打开的各个页面一起收掉', () => {
    const a = previewSessionService.openUrl('http://127.0.0.1:15203/a.html', {
      previewRoot: '/tmp/awe-preview-site',
      localPath: '/tmp/awe-preview-site/a.html',
    })
    const b = previewSessionService.openUrl('http://127.0.0.1:15203/b.html', {
      previewRoot: '/tmp/awe-preview-site',
      localPath: '/tmp/awe-preview-site/b.html',
    })

    const closed = previewSessionService.closeSessionsUnderPath('/tmp/awe-preview-site', 'test')

    expect(closed).toBe(2)
    expect(previewSessionService.getSession(a.id)).toBeNull()
    expect(previewSessionService.getSession(b.id)).toBeNull()
  })

  it('名字相近的兄弟目录不在命中范围内', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15204/index.html', {
      previewRoot: '/tmp/awe-preview-site2',
      localPath: '/tmp/awe-preview-site2/index.html',
    })

    const closed = previewSessionService.closeSessionsUnderPath('/tmp/awe-preview-site', 'test')

    expect(closed).toBe(0)
    expect(previewSessionService.getSession(session.id)).not.toBeNull()
    previewSessionService.closeSession(session.id, 'cleanup')
  })

  it('服务类预览（无本地目标）不受文件删除影响', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15205/', {
      source: 'port-probe',
    })

    const closed = previewSessionService.closeSessionsUnderPath('/tmp/awe-preview-site', 'test')

    expect(closed).toBe(0)
    expect(previewSessionService.getSession(session.id)).not.toBeNull()
    previewSessionService.closeSession(session.id, 'cleanup')
  })
})

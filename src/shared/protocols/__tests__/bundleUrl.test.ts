import { describe, it, expect } from 'vitest'
import { buildLocalFileUrl } from '../bundleUrl'

/**
 * 把构造出的 URL 还原成协议处理器看到的文件路径
 *
 * 与 scenarioBundleProtocol / pluginBundleProtocol 的解析逻辑保持一致：
 * 取 pathname、去掉百分号编码，Windows 再剥掉前导斜杠。
 */
function resolveFileUrl(url: string, platform: 'win32' | 'darwin' | 'linux' = 'linux'): string {
  const pathname = decodeURIComponent(new URL(url).pathname)
  if (platform === 'win32' && pathname.startsWith('/')) {
    return pathname.slice(1)
  }
  return pathname
}

describe('buildLocalFileUrl', () => {
  it('Windows 盘符路径不会被并入 host', () => {
    const url = buildLocalFileUrl(
      'scenario-bundle',
      'C:\\Users\\liwei\\AppData\\Roaming\\AweeClaw\\scenarios\\video-studio',
      'dist/index.js',
    )

    // 盘符跟在 localhost 后面而没有分隔符时，URL 解析会把 host 读成 localhostC，
    // 协议处理器随即在相对路径下找文件并返回 404。
    expect(new URL(url).host).toBe('localhost')
    expect(resolveFileUrl(url, 'win32')).toBe(
      'C:/Users/liwei/AppData/Roaming/AweeClaw/scenarios/video-studio/dist/index.js',
    )
  })

  it('POSIX 路径保持原样且不重复前导斜杠', () => {
    const url = buildLocalFileUrl(
      'scenario-bundle',
      '/Users/liwei/Library/Application Support/AweeClaw/scenarios/video-studio',
      'dist/index.js',
    )

    expect(new URL(url).host).toBe('localhost')
    expect(resolveFileUrl(url, 'darwin')).toBe(
      '/Users/liwei/Library/Application Support/AweeClaw/scenarios/video-studio/dist/index.js',
    )
  })

  it('路径中的中文与空格往返解码后不变', () => {
    const dir = 'C:\\Users\\李伟\\AppData\\Roaming\\AweeClaw\\scenarios\\视频工坊'
    const url = buildLocalFileUrl('scenario-bundle', dir, 'dist/index.js')

    expect(url).not.toContain('李伟')
    expect(resolveFileUrl(url, 'win32')).toBe(
      'C:/Users/李伟/AppData/Roaming/AweeClaw/scenarios/视频工坊/dist/index.js',
    )
  })

  it('# 与 ? 被转义，不会截断路径', () => {
    const dir = 'C:\\Users\\a#b\\scenarios\\q?x'
    const url = buildLocalFileUrl('plugin-bundle', dir, 'ui.js')

    expect(resolveFileUrl(url, 'win32')).toBe('C:/Users/a#b/scenarios/q?x/ui.js')
  })

  it('入口带 ./ 或前导 / 时不会拼出重复分隔符', () => {
    const dir = 'C:\\scenarios\\demo'

    expect(resolveFileUrl(buildLocalFileUrl('scenario-bundle', dir, './dist/index.js'), 'win32')).toBe(
      'C:/scenarios/demo/dist/index.js',
    )
    expect(resolveFileUrl(buildLocalFileUrl('scenario-bundle', dir, '/dist/index.js'), 'win32')).toBe(
      'C:/scenarios/demo/dist/index.js',
    )
  })

  it('入口文件带子目录时保留层级', () => {
    const url = buildLocalFileUrl('plugin-bundle', '/opt/aweeclaw/plugins/demo', 'dist/ui.js')

    expect(resolveFileUrl(url, 'linux')).toBe('/opt/aweeclaw/plugins/demo/dist/ui.js')
  })
})

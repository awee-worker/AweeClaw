import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PluginContributes, PluginRegionNode } from '@shared/plugin-sdk/types'
import type { RegionNode } from '@shared/protocols/scenario-regions'
import { buildPluginRegions } from './pluginRegions'

const PLUGIN_ROOT = '/Users/liwei/.config/aweeclaw/plugins/demo/1.0.0'

/** 相对路径应被拼成 plugin-bundle:// 地址 */
const EXPECTED_BUNDLE_URL = `plugin-bundle://localhost${PLUGIN_ROOT}/sandbox/dashboard.html`

function build(contributes: PluginContributes, primaryPanelId?: string): RegionNode | undefined {
  return buildPluginRegions({
    pluginKey: 'demo',
    pluginRootAbsDir: PLUGIN_ROOT,
    contributes,
    primaryPanelId,
  })
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // 非法声明会输出警告，测试里静音避免污染输出
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('buildPluginRegions - 基本构建', () => {
  it('两种声明都没有时返回 undefined', () => {
    expect(build({})).toBeUndefined()
  })

  it('regions 的分栏结构原样保留', () => {
    const regions = build({
      regions: {
        type: 'split',
        dir: 'row',
        ratio: [2, 1],
        gap: 8,
        className: 'flex gap-2',
        children: [
          { type: 'panel', id: 'demo:list' },
          { type: 'panel', id: 'demo:detail' },
        ],
      },
    })

    expect(regions).toMatchObject({
      type: 'split',
      dir: 'row',
      ratio: [2, 1],
      gap: 8,
      className: 'flex gap-2',
    })
    const root = regions as Extract<RegionNode, { type: 'split' }>
    expect(root.children).toHaveLength(2)
    expect(root.children[0]).toMatchObject({ type: 'panel', id: 'demo:list' })
  })

  it('面板节点自动补上撑满样式', () => {
    const regions = build({ regions: { type: 'panel', id: 'demo:main' } })
    expect(regions).toMatchObject({
      type: 'panel',
      id: 'demo:main',
      className: expect.stringContaining('flex-1'),
    })
  })

  it('面板显式给出的 className 不被覆盖', () => {
    const regions = build({ regions: { type: 'panel', id: 'demo:main', className: 'custom' } })
    expect(regions).toMatchObject({ className: 'custom' })
  })
})

describe('buildPluginRegions - 沙箱地址解析', () => {
  it('相对路径拼成 plugin-bundle:// 地址', () => {
    const regions = build({
      regions: { type: 'sandbox', id: 'sb', src: 'sandbox/dashboard.html', title: '大屏' },
    })

    expect(regions).toMatchObject({
      type: 'sandbox',
      id: 'sb',
      src: EXPECTED_BUNDLE_URL,
      title: '大屏',
    })
  })

  it('完整 URL 原样保留', () => {
    const regions = build({
      regions: { type: 'sandbox', id: 'sb', src: 'https://example.com/app.html' },
    })
    expect(regions).toMatchObject({ src: 'https://example.com/app.html' })
  })

  it('嵌套在分栏里的沙箱同样被解析', () => {
    const regions = build({
      regions: {
        type: 'split',
        dir: 'col',
        children: [{ type: 'sandbox', id: 'sb', src: 'sandbox/a.html' }],
      },
    })
    const root = regions as Extract<RegionNode, { type: 'split' }>
    expect(root.children[0]).toMatchObject({
      src: `plugin-bundle://localhost${PLUGIN_ROOT}/sandbox/a.html`,
    })
  })
})

describe('buildPluginRegions - 校验', () => {
  it('引用外壳槽位时整棵回退', () => {
    // 插件类型层面没有 slot 变体，但 manifest 是外部 JSON，绕过类型后必须被拦下
    const withSlot = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'slot', slot: 'sidebar' },
        { type: 'panel', id: 'demo:main' },
      ],
    } as unknown as PluginRegionNode

    expect(build({ regions: withSlot })).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('ratio 长度与子节点数量不一致时回退', () => {
    const bad = {
      type: 'split',
      dir: 'row',
      ratio: [1, 2, 3],
      children: [{ type: 'panel', id: 'demo:main' }],
    } as PluginRegionNode

    expect(build({ regions: bad })).toBeUndefined()
  })

  it('沙箱缺少 src 时回退', () => {
    const bad = {
      type: 'sandbox',
      id: 'sb',
      src: '',
    } as PluginRegionNode

    expect(build({ regions: bad })).toBeUndefined()
  })
})

describe('buildPluginRegions - primaryView 归一化', () => {
  it('primaryView 转成单面板区域树', () => {
    const regions = build({ primaryView: { component: 'my-dashboard' } }, 'demo:__primary__')
    expect(regions).toMatchObject({
      type: 'panel',
      id: 'demo:__primary__',
      className: expect.stringContaining('flex-1'),
    })
  })

  it('primaryView 缺少归一化面板 id 时返回 undefined', () => {
    expect(build({ primaryView: { component: 'my-dashboard' } })).toBeUndefined()
  })

  it('regions 优先于 primaryView', () => {
    const regions = build(
      {
        primaryView: { component: 'ignored' },
        regions: { type: 'panel', id: 'demo:declared' },
      },
      'demo:__primary__',
    )
    expect(regions).toMatchObject({ id: 'demo:declared' })
  })
})

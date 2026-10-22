import { describe, it, expect, afterAll } from 'vitest'
import type { ScenarioPlugin, ScenarioUI } from '@shared/protocols/scenario'
import type { RegionNode } from '@shared/protocols/scenario-regions'
import { shellComposer } from './ShellComposer'

function makeUi(overrides: Partial<ScenarioUI> = {}): ScenarioUI {
  return {
    layout: 'editor-centric',
    panels: [],
    sidebarItems: [],
    statusBarItems: [],
    ...overrides,
  }
}

function makeScenario(overrides: Partial<ScenarioPlugin> = {}): ScenarioPlugin {
  return {
    id: 'test-scenario',
    name: 'Test Scenario',
    nameZh: '测试场景',
    icon: 'Box',
    description: '',
    descriptionZh: '',
    version: '1.0.0',
    author: 'test',
    category: 'custom',
    tags: [],
    identity: { systemPrompt: '', securityRules: '', conventions: '', workflow: '' },
    capabilities: { toolPacks: [], modes: [], contextTypes: [], outputFormats: [] },
    ui: makeUi(),
    dataSources: { workspace: false },
    ...overrides,
  }
}

/** 一棵合法的自定义外壳树：侧边栏在左，标题栏与主区在右列 */
const CUSTOM_REGIONS: RegionNode = {
  type: 'split',
  dir: 'row',
  className: 'flex h-full w-full',
  children: [
    { type: 'slot', slot: 'sidebar' },
    {
      type: 'split',
      dir: 'col',
      className: 'flex-1 flex flex-col min-w-0',
      children: [
        { type: 'slot', slot: 'titlebar' },
        { type: 'slot', slot: 'main' },
      ],
    },
  ],
}

afterAll(() => shellComposer.dispose())

describe('getLayoutConfig - 基础注入', () => {
  it('注入 scenarioId，供主区域组件按场景解析', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(makeScenario({ id: 'alpha' }))
    expect(config.scenarioId).toBe('alpha')
  })

  it('预设原有的布局字段不受注入影响', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(makeScenario({ ui: makeUi({ layout: 'focus-centric' }) }))
    expect(config.layout).toBe('focus-centric')
    expect(config.showActivityBar).toBe(false)
  })
})

describe('getLayoutConfig - primaryView', () => {
  it('未声明且无兼容映射时为空', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(makeScenario({ id: 'plain' }))
    expect(config.primaryView).toBeUndefined()
  })

  it('场景显式声明时原样采用', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({
        id: 'custom',
        ui: makeUi({
          layout: 'analytics-centric',
          primaryView: { component: 'MyDashboard', preferEditor: false },
        }),
      }),
    )
    expect(config.primaryView).toEqual({ component: 'MyDashboard', preferEditor: false })
  })

  it('历史兼容映射让既有场景不掉功能', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(makeScenario({ id: 'store-diagnosis' }))
    expect(config.primaryView?.component).toBe('StoreDiagnosisDashboard')
  })

  it('显式声明优先于历史兼容映射', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({
        id: 'store-diagnosis',
        ui: makeUi({ primaryView: { component: 'AnotherDashboard' } }),
      }),
    )
    expect(config.primaryView?.component).toBe('AnotherDashboard')
  })
})

describe('getLayoutConfig - regions', () => {
  it('合法区域树原样返回', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({ id: 'region-ok', ui: makeUi({ regions: CUSTOM_REGIONS }) }),
    )
    expect(config.regions).toEqual(CUSTOM_REGIONS)
  })

  it('未声明时为空，由客户端生成默认结构', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(makeScenario({ id: 'region-none' }))
    expect(config.regions).toBeUndefined()
  })

  it('引用越界槽位时整棵回退', () => {
    shellComposer.clearCache()
    const bad: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [{ type: 'slot', slot: 'chat' }],
    }
    const config = shellComposer.getLayoutConfig(
      makeScenario({ id: 'region-bad-slot', ui: makeUi({ regions: bad }) }),
    )
    expect(config.regions).toBeUndefined()
  })

  it('槽位重复引用时整棵回退', () => {
    shellComposer.clearCache()
    const duplicated: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [{ type: 'slot', slot: 'main' }, { type: 'slot', slot: 'main' }],
    }
    const config = shellComposer.getLayoutConfig(
      makeScenario({ id: 'region-dup', ui: makeUi({ regions: duplicated }) }),
    )
    expect(config.regions).toBeUndefined()
  })

  it('契约版本高于客户端支持时整棵回退', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({
        id: 'region-future',
        ui: makeUi({ regions: CUSTOM_REGIONS, regionsSchemaVersion: 99 }),
      }),
    )
    expect(config.regions).toBeUndefined()
  })
})

describe('getLayoutConfig - shellMode', () => {
  it('未声明时按现状推断：有 regions 视为 regions，否则 chrome', () => {
    shellComposer.clearCache()
    expect(
      shellComposer.getLayoutConfig(makeScenario({ id: 'mode-plain' })).shellMode,
    ).toBe('chrome')
    expect(
      shellComposer.getLayoutConfig(
        makeScenario({ id: 'mode-inferred', ui: makeUi({ regions: CUSTOM_REGIONS }) }),
      ).shellMode,
    ).toBe('regions')
  })

  it('显式声明 full 时原样采用', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({
        id: 'mode-full',
        ui: makeUi({
          shellMode: 'full',
          regionsSchemaVersion: 2,
          regions: {
            type: 'split',
            dir: 'row',
            children: [
              { type: 'part', id: 'scene-switcher' },
              { type: 'part', id: 'drag-region' },
              { type: 'part', id: 'window-controls' },
              { type: 'panel', id: 'studio' },
            ],
          },
        }),
      }),
    )
    expect(config.shellMode).toBe('full')
    expect(config.regions).toBeDefined()
  })

  it('full 缺保留件时降级到宿主默认树，不回退场景自己的 regions', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({
        id: 'mode-full-bad',
        ui: makeUi({
          shellMode: 'full',
          regionsSchemaVersion: 2,
          regions: {
            type: 'split',
            dir: 'row',
            children: [
              { type: 'part', id: 'scene-switcher' },
              { type: 'panel', id: 'studio' },
            ],
          },
        }),
      }),
    )
    // 宿主默认树由渲染层生成，Composer 只需交出 undefined
    expect(config.regions).toBeUndefined()
  })

  it('v1 老树仍走 regions 通道', () => {
    shellComposer.clearCache()
    const config = shellComposer.getLayoutConfig(
      makeScenario({
        id: 'mode-legacy',
        ui: makeUi({ regions: CUSTOM_REGIONS, regionsSchemaVersion: 1 }),
      }),
    )
    expect(config.shellMode).toBe('regions')
    expect(config.regions).toEqual(CUSTOM_REGIONS)
  })
})

describe('getLayoutConfig - 缓存', () => {
  it('panels 变化会让缓存失效', () => {
    shellComposer.clearCache()

    const before = makeScenario({ id: 'cache-scope', ui: makeUi({ panels: [] }) })
    const after = makeScenario({
      id: 'cache-scope',
      ui: makeUi({
        panels: [{ id: 'p1', component: 'P1', region: 'primary' }],
      }),
    })

    const first = shellComposer.getLayoutConfig(before)
    const second = shellComposer.getLayoutConfig(after)

    // 旧实现只把 sidebarItems 拼进 key：两个场景 sidebarItems 都是空数组，
    // key 完全相同 → 命中旧缓存 → 第二次拿到的仍是空 panels
    expect(second).not.toBe(first)
    expect(second.panels).toHaveLength(1)
  })

  it('primaryView 变化会让缓存失效', () => {
    shellComposer.clearCache()

    const first = shellComposer.getLayoutConfig(
      makeScenario({ id: 'cache-primary', ui: makeUi() }),
    )
    const second = shellComposer.getLayoutConfig(
      makeScenario({ id: 'cache-primary', ui: makeUi({ primaryView: { component: 'NewView' } }) }),
    )

    expect(second).not.toBe(first)
    expect(second.primaryView?.component).toBe('NewView')
  })

  it('内容完全相同时命中缓存', () => {
    shellComposer.clearCache()

    const first = shellComposer.getLayoutConfig(makeScenario({ id: 'cache-hit' }))
    const second = shellComposer.getLayoutConfig(makeScenario({ id: 'cache-hit' }))

    expect(second).toBe(first)
  })
})

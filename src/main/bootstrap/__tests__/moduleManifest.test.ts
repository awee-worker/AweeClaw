import { describe, expect, it } from 'vitest'
import { resolveInitOrder, type ModuleManifest } from '../moduleManifest'

/** 构造一个只关心顺序的模块声明 */
function mod(id: string, dependsOn?: string[], phase: ModuleManifest['phase'] = 'boot'): ModuleManifest {
  return { id, phase, dependsOn, init: () => undefined }
}

describe('resolveInitOrder — 模块初始化编排', () => {
  it('无依赖时保持声明顺序', () => {
    const modules = [mod('a'), mod('b'), mod('c')]
    const { order, problems } = resolveInitOrder(modules, 'boot')
    expect(order.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(problems).toEqual([])
  })

  it('依赖项排在依赖者之前', () => {
    const modules = [mod('later', ['first']), mod('first')]
    const { order, problems } = resolveInitOrder(modules, 'boot')
    expect(order.map((m) => m.id)).toEqual(['first', 'later'])
    expect(problems).toEqual([])
  })

  it('满足依赖的前提下不改变其余模块的相对顺序', () => {
    // 场景取自实际清单：网关依赖 A2A，收敛依赖多个业务模块
    const modules = [
      mod('FloatingAvatar'),
      mod('MailCenter'),
      mod('Live'),
      mod('Vts'),
      mod('A2a'),
      mod('OpenApi', ['A2a']),
      mod('PowerGuard'),
      mod('Sandbox'),
      mod('Vmc'),
      mod('CapabilityGuard', ['Live', 'Vts', 'Vmc', 'A2a', 'OpenApi']),
    ]
    const { order } = resolveInitOrder(modules, 'boot')
    expect(order.map((m) => m.id)).toEqual([
      'FloatingAvatar',
      'MailCenter',
      'Live',
      'Vts',
      'A2a',
      'OpenApi',
      'PowerGuard',
      'Sandbox',
      'Vmc',
      'CapabilityGuard',
    ])
  })

  it('循环依赖被报告，且不丢弃任何模块', () => {
    const modules = [mod('a', ['b']), mod('b', ['a']), mod('c')]
    const { order, problems } = resolveInitOrder(modules, 'boot')
    expect(problems.some((p) => p.includes('循环依赖'))).toBe(true)
    expect(order).toHaveLength(3)
    expect(order.map((m) => m.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('自依赖被报告但不影响其余模块', () => {
    const modules = [mod('a', ['a']), mod('b')]
    const { order, problems } = resolveInitOrder(modules, 'boot')
    expect(problems.some((p) => p.includes('依赖了自身'))).toBe(true)
    expect(order.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('引用完全不存在的模块会被报告', () => {
    const modules = [mod('a', ['ghost'])]
    const { problems } = resolveInitOrder(modules, 'boot')
    expect(problems.some((p) => p.includes('不存在的模块 ghost'))).toBe(true)
  })

  it('跨阶段依赖不参与本阶段排序，也不算问题', () => {
    // CapabilityGuard 依赖的首屏模块由 boot 阶段先跑完，deferred 阶段不必再排
    const modules = [mod('IoTIpc'), mod('Guard', ['IoTIpc'], 'deferred')]
    const { order, problems } = resolveInitOrder(modules, 'deferred')
    expect(order.map((m) => m.id)).toEqual(['Guard'])
    expect(problems).toEqual([])
  })

  it('只返回指定阶段的模块', () => {
    const modules = [mod('bootA'), mod('deferredA', undefined, 'deferred')]
    expect(resolveInitOrder(modules, 'boot').order.map((m) => m.id)).toEqual(['bootA'])
    expect(resolveInitOrder(modules, 'deferred').order.map((m) => m.id)).toEqual(['deferredA'])
  })

  it('重复 id 会被报告', () => {
    const modules = [mod('a'), mod('a')]
    const { problems } = resolveInitOrder(modules, 'boot')
    expect(problems.some((p) => p.includes('id 重复'))).toBe(true)
  })
})

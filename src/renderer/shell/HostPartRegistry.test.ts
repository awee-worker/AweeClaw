import { describe, it, expect, afterEach } from 'vitest'
import {
  clearHostParts,
  getHostPart,
  listRegisteredHostParts,
  registerHostPart,
  unregisterHostPart,
} from './HostPartRegistry'
import type { HostPartComponent } from './HostPartRegistry'

const Stub: HostPartComponent = () => null
const Another: HostPartComponent = () => null

afterEach(() => clearHostParts())

describe('HostPartRegistry', () => {
  it('注册后可取回同一组件', () => {
    registerHostPart('quota', Stub)
    expect(getHostPart('quota')).toBe(Stub)
  })

  it('未注册的部件返回 undefined，调用方据此跳过渲染', () => {
    expect(getHostPart('chat')).toBeUndefined()
  })

  it('重复注册以后写入的为准，便于热更新', () => {
    registerHostPart('quota', Stub)
    registerHostPart('quota', Another)
    expect(getHostPart('quota')).toBe(Another)
  })

  it('注销后不再返回组件', () => {
    registerHostPart('quota', Stub)
    unregisterHostPart('quota')
    expect(getHostPart('quota')).toBeUndefined()
  })

  it('列出已注册的部件 id', () => {
    registerHostPart('quota', Stub)
    registerHostPart('chat', Stub)
    expect(listRegisteredHostParts().sort()).toEqual(['chat', 'quota'])
  })
})

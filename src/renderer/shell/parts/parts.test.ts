/**
 * 部件注册表完整性
 *
 * 直接 import 注册入口会把整条外壳组件链（store、懒加载面板）拖进测试，
 * 因此这里读源码做静态核对：注册表漏项时，类型层不会报错、校验层也放行，
 * 只有真跑到渲染才表现为空白，属于最难定位的一类问题。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_PART_IDS, RESERVED_PART_IDS } from '@shared/protocols/scenario-regions'

const indexPath = resolve(__dirname, 'index.ts')
const source = readFileSync(indexPath, 'utf8')

/** 抓取 registerHostPart('xxx', ...) 里的 id */
function registeredIds(): string[] {
  const ids: string[] = []
  const re = /registerHostPart\(\s*'([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) ids.push(match[1])
  return ids
}

describe('宿主部件注册表', () => {
  it('HOST_PART_IDS 里每个部件都已注册', () => {
    const registered = new Set(registeredIds())
    const missing = HOST_PART_IDS.filter((id) => !registered.has(id))
    expect(missing).toEqual([])
  })

  it('注册表里没有契约之外的 id', () => {
    const known = new Set<string>(HOST_PART_IDS)
    const extra = registeredIds().filter((id) => !known.has(id))
    expect(extra).toEqual([])
  })

  it('同一部件只注册一次', () => {
    const ids = registeredIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('保留集部件全部已注册', () => {
    const registered = new Set(registeredIds())
    expect(RESERVED_PART_IDS.every((id) => registered.has(id))).toBe(true)
  })
})

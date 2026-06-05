/**
 * StorageService 单元测试
 *
 * 覆盖核心功能：读写、过期、删除、版本迁移、命名空间隔离
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
})()

Object.defineProperty(global, 'localStorage', { value: localStorageMock })

// Mock logger
vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    ui: { debug: vi.fn(), warn: vi.fn() },
  },
}))

import { StorageService } from '@shared/toolkit/StorageService'

describe('StorageService', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  describe('get / set', () => {
    it('应正确读写基本类型', () => {
      StorageService.set('test-key', 'hello')
      expect(StorageService.get<string>('test-key')).toBe('hello')
    })

    it('应正确读写对象类型', () => {
      const obj = { name: 'test', count: 42 }
      StorageService.set('test-obj', obj)
      expect(StorageService.get<typeof obj>('test-obj')).toEqual(obj)
    })

    it('应正确读写数组类型', () => {
      const arr = [1, 2, 3]
      StorageService.set('test-arr', arr)
      expect(StorageService.get<typeof arr>('test-arr')).toEqual(arr)
    })

    it('应正确读写布尔和数字类型', () => {
      StorageService.set('bool', true)
      StorageService.set('num', 3.14)
      expect(StorageService.get<boolean>('bool')).toBe(true)
      expect(StorageService.get<number>('num')).toBe(3.14)
    })

    it('key 不存在时应返回 null', () => {
      expect(StorageService.get('nonexistent')).toBeNull()
    })

    it('key 不存在时应返回 defaultValue', () => {
      expect(StorageService.get('nonexistent', 'fallback')).toBe('fallback')
    })

    it('应使用命名空间前缀存储', () => {
      StorageService.set('ns-test', 'value')
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'aweeclaw:ns-test',
        expect.any(String),
      )
    })
  })

  describe('TTL 过期', () => {
    it('未过期的值应正常返回', () => {
      StorageService.set('ttl-ok', 'alive', 60000)
      expect(StorageService.get<string>('ttl-ok')).toBe('alive')
    })

    it('过期的值应返回 defaultValue', () => {
      // 设置一个已经过期的 TTL（-1ms）
      StorageService.set('ttl-expired', 'dead', -1)
      expect(StorageService.get<string>('ttl-expired')).toBeNull()
      expect(StorageService.get('ttl-expired', 'fallback')).toBe('fallback')
    })

    it('过期值应被自动删除', () => {
      StorageService.set('ttl-auto-remove', 'gone', -1)
      StorageService.get('ttl-auto-remove')
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('aweeclaw:ttl-auto-remove')
    })
  })

  describe('remove / removeByPrefix', () => {
    it('应正确删除单个 key', () => {
      StorageService.set('del-me', 'value')
      StorageService.remove('del-me')
      expect(StorageService.get('del-me')).toBeNull()
    })

    it('应按前缀批量删除', () => {
      StorageService.set('prefix-a', 1)
      StorageService.set('prefix-b', 2)
      StorageService.set('other-c', 3)
      StorageService.removeByPrefix('prefix')
      expect(StorageService.get('prefix-a')).toBeNull()
      expect(StorageService.get('prefix-b')).toBeNull()
      expect(StorageService.get<number>('other-c')).toBe(3)
    })
  })

  describe('getWithSchema / setWithSchema', () => {
    it('无数据时应返回 defaultValue', () => {
      const schema = { defaultValue: { name: 'default' }, version: 1 }
      expect(StorageService.getWithSchema('schema-missing', schema)).toEqual({ name: 'default' })
    })

    it('应正确读写带版本的数据', () => {
      const schema = { defaultValue: { count: 0 }, version: 2 }
      StorageService.setWithSchema('schema-ver', { count: 10 }, schema)
      expect(StorageService.getWithSchema('schema-ver', schema)).toEqual({ count: 10 })
    })

    it('版本较低时应触发迁移', () => {
      // 先写入 v1 数据
      const v1Schema = { defaultValue: { count: 0 }, version: 1 }
      StorageService.setWithSchema('schema-migrate', { count: 5 }, v1Schema)

      // 用 v2 schema 读取，带迁移函数
      const v2Schema = {
        defaultValue: { count: 0, total: 0 },
        version: 2,
        migrate: (data: unknown, _from: number) => {
          const old = data as { count: number }
          return { count: old.count, total: old.count * 2 }
        },
      }
      const result = StorageService.getWithSchema('schema-migrate', v2Schema)
      expect(result).toEqual({ count: 5, total: 10 })
    })

    it('带 TTL 的 schema 数据过期后应返回 defaultValue', () => {
      const schema = { defaultValue: 'fresh', version: 1, ttl: -1 }
      StorageService.setWithSchema('schema-ttl', 'stale', schema)
      expect(StorageService.getWithSchema('schema-ttl', schema)).toBe('fresh')
    })
  })

  describe('clearAll', () => {
    it('应清除所有 aweeclaw 命名空间的存储', () => {
      StorageService.set('a', 1)
      StorageService.set('b', 2)
      StorageService.clearAll()
      expect(StorageService.get('a')).toBeNull()
      expect(StorageService.get('b')).toBeNull()
    })
  })

  describe('异常处理', () => {
    it('JSON 解析失败时应返回 defaultValue', () => {
      localStorageMock.getItem.mockReturnValueOnce('invalid-json{{{')
      expect(StorageService.get('bad-json', 'fallback')).toBe('fallback')
    })

    it('localStorage 写入失败时不应抛出异常', () => {
      localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceeded') })
      expect(() => StorageService.set('overflow', 'x'.repeat(100))).not.toThrow()
    })
  })
})

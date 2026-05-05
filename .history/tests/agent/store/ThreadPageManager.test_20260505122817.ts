import { describe, it, expect, beforeEach } from 'vitest'
import { ThreadPageManager } from '@renderer/agent/store/ThreadPageManager'
import { inactiveThreadPersister } from '@renderer/agent/store/InactiveThreadPersister'

describe('ThreadPageManager', () => {
  let manager: ThreadPageManager

  beforeEach(() => {
    manager = new ThreadPageManager({ pageSize: 10, maxPagesInMemory: 3, prefetchPages: 1 })
  })

  it('registers a thread with correct total pages', () => {
    manager.registerThread('t1', 55)
    expect(manager.getTotalPages('t1')).toBe(6)
    expect(manager.getCurrentPage('t1')).toBe(5)
  })

  it('handles zero messages', () => {
    manager.registerThread('t1', 0)
    expect(manager.getTotalPages('t1')).toBe(1)
  })

  it('calculates page range correctly', () => {
    manager.registerThread('t1', 100)
    const range = manager.getPageRange('t1', 2)
    expect(range).toEqual({ start: 20, end: 30 })
  })

  it('tracks loaded pages', () => {
    manager.registerThread('t1', 100)
    expect(manager.isPageLoaded('t1', 0)).toBe(false)

    manager.markPageLoaded('t1', 0)
    expect(manager.isPageLoaded('t1', 0)).toBe(true)
  })

  it('returns pages to load when setting current page', () => {
    manager.registerThread('t1', 100)
    const pagesToLoad = manager.setCurrentPage('t1', 3)
    expect(pagesToLoad).toContain(2)
    expect(pagesToLoad).toContain(3)
    expect(pagesToLoad).toContain(4)
  })

  it('evicts old pages when exceeding maxPagesInMemory', () => {
    manager.registerThread('t1', 100)
    for (let i = 0; i < 6; i++) {
      manager.markPageLoaded('t1', i)
    }
    manager.setCurrentPage('t1', 5)

    const state = (manager as any).threadStates.get('t1')
    expect(state.loadedPages.size).toBeLessThanOrEqual(3)
    expect(state.loadedPages.has(5)).toBe(true)
  })

  it('updates total messages', () => {
    manager.registerThread('t1', 50)
    expect(manager.getTotalPages('t1')).toBe(5)

    manager.updateTotalMessages('t1', 100)
    expect(manager.getTotalPages('t1')).toBe(10)
  })

  it('returns eviction candidates sorted by last accessed', () => {
    manager.registerThread('t1', 10)
    manager.registerThread('t2', 10)
    manager.registerThread('t3', 10)

    manager.markPageLoaded('t1', 0)
    manager.markPageLoaded('t2', 0)
    manager.markPageLoaded('t3', 0)

    manager.touchThread('t1')
    manager.touchThread('t3')

    const candidates = manager.getEvictionCandidates()
    expect(candidates[0]).toBe('t2')
  })

  it('unregisters a thread', () => {
    manager.registerThread('t1', 10)
    manager.unregisterThread('t1')
    expect(manager.getTotalPages('t1')).toBe(0)
  })
})

describe('InactiveThreadPersister', () => {
  beforeEach(() => {
    inactiveThreadPersister.clear()
  })

  it('serializes and deserializes thread messages', () => {
    const messages = [{ id: '1', content: 'hello' }, { id: '2', content: 'world' }]
    inactiveThreadPersister.serializeThread('t1', messages)

    expect(inactiveThreadPersister.isSerialized('t1')).toBe(true)

    const restored = inactiveThreadPersister.deserializeThread('t1')
    expect(restored).toEqual(messages)
    expect(inactiveThreadPersister.isSerialized('t1')).toBe(false)
  })

  it('tracks active threads', () => {
    inactiveThreadPersister.markActive('t1')
    expect(inactiveThreadPersister.isActive('t1')).toBe(true)
    expect(inactiveThreadPersister.isActive('t2')).toBe(false)

    inactiveThreadPersister.markInactive('t1')
    expect(inactiveThreadPersister.isActive('t1')).toBe(false)
  })

  it('returns eviction candidates excluding active and current thread', () => {
    inactiveThreadPersister.serializeThread('t1', [])
    inactiveThreadPersister.serializeThread('t2', [])
    inactiveThreadPersister.serializeThread('t3', [])
    inactiveThreadPersister.markActive('t2')

    const candidates = inactiveThreadPersister.getEvictionCandidates('t1')
    expect(candidates).not.toContain('t1')
    expect(candidates).not.toContain('t2')
    expect(candidates).toContain('t3')
  })

  it('shouldEvict returns true when exceeding max threads', () => {
    expect(inactiveThreadPersister.shouldEvict(10)).toBe(true)
    expect(inactiveThreadPersister.shouldEvict(3)).toBe(false)
  })

  it('returns stats', () => {
    inactiveThreadPersister.serializeThread('t1', [])
    inactiveThreadPersister.markActive('t2')

    const stats = inactiveThreadPersister.getStats()
    expect(stats.serializedCount).toBe(1)
    expect(stats.activeCount).toBe(1)
  })
})

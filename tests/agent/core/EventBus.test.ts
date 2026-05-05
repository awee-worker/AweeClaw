import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@renderer/agent/core/EventBus'

describe('EventBus', () => {
  beforeEach(() => {
    EventBus.clear()
  })

  describe('subscribe and emit', () => {
    it('delivers typed events to subscribers', () => {
      let received: string | null = null
      EventBus.on('stream:text', (event) => {
        received = event.text
      })

      EventBus.emit({ type: 'stream:text', text: 'hello' })
      expect(received).toBe('hello')
    })

    it('does not deliver events to subscribers of other types', () => {
      let received = false
      EventBus.on('llm:start', () => {
        received = true
      })

      EventBus.emit({ type: 'stream:text', text: 'hello' })
      expect(received).toBe(false)
    })

    it('delivers same event to multiple subscribers', () => {
      let count = 0
      EventBus.on('llm:start', () => { count++ })
      EventBus.on('llm:start', () => { count++ })

      EventBus.emit({ type: 'llm:start' })
      expect(count).toBe(2)
    })
  })

  describe('unsubscribe', () => {
    it('stops receiving events after unsubscribe', () => {
      let count = 0
      const unsub = EventBus.on('llm:error', () => { count++ })

      EventBus.emit({ type: 'llm:error', error: 'test' })
      expect(count).toBe(1)

      unsub()
      EventBus.emit({ type: 'llm:error', error: 'test2' })
      expect(count).toBe(1)
    })
  })

  describe('onAll', () => {
    it('receives all event types', () => {
      const received: string[] = []
      EventBus.onAll((event) => { received.push(event.type) })

      EventBus.emit({ type: 'llm:start' })
      EventBus.emit({ type: 'stream:text', text: 'hi' })
      EventBus.emit({ type: 'loop:end', reason: 'complete' })

      expect(received).toEqual(['llm:start', 'stream:text', 'loop:end'])
    })
  })

  describe('error isolation', () => {
    it('continues delivering to other handlers when one throws', () => {
      let secondCalled = false
      EventBus.on('stream:text', () => { throw new Error('boom') })
      EventBus.on('stream:text', () => { secondCalled = true })

      EventBus.emit({ type: 'stream:text', text: 'test' })
      expect(secondCalled).toBe(true)
    })
  })

  describe('loop events', () => {
    it('delivers loop lifecycle events', () => {
      const events: string[] = []
      EventBus.on('loop:start', () => events.push('start'))
      EventBus.on('loop:end', (e) => events.push(`end:${e.reason}`))

      EventBus.emit({ type: 'loop:start', threadId: 't1' })
      EventBus.emit({ type: 'loop:end', reason: 'complete', threadId: 't1' })

      expect(events).toEqual(['start', 'end:complete'])
    })
  })

  describe('tool events', () => {
    it('delivers tool lifecycle events with metadata', () => {
      const events: Array<{ type: string; id: string }> = []
      EventBus.on('tool:running', (e) => events.push({ type: 'running', id: e.id }))
      EventBus.on('tool:completed', (e) => events.push({ type: 'completed', id: e.id }))

      EventBus.emit({ type: 'tool:running', id: 'tc-1' })
      EventBus.emit({ type: 'tool:completed', id: 'tc-1', result: 'ok' })

      expect(events).toEqual([
        { type: 'running', id: 'tc-1' },
        { type: 'completed', id: 'tc-1' },
      ])
    })
  })

  describe('off', () => {
    it('removes all handlers for a specific event type', () => {
      let count = 0
      EventBus.on('llm:start', () => { count++ })
      EventBus.on('llm:start', () => { count++ })

      EventBus.emit({ type: 'llm:start' })
      expect(count).toBe(2)

      EventBus.off('llm:start')
      EventBus.emit({ type: 'llm:start' })
      expect(count).toBe(2)
    })
  })
})

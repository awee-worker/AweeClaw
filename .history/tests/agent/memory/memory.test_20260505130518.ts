import { describe, it, expect, beforeEach } from 'vitest'
import { LongTermMemory } from '@renderer/agent/memory/LongTermMemory'
import { ProjectKnowledgeGraph } from '@renderer/agent/memory/ProjectKnowledgeGraph'
import { AdaptivePromptEngine } from '@renderer/agent/memory/AdaptivePromptEngine'
import type { LongTermMemoryEntry } from '@renderer/agent/memory/LongTermMemory'

describe('LongTermMemory', () => {
  let memory: LongTermMemory

  beforeEach(async () => {
    memory = new LongTermMemory()
    await memory.init()
  })

  it('adds and retrieves memories', () => {
    const entry = memory.add({
      content: 'This project uses React with TypeScript',
      type: 'fact',
      source: 'user_explicit',
      confidence: 0.9,
      relevanceTags: ['react', 'typescript'],
    })

    expect(entry.id).toBeTruthy()
    expect(entry.content).toBe('This project uses React with TypeScript')

    const results = memory.search({ query: 'React' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].content).toContain('React')
  })

  it('deduplicates similar entries', () => {
    memory.add({ content: 'Uses PostgreSQL', type: 'fact', source: 'user_explicit', confidence: 0.8, relevanceTags: [] })
    memory.add({ content: 'Uses PostgreSQL', type: 'fact', source: 'user_explicit', confidence: 0.8, relevanceTags: [] })

    expect(memory.getStats().total).toBe(1)
  })

  it('searches by type', () => {
    memory.add({ content: 'Prefers dark mode', type: 'preference', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })
    memory.add({ content: 'Uses React', type: 'fact', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })

    const prefs = memory.getByType('preference')
    expect(prefs.length).toBe(1)
    expect(prefs[0].type).toBe('preference')
  })

  it('searches with confidence threshold', () => {
    memory.add({ content: 'Low confidence fact', type: 'fact', source: 'pattern_detected', confidence: 0.3, relevanceTags: [] })
    memory.add({ content: 'High confidence fact', type: 'fact', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })

    const results = memory.search({ query: 'fact', minConfidence: 0.5 })
    expect(results.every(r => r.confidence >= 0.5)).toBe(true)
  })

  it('extracts memories from conversation', () => {
    const messages = [
      { role: 'user', content: 'Remember: always use strict TypeScript' },
      { role: 'assistant', content: 'I will remember that.' },
      { role: 'user', content: 'I prefer functional components over class components' },
      { role: 'user', content: 'The error was caused by missing null check, the fix is to add optional chaining' },
    ]

    const result = memory.extractFromConversation(messages)
    expect(result.entries.length).toBeGreaterThanOrEqual(2)
  })

  it('builds context prompt', () => {
    memory.add({ content: 'Uses React 18', type: 'fact', source: 'user_explicit', confidence: 0.9, relevanceTags: ['react'] })
    memory.add({ content: 'Prefers Tailwind CSS', type: 'preference', source: 'user_explicit', confidence: 0.85, relevanceTags: ['css'] })

    const prompt = memory.buildContextPrompt('React')
    expect(prompt).toContain('long_term_memory')
    expect(prompt).toContain('React 18')
  })

  it('removes entries', () => {
    const entry = memory.add({ content: 'To be removed', type: 'fact', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })
    expect(memory.remove(entry.id)).toBe(true)
    expect(memory.getStats().total).toBe(0)
  })

  it('compacts low-confidence entries', () => {
    for (let i = 0; i < 10; i++) {
      memory.add({ content: `Low confidence ${i}`, type: 'fact', source: 'pattern_detected', confidence: 0.1, relevanceTags: [] })
    }

    memory.compact()
    expect(memory.getStats().total).toBe(0)
  })

  it('returns stats', () => {
    memory.add({ content: 'Fact 1', type: 'fact', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })
    memory.add({ content: 'Pref 1', type: 'preference', source: 'user_explicit', confidence: 0.8, relevanceTags: [] })

    const stats = memory.getStats()
    expect(stats.total).toBe(2)
    expect(stats.byType.fact).toBe(1)
    expect(stats.byType.preference).toBe(1)
  })

  it('serializes and deserializes', async () => {
    memory.add({ content: 'Persistent fact', type: 'fact', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })

    const serialized = memory.serialize()

    const memory2 = new LongTermMemory()
    await memory2.init(serialized)

    const results = memory2.search({ query: 'Persistent' })
    expect(results.length).toBe(1)
  })
})

describe('ProjectKnowledgeGraph', () => {
  let graph: ProjectKnowledgeGraph

  beforeEach(async () => {
    graph = new ProjectKnowledgeGraph()
    await graph.init()
  })

  it('adds and retrieves entities', () => {
    const entity = graph.addEntity({ name: 'UserService', type: 'class', properties: { file: 'src/services/UserService.ts' } })
    expect(entity.id).toBeTruthy()
    expect(entity.name).toBe('UserService')

    const retrieved = graph.getEntity(entity.id)
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('UserService')
  })

  it('updates existing entities', () => {
    graph.addEntity({ name: 'UserService', type: 'class', properties: { file: 'old.ts' } })
    const updated = graph.addEntity({ name: 'UserService', type: 'class', properties: { file: 'new.ts' } })

    expect(updated.properties.file).toBe('new.ts')
    expect(graph.getStats().entityCount).toBe(1)
  })

  it('adds and queries relations', () => {
    const user = graph.addEntity({ name: 'UserService', type: 'class', properties: {} })
    const db = graph.addEntity({ name: 'UserTable', type: 'database_table', properties: {} })

    const rel = graph.addRelation({ sourceId: user.id, targetId: db.id, type: 'depends_on', properties: {} })
    expect(rel).toBeDefined()

    const rels = graph.getRelations(user.id)
    expect(rels.length).toBe(1)
    expect(rels[0].type).toBe('depends_on')
  })

  it('gets neighbors', () => {
    const a = graph.addEntity({ name: 'A', type: 'module', properties: {} })
    const b = graph.addEntity({ name: 'B', type: 'module', properties: {} })
    const c = graph.addEntity({ name: 'C', type: 'module', properties: {} })

    graph.addRelation({ sourceId: a.id, targetId: b.id, type: 'imports', properties: {} })
    graph.addRelation({ sourceId: b.id, targetId: c.id, type: 'imports', properties: {} })

    const neighbors = graph.getNeighbors(a.id, 1)
    expect(neighbors.entities.length).toBeGreaterThanOrEqual(2)
  })

  it('finds paths between entities', () => {
    const a = graph.addEntity({ name: 'A', type: 'module', properties: {} })
    const b = graph.addEntity({ name: 'B', type: 'module', properties: {} })
    const c = graph.addEntity({ name: 'C', type: 'module', properties: {} })

    graph.addRelation({ sourceId: a.id, targetId: b.id, type: 'imports', properties: {} })
    graph.addRelation({ sourceId: b.id, targetId: c.id, type: 'imports', properties: {} })

    const path = graph.findPath(a.id, c.id)
    expect(path.length).toBe(3)
    expect(path[0].name).toBe('A')
    expect(path[2].name).toBe('C')
  })

  it('searches entities by name', () => {
    graph.addEntity({ name: 'UserService', type: 'class', properties: {} })
    graph.addEntity({ name: 'ProductService', type: 'class', properties: {} })
    graph.addEntity({ name: 'UserController', type: 'component', properties: {} })

    const results = graph.search('User')
    expect(results.length).toBe(2)
  })

  it('gets entities by type', () => {
    graph.addEntity({ name: 'Service1', type: 'class', properties: {} })
    graph.addEntity({ name: 'Component1', type: 'component', properties: {} })

    const classes = graph.getEntitiesByType('class')
    expect(classes.length).toBe(1)
  })

  it('removes entity and its relations', () => {
    const a = graph.addEntity({ name: 'A', type: 'module', properties: {} })
    const b = graph.addEntity({ name: 'B', type: 'module', properties: {} })
    graph.addRelation({ sourceId: a.id, targetId: b.id, type: 'imports', properties: {} })

    graph.removeEntity(a.id)

    expect(graph.getEntity(a.id)).toBeUndefined()
    expect(graph.getRelations(b.id).length).toBe(0)
  })

  it('serializes and deserializes', async () => {
    const e = graph.addEntity({ name: 'TestEntity', type: 'function', properties: { file: 'test.ts' } })
    const serialized = graph.serialize()

    const graph2 = new ProjectKnowledgeGraph()
    await graph2.init(serialized)

    const retrieved = graph2.getEntity(e.id)
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('TestEntity')
  })

  it('returns stats', () => {
    graph.addEntity({ name: 'S1', type: 'class', properties: {} })
    graph.addEntity({ name: 'C1', type: 'component', properties: {} })

    const stats = graph.getStats()
    expect(stats.entityCount).toBe(2)
    expect(stats.entityTypes.class).toBe(1)
  })
})

describe('AdaptivePromptEngine', () => {
  let engine: AdaptivePromptEngine
  let memory: LongTermMemory

  beforeEach(async () => {
    memory = new LongTermMemory()
    await memory.init()
    engine = new AdaptivePromptEngine(3000)
  })

  it('generates empty prompt when no context', async () => {
    const result = await engine.generateAdaptivePrompt({
      query: 'hello',
    })
    expect(result.totalEstimatedTokens).toBeGreaterThanOrEqual(0)
  })

  it('includes user preferences when available', async () => {
    memory.add({ content: 'Prefers functional components', type: 'preference', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })

    const result = await engine.generateAdaptivePrompt({
      query: 'create a component',
      recentMessages: [{ role: 'user', content: 'create a component' }],
    })

    expect(result.systemPromptAddition).toContain('user_preferences')
  })

  it('includes project decisions', async () => {
    memory.add({ content: 'Using Next.js for SSR', type: 'decision', source: 'conversation_extracted', confidence: 0.85, relevanceTags: [] })

    const result = await engine.generateAdaptivePrompt({
      query: 'setup routing',
    })

    expect(result.systemPromptAddition).toContain('project_decisions')
  })

  it('respects token budget', async () => {
    for (let i = 0; i < 50; i++) {
      memory.add({ content: `Decision ${i}: very long decision content that takes up tokens`, type: 'decision', source: 'conversation_extracted', confidence: 0.8, relevanceTags: [] })
    }

    const result = await engine.generateAdaptivePrompt({
      query: 'test',
    })

    expect(result.totalEstimatedTokens).toBeLessThanOrEqual(4000)
  })

  it('allows registering custom strategies', async () => {
    engine.registerStrategy({
      id: 'custom_test',
      priority: 100,
      estimatedTokens: 100,
      condition: () => true,
      generate: () => '<custom>Custom strategy output</custom>',
    })

    const result = await engine.generateAdaptivePrompt({ query: 'test' })
    expect(result.systemPromptAddition).toContain('Custom strategy output')
  })

  it('allows removing strategies', async () => {
    engine.removeStrategy('user_preferences')

    memory.add({ content: 'Prefers dark mode', type: 'preference', source: 'user_explicit', confidence: 0.9, relevanceTags: [] })

    const result = await engine.generateAdaptivePrompt({ query: 'test' })
    expect(result.systemPromptAddition).not.toContain('user_preferences')
  })
})

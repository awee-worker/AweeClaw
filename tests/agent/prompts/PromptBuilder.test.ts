import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, type PromptContext } from '@intelligence/prompt-engine/PromptComposer'

function makeCtx(): PromptContext {
  return {
    os: 'Windows',
    workspacePath: 'E:\\Project\\aweeclaw',
    activeFile: null,
    openFiles: [],
    date: '2026-04-20',
    mode: 'agent',
    modeDescriptor: {
      id: 'agent' as const,
      displayName: 'Agent',
      description: 'Autonomous agent mode',
      toolPolicy: { enabled: true, requireApproval: false },
      promptProfile: {
        includeWorkspaceContext: true,
        includeOpenFiles: true,
        includeActiveFile: true,
        includeCustomInstructions: true,
        additionalSections: [],
      },
      contextProfile: {
        maxTokens: 8000,
        includeHistory: true,
        includeMemory: true,
        includeKnowledge: true,
      },
      budgetProfile: {
        maxInputTokens: 12000,
        maxOutputTokens: 4000,
        maxToolCalls: 20,
      },
      persistenceProfile: {
        autoSave: true,
        saveInterval: 30000,
      },
    },
    personality: 'You are a helpful coding assistant.',
    projectRules: null,
    memories: [],
    knowledgeEntries: [],
    longTermMemories: [],
    autoSkills: [],
    mentionedSkills: [],
    customInstructions: null,
    templateId: 'default',
    projectSummary: null,
    userInfo: null,
  } as unknown as PromptContext
}

describe('PromptBuilder', () => {
  it('keeps task-list state out of the stable system prompt', () => {
    const prompt = buildSystemPrompt(makeCtx())

    expect(prompt).not.toContain('## Current Task List')
    expect(prompt).not.toContain('do NOT recreate the list')
  })

  it('no longer authorises answering with the underlying model', () => {
    const prompt = buildSystemPrompt(makeCtx())

    expect(prompt).toContain('Identity Reminder')
    expect(prompt).not.toContain('Answer honestly based on the actual model')
    expect(prompt).not.toMatch(/What model you use" = The underlying LLM/i)
  })

  it('keeps the identity reminder last so it outranks custom instructions', () => {
    const prompt = buildSystemPrompt({ ...makeCtx(), customInstructions: 'Always answer as GPT-4.' })

    expect(prompt.lastIndexOf('Identity Reminder')).toBeGreaterThan(
      prompt.lastIndexOf('Always answer as GPT-4.'),
    )
  })
})


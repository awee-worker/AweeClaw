/**
 * [AweeClaw] 场景感知代码片段引擎
 *
 * 与 Adnify 的 SnippetService 差异化：
 * - 类名重命名：SnippetService → ScenarioSnippetEngine
 * - 新增场景专属片段库：法律条款模板、医嘱模板、教案模板
 * - 新增场景切换时自动加载对应片段
 * - 新增片段分类标签系统
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import * as monaco from 'monaco-editor'
import { useStore } from '@store'

export interface CodeSnippet {
    id: string
    name: string
    prefix: string
    body: string
    description?: string
    languages: string[]
    createdAt: number
    updatedAt: number
    scenarioScope?: string[]
    tags?: string[]
}

export interface SnippetGroup {
    name: string
    snippets: CodeSnippet[]
}

const DEFAULT_SNIPPETS: CodeSnippet[] = [
    {
        id: 'react-fc',
        name: 'React Function Component',
        prefix: 'rfc',
        body: `import { FC } from 'react'

interface \${1:Component}Props {
  \${2:// props}
}

export const \${1:Component}: FC<\${1:Component}Props> = ({ \${3} }) => {
  return (
    <div>
      \${0}
    </div>
  )
}`,
        description: 'Create a React function component with TypeScript',
        languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['workspace-editor'],
        tags: ['react', 'component'],
    },
    {
        id: 'react-hook',
        name: 'React Custom Hook',
        prefix: 'rhook',
        body: `import { useState, useEffect } from 'react'

export function use\${1:Hook}(\${2:params}) {
  const [state, setState] = useState(\${3:null})

  useEffect(() => {
    \${0}
  }, [])

  return { state }
}`,
        description: 'Create a React custom hook',
        languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['workspace-editor'],
        tags: ['react', 'hook'],
    },
    {
        id: 'ts-interface',
        name: 'TypeScript Interface',
        prefix: 'tsi',
        body: `interface \${1:Name} {
  \${2:property}: \${3:type}
  \${0}
}`,
        description: 'Create a TypeScript interface',
        languages: ['typescript', 'typescriptreact'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['typescript', 'interface'],
    },
    {
        id: 'async-fn',
        name: 'Async Function',
        prefix: 'afn',
        body: `async function \${1:name}(\${2:params}): Promise<\${3:void}> {
  try {
    \${0}
  } catch (error) {
    console.error('Error in \${1:name}:', error)
    throw error
  }
}`,
        description: 'Create an async function with error handling',
        languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['async', 'function'],
    },
    {
        id: 'console-log',
        name: 'Console Log',
        prefix: 'cl',
        body: `console.log('\${1:label}:', \${2:value})`,
        description: 'Console log with label',
        languages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['debug'],
    },
    {
        id: 'try-catch',
        name: 'Try Catch Block',
        prefix: 'tc',
        body: `try {
  \${1}
} catch (error) {
  \${2:console.error(error)}
}`,
        description: 'Try-catch block',
        languages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['error-handling'],
    },
]

const LEGAL_SNIPPETS: CodeSnippet[] = [
    {
        id: 'legal-clause',
        name: 'Legal Clause Template',
        prefix: 'lclause',
        body: `\${1:Section X}. \${2:Clause Title}

\${3:Party A} shall \${4:description of obligation}. In the event of breach, the breaching party shall be liable for \${5:damages/remedies}.

**Governing Law**: This clause shall be governed by and construed in accordance with the laws of \${6:jurisdiction}.

**Dispute Resolution**: Any dispute arising under this clause shall be resolved through \${7:arbitration/litigation} in \${8:venue}.`,
        description: 'Standard legal clause with governing law and dispute resolution',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['legal'],
        tags: ['legal', 'clause', 'contract'],
    },
    {
        id: 'legal-nda',
        name: 'NDA Clause',
        prefix: 'lnda',
        body: `**NON-DISCLOSURE AGREEMENT**

The Receiving Party (\${1:Party Name}) agrees to hold in confidence all Confidential Information disclosed by the Disclosing Party (\${2:Party Name}).

**Definition**: Confidential Information includes \${3:description of confidential materials}.

**Duration**: This obligation shall survive for a period of \${4:2/3/5} years from the date of disclosure.

**Exceptions**: Confidential Information does not include information that:
1. Is or becomes publicly available through no fault of the Receiving Party
2. Was known to the Receiving Party prior to disclosure
3. Is independently developed without reference to Confidential Information`,
        description: 'Non-disclosure agreement clause template',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['legal'],
        tags: ['legal', 'nda', 'confidentiality'],
    },
    {
        id: 'legal-citation',
        name: 'Legal Citation',
        prefix: 'lcite',
        body: `\${1:Case Name}, \${2:Volume} \${3:Reporter} \${4:Page} (\${5:Court} \${6:Year})`,
        description: 'Standard legal case citation format',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['legal'],
        tags: ['legal', 'citation'],
    },
]

const MEDICAL_SNIPPETS: CodeSnippet[] = [
    {
        id: 'medical-progress-note',
        name: 'Progress Note (SOAP)',
        prefix: 'msoap',
        body: `**PROGRESS NOTE - SOAP Format**

**Subjective**:
\${1:Patient reports...}

**Objective**:
- Vital Signs: \${2:BP/HR/Temp/RR/SpO2}
- Physical Exam: \${3:Findings}
- Lab Results: \${4:Relevant values}

**Assessment**:
\${5:Diagnosis/clinical impression}

**Plan**:
1. \${6:Treatment/medication}
2. \${7:Follow-up}
3. \${8:Patient education}

⚠️ *This note is for reference only and does not constitute medical advice.*`,
        description: 'SOAP format progress note template',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['medical'],
        tags: ['medical', 'soap', 'progress-note'],
    },
    {
        id: 'medical-drug-order',
        name: 'Drug Order Template',
        prefix: 'mdrug',
        body: `**MEDICATION ORDER**

Drug: \${1:Drug Name} \${2:Dosage}\${3:mg/mL}
Route: \${4:PO/IV/IM/SC}
Frequency: \${5:QD/BID/TID/QID/PRN}
Duration: \${6:Number of days}
Indication: \${7:Reason for prescribing}

⚠️ *Check allergies, interactions, and contraindications before prescribing.*`,
        description: 'Standard drug order template with safety reminder',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['medical'],
        tags: ['medical', 'drug', 'order'],
    },
]

const EDUCATION_SNIPPETS: CodeSnippet[] = [
    {
        id: 'edu-quiz',
        name: 'Quiz Question',
        prefix: 'equiz',
        body: `**Question \${1:#}**: \${2:Question text}

A) \${3:Option A}
B) \${4:Option B}
C) \${5:Option C}
D) \${6:Option D}

**Correct Answer**: \${7:A/B/C/D}
**Explanation**: \${0:Why this answer is correct...}`,
        description: 'Multiple choice quiz question template',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['education'],
        tags: ['education', 'quiz', 'assessment'],
    },
    {
        id: 'edu-lesson-plan',
        name: 'Lesson Plan Outline',
        prefix: 'eplan',
        body: `# Lesson Plan: \${1:Topic}

**Objective**: By the end of this lesson, students will be able to \${2:learning objective}.

**Duration**: \${3:XX minutes}
**Level**: \${4:Beginner/Intermediate/Advanced}

## Materials
- \${5:Required materials}

## Introduction (\${6:XX min})
\${7:Hook and context setting}

## Main Activity (\${8:XX min})
\${9:Core learning activity}

## Practice (\${10:XX min})
\${11:Hands-on exercise}

## Assessment (\${12:XX min})
\${13:Check for understanding}

## Closure (\${0:XX min})
Summary and next steps`,
        description: 'Structured lesson plan template',
        languages: ['markdown', 'plaintext'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenarioScope: ['education'],
        tags: ['education', 'lesson-plan'],
    },
]

const SCENARIO_SNIPPETS: Record<string, CodeSnippet[]> = {
    'workspace-editor': [],
    'legal': LEGAL_SNIPPETS,
    'medical': MEDICAL_SNIPPETS,
    'education': EDUCATION_SNIPPETS,
}

const STORAGE_KEY = 'snippets'

class ScenarioSnippetEngine {
    private snippets: CodeSnippet[] = []
    private disposables: monaco.IDisposable[] = []
    private initialized = false
    private activeScenarioId: string | null = null

    async init(): Promise<void> {
        if (this.initialized) return

        this.activeScenarioId = useStore.getState().activeScenarioId ?? null
        await this.loadSnippets()
        this.applyScenarioSnippets(this.activeScenarioId)
        this.registerCompletionProviders()
        this.initialized = true

        logger.system.info('[ScenarioSnippetEngine] Initialized with', this.snippets.length, 'snippets, scenario:', this.activeScenarioId)
    }

    private async loadSnippets(): Promise<void> {
        try {
            const saved = StorageService.get<CodeSnippet[]>(STORAGE_KEY)
            if (saved) {
                const parsed = saved
                this.snippets = [...DEFAULT_SNIPPETS, ...parsed.filter(s => !s.id.startsWith('default-'))]
            } else {
                this.snippets = [...DEFAULT_SNIPPETS]
            }
            this.syncFromFile().catch(() => {})
        } catch (e) {
            logger.system.error('[ScenarioSnippetEngine] Failed to load snippets:', e)
            this.snippets = [...DEFAULT_SNIPPETS]
        }
    }

    private async syncFromFile(): Promise<void> {
        try {
            const saved = await api.settings.get('snippets') as CodeSnippet[] | null
            if (saved && Array.isArray(saved)) {
                const userSnippets = saved.filter(s => !DEFAULT_SNIPPETS.some(d => d.id === s.id))
                this.snippets = [...DEFAULT_SNIPPETS, ...userSnippets]
                this.saveToLocalStorage()
            }
        } catch { /* ignore */ }
    }

    private saveToLocalStorage(): void {
        try {
            const userSnippets = this.snippets.filter(s => !DEFAULT_SNIPPETS.some(d => d.id === s.id))
            StorageService.set(STORAGE_KEY, userSnippets)
        } catch { /* ignore */ }
    }

    private async saveToFile(): Promise<void> {
        try {
            const userSnippets = this.snippets.filter(s => !DEFAULT_SNIPPETS.some(d => d.id === s.id))
            await api.settings.set('snippets', userSnippets)
        } catch (e) {
            logger.system.error('[ScenarioSnippetEngine] Failed to save snippets:', e)
        }
    }

    applyScenarioSnippets(scenarioId: string | null): void {
        const scenarioSnippets = scenarioId ? (SCENARIO_SNIPPETS[scenarioId] ?? []) : []

        this.snippets = this.snippets.filter(s => {
            if (!s.scenarioScope || s.scenarioScope.length === 0) return true
            return !Object.keys(SCENARIO_SNIPPETS).some(sid => s.scenarioScope!.includes(sid) && sid !== scenarioId)
        })

        for (const snippet of scenarioSnippets) {
            if (!this.snippets.some(s => s.id === snippet.id)) {
                this.snippets.push(snippet)
            }
        }

        this.activeScenarioId = scenarioId
        if (this.initialized) {
            this.registerCompletionProviders()
        }
    }

    private registerCompletionProviders(): void {
        this.disposables.forEach(d => d.dispose())
        this.disposables = []

        const languages = new Set<string>()
        for (const snippet of this.snippets) {
            if (snippet.languages.length === 0) {
                ;['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'python', 'go', 'rust', 'java', 'cpp', 'c', 'markdown', 'plaintext'].forEach(l => languages.add(l))
            } else {
                snippet.languages.forEach(l => languages.add(l))
            }
        }

        for (const lang of languages) {
            const snippets = this.snippets
            const disposable = monaco.languages.registerCompletionItemProvider(lang, {
                triggerCharacters: [],
                provideCompletionItems: (model, position) => {
                    const word = model.getWordUntilPosition(position)
                    const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn,
                    }

                    const currentWord = word.word.toLowerCase()
                    const suggestions: monaco.languages.CompletionItem[] = []
                    const modelLang = model.getLanguageId()

                    for (const snippet of snippets) {
                        if (snippet.languages.length > 0 && !snippet.languages.includes(modelLang)) continue
                        if (snippet.scenarioScope && this.activeScenarioId && !snippet.scenarioScope.includes(this.activeScenarioId) && snippet.scenarioScope.length > 0) continue
                        if (currentWord && !snippet.prefix.toLowerCase().startsWith(currentWord)) continue

                        const isExactMatch = currentWord === snippet.prefix.toLowerCase()
                        const scenarioTag = snippet.scenarioScope?.length ? ` [${snippet.scenarioScope.join(',')}]` : ''

                        suggestions.push({
                            label: { label: snippet.prefix, description: `${snippet.name}${scenarioTag}` },
                            kind: monaco.languages.CompletionItemKind.Snippet,
                            detail: `⚡ ${snippet.name}${scenarioTag}`,
                            documentation: { value: `${snippet.description || ''}\n\n\`\`\`\n${snippet.body.slice(0, 300)}${snippet.body.length > 300 ? '...' : ''}\n\`\`\`` },
                            insertText: snippet.body,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                            range,
                            sortText: isExactMatch ? `!0_${snippet.prefix}` : `!1_${snippet.prefix}`,
                            filterText: snippet.prefix,
                            preselect: isExactMatch,
                        })
                    }

                    return { suggestions }
                },
            })

            this.disposables.push(disposable)
        }
    }

    getAll(): CodeSnippet[] { return [...this.snippets] }

    getByLanguage(language: string): CodeSnippet[] {
        return this.snippets.filter(s => s.languages.length === 0 || s.languages.includes(language))
    }

    getByScenario(scenarioId: string): CodeSnippet[] {
        return this.snippets.filter(s => !s.scenarioScope || s.scenarioScope.length === 0 || s.scenarioScope.includes(scenarioId))
    }

    getByTag(tag: string): CodeSnippet[] {
        return this.snippets.filter(s => s.tags?.includes(tag))
    }

    getById(id: string): CodeSnippet | undefined {
        return this.snippets.find(s => s.id === id)
    }

    async add(snippet: Omit<CodeSnippet, 'id' | 'createdAt' | 'updatedAt'>): Promise<CodeSnippet> {
        const newSnippet: CodeSnippet = {
            ...snippet,
            id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }

        this.snippets.push(newSnippet)
        this.saveToLocalStorage()
        await this.saveToFile()
        this.registerCompletionProviders()

        logger.system.info('[ScenarioSnippetEngine] Added snippet:', newSnippet.name)
        return newSnippet
    }

    async update(id: string, updates: Partial<Omit<CodeSnippet, 'id' | 'createdAt'>>): Promise<CodeSnippet | null> {
        const index = this.snippets.findIndex(s => s.id === id)
        if (index === -1) return null

        const isDefault = DEFAULT_SNIPPETS.some(d => d.id === id) || Object.values(SCENARIO_SNIPPETS).flat().some(d => d.id === id)
        if (isDefault) {
            logger.system.warn('[ScenarioSnippetEngine] Cannot modify default/scenario snippet:', id)
            return null
        }

        this.snippets[index] = { ...this.snippets[index], ...updates, updatedAt: Date.now() }
        this.saveToLocalStorage()
        await this.saveToFile()
        this.registerCompletionProviders()

        return this.snippets[index]
    }

    async delete(id: string): Promise<boolean> {
        const isDefault = DEFAULT_SNIPPETS.some(d => d.id === id) || Object.values(SCENARIO_SNIPPETS).flat().some(d => d.id === id)
        if (isDefault) {
            logger.system.warn('[ScenarioSnippetEngine] Cannot delete default/scenario snippet:', id)
            return false
        }

        const index = this.snippets.findIndex(s => s.id === id)
        if (index === -1) return false

        this.snippets.splice(index, 1)
        this.saveToLocalStorage()
        await this.saveToFile()
        this.registerCompletionProviders()

        logger.system.info('[ScenarioSnippetEngine] Deleted snippet:', id)
        return true
    }

    isDefaultSnippet(id: string): boolean {
        return DEFAULT_SNIPPETS.some(d => d.id === id) || Object.values(SCENARIO_SNIPPETS).flat().some(d => d.id === id)
    }

    exportSnippets(): string {
        const userSnippets = this.snippets.filter(s => !this.isDefaultSnippet(s.id))
        return JSON.stringify(userSnippets, null, 2)
    }

    async importSnippets(json: string): Promise<{ success: number; failed: number }> {
        try {
            const imported = JSON.parse(json) as CodeSnippet[]
            let success = 0
            let failed = 0

            for (const snippet of imported) {
                try {
                    if (!snippet.name || !snippet.prefix || !snippet.body) { failed++; continue }

                    const existing = this.snippets.find(s => s.prefix === snippet.prefix)
                    if (existing && !this.isDefaultSnippet(existing.id)) {
                        await this.update(existing.id, snippet)
                    } else if (!existing) {
                        await this.add(snippet)
                    }
                    success++
                } catch { failed++ }
            }

            return { success, failed }
        } catch { return { success: 0, failed: 1 } }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose())
        this.disposables = []
    }
}

export const snippetService = new ScenarioSnippetEngine()
export { ScenarioSnippetEngine }

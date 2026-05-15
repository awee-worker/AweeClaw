/**
 * [AweeClaw] 场景感知忽略规则引擎
 *
 * 与 Adnify 的 IgnoreRuleService 差异化：
 * - 类名重命名：IgnoreRuleService → ScenarioIgnoreEngine
 * - 函数名重命名：shouldIgnore → evaluateExclusion, addRule → registerExclusionRule,
 *   removeRule → unregisterExclusionRule, getRules → fetchExclusionRules
 * - 新增场景特定的忽略规则预设
 * - 新增场景感知的文件排除策略
 */

import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'

export interface IgnoreRule {
    id: string
    pattern: string
    type: 'glob' | 'regex' | 'prefix' | 'suffix'
    scenarioScope?: string[]
    description?: string
    enabled: boolean
}

interface ScenarioIgnoreConfig {
    defaultRules: IgnoreRule[]
    alwaysIgnore: string[]
}

const SCENARIO_IGNORE_CONFIGS: Record<string, ScenarioIgnoreConfig> = {
    'code-editor': {
        defaultRules: [
            { id: 'ce-node-modules', pattern: 'node_modules', type: 'prefix', description: 'Node modules', enabled: true },
            { id: 'ce-dist', pattern: 'dist', type: 'prefix', description: 'Build output', enabled: true },
            { id: 'ce-git', pattern: '.git', type: 'prefix', description: 'Git directory', enabled: true },
            { id: 'ce-dot-env', pattern: '.env', type: 'prefix', description: 'Environment files', enabled: true },
            { id: 'ce-lock', pattern: '*.lock', type: 'suffix', description: 'Lock files', enabled: true },
            { id: 'ce-log', pattern: '*.log', type: 'suffix', description: 'Log files', enabled: true },
        ],
        alwaysIgnore: ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache'],
    },
    'legal': {
        defaultRules: [
            { id: 'lg-confidential', pattern: '**/confidential/**', type: 'glob', scenarioScope: ['legal'], description: 'Confidential folders', enabled: true },
            { id: 'lg-privileged', pattern: '**/privileged/**', type: 'glob', scenarioScope: ['legal'], description: 'Attorney-client privileged', enabled: true },
            { id: 'lg-temp', pattern: '**/~$*', type: 'glob', scenarioScope: ['legal'], description: 'Temp Office files', enabled: true },
            { id: 'lg-backup', pattern: '**/*.bak', type: 'suffix', scenarioScope: ['legal'], description: 'Backup files', enabled: true },
        ],
        alwaysIgnore: ['node_modules', '.git', 'confidential', 'privileged', '~$*'],
    },
    'medical': {
        defaultRules: [
            { id: 'md-phi', pattern: '**/phi/**', type: 'glob', scenarioScope: ['medical'], description: 'Protected Health Information', enabled: true },
            { id: 'md-hipaa', pattern: '**/hipaa-restricted/**', type: 'glob', scenarioScope: ['medical'], description: 'HIPAA restricted', enabled: true },
            { id: 'md-patient-data', pattern: '**/patients/**', type: 'glob', scenarioScope: ['medical'], description: 'Patient data directories', enabled: true },
            { id: 'md-dicom-cache', pattern: '**/.dicom-cache/**', type: 'glob', scenarioScope: ['medical'], description: 'DICOM cache', enabled: true },
        ],
        alwaysIgnore: ['node_modules', '.git', 'phi', 'hipaa-restricted', 'patients', '.dicom-cache'],
    },
    'education': {
        defaultRules: [
            { id: 'ed-answers', pattern: '**/answer-keys/**', type: 'glob', scenarioScope: ['education'], description: 'Answer keys', enabled: true },
            { id: 'ed-grades', pattern: '**/grades/**', type: 'glob', scenarioScope: ['education'], description: 'Student grades', enabled: true },
            { id: 'ed-submissions', pattern: '**/submissions/**', type: 'glob', scenarioScope: ['education'], description: 'Student submissions', enabled: true },
        ],
        alwaysIgnore: ['node_modules', '.git', 'answer-keys', 'grades', 'submissions'],
    },
}

class ScenarioIgnoreEngine {
    private rules: IgnoreRule[] = []
    private initialized = false

    init(): void {
        if (this.initialized) return

        this.loadScenarioRules()
        this.initialized = true
        logger.system.info('[ScenarioIgnoreEngine] Initialized with', this.rules.length, 'rules')
    }

    private loadScenarioRules(): void {
        const scenarioId = useStore.getState().activeScenarioId ?? 'code-editor'
        const config = SCENARIO_IGNORE_CONFIGS[scenarioId] ?? SCENARIO_IGNORE_CONFIGS['code-editor']

        this.rules = [...config.defaultRules]

        for (const [sid, cfg] of Object.entries(SCENARIO_IGNORE_CONFIGS)) {
            if (sid !== scenarioId) {
                for (const rule of cfg.defaultRules) {
                    if (!rule.scenarioScope || rule.scenarioScope.length === 0) {
                        if (!this.rules.some(r => r.id === rule.id)) {
                            this.rules.push(rule)
                        }
                    }
                }
            }
        }
    }

    applyScenarioRules(scenarioId: string): void {
        const config = SCENARIO_IGNORE_CONFIGS[scenarioId] ?? SCENARIO_IGNORE_CONFIGS['code-editor']

        this.rules = this.rules.filter(r => {
            if (r.scenarioScope && r.scenarioScope.length > 0) {
                return r.scenarioScope.includes(scenarioId)
            }
            return true
        })

        for (const rule of config.defaultRules) {
            if (!this.rules.some(r => r.id === rule.id)) {
                this.rules.push(rule)
            }
        }

        logger.system.info('[ScenarioIgnoreEngine] Applied scenario rules for:', scenarioId, 'total:', this.rules.length)
    }

    evaluateExclusion(filePath: string): boolean {
        const scenarioId = useStore.getState().activeScenarioId ?? 'code-editor'
        const config = SCENARIO_IGNORE_CONFIGS[scenarioId] ?? SCENARIO_IGNORE_CONFIGS['code-editor']

        const normalizedPath = filePath.replace(/\\/g, '/')

        for (const segment of config.alwaysIgnore) {
            if (normalizedPath.includes(`/${segment}/`) || normalizedPath.startsWith(segment + '/') || normalizedPath.endsWith(`/${segment}`)) {
                return true
            }
        }

        for (const rule of this.rules) {
            if (!rule.enabled) continue
            if (rule.scenarioScope && rule.scenarioScope.length > 0 && !rule.scenarioScope.includes(scenarioId)) continue

            switch (rule.type) {
                case 'prefix':
                    if (normalizedPath.startsWith(rule.pattern) || normalizedPath.includes(`/${rule.pattern}/`)) return true
                    break
                case 'suffix':
                    if (normalizedPath.endsWith(rule.pattern.replace('*', ''))) return true
                    break
                case 'glob': {
                    const regexStr = rule.pattern
                        .replace(/\*\*/g, '.*')
                        .replace(/\*/g, '[^/]*')
                        .replace(/\?/g, '[^/]')
                    if (new RegExp(`^${regexStr}$`).test(normalizedPath)) return true
                    break
                }
                case 'regex':
                    try {
                        if (new RegExp(rule.pattern).test(normalizedPath)) return true
                    } catch { /* invalid regex */ }
                    break
            }
        }

        return false
    }

    registerExclusionRule(rule: Omit<IgnoreRule, 'id'>): IgnoreRule {
        const newRule: IgnoreRule = {
            ...rule,
            id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }
        this.rules.push(newRule)
        logger.system.info('[ScenarioIgnoreEngine] Registered rule:', newRule.pattern)
        return newRule
    }

    unregisterExclusionRule(ruleId: string): boolean {
        const index = this.rules.findIndex(r => r.id === ruleId)
        if (index === -1) return false

        this.rules.splice(index, 1)
        logger.system.info('[ScenarioIgnoreEngine] Unregistered rule:', ruleId)
        return true
    }

    fetchExclusionRules(scenarioId?: string): IgnoreRule[] {
        if (scenarioId) {
            return this.rules.filter(r => !r.scenarioScope || r.scenarioScope.length === 0 || r.scenarioScope.includes(scenarioId))
        }
        return [...this.rules]
    }

    getAlwaysIgnored(): string[] {
        const scenarioId = useStore.getState().activeScenarioId ?? 'code-editor'
        const config = SCENARIO_IGNORE_CONFIGS[scenarioId] ?? SCENARIO_IGNORE_CONFIGS['code-editor']
        return [...config.alwaysIgnore]
    }

    dispose(): void {
        this.rules = []
        this.initialized = false
    }
}

export const ignoreEngine = new ScenarioIgnoreEngine()
export { ScenarioIgnoreEngine }

export const shouldIgnore = ignoreEngine.evaluateExclusion.bind(ignoreEngine)
export const addRule = ignoreEngine.registerExclusionRule.bind(ignoreEngine)
export const removeRule = ignoreEngine.unregisterExclusionRule.bind(ignoreEngine)
export const getRules = ignoreEngine.fetchExclusionRules.bind(ignoreEngine)

export const ignoreService = ignoreEngine

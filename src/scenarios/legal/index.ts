import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { LEGAL_WELCOME_SUGGESTIONS, LEGAL_WELCOME_TITLE } from './config/welcome'
import { buildScenarioIdentity } from '../scenarioBrandIdentity'
import LEGAL_TOOLS from './tools/definitions'
import { legalComponents } from './components'

const SCENARIO_ID = 'legal'
const SCENARIO_VERSION = '1.0.0'

const LEGAL_MANIFEST: ScenarioManifest = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  name: 'Legal Counsel',
  nameZh: '法律顾问',
  description: 'AI-powered legal research, contract analysis, and compliance assistant',
  descriptionZh: 'AI 驱动的法律研究、合同分析和合规助手',
  author: 'awee',
  icon: 'Scale',
  category: 'legal',
  tags: ['legal', 'contract', 'compliance', 'law'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: ['filesystem:read', 'filesystem:write', 'network:request'],
}

const LEGAL_PLUGIN: ScenarioPlugin = {
  id: SCENARIO_ID,
  name: 'Legal Counsel',
  nameZh: '法律顾问',
  icon: 'Scale',
  description: 'AI-powered legal research, contract analysis, and compliance assistant',
  descriptionZh: 'AI 驱动的法律研究、合同分析和合规助手',
  version: SCENARIO_VERSION,
  author: 'awee',
  category: 'legal',
  tags: ['legal', 'contract', 'compliance', 'law'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: {
    systemPrompt: buildScenarioIdentity('Legal Counsel', 'focused on legal research and compliance') + `

**Core Legal Capabilities:**
- **Contract Review**: Analyze contracts for risks, ambiguities, and compliance issues
- **Legal Research**: Search statutes, case law, and regulatory guidance
- **Compliance Check**: Verify business practices against applicable regulations
- **Document Drafting**: Generate legal documents, clauses, and amendments
- **Risk Assessment**: Identify legal risks and suggest mitigation strategies
- **Citation Search**: Look up specific legal citations and cross-references`,

    securityRules: `## Legal Scenario Security Rules
- NEVER provide definitive legal advice — always include disclaimers
- NEVER guarantee outcomes of legal proceedings
- ALWAYS note jurisdictional limitations of analysis
- ALWAYS flag when a matter requires licensed attorney review
- NEVER draft documents intended to circumvent regulations
- Protect attorney-client privilege concepts in conversations
- Mark all outputs as "for reference only, not legal advice"`,

    conventions: `## Legal Document Conventions
- Use precise legal terminology appropriate to the jurisdiction
- Cite relevant statutes, regulations, and case law when available
- Structure analyses with clear issue-rule-application-conclusion format
- Highlight key assumptions and limitations
- Use track-changes style for contract modifications
- Include effective dates and governing law clauses in drafts
- Number all contract clauses and sub-clauses consistently`,

    workflow: `## Legal Workflow

### Contract Review Flow
1. **Upload**: Accept contract document for review
2. **Parse**: Identify parties, obligations, terms, and key provisions
3. **Analyze**: Check for risks, ambiguities, missing clauses, and compliance
4. **Report**: Generate structured review with risk ratings and recommendations
5. **Revise**: Draft proposed amendments with explanations

### Legal Research Flow
1. **Question**: Understand the legal question and jurisdiction
2. **Search**: Find relevant statutes, cases, and secondary sources
3. **Synthesize**: Summarize applicable law and key holdings
4. **Apply**: Apply legal principles to the specific factual scenario
5. **Caveat**: Note limitations and recommend professional review

### Compliance Check Flow
1. **Scope**: Identify applicable regulatory framework
2. **Map**: Map business practices to regulatory requirements
3. **Gap**: Identify gaps and potential violations
4. **Remediate**: Suggest corrective actions and timelines
5. **Monitor**: Recommend ongoing compliance monitoring approach`,

    outputFormat: `## Legal Output Format
- Always include jurisdiction disclaimer
- Use IRAC structure for legal analysis (Issue, Rule, Application, Conclusion)
- Risk ratings: 🟢 Low / 🟡 Medium / 🔴 High / ⚫ Critical
- Contract clauses: Use standard numbering (1., 1.1, 1.1.1)
- Cite sources in standard legal citation format`,

    toolGuidelines: `## Legal Tool Usage
- Use contract_review for analyzing contract documents
- Use legal_research for finding statutes, cases, and regulations
- Use compliance_check for verifying regulatory compliance
- Use document_draft for generating legal documents and clauses
- Use risk_assessment for evaluating legal risks in business scenarios
- Use citation_search for looking up specific legal citations
- Always save analysis results for future reference`,
  },

  capabilities: {
    toolPacks: ['code', 'knowledge'],
    modes: [
      {
        id: 'chat',
        label: 'Consult',
        labelZh: '咨询',
        icon: 'MessageSquare',
        description: 'Legal Q&A and general consultation',
        descriptionZh: '法律问答和一般咨询',
        toolPolicy: { enabled: false },
      },
      {
        id: 'agent',
        label: 'Analyze',
        labelZh: '分析',
        icon: 'Search',
        description: 'Deep contract analysis and legal research',
        descriptionZh: '深度合同分析和法律研究',
        toolPolicy: { enabled: true, requireApproval: false },
      },
      {
        id: 'plan',
        label: 'Compliance',
        labelZh: '合规',
        icon: 'Shield',
        description: 'Structured compliance review and remediation',
        descriptionZh: '结构化合规审查和整改',
        toolPolicy: { enabled: true, requireApproval: true },
      },
    ],
    contextTypes: [
      { type: 'Contract', label: 'Contract', labelZh: '合同', icon: 'FileText', priority: 1 },
      { type: 'Statute', label: 'Statute', labelZh: '法规', icon: 'BookOpen', priority: 2 },
      { type: 'Case', label: 'Case Law', labelZh: '案例', icon: 'Gavel', priority: 3 },
      { type: 'Regulation', label: 'Regulation', labelZh: '规章', icon: 'Shield', priority: 4 },
      { type: 'File', label: 'File', labelZh: '文件', priority: 5 },
    ],
    outputFormats: ['markdown', 'text', 'html'],
  },

  ui: {
    layout: 'research-centric',
    panels: [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true, minWidth: 360, maxWidth: 800 },
      { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 500 },
    ],
    sidebarItems: [
      { id: 'knowledge', icon: 'BookOpen', label: 'Law Library', labelZh: '法律库', component: 'KnowledgeView', position: 0 },
      { id: 'contract-review', icon: 'FileText', label: 'Contract Review', labelZh: '合同审查', component: 'ContractReviewPanel', position: 1 },
      { id: 'compliance', icon: 'Shield', label: 'Compliance', labelZh: '合规', component: 'ComplianceDashboard', position: 2 },
      { id: 'explorer', icon: 'FolderTree', label: 'Documents', labelZh: '文档', component: 'ExplorerView', position: 3 },
      { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 4 },
    ],
    statusBarItems: [],
    welcomeSuggestions: LEGAL_WELCOME_SUGGESTIONS,
    welcomeTitle: LEGAL_WELCOME_TITLE,
  },

  dataSources: {
    workspace: true,
    customSources: [
      {
        id: 'legal-database',
        type: 'api',
        label: 'Legal Database',
        labelZh: '法律数据库',
        config: { supportedMethods: ['GET'], authTypes: ['none', 'api-key'] },
      },
    ],
  },
}

const legalModule: ScenarioModule = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,

  getManifest: () => LEGAL_MANIFEST,
  getPlugin: () => LEGAL_PLUGIN,
  getTools: () => LEGAL_TOOLS,
  getComponents: () => legalComponents,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing legal scenario: v${context.version}`)

    if (context.workspacePath) {
      try {
        const { api } = await import('@services/electronBridge')
        await api.file.mkdir(`${context.workspacePath}/.legal/contracts`)
        await api.file.mkdir(`${context.workspacePath}/.legal/compliance`)
        log.info('Created legal workspace directories')
      } catch (err) {
        log.warn(`Failed to create legal directories: ${err}`)
      }
    }
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating legal scenario: v${context.version}`)

    health.reportCheck('tools', 'healthy', `${LEGAL_TOOLS.length} legal tools available`)
    health.reportCheck('components', 'healthy', '2 legal components registered')

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
      capabilities: ['contract_review', 'legal_research', 'compliance_check', 'document_draft', 'risk_assessment', 'citation_search'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    context.getLogger().info(`Uninstalling legal scenario`)
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'tools', status: 'healthy', message: `${LEGAL_TOOLS.length} tools available` },
      { name: 'components', status: 'healthy', message: '2 components registered' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => [],
}

export default legalModule

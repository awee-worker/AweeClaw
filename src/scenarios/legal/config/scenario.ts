import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { LEGAL_WELCOME_SUGGESTIONS, LEGAL_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const LEGAL_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Legal Counsel', 'focused on legal research and compliance') + `

**Core Legal Capabilities:**
- **Contract Review**: Analyze contracts for risks, ambiguities, and compliance issues
- **Legal Research**: Search statutes, case law, and regulatory guidance
- **Compliance Check**: Verify business practices against applicable regulations
- **Document Drafting**: Generate legal documents, clauses, and amendments
- **Risk Assessment**: Identify legal risks and suggest mitigation strategies
- **Due Diligence**: Support M&A due diligence with structured analysis`,

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
- Use file tools to read and analyze contract documents
- Use search tools for legal research queries
- Use knowledge base for storing legal precedents and templates
- Always save analysis results for future reference
- Batch document reviews when processing multiple contracts`,
}

const LEGAL_CAPABILITIES: ScenarioCapabilities = {
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
}

const LEGAL_UI: ScenarioUI = {
  layout: 'research-centric',
  panels: [
    { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true, minWidth: 360, maxWidth: 800 },
    { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 500 },
  ],
  sidebarItems: [
    { id: 'knowledge', icon: 'BookOpen', label: 'Law Library', labelZh: '法律库', component: 'KnowledgeView', position: 0 },
    { id: 'explorer', icon: 'FolderTree', label: 'Documents', labelZh: '文档', component: 'ExplorerView', position: 1 },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 2 },
  ],
  statusBarItems: [],
  welcomeSuggestions: LEGAL_WELCOME_SUGGESTIONS,
  welcomeTitle: LEGAL_WELCOME_TITLE,
}

const LEGAL_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [],
}

export const legalScenario: ScenarioPlugin = {
  id: 'legal',
  name: 'Legal Counsel',
  nameZh: '法律顾问',
  icon: 'Scale',
  description: 'AI-powered legal research, contract analysis, and compliance assistant',
  descriptionZh: 'AI 驱动的法律研究、合同分析和合规助手',
  version: '1.0.0',
  author: 'awee',
  category: 'legal',
  tags: ['legal', 'contract', 'compliance', 'law'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: LEGAL_IDENTITY,
  capabilities: LEGAL_CAPABILITIES,
  ui: LEGAL_UI,
  dataSources: LEGAL_DATA_SOURCES,
}

export default legalScenario

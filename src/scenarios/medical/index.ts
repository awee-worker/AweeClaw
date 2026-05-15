import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { MEDICAL_WELCOME_SUGGESTIONS, MEDICAL_WELCOME_TITLE } from './config/welcome'
import { buildScenarioIdentity } from '../scenarioBrandIdentity'
import MEDICAL_TOOLS from './tools/definitions'
import { medicalComponents } from './components'

const SCENARIO_ID = 'medical'
const SCENARIO_VERSION = '1.0.0'

const MEDICAL_MANIFEST: ScenarioManifest = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  name: 'Medical Assistant',
  nameZh: '医疗助手',
  description: 'AI-powered medical information and health guidance (for reference only)',
  descriptionZh: 'AI 驱动的医学信息和健康指导（仅供参考）',
  author: 'awee',
  icon: 'Stethoscope',
  category: 'health',
  tags: ['medical', 'health', 'diagnosis', 'drug-info'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: ['filesystem:read', 'filesystem:write', 'network:request'],
}

const MEDICAL_PLUGIN: ScenarioPlugin = {
  id: SCENARIO_ID,
  name: 'Medical Assistant',
  nameZh: '医疗助手',
  icon: 'Stethoscope',
  description: 'AI-powered medical information and health guidance (for reference only)',
  descriptionZh: 'AI 驱动的医学信息和健康指导（仅供参考）',
  version: SCENARIO_VERSION,
  author: 'awee',
  category: 'health',
  tags: ['medical', 'health', 'diagnosis', 'drug-info'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: {
    systemPrompt: buildScenarioIdentity('Medical Assistant', 'focused on medical information and health guidance') + `

**Core Medical Capabilities:**
- **Symptom Analysis**: Help understand possible causes for reported symptoms
- **Report Interpretation**: Explain medical reports and lab results in plain language
- **Drug Information**: Provide medication details, interactions, and dosage guidelines
- **Health Guidance**: Evidence-based wellness and prevention recommendations
- **Medical Research**: Search and summarize medical literature and clinical guidelines
- **Patient Education**: Explain medical conditions and treatment options clearly

⚠️ **CRITICAL DISCLAIMER**: This AI is NOT a licensed medical professional. All information provided is for REFERENCE ONLY and should NOT replace professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider for medical decisions.`,

    securityRules: `## Medical Scenario Security Rules (CRITICAL)
- NEVER provide definitive medical diagnoses — always include disclaimers
- NEVER recommend specific treatment plans — only provide information
- NEVER override or contradict a healthcare provider's advice
- ALWAYS include "consult a healthcare professional" disclaimer
- ALWAYS flag emergency situations requiring immediate medical attention
- NEVER prescribe medications or suggest dosage changes
- Protect patient privacy — never store or share personal health information
- Mark all outputs as "for reference only, not medical advice"
- If symptoms suggest a serious condition, strongly recommend seeking immediate care`,

    conventions: `## Medical Content Conventions
- Use precise medical terminology with plain-language explanations
- Cite clinical guidelines, research papers, and authoritative sources
- Structure information with: Overview → Symptoms → Causes → Diagnosis → Treatment
- Clearly distinguish between established facts and emerging research
- Use evidence strength indicators: (Strong Evidence) / (Moderate Evidence) / (Limited Evidence)
- Include ICD-10 codes when discussing specific conditions
- Present differential diagnoses when analyzing symptoms
- Always include red flag warnings for serious conditions`,

    workflow: `## Medical Workflow

### Symptom Analysis Flow
1. **Gather**: Collect symptom details (onset, duration, severity, associated factors)
2. **Analyze**: Identify possible conditions based on symptom patterns
3. **Prioritize**: Rank differential diagnoses by likelihood and severity
4. **Red Flags**: Identify any warning signs requiring urgent attention
5. **Advise**: Recommend appropriate next steps (see a doctor, self-care, etc.)
6. **Disclaimer**: Always include medical disclaimer

### Report Interpretation Flow
1. **Parse**: Extract key values and findings from the report
2. **Reference**: Compare against normal reference ranges
3. **Explain**: Translate medical terminology to plain language
4. **Context**: Explain what abnormal values might indicate
5. **Recommend**: Suggest follow-up questions for the healthcare provider
6. **Disclaimer**: Always include medical disclaimer

### Drug Information Flow
1. **Identify**: Confirm the medication name and formulation
2. **Profile**: Provide mechanism of action, indications, and contraindications
3. **Interactions**: Check for known drug-drug and drug-food interactions
4. **Side Effects**: List common and serious adverse effects
5. **Guidance**: General usage information (NOT dosage recommendations)
6. **Disclaimer**: Always include medical disclaimer`,

    outputFormat: `## Medical Output Format
- ALWAYS start with disclaimer: "⚠️ This information is for reference only and does not constitute medical advice."
- Use structured format with clear sections
- Evidence strength: 🟢 Strong / 🟡 Moderate / 🔴 Limited
- Red flag warnings: 🚨 Requires immediate medical attention
- Include "When to see a doctor" section for symptom analyses
- End with: "Please consult a qualified healthcare professional for personalized medical advice."`,

    toolGuidelines: `## Medical Tool Usage
- Use symptom_analysis for analyzing reported symptoms
- Use report_interpret for explaining medical reports
- Use drug_lookup for medication information
- Use guideline_search for clinical practice guidelines
- Use health_assessment for general health risk evaluation
- Use literature_review for medical research summaries
- Never store personal health information without explicit consent`,
  },

  capabilities: {
    toolPacks: ['code', 'knowledge'],
    modes: [
      {
        id: 'chat',
        label: 'Consult',
        labelZh: '咨询',
        icon: 'MessageSquare',
        description: 'General medical information Q&A',
        descriptionZh: '一般医学信息问答',
        toolPolicy: { enabled: false },
      },
      {
        id: 'agent',
        label: 'Analyze',
        labelZh: '分析',
        icon: 'Stethoscope',
        description: 'Detailed symptom and report analysis',
        descriptionZh: '详细症状和报告分析',
        toolPolicy: { enabled: true, requireApproval: false },
      },
      {
        id: 'plan',
        label: 'Research',
        labelZh: '研究',
        icon: 'Microscope',
        description: 'Medical literature search and review',
        descriptionZh: '医学文献搜索和综述',
        toolPolicy: { enabled: true, requireApproval: true },
      },
    ],
    contextTypes: [
      { type: 'Symptom', label: 'Symptoms', labelZh: '症状', icon: 'Stethoscope', priority: 1 },
      { type: 'Report', label: 'Medical Report', labelZh: '医学报告', icon: 'FileText', priority: 2 },
      { type: 'Drug', label: 'Medication', labelZh: '药物', icon: 'Pill', priority: 3 },
      { type: 'Guideline', label: 'Clinical Guideline', labelZh: '临床指南', icon: 'BookOpen', priority: 4 },
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
      { id: 'knowledge', icon: 'BookOpen', label: 'Medical Library', labelZh: '医学库', component: 'KnowledgeView', position: 0 },
      { id: 'symptom-checker', icon: 'Stethoscope', label: 'Symptom Check', labelZh: '症状分析', component: 'SymptomCheckerPanel', position: 1 },
      { id: 'drug-info', icon: 'Pill', label: 'Drug Info', labelZh: '药物信息', component: 'DrugInfoPanel', position: 2 },
      { id: 'explorer', icon: 'FolderTree', label: 'Documents', labelZh: '文档', component: 'ExplorerView', position: 3 },
      { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 4 },
    ],
    statusBarItems: [],
    welcomeSuggestions: MEDICAL_WELCOME_SUGGESTIONS,
    welcomeTitle: MEDICAL_WELCOME_TITLE,
  },

  dataSources: {
    workspace: true,
    customSources: [
      {
        id: 'medical-database',
        type: 'api',
        label: 'Medical Database',
        labelZh: '医学数据库',
        config: { supportedMethods: ['GET'], authTypes: ['none', 'api-key'] },
      },
    ],
  },
}

const medicalModule: ScenarioModule = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,

  getManifest: () => MEDICAL_MANIFEST,
  getPlugin: () => MEDICAL_PLUGIN,
  getTools: () => MEDICAL_TOOLS,
  getComponents: () => medicalComponents,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing medical scenario: v${context.version}`)

    if (context.workspacePath) {
      try {
        const { api } = await import('@services/electronBridge')
        await api.file.mkdir(`${context.workspacePath}/.medical/reports`)
        await api.file.mkdir(`${context.workspacePath}/.medical/analyses`)
        log.info('Created medical workspace directories')
      } catch (err) {
        log.warn(`Failed to create medical directories: ${err}`)
      }
    }
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating medical scenario: v${context.version}`)

    health.reportCheck('tools', 'healthy', `${MEDICAL_TOOLS.length} medical tools available`)
    health.reportCheck('components', 'healthy', '2 medical components registered')

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
      capabilities: ['symptom_analysis', 'report_interpret', 'drug_lookup', 'guideline_search', 'health_assessment', 'literature_review'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    context.getLogger().info(`Uninstalling medical scenario`)
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'tools', status: 'healthy', message: `${MEDICAL_TOOLS.length} tools available` },
      { name: 'components', status: 'healthy', message: '2 components registered' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => [],
}

export default medicalModule

import type { ToolDefinition } from '@protocols'
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import { legalExecutors } from './toolExecutors'

const CONTRACT_REVIEW: ToolDefinition = {
  name: 'contract_review',
  description: 'Analyze a contract document for risks, ambiguities, missing clauses, and compliance issues. Returns structured review with risk ratings per clause, identified issues, and recommendations. Supports PDF, DOCX, and plain text formats.',
  parameters: {
    type: 'object',
    properties: {
      document_path: { type: 'string', description: 'Path to the contract document to review' },
      document_text: { type: 'string', description: 'Contract text content (alternative to file path)' },
      jurisdiction: { type: 'string', description: 'Applicable jurisdiction for compliance checking', enum: ['cn', 'us', 'eu', 'uk', 'jp'] },
      focus_areas: { type: 'array', items: { type: 'string' }, description: 'Specific areas to focus on (e.g., liability, termination, IP, data protection)' },
      party_role: { type: 'string', description: 'Which party perspective to analyze from (e.g., "buyer", "seller", "service provider")' },
    },
  },
}

const LEGAL_RESEARCH: ToolDefinition = {
  name: 'legal_research',
  description: 'Search for relevant statutes, case law, regulations, and legal commentary. Returns structured citations with relevance scores, summaries, and jurisdiction-specific analysis. Always includes disclaimers that results are for reference only.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The legal question or topic to research' },
      jurisdiction: { type: 'string', description: 'Target jurisdiction for the research', enum: ['cn', 'us', 'eu', 'uk', 'jp'] },
      document_types: { type: 'array', items: { type: 'string', enum: ['statute', 'case', 'regulation', 'guideline'] }, description: 'Types of legal documents to search (default: all)' },
      max_results: { type: 'number', description: 'Maximum number of results to return (default: 10, max: 50)' },
    },
    required: ['query'],
  },
}

const COMPLIANCE_CHECK: ToolDefinition = {
  name: 'compliance_check',
  description: 'Verify business practices or documents against applicable regulatory frameworks. Supports GDPR, SOX, HIPAA, PRC Personal Information Protection Law, and other major regulations. Returns compliance score with gap analysis and remediation steps.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Description of the business practice or document to check' },
      framework: { type: 'string', description: 'Regulatory framework to check against', enum: ['gdpr', 'sox', 'hipaa', 'pipl', 'ccpa', 'iso27001', 'pci_dss', 'labor_law_cn', 'company_law_cn'] },
      jurisdiction: { type: 'string', description: 'Applicable jurisdiction', enum: ['cn', 'us', 'eu', 'uk', 'jp'] },
      document_path: { type: 'string', description: 'Optional path to a document to check for compliance' },
    },
    required: ['target', 'framework'],
  },
}

const DOCUMENT_DRAFT: ToolDefinition = {
  name: 'document_draft',
  description: 'Generate legal document drafts including contract clauses, amendments, legal memos, and compliance policies. Uses templates with variable substitution. All drafts include jurisdiction disclaimers and require professional review before use.',
  parameters: {
    type: 'object',
    properties: {
      document_type: { type: 'string', description: 'Type of legal document to draft', enum: ['contract_clause', 'nda', 'service_agreement', 'employment_contract', 'privacy_policy', 'legal_memo', 'amendment', 'compliance_policy'] },
      jurisdiction: { type: 'string', description: 'Target jurisdiction for the document', enum: ['cn', 'us', 'eu', 'uk', 'jp'] },
      description: { type: 'string', description: 'Description of what the document should cover' },
      variables: { type: 'object', description: 'Key-value pairs for template variable substitution (e.g., party names, dates, amounts)', properties: {} },
      language: { type: 'string', description: 'Document language (default: matches jurisdiction)', enum: ['zh', 'en', 'ja'] },
    },
    required: ['document_type', 'description'],
  },
}

const RISK_ASSESSMENT: ToolDefinition = {
  name: 'risk_assessment',
  description: 'Perform structured legal risk assessment for a business scenario or transaction. Evaluates likelihood and impact of legal risks, provides risk scores, and suggests mitigation strategies. Uses a 5x5 risk matrix methodology.',
  parameters: {
    type: 'object',
    properties: {
      scenario: { type: 'string', description: 'Description of the business scenario or transaction to assess' },
      jurisdiction: { type: 'string', description: 'Applicable jurisdiction', enum: ['cn', 'us', 'eu', 'uk', 'jp'] },
      categories: { type: 'array', items: { type: 'string', enum: ['contractual', 'regulatory', 'ip', 'employment', 'data_privacy', 'litigation', 'corporate', 'tax'] }, description: 'Risk categories to assess (default: all relevant)' },
    },
    required: ['scenario'],
  },
}

const CITATION_SEARCH: ToolDefinition = {
  name: 'citation_search',
  description: 'Search for specific legal citations by statute name, case number, or regulation reference. Returns full citation details, effective dates, and related references. Useful for verifying citations found in documents.',
  parameters: {
    type: 'object',
    properties: {
      citation: { type: 'string', description: 'The citation or reference to look up (e.g., "Civil Code Art. 500", "GDPR Article 6")' },
      jurisdiction: { type: 'string', description: 'Jurisdiction of the citation', enum: ['cn', 'us', 'eu', 'uk', 'jp'] },
      include_related: { type: 'boolean', description: 'Include related citations and cross-references (default: true)' },
    },
    required: ['citation'],
  },
}

const LEGAL_TOOLS: ScenarioToolDefinition[] = [
  { name: 'contract_review', definition: CONTRACT_REVIEW, executor: legalExecutors.contract_review },
  { name: 'legal_research', definition: LEGAL_RESEARCH, executor: legalExecutors.legal_research },
  { name: 'compliance_check', definition: COMPLIANCE_CHECK, executor: legalExecutors.compliance_check },
  { name: 'document_draft', definition: DOCUMENT_DRAFT, executor: legalExecutors.document_draft },
  { name: 'risk_assessment', definition: RISK_ASSESSMENT, executor: legalExecutors.risk_assessment },
  { name: 'citation_search', definition: CITATION_SEARCH, executor: legalExecutors.citation_search },
]

export default LEGAL_TOOLS

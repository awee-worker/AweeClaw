export type ContractRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ComplianceStatus = 'compliant' | 'partial' | 'non-compliant' | 'unknown'

export type LegalDocumentType = 'contract' | 'statute' | 'case_law' | 'regulation' | 'memo' | 'brief' | 'amendment'

export type Jurisdiction = 'cn' | 'us' | 'eu' | 'uk' | 'jp' | 'other'

export interface ContractMetadata {
  id: string
  title: string
  parties: string[]
  effectiveDate?: string
  expiryDate?: string
  jurisdiction: Jurisdiction
  documentType: LegalDocumentType
  tags: string[]
  filePath?: string
  createdAt: number
  updatedAt: number
}

export interface ContractClause {
  number: string
  title: string
  content: string
  riskLevel: ContractRiskLevel
  issues: ContractIssue[]
  suggestions: string[]
}

export interface ContractIssue {
  clauseNumber: string
  severity: ContractRiskLevel
  category: 'ambiguity' | 'missing' | 'non_compliant' | 'unfavorable' | 'unusual'
  description: string
  recommendation: string
}

export interface ContractReviewResult {
  contractId: string
  overallRisk: ContractRiskLevel
  summary: string
  clauses: ContractClause[]
  issues: ContractIssue[]
  complianceFlags: ComplianceFlag[]
  recommendations: string[]
  reviewedAt: number
}

export interface ComplianceFlag {
  regulation: string
  article?: string
  status: ComplianceStatus
  description: string
  remediation?: string
}

export interface ComplianceCheckResult {
  id: string
  framework: string
  jurisdiction: Jurisdiction
  overallStatus: ComplianceStatus
  score: number
  checks: ComplianceCheckItem[]
  generatedAt: number
}

export interface ComplianceCheckItem {
  requirement: string
  regulation: string
  status: ComplianceStatus
  evidence: string
  gap?: string
  remediation?: string
  priority: 'immediate' | 'high' | 'medium' | 'low'
}

export interface LegalCitation {
  id: string
  type: 'statute' | 'case' | 'regulation' | 'guideline'
  title: string
  citation: string
  jurisdiction: Jurisdiction
  effectiveDate?: string
  relevance: number
  summary?: string
  url?: string
}

export interface LegalResearchResult {
  query: string
  jurisdiction: Jurisdiction
  citations: LegalCitation[]
  summary: string
  analysis: string
  disclaimers: string[]
  searchedAt: number
}

export interface RiskAssessment {
  id: string
  category: string
  description: string
  likelihood: 'unlikely' | 'possible' | 'likely' | 'almost_certain'
  impact: 'negligible' | 'minor' | 'moderate' | 'major' | 'catastrophic'
  riskScore: number
  mitigation: string[]
  residualRisk: ContractRiskLevel
}

export interface DocumentDraft {
  id: string
  title: string
  documentType: LegalDocumentType
  jurisdiction: Jurisdiction
  content: string
  clauses: Array<{ number: string; title: string; content: string }>
  variables: Array<{ name: string; description: string; defaultValue?: string }>
  createdAt: number
}

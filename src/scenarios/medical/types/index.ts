export type SymptomSeverity = 'mild' | 'moderate' | 'severe' | 'critical'

export type EvidenceLevel = 'strong' | 'moderate' | 'limited' | 'insufficient'

export type DrugCategory = 'prescription' | 'otc' | 'supplement' | 'controlled'

export type ReportStatus = 'normal' | 'abnormal' | 'borderline' | 'critical'

export type GuidelineSource = 'who' | 'cdc' | 'nih' | 'nICE' | 'cma' | 'other'

export interface SymptomProfile {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  severity: SymptomSeverity
  onset?: string
  duration?: string
  associatedSymptoms: string[]
  bodyRegion?: string
  redFlags: string[]
}

export interface DifferentialDiagnosis {
  condition: string
  conditionZh: string
  icd10Code?: string
  likelihood: 'high' | 'moderate' | 'low'
  matchingSymptoms: string[]
  distinguishingFeatures: string[]
  recommendedTests: string[]
  urgencyLevel: 'routine' | 'urgent' | 'emergency'
}

export interface SymptomAnalysisResult {
  id: string
  symptoms: SymptomProfile[]
  differentials: DifferentialDiagnosis[]
  redFlags: string[]
  recommendations: string[]
  disclaimer: string
  analyzedAt: number
}

export interface LabValue {
  name: string
  nameZh: string
  value: string | number
  unit: string
  referenceRange: { low: number; high: number }
  status: ReportStatus
  interpretation?: string
}

export interface MedicalReport {
  id: string
  title: string
  titleZh: string
  reportType: 'blood_test' | 'imaging' | 'pathology' | 'physical_exam' | 'other'
  date: string
  labValues?: LabValue[]
  findings?: string
  impression?: string
  filePath?: string
  parsedAt: number
}

export interface ReportInterpretation {
  reportId: string
  summary: string
  summaryZh: string
  abnormalValues: LabValue[]
  criticalValues: LabValue[]
  possibleCauses: string[]
  followUpQuestions: string[]
  disclaimer: string
}

export interface DrugInfo {
  id: string
  name: string
  nameZh: string
  genericName: string
  genericNameZh: string
  category: DrugCategory
  mechanismOfAction: string
  indications: string[]
  contraindications: string[]
  sideEffects: Array<{ name: string; frequency: 'common' | 'uncommon' | 'rare' }>
  interactions: Array<{ drug: string; severity: 'minor' | 'moderate' | 'major'; description: string }>
  dosageForms: string[]
  pregnancyCategory?: string
  evidenceLevel: EvidenceLevel
}

export interface ClinicalGuideline {
  id: string
  title: string
  titleZh: string
  source: GuidelineSource
  year: number
  condition: string
  conditionZh: string
  recommendations: Array<{
    grade: 'A' | 'B' | 'C' | 'D'
    text: string
    textZh: string
    evidenceLevel: EvidenceLevel
  }>
  url?: string
}

export interface HealthAssessment {
  id: string
  category: string
  categoryZh: string
  riskLevel: 'low' | 'moderate' | 'high' | 'very_high'
  factors: Array<{ name: string; nameZh: string; impact: 'positive' | 'negative' | 'neutral'; description: string }>
  recommendations: string[]
  evidenceLevel: EvidenceLevel
}

export interface LiteratureReview {
  id: string
  query: string
  articles: Array<{
    title: string
    authors: string
    journal: string
    year: number
    doi?: string
    abstract: string
    relevanceScore: number
  }>
  summary: string
  disclaimer: string
  searchedAt: number
}

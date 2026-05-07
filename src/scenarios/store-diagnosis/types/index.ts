export type StoreType = 'retail' | 'restaurant' | 'service' | 'other'

export type DiagnosisDimension =
  | 'operations'
  | 'cost'
  | 'competition'
  | 'scene'

export type DiagnosisStatus = 'pending' | 'running' | 'completed' | 'failed'

export type OptimizationStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface StoreInfo {
  id: string
  name: string
  type: StoreType
  area: number
  businessHours: string
  employeeCount: number
  avgTransactionValue: number
  mainCategories: string
  rentCost: number
  decorationAge: number
  region: string
  photos: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface DiagnosisRecord {
  id: string
  storeId: string
  dimension: DiagnosisDimension
  status: DiagnosisStatus
  score: number
  summary: string
  details: string
  recommendations: string
  diagnosedAt: string
}

export interface OptimizationPlan {
  id: string
  storeId: string
  diagnosisId: string
  title: string
  description: string
  priority: number
  status: OptimizationStatus
  expectedEffect: string
  executionCycle: string
  tasks: string
  createdAt: string
  updatedAt: string
}

export interface PlanTask {
  id: string
  planId: string
  title: string
  description: string
  assignee: string
  dueDate: string
  status: TaskStatus
  completedAt: string | null
}

export interface BenchmarkData {
  category: string
  metric: string
  industryAvg: number
  topQuartile: number
  unit: string
}

export interface DiagnosisScoreCard {
  overall: number
  operations: number
  cost: number
  competition: number
  scene: number
}

export interface StoreFinancialData {
  storeId: string
  period: string
  revenue: number
  rentCost: number
  laborCost: number
  materialCost: number
  utilityCost: number
  otherCost: number
  customerCount: number
  repeatCustomerRate: number
  avgTransactionValue: number
}

export interface StoreTrafficData {
  storeId: string
  date: string
  hour: number
  customerCount: number
  newCustomerCount: number
  returningCustomerCount: number
}

import type { ToolDefinition } from '@protocols'
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import { medicalExecutors } from './toolExecutors'

const SYMPTOM_ANALYSIS: ToolDefinition = {
  name: 'symptom_analysis',
  description: 'Analyze reported symptoms to identify possible conditions, generate differential diagnoses, and flag red flags requiring urgent attention. CRITICAL: This is for reference only and does NOT constitute medical diagnosis. Always recommend consulting a healthcare professional.',
  parameters: {
    type: 'object',
    properties: {
      symptoms: { type: 'array', items: { type: 'string' }, description: 'List of symptoms to analyze' },
      duration: { type: 'string', description: 'How long symptoms have been present (e.g., "3 days", "2 weeks")' },
      severity: { type: 'string', description: 'Overall severity', enum: ['mild', 'moderate', 'severe'] },
      age: { type: 'number', description: 'Patient age (for age-appropriate analysis)' },
      gender: { type: 'string', description: 'Patient gender (for gender-specific conditions)', enum: ['male', 'female', 'other'] },
      medical_history: { type: 'array', items: { type: 'string' }, description: 'Relevant medical history' },
      current_medications: { type: 'array', items: { type: 'string' }, description: 'Current medications' },
    },
    required: ['symptoms'],
  },
}

const REPORT_INTERPRET: ToolDefinition = {
  name: 'report_interpret',
  description: 'Interpret medical reports and lab results in plain language. Compares values against reference ranges, identifies abnormal results, and suggests follow-up questions for the healthcare provider. CRITICAL: For reference only, not medical advice.',
  parameters: {
    type: 'object',
    properties: {
      report_text: { type: 'string', description: 'Medical report text content to interpret' },
      report_path: { type: 'string', description: 'Path to the medical report file (alternative to text)' },
      report_type: { type: 'string', description: 'Type of report', enum: ['blood_test', 'imaging', 'pathology', 'physical_exam', 'other'] },
      language: { type: 'string', description: 'Output language', enum: ['zh', 'en'] },
    },
  },
}

const DRUG_LOOKUP: ToolDefinition = {
  name: 'drug_lookup',
  description: 'Look up medication information including mechanism of action, indications, contraindications, side effects, and drug interactions. CRITICAL: For reference only, does not replace professional pharmaceutical advice.',
  parameters: {
    type: 'object',
    properties: {
      drug_name: { type: 'string', description: 'Name of the medication to look up (generic or brand name)' },
      include_interactions: { type: 'boolean', description: 'Include drug interaction information (default: true)' },
      include_side_effects: { type: 'boolean', description: 'Include side effect information (default: true)' },
      check_with: { type: 'array', items: { type: 'string' }, description: 'Other medications to check interactions with' },
    },
    required: ['drug_name'],
  },
}

const GUIDELINE_SEARCH: ToolDefinition = {
  name: 'guideline_search',
  description: 'Search clinical practice guidelines from WHO, CDC, NIH, NICE, CMA and other authoritative sources. Returns evidence-based recommendations with grading. CRITICAL: Guidelines are for reference only.',
  parameters: {
    type: 'object',
    properties: {
      condition: { type: 'string', description: 'Medical condition or topic to search guidelines for' },
      source: { type: 'string', description: 'Preferred guideline source', enum: ['who', 'cdc', 'nih', 'nice', 'cma', 'any'] },
      year_from: { type: 'number', description: 'Minimum publication year (default: 2018)' },
    },
    required: ['condition'],
  },
}

const HEALTH_ASSESSMENT: ToolDefinition = {
  name: 'health_assessment',
  description: 'Perform a general health risk assessment based on lifestyle factors, family history, and known conditions. Provides risk levels and evidence-based recommendations. CRITICAL: For reference only, not a substitute for professional medical evaluation.',
  parameters: {
    type: 'object',
    properties: {
      age: { type: 'number', description: 'Age' },
      gender: { type: 'string', description: 'Gender', enum: ['male', 'female', 'other'] },
      lifestyle: { type: 'object', description: 'Lifestyle factors', properties: { smoking: { type: 'boolean' }, alcohol: { type: 'string' }, exercise: { type: 'string' }, diet: { type: 'string' }, sleep: { type: 'string' } } },
      family_history: { type: 'array', items: { type: 'string' }, description: 'Family history of conditions' },
      existing_conditions: { type: 'array', items: { type: 'string' }, description: 'Existing medical conditions' },
    },
  },
}

const LITERATURE_REVIEW: ToolDefinition = {
  name: 'literature_review',
  description: 'Search and summarize medical literature on a specific topic. Returns relevant articles with abstracts, relevance scores, and a synthesized summary. CRITICAL: Literature review is for reference only and should not replace clinical judgment.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Medical topic or research question' },
      max_results: { type: 'number', description: 'Maximum number of articles to return (default: 10, max: 30)' },
      year_from: { type: 'number', description: 'Minimum publication year (default: 2019)' },
      study_type: { type: 'string', description: 'Preferred study type', enum: ['rct', 'meta_analysis', 'systematic_review', 'observational', 'any'] },
    },
    required: ['query'],
  },
}

const MEDICAL_TOOLS: ScenarioToolDefinition[] = [
  { name: 'symptom_analysis', definition: SYMPTOM_ANALYSIS, executor: medicalExecutors.symptom_analysis },
  { name: 'report_interpret', definition: REPORT_INTERPRET, executor: medicalExecutors.report_interpret },
  { name: 'drug_lookup', definition: DRUG_LOOKUP, executor: medicalExecutors.drug_lookup },
  { name: 'guideline_search', definition: GUIDELINE_SEARCH, executor: medicalExecutors.guideline_search },
  { name: 'health_assessment', definition: HEALTH_ASSESSMENT, executor: medicalExecutors.health_assessment },
  { name: 'literature_review', definition: LITERATURE_REVIEW, executor: medicalExecutors.literature_review },
]

export default MEDICAL_TOOLS

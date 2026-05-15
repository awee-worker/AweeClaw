import { api } from '@services/electronBridge'
import type { MedicalReport, SymptomAnalysisResult } from '../providerTypes'

export async function saveMedicalReport(report: MedicalReport): Promise<{ success: boolean; error?: string }> {
  try {
    await api.file.write(
      `.medical/reports/${report.id}.json`,
      JSON.stringify(report, null, 2)
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadMedicalReport(reportId: string): Promise<MedicalReport | null> {
  try {
    const content = await api.file.read(`.medical/reports/${reportId}.json`)
    return JSON.parse(typeof content === 'string' ? content : String(content)) as MedicalReport
  } catch {
    return null
  }
}

export async function listMedicalReports(): Promise<MedicalReport[]> {
  try {
    const files = await api.file.readDir('.medical/reports')
    const reports: MedicalReport[] = []
    for (const file of files) {
      if (String(file).endsWith('.json')) {
        const id = String(file).replace('.json', '')
        const report = await loadMedicalReport(id)
        if (report) reports.push(report)
      }
    }
    return reports.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  } catch {
    return []
  }
}

export async function saveSymptomAnalysis(analysis: SymptomAnalysisResult): Promise<{ success: boolean }> {
  try {
    await api.file.write(
      `.medical/analyses/${analysis.id}.json`,
      JSON.stringify(analysis, null, 2)
    )
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function getDrugInteractionWarning(drugs: string[]): Promise<string | null> {
  if (drugs.length < 2) return null
  return null
}

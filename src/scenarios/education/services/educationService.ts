import { api } from '@services/electronBridge'
import type { StudyPlan, LearningProgress, QuizResult } from '../providerTypes'

export async function saveStudyPlan(plan: StudyPlan): Promise<{ success: boolean; error?: string }> {
  try {
    await api.file.write(
      `.education/plans/${plan.id}.json`,
      JSON.stringify(plan, null, 2)
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadStudyPlan(planId: string): Promise<StudyPlan | null> {
  try {
    const content = await api.file.read(`.education/plans/${planId}.json`)
    return JSON.parse(typeof content === 'string' ? content : String(content)) as StudyPlan
  } catch {
    return null
  }
}

export async function saveProgress(progress: LearningProgress): Promise<{ success: boolean }> {
  try {
    await api.file.write(
      `.education/progress/${progress.topicId}.json`,
      JSON.stringify(progress, null, 2)
    )
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function loadProgress(topicId: string): Promise<LearningProgress | null> {
  try {
    const content = await api.file.read(`.education/progress/${topicId}.json`)
    return JSON.parse(typeof content === 'string' ? content : String(content)) as LearningProgress
  } catch {
    return null
  }
}

export async function saveQuizResult(result: QuizResult): Promise<{ success: boolean }> {
  try {
    const existingRaw = await api.file.read(`.education/quiz_results/${result.quizId}.json`)
    const existing = existingRaw ? JSON.parse(typeof existingRaw === 'string' ? existingRaw : String(existingRaw)) as QuizResult[] : []
    existing.push(result)
    await api.file.write(
      `.education/quiz_results/${result.quizId}.json`,
      JSON.stringify(existing, null, 2)
    )
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function getReviewSchedule(topicId: string): Promise<Array<{ date: string; topicId: string }>> {
  const progress = await loadProgress(topicId)
  if (!progress) return []

  const now = Date.now()
  const intervals = [1, 3, 7, 14, 30]

  return intervals
    .map(days => ({
      date: new Date(now + days * 86400000).toISOString().split('T')[0],
      topicId,
    }))
}

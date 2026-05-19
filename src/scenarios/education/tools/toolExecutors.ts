import type { ToolExecutionResult, ToolExecutionContext } from '../../../scenario-system/providerTypes'
import { scenarioDatabaseManager } from '@scenario-system/core/ScenarioDatabaseManager'

const DB_NAME = 'education'

function esc(v: string): string {
  return v ? v.replace(/'/g, "''") : ''
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function ok(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

function fail(error: string): ToolExecutionResult {
  return { success: false, result: '', error }
}

async function query(sql: string) {
  return scenarioDatabaseManager.executeSql(DB_NAME, sql)
}

function sm2Algorithm(quality: number, interval: number, easeFactor: number): { newInterval: number; newEaseFactor: number } {
  let newEaseFactor = easeFactor
  if (quality >= 3) {
    if (interval === 0) {
      return { newInterval: 1, newEaseFactor }
    } else if (interval === 1) {
      return { newInterval: 6, newEaseFactor }
    } else {
      return { newInterval: Math.round(interval * newEaseFactor), newEaseFactor }
    }
  } else {
    newEaseFactor = Math.max(1.3, newEaseFactor - 0.08 + (0.02 * quality))
    return { newInterval: 0, newEaseFactor }
  }
}

async function updateTopicMastery(topicId: string, delta: number): Promise<void> {
  if (!topicId) return
  try {
    const topicResult = await query(`SELECT mastery_level FROM topics WHERE id = '${topicId}'`)
    if (topicResult.rows?.length) {
      const current = (topicResult.rows[0] as Record<string, unknown>).mastery_level as number || 0
      const newLevel = Math.min(100, Math.max(0, current + delta))
      await query(`UPDATE topics SET mastery_level = ${newLevel}, updated_at = datetime('now', 'localtime') WHERE id = '${topicId}'`)

      if (newLevel >= 80) {
        await query(`UPDATE topics SET status = 'mastered', updated_at = datetime('now', 'localtime') WHERE id = '${topicId}' AND status != 'mastered'`)
        await checkMilestoneCompletion(topicId)
      } else if (newLevel > 0) {
        await query(`UPDATE topics SET status = 'in_progress', updated_at = datetime('now', 'localtime') WHERE id = '${topicId}' AND status = 'active'`)
      }
    }
  } catch {}
}

async function checkMilestoneCompletion(topicId: string): Promise<void> {
  if (!topicId) return
  try {
    const milestoneResult = await query(`SELECT id, plan_id, topic_ids, status FROM plan_milestones WHERE status != 'completed' AND status != 'mastered'`)
    if (!milestoneResult.rows?.length) return

    for (const ms of milestoneResult.rows as Record<string, unknown>[]) {
      const topicIds = String(ms.topic_ids || '').split(',').filter(Boolean)
      if (!topicIds.includes(topicId)) continue

      const masteredResult = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN mastery_level >= 80 THEN 1 ELSE 0 END) as mastered FROM topics WHERE id IN (${topicIds.map(id => `'${id}'`).join(',')})`)
      if (!masteredResult.rows?.length) continue

      const { total, mastered } = masteredResult.rows[0] as Record<string, number>
      if (total > 0 && mastered >= total) {
        await query(`UPDATE plan_milestones SET status = 'completed', completed_at = datetime('now', 'localtime') WHERE id = '${ms.id}'`)
        await checkPlanCompletion(String(ms.plan_id))
      } else if (mastered > 0) {
        await query(`UPDATE plan_milestones SET status = 'in_progress', started_at = COALESCE(started_at, datetime('now', 'localtime')) WHERE id = '${ms.id}' AND status = 'not_started'`)
      }
    }
  } catch {}
}

async function checkPlanCompletion(planId: string): Promise<void> {
  if (!planId) return
  try {
    const msResult = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' OR status = 'mastered' THEN 1 ELSE 0 END) as done FROM plan_milestones WHERE plan_id = '${planId}'`)
    if (!msResult.rows?.length) return

    const { total, done } = msResult.rows[0] as Record<string, number>
    if (total > 0 && done >= total) {
      await query(`UPDATE study_plans SET status = 'completed', updated_at = datetime('now', 'localtime') WHERE id = '${planId}'`)
    } else {
      await query(`UPDATE study_plans SET completed_days = ${done || 0}, updated_at = datetime('now', 'localtime') WHERE id = '${planId}'`)
    }
  } catch {}
}

async function upsertProgress(params: {
  subjectId: string
  topicId: string
  topic: string
  comprehensionDelta?: number
  timeSpent?: number
  weakAreas?: string[]
  notes?: string
  status?: string
}): Promise<void> {
  const { subjectId, topicId, topic, comprehensionDelta, timeSpent, weakAreas, notes, status } = params
  try {
    const existingResult = await query(`SELECT id, comprehension_score, time_spent_minutes, study_count FROM learning_progress WHERE topic = '${esc(topic)}' AND (topic_id = '${topicId}' OR topic_id = '')`)
    if (existingResult.rows?.length) {
      const row = existingResult.rows[0] as Record<string, unknown>
      const fields: string[] = []
      if (comprehensionDelta !== undefined) {
        const current = (row.comprehension_score as number) || 0
        fields.push(`comprehension_score = ${Math.min(100, Math.max(0, current + comprehensionDelta))}`)
      }
      if (timeSpent) fields.push(`time_spent_minutes = time_spent_minutes + ${timeSpent}`)
      if (weakAreas?.length) fields.push(`weak_areas = '${esc(JSON.stringify(weakAreas))}'`)
      if (notes) fields.push(`notes = '${esc(notes)}'`)
      if (status) fields.push(`status = '${status}'`)
      if (topicId) fields.push(`topic_id = '${topicId}'`)
      fields.push(`study_count = ${(row.study_count as number || 0) + 1}`)
      fields.push(`last_accessed_at = datetime('now', 'localtime')`)
      fields.push(`updated_at = datetime('now', 'localtime')`)
      await query(`UPDATE learning_progress SET ${fields.join(', ')} WHERE id = '${row.id}'`)
    } else {
      const id = genId('prog')
      const score = comprehensionDelta ? Math.min(100, Math.max(0, 50 + comprehensionDelta)) : 0
      await query(`INSERT INTO learning_progress (id, subject_id, topic_id, topic, comprehension_score, time_spent_minutes, weak_areas, notes, status, study_count, last_accessed_at) VALUES ('${id}', '${subjectId || 'general'}', '${topicId || ''}', '${esc(topic)}', ${score}, ${timeSpent || 0}, '${esc(JSON.stringify(weakAreas || []))}', '${esc(notes || '')}', '${status || 'in_progress'}', 1, datetime('now', 'localtime'))`)
    }
  } catch {}
}

async function scheduleReview(params: {
  topic: string
  topicId: string
  subjectId: string
  sourceType: string
  sourceId: string
  intervalDays?: number
}): Promise<void> {
  const { topic, topicId, subjectId, sourceType, sourceId, intervalDays } = params
  try {
    const existingResult = await query(`SELECT id, review_count, ease_factor FROM review_schedule WHERE topic = '${esc(topic)}' AND source_type = '${sourceType}' AND source_id = '${sourceId}'`)
    if (existingResult.rows?.length) {
      const row = existingResult.rows[0] as Record<string, unknown>
      const count = ((row.review_count as number) || 0) + 1
      const ease = (row.ease_factor as number) || 2.5
      const interval = intervalDays || Math.round(Math.pow(2.5, Math.min(count, 10)))
      const nextDate = `datetime('now', '+${interval} days')`
      await query(`UPDATE review_schedule SET next_review_at = ${nextDate}, interval_days = ${interval}, review_count = ${count}, ease_factor = ${ease}, status = 'pending', updated_at = datetime('now', 'localtime') WHERE id = '${row.id}'`)
    } else {
      const id = genId('rev')
      const interval = intervalDays || 1
      const nextDate = `datetime('now', '+${interval} days')`
      await query(`INSERT INTO review_schedule (id, topic, topic_id, subject_id, next_review_at, interval_days, review_count, ease_factor, source_type, source_id, status) VALUES ('${id}', '${esc(topic)}', '${topicId || ''}', '${subjectId || 'general'}', ${nextDate}, ${interval}, 0, 2.5, '${sourceType}', '${sourceId}', 'pending')`)
    }
  } catch {}
}

async function mistakeToFlashcard(mistakeId: string): Promise<void> {
  if (!mistakeId) return
  try {
    const mistakeResult = await query(`SELECT * FROM mistakes WHERE id = '${mistakeId}'`)
    if (!mistakeResult.rows?.length) return

    const m = mistakeResult.rows[0] as Record<string, unknown>
    const existingCard = await query(`SELECT id FROM flashcards WHERE source_type = 'mistake' AND source_id = '${mistakeId}'`)
    if (existingCard.rows?.length) return

    const cardId = genId('card')
    const now = new Date().toISOString()
    const front = String(m.question || '')
    const back = String(m.correct_answer || '') + (m.explanation ? `\n\n解析: ${m.explanation}` : '')
    const hint = String(m.your_answer || '') ? `常见错误: ${m.your_answer}` : ''

    await query(`INSERT INTO flashcards (id, subject_id, topic_id, front, back, hint, difficulty, tags, review_count, correct_count, next_review_at, interval_days, ease_factor, status, source_type, source_id) VALUES ('${cardId}', '${m.subject_id || 'general'}', '${m.topic_id || ''}', '${esc(front)}', '${esc(back)}', '${esc(hint)}', '${m.difficulty || 'intermediate'}', '${esc(String(m.tags || ''))}', 0, 0, '${now}', 1, 2.5, 'new', 'mistake', '${mistakeId}')`)
  } catch {}
}

export const educationExecutors: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> = {

  subject_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'create': {
          const id = genId('subj')
          const sql = `INSERT INTO subjects (id, name, name_en, category, difficulty, description, tags, sort_order, status) VALUES ('${id}', '${esc(args.name as string || '')}', '${esc(args.name_en as string || '')}', '${args.category || 'general'}', '${args.difficulty || 'intermediate'}', '${esc(args.description as string || '')}', '${esc(args.tags as string || '')}', 0, 'active')`
          const result = await query(sql)
          if (!result.success) return fail('Failed to create subject')
          const created = await query(`SELECT * FROM subjects WHERE id = '${id}'`)
          return ok(`Subject "${args.name}" created successfully.`, { subject: created.rows?.[0], subjectId: id })
        }

        case 'update': {
          if (!args.id) return fail('Subject ID is required for update')
          const fields: string[] = []
          if (args.name !== undefined) fields.push(`name = '${esc(args.name as string)}'`)
          if (args.name_en !== undefined) fields.push(`name_en = '${esc(args.name_en as string)}'`)
          if (args.category !== undefined) fields.push(`category = '${args.category}'`)
          if (args.difficulty !== undefined) fields.push(`difficulty = '${args.difficulty}'`)
          if (args.description !== undefined) fields.push(`description = '${esc(args.description as string)}'`)
          if (args.tags !== undefined) fields.push(`tags = '${esc(args.tags as string)}'`)
          if (fields.length === 0) return fail('No fields to update')
          fields.push(`updated_at = datetime('now', 'localtime')`)
          await query(`UPDATE subjects SET ${fields.join(', ')} WHERE id = '${args.id}'`)
          return ok('Subject updated successfully.')
        }

        case 'delete': {
          if (!args.id) return fail('Subject ID is required for delete')
          await query(`UPDATE subjects SET status = 'archived', updated_at = datetime('now', 'localtime') WHERE id = '${args.id}'`)
          return ok('Subject archived successfully.')
        }

        case 'list': {
          const result = await query('SELECT * FROM subjects WHERE status = "active" ORDER BY sort_order, name')
          const rows = result.rows || []
          return ok(`Found ${rows.length} subjects.`, { subjects: rows })
        }

        case 'get': {
          if (!args.id) return fail('Subject ID is required')
          const result = await query(`SELECT * FROM subjects WHERE id = '${args.id}'`)
          if (!result.rows?.length) return fail('Subject not found')
          return ok('Subject found.', { subject: result.rows[0] })
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Subject operation failed: ${(e as Error).message}`)
    }
  },

  topic_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'create': {
          if (!args.title) return fail('Title is required')
          if (!args.subject_id) return fail('Subject ID is required')
          const id = genId('topic')
          const sql = `INSERT INTO topics (id, subject_id, title, title_en, description, difficulty, parent_id, sort_order, status, mastery_level, estimated_minutes, prerequisites, tags) VALUES ('${id}', '${args.subject_id}', '${esc(args.title as string)}', '${esc(args.name_en as string || '')}', '${esc(args.description as string || '')}', '${args.difficulty || 'intermediate'}', '${args.parent_id || ''}', ${args.sort_order || 0}, 'active', 0, ${args.estimated_minutes || 30}, '${esc(args.prerequisites as string || '')}', '${esc(args.tags as string || '')}')`
          const result = await query(sql)
          if (!result.success) return fail('Failed to create topic')
          return ok(`Topic "${args.title}" created.`, { topicId: id })
        }

        case 'bulk_create': {
          if (!args.subject_id) return fail('Subject ID is required')
          const topics = args.topics as Array<Record<string, unknown>>
          if (!Array.isArray(topics) || topics.length === 0) return fail('Topics array is required')
          let added = 0
          for (const t of topics) {
            if (!t.title) continue
            const id = genId('topic')
            const sql = `INSERT INTO topics (id, subject_id, title, title_en, description, difficulty, parent_id, sort_order, status, mastery_level, estimated_minutes, prerequisites, tags) VALUES ('${id}', '${args.subject_id}', '${esc(String(t.title))}', '${esc(String(t.title_en || ''))}', '${esc(String(t.description || ''))}', '${t.difficulty || 'intermediate'}', '${t.parent_id || ''}', ${t.sort_order || added}, 'active', 0, ${t.estimated_minutes || 30}, '${esc(String(t.prerequisites || ''))}', '${esc(String(t.tags || ''))}')`
            const r = await query(sql)
            if (r.success) added++
          }
          return ok(`${added} topics created for subject.`, { added })
        }

        case 'update': {
          if (!args.id) return fail('Topic ID is required')
          const fields: string[] = []
          if (args.title !== undefined) fields.push(`title = '${esc(args.title as string)}'`)
          if (args.description !== undefined) fields.push(`description = '${esc(args.description as string)}'`)
          if (args.difficulty !== undefined) fields.push(`difficulty = '${args.difficulty}'`)
          if (args.mastery_level !== undefined) fields.push(`mastery_level = ${args.mastery_level}`)
          if (args.status !== undefined) fields.push(`status = '${args.status}'`)
          if (args.tags !== undefined) fields.push(`tags = '${esc(args.tags as string)}'`)
          if (fields.length === 0) return fail('No fields to update')
          fields.push(`updated_at = datetime('now', 'localtime')`)
          await query(`UPDATE topics SET ${fields.join(', ')} WHERE id = '${args.id}'`)
          return ok('Topic updated.')
        }

        case 'delete': {
          if (!args.id) return fail('Topic ID is required')
          await query(`DELETE FROM topics WHERE id = '${args.id}'`)
          return ok('Topic deleted.')
        }

        case 'list': {
          if (!args.subject_id) return fail('Subject ID is required')
          const result = await query(`SELECT * FROM topics WHERE subject_id = '${args.subject_id}' AND status = 'active' ORDER BY sort_order, title`)
          return ok(`Found ${(result.rows || []).length} topics.`, { topics: result.rows || [] })
        }

        case 'get': {
          if (!args.id) return fail('Topic ID is required')
          const result = await query(`SELECT * FROM topics WHERE id = '${args.id}'`)
          if (!result.rows?.length) return fail('Topic not found')
          return ok('Topic found.', { topic: result.rows[0] })
        }

        case 'generate_outline': {
          if (!args.subject_id) return fail('Subject ID is required')
          const subjectResult = await query(`SELECT name, name_en, difficulty, description FROM subjects WHERE id = '${args.subject_id}'`)
          if (!subjectResult.rows?.length) return fail('Subject not found')
          const subj = subjectResult.rows[0] as Record<string, unknown>
          const subjectName = String(subj.name || '')
          const subjectDesc = String(subj.description || '')
          const difficulty = String(subj.difficulty || 'intermediate')

          const prompt = `请为学科「${subjectName}」生成结构化的知识点大纲。${subjectDesc ? `学科描述：${subjectDesc}` : ''}难度级别：${difficulty}\n\n要求：\n1. 按层级组织，最多3层深度\n2. 每个知识点包含：title(中文名)、title_en(英文名)、description(简述)、difficulty(难度)、estimated_minutes(预计学习分钟数)\n3. 知识点之间有前置关系(prerequisites)\n4. 输出JSON数组格式，每个元素包含 title, title_en, description, difficulty, estimated_minutes, parent_title, prerequisites\n5. 知识点数量控制在15-30个之间\n6. 确保覆盖该学科的核心知识体系\n\n请严格按JSON数组格式输出，不要包含其他文字。`

          return ok(prompt, { subjectId: args.subject_id, subjectName, action: 'generate_outline' })
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Topic operation failed: ${(e as Error).message}`)
    }
  },

  quiz_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'create': {
          const id = genId('quiz')
          const questionTypes = Array.isArray(args.question_types) ? (args.question_types as string[]).join(',') : 'multiple_choice'
          const sql = `INSERT INTO quizzes (id, subject_id, title, description, difficulty, question_count, question_types, time_limit_minutes, passing_score, status) VALUES ('${id}', '${args.subject_id || 'general'}', '${esc(args.title as string || '')}', '${esc(args.description as string || '')}', '${args.difficulty || 'intermediate'}', ${args.question_count || 5}, '${questionTypes}', ${args.time_limit || 30}, ${args.passing_score || 60}, 'draft')`
          const result = await query(sql)
          if (!result.success) return fail('Failed to create quiz')
          return ok(`Quiz "${args.title}" created. Use add_questions to add questions.`, { quizId: id })
        }

        case 'add_questions': {
          if (!args.quiz_id) return fail('Quiz ID is required')
          const questions = args.questions as Array<Record<string, unknown>>
          if (!Array.isArray(questions) || questions.length === 0) return fail('Questions array is required')

          let added = 0
          for (let i = 0; i < questions.length; i++) {
            const q = questions[i]
            const qId = genId('q')
            const options = Array.isArray(q.options) ? JSON.stringify(q.options) : '[]'
            const topicId = q.topic_id ? `'${q.topic_id}'` : "''"
            const sql = `INSERT INTO quiz_questions (id, quiz_id, topic_id, question_number, type, question, options, correct_answer, explanation, difficulty, points) VALUES ('${qId}', '${args.quiz_id}', ${topicId}, ${i + 1}, '${q.type || 'multiple_choice'}', '${esc(String(q.question || ''))}', '${esc(options)}', '${esc(String(q.correct_answer || ''))}', '${esc(String(q.explanation || ''))}', '${q.difficulty || 'intermediate'}', ${q.points || 1})`
            const r = await query(sql)
            if (r.success) added++
          }

          await query(`UPDATE quizzes SET question_count = ${added}, status = 'published', updated_at = datetime('now', 'localtime') WHERE id = '${args.quiz_id}'`)
          return ok(`${added} questions added to quiz.`)
        }

        case 'record_result': {
          if (!args.quiz_id) return fail('Quiz ID is required')
          const id = genId('result')
          const score = (args.score as number) || 0
          const totalPoints = (args.total_points as number) || 100
          const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0
          const passed = percentage >= 60
          const timeSpent = (args.time_spent as number) || 0

          const sql = `INSERT INTO quiz_results (id, quiz_id, score, total_points, percentage, passed, time_spent_seconds, answers, completed_at) VALUES ('${id}', '${args.quiz_id}', ${score}, ${totalPoints}, ${percentage}, ${passed ? 1 : 0}, ${timeSpent}, '${esc(JSON.stringify(args.answers || []))}', datetime('now', 'localtime'))`
          const result = await query(sql)
          if (!result.success) return fail('Failed to record result')

          const quizInfo = await query(`SELECT subject_id, title FROM quizzes WHERE id = '${args.quiz_id}'`)
          const quiz = quizInfo.rows?.[0] as Record<string, unknown> | undefined
          const subjectId = String(quiz?.subject_id || 'general')
          const quizTitle = String(quiz?.title || '')

          const wrongQuestions = args.wrong_questions as Array<Record<string, unknown>> || []
          const answers = args.answers as Array<Record<string, unknown>> || []

          for (const wq of wrongQuestions) {
            const mistakeId = genId('mistake')
            const topicId = String(wq.topic_id || '')
            await query(`INSERT INTO mistakes (id, subject_id, topic_id, question, your_answer, correct_answer, explanation, source, source_id, difficulty, review_count, mastered) VALUES ('${mistakeId}', '${subjectId}', '${topicId}', '${esc(String(wq.question || ''))}', '${esc(String(wq.your_answer || ''))}', '${esc(String(wq.correct_answer || ''))}', '${esc(String(wq.explanation || ''))}', '${esc(quizTitle)}', '${args.quiz_id}', '${wq.difficulty || 'intermediate'}', 0, 0)`)

            await mistakeToFlashcard(mistakeId)

            if (topicId) {
              await updateTopicMastery(topicId, -10)
            }

            await scheduleReview({
              topic: String(wq.question || '').substring(0, 100),
              topicId,
              subjectId,
              sourceType: 'mistake',
              sourceId: mistakeId,
              intervalDays: 1,
            })
          }

          const topicIds = new Set<string>()
          for (const ans of answers) {
            const tid = String(ans.topic_id || '')
            if (tid) topicIds.add(tid)
          }

          for (const tid of topicIds) {
            if (passed) {
              await updateTopicMastery(tid, 20)
            } else {
              await updateTopicMastery(tid, -5)
            }
          }

          const comprehensionDelta = passed ? 15 : -5
          const mainTopicId = topicIds.values().next().value || ''
          await upsertProgress({
            subjectId,
            topicId: mainTopicId,
            topic: quizTitle,
            comprehensionDelta,
            timeSpent: Math.round(timeSpent / 60),
            status: passed ? 'completed' : 'in_progress',
          })

          await scheduleReview({
            topic: quizTitle,
            topicId: mainTopicId,
            subjectId,
            sourceType: 'quiz',
            sourceId: args.quiz_id as string,
            intervalDays: passed ? 3 : 1,
          })

          const linkages: string[] = []
          if (wrongQuestions.length > 0) {
            linkages.push(`${wrongQuestions.length} mistakes added to review book and auto-converted to flashcards`)
          }
          if (topicIds.size > 0) {
            linkages.push(`${topicIds.size} topic mastery levels updated`)
          }
          linkages.push('Learning progress updated')
          linkages.push('Review scheduled')

          return ok(
            passed
              ? `Quiz passed! Score: ${percentage}%. ${linkages.join('. ')}.`
              : `Quiz not passed (${percentage}%). ${linkages.join('. ')}.`,
            { score, totalPoints, percentage, passed, wrongCount: wrongQuestions.length, topicIds: Array.from(topicIds) }
          )
        }

        case 'list': {
          const subjectId = args.subject_id as string | undefined
          const sql = subjectId
            ? `SELECT * FROM quizzes WHERE subject_id = '${subjectId}' ORDER BY created_at DESC`
            : 'SELECT * FROM quizzes ORDER BY created_at DESC'
          const result = await query(sql)
          return ok(`Found ${(result.rows || []).length} quizzes.`, { quizzes: result.rows || [] })
        }

        case 'get': {
          if (!args.quiz_id) return fail('Quiz ID is required')
          const quizResult = await query(`SELECT * FROM quizzes WHERE id = '${args.quiz_id}'`)
          if (!quizResult.rows?.length) return fail('Quiz not found')
          const questionsResult = await query(`SELECT * FROM quiz_questions WHERE quiz_id = '${args.quiz_id}' ORDER BY question_number`)
          const resultsResult = await query(`SELECT * FROM quiz_results WHERE quiz_id = '${args.quiz_id}' ORDER BY created_at DESC`)
          return ok('Quiz found.', { quiz: quizResult.rows[0], questions: questionsResult.rows || [], results: resultsResult.rows || [] })
        }

        case 'delete': {
          if (!args.quiz_id) return fail('Quiz ID is required')
          await query(`DELETE FROM quiz_questions WHERE quiz_id = '${args.quiz_id}'`)
          await query(`DELETE FROM quiz_results WHERE quiz_id = '${args.quiz_id}'`)
          await query(`DELETE FROM quizzes WHERE id = '${args.quiz_id}'`)
          return ok('Quiz deleted.')
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Quiz operation failed: ${(e as Error).message}`)
    }
  },

  study_plan_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'create': {
          const id = genId('plan')
          const sql = `INSERT INTO study_plans (id, subject_id, title, goal, target_date, daily_minutes, current_level, learning_style, status, total_days, completed_days) VALUES ('${id}', '${args.subject_id || 'general'}', '${esc(args.title as string || '')}', '${esc(args.goal as string || '')}', '${args.target_date || ''}', ${args.daily_minutes || 30}, '${args.current_level || 'beginner'}', '${args.learning_style || 'reading'}', 'active', 0, 0)`
          const result = await query(sql)
          if (!result.success) return fail('Failed to create study plan')
          return ok(`Study plan "${args.title}" created. Use add_milestones to add milestones.`, { planId: id })
        }

        case 'add_milestones': {
          if (!args.plan_id) return fail('Plan ID is required')
          const milestones = args.milestones as Array<Record<string, unknown>>
          if (!Array.isArray(milestones) || milestones.length === 0) return fail('Milestones array is required')

          let added = 0
          for (const m of milestones) {
            const mId = genId('ms')
            const topicIds = Array.isArray(m.topic_ids) ? (m.topic_ids as string[]).join(',') : ''
            const sql = `INSERT INTO plan_milestones (id, plan_id, title, estimated_days, topic_ids, status, sort_order) VALUES ('${mId}', '${args.plan_id}', '${esc(String(m.title || ''))}', ${m.estimated_days || 7}, '${esc(topicIds)}', 'not_started', ${added})`
            const r = await query(sql)
            if (r.success) added++
          }

          const totalDays = milestones.reduce((sum, m) => sum + ((m.estimated_days as number) || 7), 0)
          await query(`UPDATE study_plans SET total_days = ${totalDays}, updated_at = datetime('now', 'localtime') WHERE id = '${args.plan_id}'`)

          return ok(`${added} milestones added.`)
        }

        case 'update_milestone': {
          if (!args.milestone_id) return fail('Milestone ID is required')
          const fields: string[] = []
          if (args.milestone_status) fields.push(`status = '${args.milestone_status}'`)
          if (args.milestone_status === 'completed') {
            fields.push(`completed_at = datetime('now', 'localtime')`)
          }
          if (args.milestone_status === 'in_progress') {
            fields.push(`started_at = COALESCE(started_at, datetime('now', 'localtime'))`)
          }
          if (fields.length === 0) return fail('No fields to update')
          fields.push(`updated_at = datetime('now', 'localtime')`)
          await query(`UPDATE plan_milestones SET ${fields.join(', ')} WHERE id = '${args.milestone_id}'`)

          const msResult = await query(`SELECT plan_id FROM plan_milestones WHERE id = '${args.milestone_id}'`)
          if (msResult.rows?.length) {
            const planId = String((msResult.rows[0] as Record<string, unknown>).plan_id)
            await checkPlanCompletion(planId)
          }

          return ok('Milestone updated.')
        }

        case 'update_progress': {
          if (!args.plan_id) return fail('Plan ID is required')
          const fields: string[] = []
          if (args.status) fields.push(`status = '${args.status}'`)
          fields.push(`updated_at = datetime('now', 'localtime')`)
          await query(`UPDATE study_plans SET ${fields.join(', ')} WHERE id = '${args.plan_id}'`)
          return ok('Plan progress updated.')
        }

        case 'list': {
          const subjectId = args.subject_id as string | undefined
          const sql = subjectId
            ? `SELECT * FROM study_plans WHERE subject_id = '${subjectId}' ORDER BY created_at DESC`
            : 'SELECT * FROM study_plans ORDER BY created_at DESC'
          const result = await query(sql)
          const plans = (result.rows || []) as Record<string, unknown>[]
          for (const plan of plans) {
            const msResult = await query(`SELECT * FROM plan_milestones WHERE plan_id = '${plan.id}' ORDER BY sort_order`)
            plan.milestones = msResult.rows || []
          }
          return ok(`Found ${plans.length} study plans.`, { plans })
        }

        case 'get': {
          if (!args.plan_id) return fail('Plan ID is required')
          const planResult = await query(`SELECT * FROM study_plans WHERE id = '${args.plan_id}'`)
          if (!planResult.rows?.length) return fail('Plan not found')
          const msResult = await query(`SELECT * FROM plan_milestones WHERE plan_id = '${args.plan_id}' ORDER BY sort_order`)
          return ok('Plan found.', { plan: planResult.rows[0], milestones: msResult.rows || [] })
        }

        case 'delete': {
          if (!args.plan_id) return fail('Plan ID is required')
          await query(`DELETE FROM plan_milestones WHERE plan_id = '${args.plan_id}'`)
          await query(`DELETE FROM study_plans WHERE id = '${args.plan_id}'`)
          return ok('Study plan deleted.')
        }

        case 'generate_from_topics': {
          if (!args.subject_id) return fail('Subject ID is required')
          const topicsResult = await query(`SELECT id, title, difficulty, estimated_minutes FROM topics WHERE subject_id = '${args.subject_id}' AND status = 'active' ORDER BY sort_order`)
          const topics = (topicsResult.rows || []) as Record<string, unknown>[]

          if (topics.length === 0) {
            return fail('No topics found for this subject. Generate topics first using topic_manage.generate_outline.')
          }

          const planId = genId('plan')
          const planTitle = args.title as string || `学习计划`
          const goal = args.goal as string || '系统掌握本学科核心知识点'

          await query(`INSERT INTO study_plans (id, subject_id, title, goal, target_date, daily_minutes, current_level, learning_style, status, total_days, completed_days) VALUES ('${planId}', '${args.subject_id}', '${esc(planTitle)}', '${esc(goal)}', '${args.target_date || ''}', ${args.daily_minutes || 30}, '${args.current_level || 'beginner'}', '${args.learning_style || 'reading'}', 'active', 0, 0)`)

          const difficultyOrder: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2, expert: 3 }
          const sortedTopics = [...topics].sort((a, b) => (difficultyOrder[String(a.difficulty)] || 1) - (difficultyOrder[String(b.difficulty)] || 1))

          const groupSize = Math.max(3, Math.ceil(sortedTopics.length / 4))
          const groups: Record<string, unknown>[][] = []
          for (let i = 0; i < sortedTopics.length; i += groupSize) {
            groups.push(sortedTopics.slice(i, i + groupSize))
          }

          const milestoneNames = ['基础概念', '核心原理', '深入理解', '综合应用']
          let totalDays = 0

          for (let gi = 0; gi < groups.length; gi++) {
            const group = groups[gi]
            const mId = genId('ms')
            const topicIds = group.map(t => String(t.id)).join(',')
            const estimatedDays = Math.max(3, Math.ceil(group.reduce((sum, t) => sum + ((t.estimated_minutes as number) || 30), 0) / ((args.daily_minutes as number) || 30)))
            totalDays += estimatedDays

            await query(`INSERT INTO plan_milestones (id, plan_id, title, estimated_days, topic_ids, status, sort_order) VALUES ('${mId}', '${planId}', '${milestoneNames[gi] || `阶段${gi + 1}`}', ${estimatedDays}, '${esc(topicIds)}', 'not_started', ${gi})`)
          }

          await query(`UPDATE study_plans SET total_days = ${totalDays}, updated_at = datetime('now', 'localtime') WHERE id = '${planId}'`)

          return ok(`Study plan "${planTitle}" created with ${groups.length} milestones from ${topics.length} topics.`, { planId, milestoneCount: groups.length, topicCount: topics.length, totalDays })
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Study plan operation failed: ${(e as Error).message}`)
    }
  },

  progress_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'update': {
          if (!args.topic) return fail('Topic is required')
          await upsertProgress({
            subjectId: String(args.subject_id || 'general'),
            topicId: String(args.topic_id || ''),
            topic: String(args.topic),
            comprehensionDelta: args.comprehension_score !== undefined ? (args.comprehension_score as number) : undefined,
            timeSpent: args.time_spent_minutes as number | undefined,
            weakAreas: args.weak_areas as string[] | undefined,
            notes: args.notes as string | undefined,
            status: args.status as string | undefined,
          })

          if (args.topic_id) {
            const delta = args.comprehension_score !== undefined ? (args.comprehension_score as number) / 5 : 0
            await updateTopicMastery(String(args.topic_id), delta)
          }

          return ok('Progress updated.')
        }

        case 'get': {
          if (!args.topic) return fail('Topic is required')
          const result = await query(`SELECT * FROM learning_progress WHERE topic = '${esc(args.topic as string)}' AND (topic_id = '${args.topic_id || ''}' OR topic_id = '')`)
          if (!result.rows?.length) return ok('No progress found for this topic.')
          return ok('Progress found.', { progress: result.rows[0] })
        }

        case 'list': {
          const subjectId = args.subject_id as string | undefined
          const sql = subjectId
            ? `SELECT * FROM learning_progress WHERE subject_id = '${subjectId}' ORDER BY last_accessed_at DESC`
            : 'SELECT * FROM learning_progress ORDER BY last_accessed_at DESC'
          const result = await query(sql)
          return ok(`Found ${(result.rows || []).length} progress records.`, { progressList: result.rows || [] })
        }

        case 'schedule_review': {
          await scheduleReview({
            topic: String(args.topic || ''),
            topicId: String(args.topic_id || ''),
            subjectId: String(args.subject_id || 'general'),
            sourceType: String(args.source_type || 'topic'),
            sourceId: String(args.source_id || ''),
            intervalDays: args.interval_days as number | undefined,
          })
          return ok('Review scheduled.')
        }

        case 'get_review_schedule': {
          const result = await query(`SELECT * FROM review_schedule WHERE next_review_at <= datetime('now') AND status = 'pending' ORDER BY next_review_at`)
          return ok(`${(result.rows || []).length} items due for review.`, { dueItems: result.rows || [] })
        }

        case 'subject_summary': {
          if (!args.subject_id) return fail('Subject ID is required')
          const subjectId = String(args.subject_id)

          const topicStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN mastery_level >= 80 THEN 1 ELSE 0 END) as mastered, SUM(CASE WHEN mastery_level > 0 AND mastery_level < 80 THEN 1 ELSE 0 END) as in_progress, AVG(mastery_level) as avg_mastery FROM topics WHERE subject_id = '${subjectId}' AND status = 'active'`)
          const quizStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed FROM quiz_results WHERE quiz_id IN (SELECT id FROM quizzes WHERE subject_id = '${subjectId}')`)
          const cardStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN next_review_at <= datetime('now') THEN 1 ELSE 0 END) as due FROM flashcards WHERE subject_id = '${subjectId}'`)
          const mistakeStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END) as unmastered FROM mistakes WHERE subject_id = '${subjectId}'`)
          const planStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM study_plans WHERE subject_id = '${subjectId}'`)
          const progressStats = await query(`SELECT SUM(time_spent_minutes) as total_minutes, AVG(comprehension_score) as avg_score FROM learning_progress WHERE subject_id = '${subjectId}'`)
          const dueReviews = await query(`SELECT COUNT(*) as count FROM review_schedule WHERE subject_id = '${subjectId}' AND next_review_at <= datetime('now') AND status = 'pending'`)

          const summary = {
            topics: topicStats.rows?.[0] || { total: 0, mastered: 0, in_progress: 0, avg_mastery: 0 },
            quizzes: quizStats.rows?.[0] || { total: 0, passed: 0 },
            flashcards: cardStats.rows?.[0] || { total: 0, due: 0 },
            mistakes: mistakeStats.rows?.[0] || { total: 0, unmastered: 0 },
            plans: planStats.rows?.[0] || { total: 0, active: 0 },
            progress: progressStats.rows?.[0] || { total_minutes: 0, avg_score: 0 },
            dueReviews: dueReviews.rows?.[0]?.count || 0,
          }

          return ok(`Subject summary for ${subjectId}.`, { summary })
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Progress operation failed: ${(e as Error).message}`)
    }
  },

  flashcard_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'create': {
          if (!args.front || !args.back) return fail('Front and back are required')
          const id = genId('card')
          const now = new Date().toISOString()
          const sql = `INSERT INTO flashcards (id, subject_id, topic_id, front, back, hint, difficulty, tags, review_count, correct_count, next_review_at, interval_days, ease_factor, status, source_type, source_id) VALUES ('${id}', '${args.subject_id || 'general'}', '${args.topic_id || ''}', '${esc(args.front as string)}', '${esc(args.back as string)}', '${esc(args.hint as string || '')}', '${args.difficulty || 'intermediate'}', '${esc(args.tags as string || '')}', 0, 0, '${now}', 1, 2.5, 'new', '${args.source_type || ''}', '${args.source_id || ''}')`
          const result = await query(sql)
          if (!result.success) return fail('Failed to create flashcard')
          return ok('Flashcard created.', { cardId: id })
        }

        case 'bulk_create': {
          const cards = args.cards as Array<Record<string, string>>
          if (!Array.isArray(cards) || cards.length === 0) return fail('Cards array is required')
          let added = 0
          const now = new Date().toISOString()
          for (const c of cards) {
            if (!c.front || !c.back) continue
            const id = genId('card')
            const sql = `INSERT INTO flashcards (id, subject_id, topic_id, front, back, hint, difficulty, tags, review_count, correct_count, next_review_at, interval_days, ease_factor, status, source_type, source_id) VALUES ('${id}', '${args.subject_id || 'general'}', '${c.topic_id || ''}', '${esc(c.front)}', '${esc(c.back)}', '${esc(c.hint || '')}', '${c.difficulty || 'intermediate'}', '${esc(c.tags || '')}', 0, 0, '${now}', 1, 2.5, 'new', '${args.source_type || ''}', '${args.source_id || ''}')`
            const r = await query(sql)
            if (r.success) added++
          }
          return ok(`${added} flashcards created.`)
        }

        case 'review': {
          if (!args.card_id) return fail('Card ID is required')
          if (args.quality === undefined) return fail('Quality rating (0-5) is required')
          const quality = args.quality as number
          if (quality < 0 || quality > 5) return fail('Quality must be between 0 and 5')

          const cardResult = await query(`SELECT * FROM flashcards WHERE id = '${args.card_id}'`)
          if (!cardResult.rows?.length) return fail('Flashcard not found')
          const card = cardResult.rows[0] as Record<string, unknown>

          const currentInterval = (card.interval_days as number) || 1
          const currentEase = (card.ease_factor as number) || 2.5
          const reviewCount = ((card.review_count as number) || 0) + 1
          const correctCount = quality >= 3 ? ((card.correct_count as number) || 0) + 1 : (card.correct_count as number) || 0

          const { newInterval, newEaseFactor } = sm2Algorithm(quality, currentInterval, currentEase)

          const nextReviewDate = new Date()
          nextReviewDate.setDate(nextReviewDate.getDate() + newInterval)
          const nextReviewAt = nextReviewDate.toISOString()

          const newStatus = quality >= 4 ? (newInterval >= 30 ? 'mastered' : 'review') : (quality >= 3 ? 'learning' : 'new')

          await query(`UPDATE flashcards SET review_count = ${reviewCount}, correct_count = ${correctCount}, next_review_at = '${nextReviewAt}', interval_days = ${newInterval}, ease_factor = ${newEaseFactor}, status = '${newStatus}', updated_at = datetime('now', 'localtime') WHERE id = '${args.card_id}'`)

          await query(`INSERT INTO card_review_log (card_id, quality, response_time, reviewed_at) VALUES ('${args.card_id}', ${quality}, ${args.response_time || 0}, datetime('now', 'localtime'))`)

          const topicId = String(card.topic_id || '')
          const subjectId = String(card.subject_id || 'general')
          if (topicId) {
            const masteryDelta = quality >= 4 ? 5 : (quality >= 3 ? 2 : -3)
            await updateTopicMastery(topicId, masteryDelta)
          }

          await upsertProgress({
            subjectId,
            topicId,
            topic: String(card.front || '').substring(0, 100),
            timeSpent: 1,
            status: newStatus === 'mastered' ? 'mastered' : 'in_progress',
          })

          return ok(`Card reviewed. Quality: ${quality}/5. Next review in ${newInterval} day(s). Status: ${newStatus}.`, {
            newInterval,
            newEaseFactor,
            newStatus,
            topicId,
          })
        }

        case 'list': {
          const subjectId = args.subject_id as string | undefined
          const topicId = args.topic_id as string | undefined
          let sql = 'SELECT * FROM flashcards WHERE 1=1'
          if (subjectId) sql += ` AND subject_id = '${subjectId}'`
          if (topicId) sql += ` AND topic_id = '${topicId}'`
          sql += ' ORDER BY next_review_at ASC'
          const result = await query(sql)
          return ok(`Found ${(result.rows || []).length} flashcards.`, { flashcards: result.rows || [] })
        }

        case 'get_due': {
          const limit = Math.min((args.limit as number) || 20, 100)
          const subjectId = args.subject_id as string | undefined
          let sql = `SELECT * FROM flashcards WHERE next_review_at <= datetime('now') AND status != 'mastered'`
          if (subjectId) sql += ` AND subject_id = '${subjectId}'`
          sql += ` ORDER BY next_review_at ASC LIMIT ${limit}`
          const result = await query(sql)
          return ok(`${(result.rows || []).length} cards due for review.`, { dueCards: result.rows || [] })
        }

        case 'delete': {
          if (!args.card_id) return fail('Card ID is required')
          await query(`DELETE FROM card_review_log WHERE card_id = '${args.card_id}'`)
          await query(`DELETE FROM flashcards WHERE id = '${args.card_id}'`)
          return ok('Flashcard deleted.')
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Flashcard operation failed: ${(e as Error).message}`)
    }
  },

  mistake_manage: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const action = args.action as string

    try {
      switch (action) {
        case 'add': {
          if (!args.question) return fail('Question is required')
          const id = genId('mistake')
          const sql = `INSERT INTO mistakes (id, subject_id, topic_id, question, your_answer, correct_answer, explanation, source, source_id, difficulty, review_count, mastered, tags, notes) VALUES ('${id}', '${args.subject_id || 'general'}', '${args.topic_id || ''}', '${esc(args.question as string)}', '${esc(args.your_answer as string || '')}', '${esc(args.correct_answer as string || '')}', '${esc(args.explanation as string || '')}', '${esc(args.source as string || '')}', '${args.source_id || ''}', '${args.difficulty || 'intermediate'}', 0, 0, '${esc(args.tags as string || '')}', '${esc(args.notes as string || '')}')`
          const result = await query(sql)
          if (!result.success) return fail('Failed to add mistake')

          await mistakeToFlashcard(id)

          const topicId = String(args.topic_id || '')
          if (topicId) {
            await updateTopicMastery(topicId, -10)
          }

          await scheduleReview({
            topic: String(args.question).substring(0, 100),
            topicId,
            subjectId: String(args.subject_id || 'general'),
            sourceType: 'mistake',
            sourceId: id,
            intervalDays: 1,
          })

          return ok('Mistake added. Auto-converted to flashcard for review.', { mistakeId: id })
        }

        case 'mark_mastered': {
          if (!args.mistake_id) return fail('Mistake ID is required')
          await query(`UPDATE mistakes SET mastered = 1, review_count = review_count + 1, updated_at = datetime('now', 'localtime') WHERE id = '${args.mistake_id}'`)

          const mistakeResult = await query(`SELECT subject_id, topic_id, question FROM mistakes WHERE id = '${args.mistake_id}'`)
          if (mistakeResult.rows?.length) {
            const m = mistakeResult.rows[0] as Record<string, unknown>
            const topicId = String(m.topic_id || '')
            const subjectId = String(m.subject_id || 'general')

            if (topicId) {
              await updateTopicMastery(topicId, 10)
            }

            await upsertProgress({
              subjectId,
              topicId,
              topic: String(m.question || '').substring(0, 100),
              comprehensionDelta: 10,
              status: 'review',
            })
          }

          return ok('Mistake marked as mastered. Topic mastery updated.')
        }

        case 'list': {
          const subjectId = args.subject_id as string | undefined
          const topicId = args.topic_id as string | undefined
          let sql = 'SELECT * FROM mistakes WHERE 1=1'
          if (subjectId) sql += ` AND subject_id = '${subjectId}'`
          if (topicId) sql += ` AND topic_id = '${topicId}'`
          sql += ' ORDER BY created_at DESC'
          const result = await query(sql)
          return ok(`Found ${(result.rows || []).length} mistakes.`, { mistakes: result.rows || [] })
        }

        case 'get_unmastered': {
          const subjectId = args.subject_id as string | undefined
          let sql = 'SELECT * FROM mistakes WHERE mastered = 0'
          if (subjectId) sql += ` AND subject_id = '${subjectId}'`
          sql += ' ORDER BY created_at DESC'
          const result = await query(sql)
          return ok(`${(result.rows || []).length} unmastered mistakes.`, { mistakes: result.rows || [] })
        }

        case 'to_flashcard': {
          if (!args.mistake_id) return fail('Mistake ID is required')
          await mistakeToFlashcard(String(args.mistake_id))
          return ok('Mistake converted to flashcard.')
        }

        case 'delete': {
          if (!args.mistake_id) return fail('Mistake ID is required')
          await query(`DELETE FROM mistakes WHERE id = '${args.mistake_id}'`)
          return ok('Mistake deleted.')
        }

        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (e) {
      return fail(`Mistake operation failed: ${(e as Error).message}`)
    }
  },

  topic_explain: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const topic = args.topic as string
    if (!topic) return fail('Topic is required')

    const difficulty = (args.difficulty as string) || 'intermediate'
    const learningStyle = (args.learning_style as string) || 'reading'
    const lang = (args.language as string) || 'zh'
    const context = (args.context as string) || ''

    const difficultyLabels: Record<string, Record<string, string>> = {
      beginner: { zh: '入门级（用最简单的语言，生活化类比）', en: 'Beginner (simple language, everyday analogies)' },
      intermediate: { zh: '中级（适度专业术语，结构化讲解）', en: 'Intermediate (moderate terminology, structured)' },
      advanced: { zh: '高级（深入原理，学术化表达）', en: 'Advanced (deep principles, academic expression)' },
      expert: { zh: '专家级（前沿研究，批判性分析）', en: 'Expert (cutting-edge, critical analysis)' },
    }

    const styleLabels: Record<string, Record<string, string>> = {
      visual: { zh: '多用图表、思维导图、流程图描述', en: 'Use diagrams, mind maps, flowcharts' },
      auditory: { zh: '多用对话式、讲故事的方式', en: 'Use conversational, storytelling approach' },
      reading: { zh: '多用文字、定义、逻辑推导', en: 'Use text, definitions, logical derivation' },
      kinesthetic: { zh: '多用动手实践、代码示例、操作步骤', en: 'Use hands-on, code examples, step-by-step' },
    }

    const diffLabel = difficultyLabels[difficulty]?.[lang] || difficultyLabels.intermediate[lang]
    const styleLabel = styleLabels[learningStyle]?.[lang] || styleLabels.reading[lang]

    const prompt = lang === 'zh'
      ? `请以资深教育专家的身份，详细讲解「${topic}」这个知识点。\n\n要求：\n1. 难度级别：${diffLabel}\n2. 教学风格：${styleLabel}\n3. 讲解结构：\n   - 📌 核心定义：用一句话概括\n   - 🔍 深入理解：展开讲解核心概念和原理\n   - 💡 类比说明：用生活中的例子帮助理解\n   - 📝 关键要点：列出3-5个必须记住的要点\n   - ⚠️ 常见误区：指出学习者容易犯的错误\n   - 🎯 应用场景：说明这个知识在什么情况下使用\n   - 📚 延伸学习：推荐进一步学习的方向${context ? `\n4. 学习者背景：${context}` : ''}\n\n请确保讲解清晰、准确、有层次感，让学习者能够循序渐进地掌握。`
      : `Please explain the topic "${topic}" as a senior education expert.\n\nRequirements:\n1. Difficulty level: ${diffLabel}\n2. Teaching style: ${styleLabel}\n3. Explanation structure:\n   - 📌 Core Definition: One-sentence summary\n   - 🔍 Deep Understanding: Expand on core concepts and principles\n   - 💡 Analogy: Use everyday examples to aid understanding\n   - 📝 Key Points: List 3-5 essential takeaways\n   - ⚠️ Common Pitfalls: Point out mistakes learners often make\n   - 🎯 Use Cases: When and where to apply this knowledge\n   - 📚 Further Learning: Recommended next steps${context ? `\n4. Learner background: ${context}` : ''}\n\nEnsure the explanation is clear, accurate, and well-structured for progressive learning.`

    return ok(prompt, { topic, difficulty, learningStyle })
  },

  practice_problems: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const topic = args.topic as string
    if (!topic) return fail('Topic is required')

    const problemType = (args.problem_type as string) || 'calculation'
    const difficulty = (args.difficulty as string) || 'intermediate'
    const count = Math.min(Math.max((args.count as number) || 3, 1), 10)
    const includeHints = args.include_hints !== false

    const typeLabels: Record<string, Record<string, string>> = {
      calculation: { zh: '计算题（需要数值计算或公式推导）', en: 'Calculation (numerical computation or formula derivation)' },
      proof: { zh: '证明题（需要逻辑推理和论证）', en: 'Proof (logical reasoning and argumentation)' },
      coding: { zh: '编程题（需要编写代码实现）', en: 'Coding (write code to implement)' },
      analysis: { zh: '分析题（需要分析问题并给出方案）', en: 'Analysis (analyze and propose solutions)' },
      design: { zh: '设计题（需要设计方案或架构）', en: 'Design (design solutions or architecture)' },
    }

    const diffLabels: Record<string, Record<string, string>> = {
      beginner: { zh: '入门（基础概念应用）', en: 'Beginner (basic concept application)' },
      intermediate: { zh: '中级（综合应用）', en: 'Intermediate (comprehensive application)' },
      advanced: { zh: '高级（深度分析）', en: 'Advanced (deep analysis)' },
      expert: { zh: '专家（创新解决）', en: 'Expert (innovative solutions)' },
    }

    const typeLabel = typeLabels[problemType]?.zh || typeLabels.calculation.zh
    const diffLabel = diffLabels[difficulty]?.zh || diffLabels.intermediate.zh

    const prompt = `请为「${topic}」生成 ${count} 道练习题。\n\n要求：\n1. 题目类型：${typeLabel}\n2. 难度级别：${diffLabel}\n3. 每道题包含：\n   - 📋 题目描述\n   - 💭 解题思路（简短提示）${includeHints ? '\n   - 💡 渐进式提示（3个层级：轻微提示→中等提示→详细提示）' : ''}\n   - ✅ 完整解答步骤\n   - 📊 答案\n4. 题目之间难度递进，从易到难\n5. 确保题目有实际应用价值，不是纯理论\n\n请按以下格式输出每道题：\n---\n**第 N 题**\n📋 题目：...\n💭 思路：...${includeHints ? '\n💡 提示1：...\n💡 提示2：...\n💡 提示3：...' : ''}\n✅ 解答：...\n📊 答案：...\n---`

    return ok(prompt, { topic, problemType, difficulty, count, includeHints })
  },

  subject_dashboard: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    if (!args.subject_id) return fail('Subject ID is required')
    const subjectId = String(args.subject_id)

    try {
      const subjectResult = await query(`SELECT * FROM subjects WHERE id = '${subjectId}'`)
      if (!subjectResult.rows?.length) return fail('Subject not found')
      const subject = subjectResult.rows[0]

      const topicStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN mastery_level >= 80 THEN 1 ELSE 0 END) as mastered, SUM(CASE WHEN mastery_level > 0 AND mastery_level < 80 THEN 1 ELSE 0 END) as in_progress, AVG(mastery_level) as avg_mastery FROM topics WHERE subject_id = '${subjectId}' AND status = 'active'`)
      const quizStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published FROM quizzes WHERE subject_id = '${subjectId}'`)
      const resultStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed, AVG(percentage) as avg_score FROM quiz_results WHERE quiz_id IN (SELECT id FROM quizzes WHERE subject_id = '${subjectId}')`)
      const cardStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN next_review_at <= datetime('now') AND status != 'mastered' THEN 1 ELSE 0 END) as due FROM flashcards WHERE subject_id = '${subjectId}'`)
      const mistakeStats = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END) as unmastered FROM mistakes WHERE subject_id = '${subjectId}'`)
      const planStats = await query(`SELECT * FROM study_plans WHERE subject_id = '${subjectId}' AND status = 'active' ORDER BY created_at DESC LIMIT 5`)
      const progressStats = await query(`SELECT SUM(time_spent_minutes) as total_minutes, AVG(comprehension_score) as avg_score FROM learning_progress WHERE subject_id = '${subjectId}'`)
      const dueReviews = await query(`SELECT * FROM review_schedule WHERE subject_id = '${subjectId}' AND next_review_at <= datetime('now') AND status = 'pending' ORDER BY next_review_at LIMIT 10`)
      const recentResults = await query(`SELECT qr.* FROM quiz_results qr JOIN quizzes q ON qr.quiz_id = q.id WHERE q.subject_id = '${subjectId}' ORDER BY qr.created_at DESC LIMIT 5`)

      const dashboard = {
        subject,
        topics: topicStats.rows?.[0] || { total: 0, mastered: 0, in_progress: 0, avg_mastery: 0 },
        quizzes: quizStats.rows?.[0] || { total: 0, published: 0 },
        results: resultStats.rows?.[0] || { total: 0, passed: 0, avg_score: 0 },
        flashcards: cardStats.rows?.[0] || { total: 0, due: 0 },
        mistakes: mistakeStats.rows?.[0] || { total: 0, unmastered: 0 },
        activePlans: planStats.rows || [],
        progress: progressStats.rows?.[0] || { total_minutes: 0, avg_score: 0 },
        dueReviews: dueReviews.rows || [],
        recentResults: recentResults.rows || [],
      }

      return ok(`Dashboard for subject ${subjectId}.`, { dashboard })
    } catch (e) {
      return fail(`Dashboard error: ${(e as Error).message}`)
    }
  },

  learning_suggest: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const subjectId = String(args.subject_id || '')

    try {
      const suggestions: string[] = []

      if (subjectId) {
        const dueCards = await query(`SELECT COUNT(*) as count FROM flashcards WHERE subject_id = '${subjectId}' AND next_review_at <= datetime('now') AND status != 'mastered'`)
        const dueCount = (dueCards.rows?.[0] as Record<string, number>)?.count || 0
        if (dueCount > 0) suggestions.push(`📅 有 ${dueCount} 张知识卡片到期复习，建议优先复习`)

        const unmasteredMistakes = await query(`SELECT question, topic_id FROM mistakes WHERE subject_id = '${subjectId}' AND mastered = 0 ORDER BY created_at DESC LIMIT 3`)
        const mistakes = (unmasteredMistakes.rows || []) as Record<string, unknown>[]
        if (mistakes.length > 0) {
          const mistakeNames = mistakes.map(m => `「${String(m.question).substring(0, 20)}」`).join('、')
          suggestions.push(`❌ 未掌握错题: ${mistakeNames}，建议重点攻克`)
        }

        const weakTopics = await query(`SELECT title, mastery_level FROM topics WHERE subject_id = '${subjectId}' AND status = 'active' AND mastery_level > 0 AND mastery_level < 50 ORDER BY mastery_level ASC LIMIT 3`)
        const weakOnes = (weakTopics.rows || []) as Record<string, unknown>[]
        if (weakOnes.length > 0) {
          const weakNames = weakOnes.map(t => `「${t.title}」(${t.mastery_level}%)`).join('、')
          suggestions.push(`⚠️ 薄弱知识点: ${weakNames}，建议加强学习`)
        }

        const activePlans = await query(`SELECT title FROM study_plans WHERE subject_id = '${subjectId}' AND status = 'active'`)
        if ((activePlans.rows || []).length === 0) {
          suggestions.push('📋 还没有学习计划，建议创建一个系统化的学习计划')
        }

        const nextTopics = await query(`SELECT title FROM topics WHERE subject_id = '${subjectId}' AND status = 'active' AND mastery_level = 0 ORDER BY sort_order LIMIT 3`)
        const nextOnes = (nextTopics.rows || []) as Record<string, unknown>[]
        if (nextOnes.length > 0) {
          const nextNames = nextOnes.map(t => `「${t.title}」`).join('、')
          suggestions.push(`🎯 建议开始学习: ${nextNames}`)
        }
      } else {
        const allDueCards = await query(`SELECT COUNT(*) as count FROM flashcards WHERE next_review_at <= datetime('now') AND status != 'mastered'`)
        const allDueCount = (allDueCards.rows?.[0] as Record<string, number>)?.count || 0
        if (allDueCount > 0) suggestions.push(`📅 有 ${allDueCount} 张知识卡片到期复习`)

        const allUnmastered = await query(`SELECT COUNT(*) as count FROM mistakes WHERE mastered = 0`)
        const allUnmasteredCount = (allUnmastered.rows?.[0] as Record<string, number>)?.count || 0
        if (allUnmasteredCount > 0) suggestions.push(`❌ 有 ${allUnmasteredCount} 道错题未掌握`)

        const allDueReviews = await query(`SELECT COUNT(*) as count FROM review_schedule WHERE next_review_at <= datetime('now') AND status = 'pending'`)
        const allDueReviewCount = (allDueReviews.rows?.[0] as Record<string, number>)?.count || 0
        if (allDueReviewCount > 0) suggestions.push(`🔄 有 ${allDueReviewCount} 项复习计划到期`)
      }

      if (suggestions.length === 0) {
        suggestions.push('✅ 当前没有紧急学习任务，可以开始新的学习内容或创建学习计划')
      }

      return ok(suggestions.join('\n'), { suggestions })
    } catch (e) {
      return fail(`Suggestion error: ${(e as Error).message}`)
    }
  },
}

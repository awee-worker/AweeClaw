import type { ToolExecutionResult, ToolExecutionContext } from '@protocols'
import type {
  Quiz,
  StudyPlan,
  StudyMilestone,
  ConceptMap,
  LearningProgress,
  DifficultyLevel,
  ProgressStatus,
} from '../providerTypes'

function eduError(message: string): ToolExecutionResult {
  return { success: false, result: '', error: message }
}

function eduSuccess(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

function difficultyLabel(level: DifficultyLevel): string {
  const map: Record<DifficultyLevel, string> = {
    beginner: '🟢 入门',
    intermediate: '🟡 中级',
    advanced: '🔴 高级',
    expert: '⚫ 专家',
  }
  return map[level] || level
}

function statusLabel(status: ProgressStatus): string {
  const map: Record<ProgressStatus, string> = {
    not_started: '⬜ 未开始',
    in_progress: '🔵 进行中',
    completed: '✅ 已完成',
    review: '🔄 复习中',
    mastered: '🏆 已掌握',
  }
  return map[status] || status
}

async function topicExplain(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const topic = args.topic as string
  const difficulty = (args.difficulty as DifficultyLevel) || 'intermediate'
  const learningStyle = (args.learning_style as string) || 'reading'
  const context = args.context as string | undefined
  const language = (args.language as string) || 'zh'

  if (!topic?.trim()) return eduError('topic is required')

  const styleDescriptions: Record<string, string> = {
    visual: '使用图表、示意图和视觉类比',
    auditory: '使用对话式、故事化的讲解方式',
    reading: '使用结构化文本、定义和详细说明',
    kinesthetic: '使用实践示例、动手练习和场景模拟',
  }

  try {
    const lines = [
      `**主题讲解: ${topic.trim()}**`,
      '',
      `📊 **难度级别**: ${difficultyLabel(difficulty)}`,
      `🎨 **学习风格**: ${styleDescriptions[learningStyle] || learningStyle}`,
      `${context ? `📝 **背景**: ${context}` : ''}`,
      `🌐 **语言**: ${language === 'zh' ? '中文' : language === 'ja' ? '日本語' : 'English'}`,
      '',
      '---',
      '',
      '### 📚 讲解结构',
      '',
      '本工具将按以下结构生成讲解：',
      '',
      '1. **核心概念** — 简洁定义与关键特征',
      '2. **直观理解** — 类比与生活实例',
      '3. **深入剖析** — 原理、机制与细节',
      '4. **实际应用** — 真实场景与应用案例',
      '5. **常见误区** — 典型错误与纠正',
      '6. **关键要点** — 精炼总结与记忆锚点',
      '',
      `> 💡 讲解将采用${styleDescriptions[learningStyle] || '结构化文本'}方式，适合${difficultyLabel(difficulty)}水平的学习者。`,
    ].filter(Boolean)

    return eduSuccess(lines.join('\n'), { topic: topic.trim(), difficulty, learningStyle })
  } catch (err) {
    return eduError(`Topic explanation error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function quizGenerate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const topic = args.topic as string
  const questionCount = Math.min((args.question_count as number) || 5, 20)
  const difficulty = (args.difficulty as DifficultyLevel) || 'intermediate'
  const questionTypes = (args.question_types as string[]) || ['multiple_choice']
  const focusAreas = args.focus_areas as string[] | undefined

  if (!topic?.trim()) return eduError('topic is required')

  try {
    const quiz: Partial<Quiz> = {
      id: `quiz_${Date.now()}`,
      title: `Quiz: ${topic.trim()}`,
      titleZh: `测验: ${topic.trim()}`,
      topicId: topic.trim().toLowerCase().replace(/\s+/g, '_'),
      questions: [],
      difficulty,
      passingScore: 70,
      createdAt: Date.now(),
    }

    const lines = [
      `**测验生成: ${topic.trim()}**`,
      '',
      `📊 **难度**: ${difficultyLabel(difficulty)}`,
      `📝 **题目数量**: ${questionCount}`,
      `📋 **题型**: ${questionTypes.join(', ')}`,
      `${focusAreas ? `🎯 **重点领域**: ${focusAreas.join(', ')}` : ''}`,
      `✅ **及格分数**: ${quiz.passingScore}%`,
      '',
      '---',
      '',
      '### 📝 测验说明',
      '',
      '本工具将生成以下类型的题目：',
      ...questionTypes.map(t => `- ${t === 'multiple_choice' ? '选择题' : t === 'true_false' ? '判断题' : t === 'short_answer' ? '简答题' : t === 'fill_blank' ? '填空题' : t}`),
      '',
      '每道题目包含：',
      '- 题目内容与选项（如适用）',
      '- 正确答案',
      '- 详细解析',
      '- 难度标记',
      '',
      `> 💡 建议在完成 "${topic.trim()}" 的学习后进行测验，以检验理解程度。`,
    ].filter(Boolean)

    return eduSuccess(lines.join('\n'), { quiz })
  } catch (err) {
    return eduError(`Quiz generation error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function studyPlanCreate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const subject = args.subject as string
  const goal = args.goal as string
  const targetDate = args.target_date as string | undefined
  const dailyMinutes = (args.daily_minutes as number) || 60
  const currentLevel = (args.current_level as DifficultyLevel) || 'beginner'
  const learningStyle = (args.learning_style as string) || 'reading'

  if (!subject?.trim()) return eduError('subject is required')
  if (!goal?.trim()) return eduError('goal is required')

  try {
    const plan: Partial<StudyPlan> = {
      id: `plan_${Date.now()}`,
      title: `Study Plan: ${subject.trim()}`,
      titleZh: `学习计划: ${subject.trim()}`,
      goal: goal.trim(),
      goalZh: goal.trim(),
      targetDate,
      milestones: [],
      dailyMinutes,
      learningStyle: learningStyle as StudyPlan['learningStyle'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const defaultMilestones: StudyMilestone[] = [
      { id: 'm1', title: '基础概念', titleZh: '基础概念', topicIds: [], estimatedDays: 7, order: 1, status: 'not_started' },
      { id: 'm2', title: '核心原理', titleZh: '核心原理', topicIds: [], estimatedDays: 10, order: 2, status: 'not_started' },
      { id: 'm3', title: '实践应用', titleZh: '实践应用', topicIds: [], estimatedDays: 7, order: 3, status: 'not_started' },
      { id: 'm4', title: '综合评估', titleZh: '综合评估', topicIds: [], estimatedDays: 3, order: 4, status: 'not_started' },
    ]

    const totalDays = defaultMilestones.reduce((sum, m) => sum + m.estimatedDays, 0)

    const lines = [
      `**学习计划: ${subject.trim()}**`,
      '',
      `🎯 **目标**: ${goal.trim()}`,
      `📊 **当前水平**: ${difficultyLabel(currentLevel)}`,
      `⏰ **每日学习时间**: ${dailyMinutes} 分钟`,
      `🎨 **学习风格**: ${learningStyle}`,
      `${targetDate ? `📅 **目标日期**: ${targetDate}` : `📅 **预计天数**: ${totalDays} 天`}`,
      '',
      '---',
      '',
      '### 📋 里程碑',
      '',
      ...defaultMilestones.map(m =>
        `${m.order}. ${statusLabel(m.status)} **${m.titleZh}** — 预计 ${m.estimatedDays} 天`
      ),
      '',
      `**总计**: ${totalDays} 天 × ${dailyMinutes} 分钟/天 = ${totalDays * dailyMinutes} 分钟`,
      '',
      '### 📚 学习资源推荐',
      '',
      '每个里程碑将包含：',
      '- 📖 推荐阅读材料',
      '- 🎥 视频教程链接',
      '- ✏️ 练习题与测验',
      '- 📝 学习笔记模板',
      '',
      '> 💡 计划将根据你的学习进度动态调整，确保高效达成目标。',
    ]

    return eduSuccess(lines.join('\n'), { plan, milestones: defaultMilestones })
  } catch (err) {
    return eduError(`Study plan error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function conceptMapGenerate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const topic = args.topic as string
  const depth = Math.min((args.depth as number) || 2, 4)
  const focus = args.focus as string | undefined

  if (!topic?.trim()) return eduError('topic is required')

  try {
    const map: Partial<ConceptMap> = {
      id: `cmap_${Date.now()}`,
      title: `Concept Map: ${topic.trim()}`,
      titleZh: `概念图: ${topic.trim()}`,
      nodes: [{ id: 'root', label: topic.trim(), labelZh: topic.trim(), type: 'concept' }],
      edges: [],
    }

    const lines = [
      `**概念图: ${topic.trim()}**`,
      '',
      `${focus ? `🔍 **焦点**: ${focus}` : ''}`,
      `📊 **深度**: ${depth} 层`,
      '',
      '---',
      '',
      '```',
      `        ┌─────────────┐`,
      `        │  ${topic.trim().padEnd(10)}│`,
      `        └──────┬──────┘`,
      `               │`,
      `    ┌──────────┼──────────┐`,
      `    │          │          │`,
      ` ┌──┴──┐   ┌──┴──┐   ┌──┴──┐`,
      ` │子概念1│   │子概念2│   │子概念3│`,
      ` └─────┘   └─────┘   └─────┘`,
      '```',
      '',
      '### 🔗 关系类型',
      '',
      '- **前置知识** → 学习此概念前需要掌握的内容',
      '- **组成部分** → 此概念包含的子概念',
      '- **相关概念** → 与此概念有关联的其他概念',
      '- **进阶方向** → 掌握此概念后可以学习的内容',
      '',
      '> 💡 概念图将根据主题自动生成节点和关系，帮助理解知识结构。',
    ].filter(Boolean)

    return eduSuccess(lines.join('\n'), { conceptMap: map })
  } catch (err) {
    return eduError(`Concept map error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function practiceProblemsGenerate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const topic = args.topic as string
  const problemType = (args.problem_type as string) || 'calculation'
  const difficulty = (args.difficulty as DifficultyLevel) || 'intermediate'
  const count = Math.min((args.count as number) || 3, 10)
  const includeHints = args.include_hints !== false

  if (!topic?.trim()) return eduError('topic is required')

  const typeNames: Record<string, string> = {
    calculation: '计算题',
    proof: '证明题',
    coding: '编程题',
    analysis: '分析题',
    design: '设计题',
  }

  try {
    const lines = [
      `**练习题: ${topic.trim()}**`,
      '',
      `📊 **难度**: ${difficultyLabel(difficulty)}`,
      `📝 **类型**: ${typeNames[problemType] || problemType}`,
      `🔢 **数量**: ${count} 题`,
      `${includeHints ? '💡 **提示**: 包含渐进式提示' : ''}`,
      '',
      '---',
      '',
      '### ✏️ 练习说明',
      '',
      '每道练习题包含：',
      '- 📋 题目描述与要求',
      `${includeHints ? '- 💡 渐进式提示（可逐步揭示）' : ''}`,
      '- ✅ 详细解答步骤',
      '- 📊 难度评级',
      '',
      `> 💡 建议先独立思考，遇到困难时再查看${includeHints ? '提示或' : ''}解答。`,
    ].filter(Boolean)

    return eduSuccess(lines.join('\n'), { topic: topic.trim(), problemType, difficulty, count })
  } catch (err) {
    return eduError(`Practice problems error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function progressTrack(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const topicId = args.topic_id as string | undefined
  const studyPlanId = args.study_plan_id as string | undefined
  const action = (args.action as string) || 'status'

  if (!topicId && !studyPlanId) return eduError('topic_id or study_plan_id is required')

  try {
    const progress: Partial<LearningProgress> = {
      topicId: topicId || studyPlanId || '',
      status: 'in_progress',
      comprehensionScore: 0,
      timeSpentMinutes: 0,
      lastAccessedAt: Date.now(),
      quizResults: [],
      notes: [],
      weakAreas: [],
    }

    const lines = [
      `**学习进度${action === 'review_schedule' ? ' — 复习计划' : ''}**`,
      '',
      `${topicId ? `📚 **主题**: ${topicId}` : ''}`,
      `${studyPlanId ? `📋 **学习计划**: ${studyPlanId}` : ''}`,
      `📊 **操作**: ${action === 'status' ? '查看状态' : action === 'update' ? '更新进度' : '复习计划'}`,
      '',
      '---',
    ].filter(Boolean)

    if (action === 'review_schedule') {
      lines.push(
        '',
        '### 🔄 间隔重复复习计划',
        '',
        '基于艾宾浩斯遗忘曲线，推荐复习时间：',
        '',
        '| 学习后 | 建议复习 | 保留率 |',
        '| --- | --- | --- |',
        '| 1天 | 第1次复习 | ~90% |',
        '| 3天 | 第2次复习 | ~85% |',
        '| 7天 | 第3次复习 | ~80% |',
        '| 14天 | 第4次复习 | ~75% |',
        '| 30天 | 第5次复习 | ~70% |',
      )
    } else {
      lines.push(
        '',
        '### 📊 进度概览',
        '',
        `状态: ${statusLabel(progress.status!)}`,
        `理解程度: ${progress.comprehensionScore}%`,
        `学习时长: ${progress.timeSpentMinutes} 分钟`,
        '',
        '进度数据将在学习过程中持续更新。',
      )
    }

    return eduSuccess(lines.join('\n'), { progress })
  } catch (err) {
    return eduError(`Progress tracking error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const educationExecutors = {
  topic_explain: topicExplain,
  quiz_generate: quizGenerate,
  study_plan: studyPlanCreate,
  concept_map: conceptMapGenerate,
  practice_problems: practiceProblemsGenerate,
  progress_track: progressTrack,
}

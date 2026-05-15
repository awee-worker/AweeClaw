export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert'

export type QuizQuestionType = 'multiple_choice' | 'true_false' | 'short_answer' | 'essay' | 'fill_blank' | 'matching'

export type LearningStyle = 'visual' | 'auditory' | 'reading' | 'kinesthetic'

export type ProgressStatus = 'not_started' | 'in_progress' | 'completed' | 'review' | 'mastered'

export interface TopicNode {
  id: string
  title: string
  titleZh: string
  description: string
  descriptionZh: string
  difficulty: DifficultyLevel
  prerequisites: string[]
  children: string[]
  estimatedMinutes: number
  tags: string[]
}

export interface QuizQuestion {
  id: string
  type: QuizQuestionType
  question: string
  questionZh?: string
  options?: string[]
  correctAnswer: string
  explanation: string
  explanationZh?: string
  difficulty: DifficultyLevel
  points: number
  topicId?: string
}

export interface Quiz {
  id: string
  title: string
  titleZh: string
  topicId: string
  questions: QuizQuestion[]
  difficulty: DifficultyLevel
  timeLimit?: number
  passingScore: number
  createdAt: number
}

export interface QuizResult {
  quizId: string
  score: number
  totalPoints: number
  percentage: number
  passed: boolean
  answers: Array<{
    questionId: string
    userAnswer: string
    correct: boolean
    timeSpent?: number
  }>
  completedAt: number
}

export interface StudyPlan {
  id: string
  title: string
  titleZh: string
  goal: string
  goalZh: string
  targetDate?: string
  milestones: StudyMilestone[]
  dailyMinutes: number
  learningStyle: LearningStyle
  createdAt: number
  updatedAt: number
}

export interface StudyMilestone {
  id: string
  title: string
  titleZh: string
  topicIds: string[]
  estimatedDays: number
  order: number
  status: ProgressStatus
  quizId?: string
  notes?: string
}

export interface LearningProgress {
  topicId: string
  status: ProgressStatus
  comprehensionScore: number
  timeSpentMinutes: number
  lastAccessedAt: number
  quizResults: QuizResult[]
  notes: string[]
  weakAreas: string[]
}

export interface ConceptMap {
  id: string
  title: string
  titleZh: string
  nodes: Array<{
    id: string
    label: string
    labelZh: string
    type: 'concept' | 'principle' | 'fact' | 'skill'
  }>
  edges: Array<{
    from: string
    to: string
    label: string
    labelZh: string
    type: 'prerequisite' | 'related' | 'part_of' | 'leads_to'
  }>
}

export interface CourseMaterial {
  id: string
  title: string
  titleZh: string
  type: 'document' | 'video' | 'exercise' | 'reference' | 'summary'
  filePath?: string
  url?: string
  topicId: string
  difficulty: DifficultyLevel
  tags: string[]
  createdAt: number
}

export interface PracticeProblem {
  id: string
  topicId: string
  title: string
  titleZh: string
  description: string
  descriptionZh: string
  hints: string[]
  solution: string
  solutionZh?: string
  difficulty: DifficultyLevel
  type: 'calculation' | 'proof' | 'coding' | 'analysis' | 'design'
}

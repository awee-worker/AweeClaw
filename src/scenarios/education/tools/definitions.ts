import type { ToolDefinition } from '@protocols'
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import { educationExecutors } from './toolExecutors'

const SUBJECT_MANAGE: ToolDefinition = {
  name: 'subject_manage',
  description: 'Manage subjects (courses). Supports create, update, delete, and list operations. Use this to organize learning by subject area.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['create', 'update', 'delete', 'list', 'get'] },
      id: { type: 'string', description: 'Subject ID (for update/delete/get)' },
      name: { type: 'string', description: 'Subject name' },
      name_en: { type: 'string', description: 'English name' },
      category: { type: 'string', description: 'Subject category', enum: ['science', 'language', 'humanities', 'technology', 'general'] },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      description: { type: 'string', description: 'Subject description' },
      tags: { type: 'string', description: 'Comma-separated tags' },
    },
    required: ['action'],
  },
}

const QUIZ_MANAGE: ToolDefinition = {
  name: 'quiz_manage',
  description: 'Manage quizzes. Create quizzes, add questions, record results, and query quiz history. Supports generating quiz content with answers and explanations.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['create', 'add_questions', 'record_result', 'list', 'get', 'delete'] },
      quiz_id: { type: 'string', description: 'Quiz ID' },
      subject_id: { type: 'string', description: 'Subject ID' },
      title: { type: 'string', description: 'Quiz title' },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      question_count: { type: 'number', description: 'Number of questions' },
      question_types: { type: 'array', items: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'fill_blank', 'essay'] }, description: 'Question types' },
      questions: { type: 'array', description: 'Array of question objects with type, question, options, correct_answer, explanation, difficulty, points', items: { type: 'object', properties: { type: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, correct_answer: { type: 'string' }, explanation: { type: 'string' }, difficulty: { type: 'string' }, points: { type: 'number' } } } },
      score: { type: 'number', description: 'Quiz score (for record_result)' },
      total_points: { type: 'number', description: 'Total possible points' },
      answers: { type: 'array', description: 'User answers array (for record_result)', items: { type: 'object' } },
      time_spent: { type: 'number', description: 'Time spent in seconds' },
    },
    required: ['action'],
  },
}

const STUDY_PLAN_MANAGE: ToolDefinition = {
  name: 'study_plan_manage',
  description: 'Manage study plans. Create structured learning plans with milestones, update progress, and track completion. Supports adaptive plan adjustment based on progress.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['create', 'add_milestones', 'update_milestone', 'update_progress', 'generate_from_topics', 'list', 'get', 'delete'] },
      plan_id: { type: 'string', description: 'Plan ID' },
      subject_id: { type: 'string', description: 'Subject ID' },
      title: { type: 'string', description: 'Plan title' },
      goal: { type: 'string', description: 'Learning goal' },
      target_date: { type: 'string', description: 'Target completion date (ISO format)' },
      daily_minutes: { type: 'number', description: 'Daily study time in minutes' },
      current_level: { type: 'string', description: 'Current knowledge level', enum: ['beginner', 'intermediate', 'advanced'] },
      learning_style: { type: 'string', description: 'Preferred learning style', enum: ['visual', 'auditory', 'reading', 'kinesthetic'] },
      milestones: { type: 'array', description: 'Array of milestone objects', items: { type: 'object', properties: { title: { type: 'string' }, estimated_days: { type: 'number' }, topic_ids: { type: 'array', items: { type: 'string' } } } } },
      milestone_id: { type: 'string', description: 'Milestone ID (for update_milestone)' },
      milestone_status: { type: 'string', description: 'New milestone status', enum: ['not_started', 'in_progress', 'completed', 'review', 'mastered'] },
      status: { type: 'string', description: 'Plan status', enum: ['active', 'paused', 'completed'] },
    },
    required: ['action'],
  },
}

const PROGRESS_MANAGE: ToolDefinition = {
  name: 'progress_manage',
  description: 'Track and manage learning progress. Update comprehension scores, time spent, and weak areas. Supports spaced repetition scheduling for review.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['update', 'get', 'list', 'schedule_review', 'get_review_schedule'] },
      topic: { type: 'string', description: 'Topic name' },
      subject_id: { type: 'string', description: 'Subject ID' },
      comprehension_score: { type: 'number', description: 'Comprehension score (0-100)' },
      time_spent_minutes: { type: 'number', description: 'Time spent in minutes' },
      weak_areas: { type: 'array', items: { type: 'string' }, description: 'Weak areas identified' },
      notes: { type: 'string', description: 'Progress notes' },
      status: { type: 'string', description: 'Learning status', enum: ['not_started', 'in_progress', 'completed', 'review', 'mastered'] },
      source_type: { type: 'string', description: 'Source type for review', enum: ['topic', 'quiz', 'flashcard', 'mistake'] },
      source_id: { type: 'string', description: 'Source ID' },
    },
    required: ['action'],
  },
}

const FLASHCARD_MANAGE: ToolDefinition = {
  name: 'flashcard_manage',
  description: 'Manage flashcards (knowledge cards). Create, review, and track flashcard progress using spaced repetition (SM-2 algorithm). Supports bulk creation and review sessions.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['create', 'bulk_create', 'review', 'list', 'get_due', 'delete'] },
      card_id: { type: 'string', description: 'Flashcard ID' },
      subject_id: { type: 'string', description: 'Subject ID' },
      front: { type: 'string', description: 'Front side (question)' },
      back: { type: 'string', description: 'Back side (answer)' },
      hint: { type: 'string', description: 'Optional hint' },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      tags: { type: 'string', description: 'Comma-separated tags' },
      quality: { type: 'number', description: 'Review quality (0-5, for SM-2 algorithm): 0=complete blackout, 1=wrong, 2=wrong but remembered, 3=correct with difficulty, 4=correct with hesitation, 5=perfect' },
      cards: { type: 'array', description: 'Array of card objects for bulk_create', items: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' }, hint: { type: 'string' }, difficulty: { type: 'string' }, tags: { type: 'string' } } } },
    },
    required: ['action'],
  },
}

const MISTAKE_MANAGE: ToolDefinition = {
  name: 'mistake_manage',
  description: 'Manage mistake book (wrong answer collection). Add mistakes from quizzes, mark as mastered, and review. Helps learners identify and overcome weak areas.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['add', 'mark_mastered', 'list', 'get_unmastered', 'delete'] },
      mistake_id: { type: 'string', description: 'Mistake ID' },
      subject_id: { type: 'string', description: 'Subject ID' },
      question: { type: 'string', description: 'The question text' },
      your_answer: { type: 'string', description: 'The wrong answer given' },
      correct_answer: { type: 'string', description: 'The correct answer' },
      explanation: { type: 'string', description: 'Why the correct answer is right' },
      source: { type: 'string', description: 'Source of the mistake (e.g., quiz name)' },
      source_id: { type: 'string', description: 'Source ID (e.g., quiz ID)' },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      tags: { type: 'string', description: 'Comma-separated tags' },
    },
    required: ['action'],
  },
}

const TOPIC_EXPLAIN: ToolDefinition = {
  name: 'topic_explain',
  description: 'Explain a topic with progressive complexity, adapting to the learner\'s level. Includes analogies, examples, visual structure, and key takeaways. Supports multiple explanation styles.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'The topic or concept to explain' },
      difficulty: { type: 'string', description: 'Target difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      learning_style: { type: 'string', description: 'Preferred learning style', enum: ['visual', 'auditory', 'reading', 'kinesthetic'] },
      context: { type: 'string', description: 'Additional context about what the learner already knows or wants to focus on' },
      language: { type: 'string', description: 'Explanation language', enum: ['zh', 'en', 'ja'] },
    },
    required: ['topic'],
  },
}

const PRACTICE_PROBLEMS: ToolDefinition = {
  name: 'practice_problems',
  description: 'Generate practice problems with step-by-step solutions. Supports calculation, proof, coding, analysis, and design problems. Includes hints that can be revealed progressively.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic for practice problems' },
      problem_type: { type: 'string', description: 'Type of problems to generate', enum: ['calculation', 'proof', 'coding', 'analysis', 'design'] },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      count: { type: 'number', description: 'Number of problems to generate (default: 3, max: 10)' },
      include_hints: { type: 'boolean', description: 'Include progressive hints (default: true)' },
    },
    required: ['topic'],
  },
}

const TOPIC_MANAGE: ToolDefinition = {
  name: 'topic_manage',
  description: 'Manage topics (knowledge points). Create, update, delete, and list topics. Generate topic outlines using AI. Topics are the bridge between subjects and learning modules.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action to perform', enum: ['create', 'bulk_create', 'update', 'delete', 'list', 'get', 'generate_outline'] },
      id: { type: 'string', description: 'Topic ID (for update/delete/get)' },
      subject_id: { type: 'string', description: 'Subject ID' },
      title: { type: 'string', description: 'Topic title' },
      title_en: { type: 'string', description: 'English title' },
      description: { type: 'string', description: 'Topic description' },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      parent_id: { type: 'string', description: 'Parent topic ID' },
      sort_order: { type: 'number', description: 'Sort order' },
      estimated_minutes: { type: 'number', description: 'Estimated learning minutes' },
      prerequisites: { type: 'string', description: 'Prerequisite topic IDs (comma-separated)' },
      tags: { type: 'string', description: 'Comma-separated tags' },
      topics: { type: 'array', description: 'Array of topic objects for bulk_create', items: { type: 'object', properties: { title: { type: 'string' }, title_en: { type: 'string' }, description: { type: 'string' }, difficulty: { type: 'string' }, parent_id: { type: 'string' }, sort_order: { type: 'number' }, estimated_minutes: { type: 'number' }, prerequisites: { type: 'string' }, tags: { type: 'string' } } } },
      mastery_level: { type: 'number', description: 'Mastery level 0-100 (for update)' },
      status: { type: 'string', description: 'Topic status (for update)', enum: ['active', 'in_progress', 'mastered'] },
    },
    required: ['action'],
  },
}

const SUBJECT_DASHBOARD: ToolDefinition = {
  name: 'subject_dashboard',
  description: 'Get a comprehensive dashboard for a subject including topic stats, quiz results, flashcard status, mistake tracking, active plans, and due reviews. Use this to get an overview of learning progress.',
  parameters: {
    type: 'object',
    properties: {
      subject_id: { type: 'string', description: 'Subject ID (required)' },
    },
    required: ['subject_id'],
  },
}

const LEARNING_SUGGEST: ToolDefinition = {
  name: 'learning_suggest',
  description: 'Generate personalized learning suggestions based on current progress, due reviews, weak topics, and unmastered mistakes. Provides actionable next-step recommendations.',
  parameters: {
    type: 'object',
    properties: {
      subject_id: { type: 'string', description: 'Subject ID to get suggestions for (optional, returns general suggestions if omitted)' },
    },
    required: [],
  },
}

const EDUCATION_TOOLS: ScenarioToolDefinition[] = [
  { name: 'subject_manage', definition: SUBJECT_MANAGE, executor: educationExecutors.subject_manage },
  { name: 'topic_manage', definition: TOPIC_MANAGE, executor: educationExecutors.topic_manage },
  { name: 'quiz_manage', definition: QUIZ_MANAGE, executor: educationExecutors.quiz_manage },
  { name: 'study_plan_manage', definition: STUDY_PLAN_MANAGE, executor: educationExecutors.study_plan_manage },
  { name: 'progress_manage', definition: PROGRESS_MANAGE, executor: educationExecutors.progress_manage },
  { name: 'flashcard_manage', definition: FLASHCARD_MANAGE, executor: educationExecutors.flashcard_manage },
  { name: 'mistake_manage', definition: MISTAKE_MANAGE, executor: educationExecutors.mistake_manage },
  { name: 'topic_explain', definition: TOPIC_EXPLAIN, executor: educationExecutors.topic_explain },
  { name: 'practice_problems', definition: PRACTICE_PROBLEMS, executor: educationExecutors.practice_problems },
  { name: 'subject_dashboard', definition: SUBJECT_DASHBOARD, executor: educationExecutors.subject_dashboard },
  { name: 'learning_suggest', definition: LEARNING_SUGGEST, executor: educationExecutors.learning_suggest },
]

export default EDUCATION_TOOLS

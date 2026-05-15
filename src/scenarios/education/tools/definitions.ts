import type { ToolDefinition } from '@protocols'
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import { educationExecutors } from './toolExecutors'

const TOPIC_EXPLAIN: ToolDefinition = {
  name: 'topic_explain',
  description: 'Explain a topic with progressive complexity, adapting to the learner\'s level. Includes analogies, examples, visual structure, and key takeaways. Supports multiple explanation styles (Socratic, direct, story-based).',
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

const QUIZ_GENERATE: ToolDefinition = {
  name: 'quiz_generate',
  description: 'Generate quizzes with diverse question types (multiple choice, true/false, short answer, fill-in-blank). Includes correct answers, explanations, and difficulty ratings. Supports adaptive difficulty based on past performance.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic to quiz on' },
      question_count: { type: 'number', description: 'Number of questions to generate (default: 5, max: 20)' },
      difficulty: { type: 'string', description: 'Difficulty level', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      question_types: { type: 'array', items: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'fill_blank'] }, description: 'Question types to include (default: multiple_choice)' },
      focus_areas: { type: 'array', items: { type: 'string' }, description: 'Specific sub-topics to focus on' },
    },
    required: ['topic'],
  },
}

const STUDY_PLAN: ToolDefinition = {
  name: 'study_plan',
  description: 'Create a structured study plan with milestones, daily goals, and progress tracking. Adapts to available time, learning style, and prior knowledge. Includes recommended resources and checkpoint quizzes.',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Subject or skill to learn' },
      goal: { type: 'string', description: 'Learning goal (e.g., "pass exam", "build a project", "understand fundamentals")' },
      target_date: { type: 'string', description: 'Target completion date (ISO format, optional)' },
      daily_minutes: { type: 'number', description: 'Available study time per day in minutes (default: 60)' },
      current_level: { type: 'string', description: 'Current knowledge level', enum: ['beginner', 'intermediate', 'advanced'] },
      learning_style: { type: 'string', description: 'Preferred learning style', enum: ['visual', 'auditory', 'reading', 'kinesthetic'] },
    },
    required: ['subject', 'goal'],
  },
}

const CONCEPT_MAP: ToolDefinition = {
  name: 'concept_map',
  description: 'Generate a concept map showing relationships between concepts in a topic. Visualizes prerequisite chains, part-of relationships, and related concepts. Useful for understanding how ideas connect.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Central topic for the concept map' },
      depth: { type: 'number', description: 'Depth of related concepts to include (default: 2, max: 4)' },
      focus: { type: 'string', description: 'Specific aspect to focus the map around' },
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

const PROGRESS_TRACK: ToolDefinition = {
  name: 'progress_track',
  description: 'Track and report learning progress for a topic or study plan. Shows comprehension scores, time spent, weak areas, and recommended next steps. Supports spaced repetition scheduling.',
  parameters: {
    type: 'object',
    properties: {
      topic_id: { type: 'string', description: 'Topic ID to track progress for' },
      study_plan_id: { type: 'string', description: 'Study plan ID to get overall progress' },
      action: { type: 'string', description: 'Action to perform', enum: ['status', 'update', 'review_schedule'] },
      update_data: { type: 'object', description: 'Progress update data (for action=update)', properties: {} },
    },
  },
}

const EDUCATION_TOOLS: ScenarioToolDefinition[] = [
  { name: 'topic_explain', definition: TOPIC_EXPLAIN, executor: educationExecutors.topic_explain },
  { name: 'quiz_generate', definition: QUIZ_GENERATE, executor: educationExecutors.quiz_generate },
  { name: 'study_plan', definition: STUDY_PLAN, executor: educationExecutors.study_plan },
  { name: 'concept_map', definition: CONCEPT_MAP, executor: educationExecutors.concept_map },
  { name: 'practice_problems', definition: PRACTICE_PROBLEMS, executor: educationExecutors.practice_problems },
  { name: 'progress_track', definition: PROGRESS_TRACK, executor: educationExecutors.progress_track },
]

export default EDUCATION_TOOLS

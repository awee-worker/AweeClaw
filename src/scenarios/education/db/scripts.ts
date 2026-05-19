import type { ScenarioDbScript } from '@shared/protocols/scenario-arch'

export const INSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'create-subjects-table',
    description: '创建学科/课程表',
    sql: `
      CREATE TABLE IF NOT EXISTS subjects (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        name_en         TEXT DEFAULT '',
        category        TEXT NOT NULL DEFAULT 'general',
        icon            TEXT DEFAULT 'BookOpen',
        color           TEXT DEFAULT '#10B981',
        difficulty      TEXT DEFAULT 'intermediate',
        description     TEXT DEFAULT '',
        parent_id       TEXT DEFAULT '',
        tags            TEXT DEFAULT '',
        sort_order      INTEGER DEFAULT 0,
        status          TEXT DEFAULT 'active',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_subjects_category ON subjects(category);
      CREATE INDEX IF NOT EXISTS idx_subjects_parent ON subjects(parent_id);
      CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects(status);
    `,
  },
  {
    id: 'create-topics-table',
    description: '创建知识点表（学科与各模块的桥梁）',
    sql: `
      CREATE TABLE IF NOT EXISTS topics (
        id                TEXT PRIMARY KEY,
        subject_id        TEXT NOT NULL,
        title             TEXT NOT NULL,
        title_en          TEXT DEFAULT '',
        description       TEXT DEFAULT '',
        difficulty        TEXT DEFAULT 'intermediate',
        parent_id         TEXT DEFAULT '',
        sort_order        INTEGER DEFAULT 0,
        status            TEXT DEFAULT 'active',
        mastery_level     REAL DEFAULT 0,
        estimated_minutes INTEGER DEFAULT 30,
        prerequisites     TEXT DEFAULT '',
        tags              TEXT DEFAULT '',
        created_at        TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at        TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
      CREATE INDEX IF NOT EXISTS idx_topics_parent ON topics(parent_id);
      CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
      CREATE INDEX IF NOT EXISTS idx_topics_mastery ON topics(mastery_level);
    `,
  },
  {
    id: 'create-quizzes-table',
    description: '创建测验表',
    sql: `
      CREATE TABLE IF NOT EXISTS quizzes (
        id              TEXT PRIMARY KEY,
        subject_id      TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT DEFAULT '',
        difficulty      TEXT DEFAULT 'intermediate',
        question_types  TEXT DEFAULT '["multiple_choice"]',
        question_count  INTEGER DEFAULT 0,
        time_limit      INTEGER DEFAULT 0,
        passing_score   REAL DEFAULT 60,
        status          TEXT DEFAULT 'draft',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_quizzes_subject ON quizzes(subject_id);
      CREATE INDEX IF NOT EXISTS idx_quizzes_status ON quizzes(status);
    `,
  },
  {
    id: 'create-quiz-questions-table',
    description: '创建测验题目表',
    sql: `
      CREATE TABLE IF NOT EXISTS quiz_questions (
        id              TEXT PRIMARY KEY,
        quiz_id         TEXT NOT NULL,
        topic_id        TEXT DEFAULT '',
        type            TEXT NOT NULL DEFAULT 'multiple_choice',
        question        TEXT NOT NULL,
        options         TEXT DEFAULT '',
        correct_answer  TEXT NOT NULL,
        explanation     TEXT DEFAULT '',
        difficulty      TEXT DEFAULT 'intermediate',
        points          REAL DEFAULT 1,
        sort_order      INTEGER DEFAULT 0,
        hints           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_questions_quiz ON quiz_questions(quiz_id);
      CREATE INDEX IF NOT EXISTS idx_questions_type ON quiz_questions(type);
      CREATE INDEX IF NOT EXISTS idx_questions_topic ON quiz_questions(topic_id);
    `,
  },
  {
    id: 'create-quiz-results-table',
    description: '创建测验结果表',
    sql: `
      CREATE TABLE IF NOT EXISTS quiz_results (
        id              TEXT PRIMARY KEY,
        quiz_id         TEXT NOT NULL,
        score           REAL DEFAULT 0,
        total_points    REAL DEFAULT 0,
        percentage      REAL DEFAULT 0,
        passed          INTEGER DEFAULT 0,
        time_spent      INTEGER DEFAULT 0,
        answers         TEXT DEFAULT '',
        wrong_questions TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_results_quiz ON quiz_results(quiz_id);
      CREATE INDEX IF NOT EXISTS idx_results_created ON quiz_results(created_at);
    `,
  },
  {
    id: 'create-study-plans-table',
    description: '创建学习计划表',
    sql: `
      CREATE TABLE IF NOT EXISTS study_plans (
        id              TEXT PRIMARY KEY,
        subject_id      TEXT DEFAULT '',
        title           TEXT NOT NULL,
        goal            TEXT DEFAULT '',
        target_date     TEXT DEFAULT '',
        daily_minutes   INTEGER DEFAULT 60,
        current_level   TEXT DEFAULT 'beginner',
        learning_style  TEXT DEFAULT 'reading',
        status          TEXT DEFAULT 'active',
        total_days      INTEGER DEFAULT 0,
        completed_days  INTEGER DEFAULT 0,
        notes           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_subject ON study_plans(subject_id);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON study_plans(status);
    `,
  },
  {
    id: 'create-plan-milestones-table',
    description: '创建学习计划里程碑表',
    sql: `
      CREATE TABLE IF NOT EXISTS plan_milestones (
        id              TEXT PRIMARY KEY,
        plan_id         TEXT NOT NULL,
        title           TEXT NOT NULL,
        topic_ids       TEXT DEFAULT '',
        estimated_days  INTEGER DEFAULT 7,
        sort_order      INTEGER DEFAULT 0,
        status          TEXT DEFAULT 'not_started',
        quiz_id         TEXT DEFAULT '',
        notes           TEXT DEFAULT '',
        started_at      TEXT DEFAULT '',
        completed_at    TEXT DEFAULT '',
        FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_milestones_plan ON plan_milestones(plan_id);
      CREATE INDEX IF NOT EXISTS idx_milestones_status ON plan_milestones(status);
    `,
  },
  {
    id: 'create-learning-progress-table',
    description: '创建学习进度表',
    sql: `
      CREATE TABLE IF NOT EXISTS learning_progress (
        id                  TEXT PRIMARY KEY,
        subject_id          TEXT DEFAULT '',
        topic_id            TEXT DEFAULT '',
        topic               TEXT NOT NULL,
        status              TEXT DEFAULT 'not_started',
        comprehension_score REAL DEFAULT 0,
        time_spent_minutes  INTEGER DEFAULT 0,
        study_count         INTEGER DEFAULT 0,
        last_accessed_at    TEXT DEFAULT '',
        weak_areas          TEXT DEFAULT '',
        notes               TEXT DEFAULT '',
        created_at          TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at          TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_progress_subject ON learning_progress(subject_id);
      CREATE INDEX IF NOT EXISTS idx_progress_topic_id ON learning_progress(topic_id);
      CREATE INDEX IF NOT EXISTS idx_progress_status ON learning_progress(status);
    `,
  },
  {
    id: 'create-flashcards-table',
    description: '创建知识卡片/闪卡表',
    sql: `
      CREATE TABLE IF NOT EXISTS flashcards (
        id              TEXT PRIMARY KEY,
        subject_id      TEXT DEFAULT '',
        topic_id        TEXT DEFAULT '',
        front           TEXT NOT NULL,
        back            TEXT NOT NULL,
        hint            TEXT DEFAULT '',
        difficulty      TEXT DEFAULT 'intermediate',
        tags            TEXT DEFAULT '',
        review_count    INTEGER DEFAULT 0,
        correct_count   INTEGER DEFAULT 0,
        next_review_at  TEXT DEFAULT '',
        interval_days   INTEGER DEFAULT 1,
        ease_factor     REAL DEFAULT 2.5,
        status          TEXT DEFAULT 'new',
        source_type     TEXT DEFAULT '',
        source_id       TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_flashcards_subject ON flashcards(subject_id);
      CREATE INDEX IF NOT EXISTS idx_flashcards_topic ON flashcards(topic_id);
      CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(next_review_at);
      CREATE INDEX IF NOT EXISTS idx_flashcards_status ON flashcards(status);
    `,
  },
  {
    id: 'create-card-review-log-table',
    description: '创建卡片复习记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS card_review_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id         TEXT NOT NULL,
        quality         INTEGER NOT NULL DEFAULT 3,
        response_time   INTEGER DEFAULT 0,
        reviewed_at     TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (card_id) REFERENCES flashcards(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_review_log_card ON card_review_log(card_id);
      CREATE INDEX IF NOT EXISTS idx_review_log_reviewed ON card_review_log(reviewed_at);
    `,
  },
  {
    id: 'create-mistakes-table',
    description: '创建错题本表',
    sql: `
      CREATE TABLE IF NOT EXISTS mistakes (
        id              TEXT PRIMARY KEY,
        subject_id      TEXT DEFAULT '',
        topic_id        TEXT DEFAULT '',
        question        TEXT NOT NULL,
        your_answer     TEXT DEFAULT '',
        correct_answer  TEXT NOT NULL,
        explanation     TEXT DEFAULT '',
        source          TEXT DEFAULT '',
        source_id       TEXT DEFAULT '',
        difficulty      TEXT DEFAULT 'intermediate',
        review_count    INTEGER DEFAULT 0,
        mastered        INTEGER DEFAULT 0,
        tags            TEXT DEFAULT '',
        notes           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject_id);
      CREATE INDEX IF NOT EXISTS idx_mistakes_topic ON mistakes(topic_id);
      CREATE INDEX IF NOT EXISTS idx_mistakes_mastered ON mistakes(mastered);
      CREATE INDEX IF NOT EXISTS idx_mistakes_source ON mistakes(source);
    `,
  },
  {
    id: 'create-review-schedule-table',
    description: '创建复习计划表（间隔重复）',
    sql: `
      CREATE TABLE IF NOT EXISTS review_schedule (
        id              TEXT PRIMARY KEY,
        topic           TEXT NOT NULL,
        topic_id        TEXT DEFAULT '',
        subject_id      TEXT DEFAULT '',
        next_review_at  TEXT NOT NULL,
        interval_days   INTEGER DEFAULT 1,
        review_count    INTEGER DEFAULT 0,
        ease_factor     REAL DEFAULT 2.5,
        source_type     TEXT DEFAULT 'topic',
        source_id       TEXT DEFAULT '',
        status          TEXT DEFAULT 'pending',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_review_schedule_next ON review_schedule(next_review_at);
      CREATE INDEX IF NOT EXISTS idx_review_schedule_status ON review_schedule(status);
      CREATE INDEX IF NOT EXISTS idx_review_schedule_subject ON review_schedule(subject_id);
      CREATE INDEX IF NOT EXISTS idx_review_schedule_topic_id ON review_schedule(topic_id);
    `,
  },
  {
    id: 'seed-default-subjects',
    description: '插入默认学科数据',
    sql: `
      INSERT OR IGNORE INTO subjects (id, name, name_en, category, icon, color, difficulty, description, sort_order) VALUES
        ('math', '数学', 'Mathematics', 'science', 'Calculator', '#3B82F6', 'intermediate', '数学学科，包含代数、几何、微积分等', 1),
        ('physics', '物理', 'Physics', 'science', 'Zap', '#8B5CF6', 'intermediate', '物理学科，包含力学、电磁学、光学等', 2),
        ('chemistry', '化学', 'Chemistry', 'science', 'FlaskConical', '#EC4899', 'intermediate', '化学学科，包含有机化学、无机化学等', 3),
        ('biology', '生物', 'Biology', 'science', 'Leaf', '#22C55E', 'beginner', '生物学科，包含细胞、遗传、生态等', 4),
        ('english', '英语', 'English', 'language', 'Globe', '#06B6D4', 'beginner', '英语语言学习，包含词汇、语法、阅读等', 5),
        ('chinese', '语文', 'Chinese', 'language', 'BookOpen', '#F59E0B', 'beginner', '语文学科，包含阅读、写作、古诗文等', 6),
        ('history', '历史', 'History', 'humanities', 'Clock', '#D97706', 'beginner', '历史学科，包含中国史、世界史等', 7),
        ('geography', '地理', 'Geography', 'humanities', 'Map', '#059669', 'beginner', '地理学科，包含自然地理、人文地理等', 8),
        ('programming', '编程', 'Programming', 'technology', 'Code2', '#6366F1', 'intermediate', '编程学习，包含Python、JavaScript等', 9),
        ('general', '通用', 'General', 'general', 'Sparkles', '#10B981', 'beginner', '通用学科，适用于跨学科学习', 0);
    `,
  },
  {
    id: 'migrate-add-topic-id-columns',
    description: '为现有表增加 topic_id 字段（兼容已有数据）',
    sql: `
      ALTER TABLE learning_progress ADD COLUMN topic_id TEXT DEFAULT '';
      ALTER TABLE flashcards ADD COLUMN topic_id TEXT DEFAULT '';
      ALTER TABLE flashcards ADD COLUMN source_type TEXT DEFAULT '';
      ALTER TABLE flashcards ADD COLUMN source_id TEXT DEFAULT '';
      ALTER TABLE mistakes ADD COLUMN topic_id TEXT DEFAULT '';
      ALTER TABLE review_schedule ADD COLUMN topic_id TEXT DEFAULT '';
      ALTER TABLE quiz_questions ADD COLUMN topic_id TEXT DEFAULT '';
    `,
  },
]

export const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'drop-all-tables',
    description: '删除所有教育场景表',
    sql: `
      DROP TABLE IF EXISTS card_review_log;
      DROP TABLE IF EXISTS flashcards;
      DROP TABLE IF EXISTS mistakes;
      DROP TABLE IF EXISTS review_schedule;
      DROP TABLE IF EXISTS learning_progress;
      DROP TABLE IF EXISTS plan_milestones;
      DROP TABLE IF EXISTS study_plans;
      DROP TABLE IF EXISTS quiz_results;
      DROP TABLE IF EXISTS quiz_questions;
      DROP TABLE IF EXISTS quizzes;
      DROP TABLE IF EXISTS topics;
      DROP TABLE IF EXISTS subjects;
    `,
  },
]

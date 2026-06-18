import type { ScenarioDbScript } from '@shared/protocols/scenario-arch'

export const INSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'create-projects-table',
    description: '创建项目表',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        template_id TEXT DEFAULT '',
        local_path  TEXT NOT NULL,
        config      TEXT DEFAULT '{}',
        status      TEXT DEFAULT 'active',
        created_at  TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
    `,
  },
  {
    id: 'create-dev-sessions-table',
    description: '创建开发会话表',
    sql: `
      CREATE TABLE IF NOT EXISTS dev_sessions (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        title       TEXT DEFAULT '',
        mode        TEXT DEFAULT 'solo',
        status      TEXT DEFAULT 'active',
        tasks       TEXT DEFAULT '[]',
        created_at  TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON dev_sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON dev_sessions(status);
    `,
  },
  {
    id: 'create-build-logs-table',
    description: '创建构建日志表',
    sql: `
      CREATE TABLE IF NOT EXISTS build_logs (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        session_id  TEXT DEFAULT '',
        build_type  TEXT NOT NULL,
        command     TEXT DEFAULT '',
        status      TEXT DEFAULT 'pending',
        exit_code   INTEGER,
        output      TEXT DEFAULT '',
        duration_ms INTEGER DEFAULT 0,
        started_at  TEXT DEFAULT (datetime('now', 'localtime')),
        finished_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_build_logs_project ON build_logs(project_id);
      CREATE INDEX IF NOT EXISTS idx_build_logs_type ON build_logs(build_type);
      CREATE INDEX IF NOT EXISTS idx_build_logs_status ON build_logs(status);
    `,
  },
  {
    id: 'create-pipeline-configs-table',
    description: '创建流水线配置表',
    sql: `
      CREATE TABLE IF NOT EXISTS pipeline_configs (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        name        TEXT NOT NULL,
        stages      TEXT DEFAULT '[]',
        trigger     TEXT DEFAULT 'manual',
        schedule    TEXT DEFAULT '',
        created_at  TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline_configs(project_id);
    `,
  },
  {
    id: 'create-deployments-table',
    description: '创建部署记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS deployments (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        session_id  TEXT DEFAULT '',
        target      TEXT NOT NULL,
        status      TEXT DEFAULT 'pending',
        url         TEXT DEFAULT '',
        config      TEXT DEFAULT '{}',
        log         TEXT DEFAULT '',
        duration_ms INTEGER DEFAULT 0,
        started_at  TEXT DEFAULT (datetime('now', 'localtime')),
        finished_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
      CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
    `,
  },
]

export const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
  { id: 'drop-deployments', description: '删除部署记录表', sql: 'DROP TABLE IF EXISTS deployments' },
  { id: 'drop-pipeline-configs', description: '删除流水线配置表', sql: 'DROP TABLE IF EXISTS pipeline_configs' },
  { id: 'drop-build-logs', description: '删除构建日志表', sql: 'DROP TABLE IF EXISTS build_logs' },
  { id: 'drop-dev-sessions', description: '删除开发会话表', sql: 'DROP TABLE IF EXISTS dev_sessions' },
  { id: 'drop-projects', description: '删除项目表', sql: 'DROP TABLE IF EXISTS projects' },
]
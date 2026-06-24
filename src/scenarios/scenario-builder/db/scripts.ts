import type { ScenarioDbScript } from '@shared/protocols/scenario-arch'

/**
 * 场景开发助手数据库安装脚本
 *
 * 表结构：
 * - scenario_projects：场景项目
 * - build_records：构建记录
 * - install_records：安装记录
 * - publish_records：发布记录
 */
export const INSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'create-scenario-projects-table',
    description: '创建场景项目表',
    sql: `
      CREATE TABLE IF NOT EXISTS scenario_projects (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        scenario_id     TEXT NOT NULL,
        version         TEXT DEFAULT '1.0.0',
        description     TEXT DEFAULT '',
        type            TEXT DEFAULT 'declarative',
        local_path      TEXT NOT NULL,
        config          TEXT DEFAULT '{}',
        status          TEXT DEFAULT 'draft',
        author          TEXT DEFAULT '',
        tags            TEXT DEFAULT '[]',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        last_built_at   TEXT,
        last_published_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_projects_scenario_id ON scenario_projects(scenario_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON scenario_projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_type ON scenario_projects(type);
    `,
  },
  {
    id: 'create-build-records-table',
    description: '创建构建记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS build_records (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        build_type    TEXT NOT NULL,
        command       TEXT DEFAULT '',
        status        TEXT DEFAULT 'pending',
        exit_code     INTEGER,
        output        TEXT DEFAULT '',
        duration_ms   INTEGER DEFAULT 0,
        started_at    TEXT DEFAULT (datetime('now', 'localtime')),
        finished_at   TEXT,
        FOREIGN KEY (project_id) REFERENCES scenario_projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_build_records_project ON build_records(project_id);
      CREATE INDEX IF NOT EXISTS idx_build_records_type ON build_records(build_type);
      CREATE INDEX IF NOT EXISTS idx_build_records_status ON build_records(status);
    `,
  },
  {
    id: 'create-install-records-table',
    description: '创建安装记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS install_records (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        version       TEXT NOT NULL,
        package_path  TEXT NOT NULL,
        status        TEXT DEFAULT 'pending',
        error         TEXT DEFAULT '',
        installed_at  TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (project_id) REFERENCES scenario_projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_install_records_project ON install_records(project_id);
      CREATE INDEX IF NOT EXISTS idx_install_records_status ON install_records(status);
    `,
  },
  {
    id: 'create-publish-records-table',
    description: '创建发布记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS publish_records (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        version         TEXT NOT NULL,
        package_name    TEXT NOT NULL,
        status          TEXT DEFAULT 'pending',
        marketplace_id  TEXT DEFAULT '',
        download_url    TEXT DEFAULT '',
        error           TEXT DEFAULT '',
        published_at    TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (project_id) REFERENCES scenario_projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_publish_records_project ON publish_records(project_id);
      CREATE INDEX IF NOT EXISTS idx_publish_records_status ON publish_records(status);
    `,
  },
]

/**
 * 卸载脚本（保留数据，仅删表）
 */
export const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'drop-publish-records-table',
    description: '删除发布记录表',
    sql: 'DROP TABLE IF EXISTS publish_records;',
  },
  {
    id: 'drop-install-records-table',
    description: '删除安装记录表',
    sql: 'DROP TABLE IF EXISTS install_records;',
  },
  {
    id: 'drop-build-records-table',
    description: '删除构建记录表',
    sql: 'DROP TABLE IF EXISTS build_records;',
  },
  {
    id: 'drop-scenario-projects-table',
    description: '删除场景项目表',
    sql: 'DROP TABLE IF EXISTS scenario_projects;',
  },
]

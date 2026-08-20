/**
 * 数据库安装脚本代码片段集合
 *
 * 提供场景开发中常见的数据库 SQL 样板：
 *  - db-install-basic:       基础表 + 索引
 *  - db-install-audit:      带审计字段（created/updated/deleted）的表
 *  - db-install-fk:         带外键关联的多表
 *  - db-uninstall-basic:    对应的卸载脚本
 *  - db-seed-data:          初始化种子数据
 */
import type { Snippet } from './types'

// ==========================================
// 基础表 + 索引
// ==========================================
export const dbInstallBasicSnippet: Snippet = {
  id: 'db-install-basic',
  name: 'DB Install Basic',
  nameZh: '基础表安装脚本',
  description: 'Basic SQLite table creation with indexes',
  descriptionZh: '基础 SQLite 建表脚本（含索引）',
  category: 'database',
  applicableTypes: ['both'],
  language: 'sql',
  icon: 'Database',
  tags: ['database', 'sql', 'install', 'table'],
  difficulty: 'beginner',
  targetFile: 'db/install.sql',
  variables: [
    {
      name: 'tableName',
      defaultValue: 'records',
      description: 'Table name',
      descriptionZh: '表名',
      required: true,
    },
  ],
  code: `-- 基础表：\${tableName}
CREATE TABLE IF NOT EXISTS \${tableName} (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：加速常用查询
CREATE INDEX IF NOT EXISTS idx_\${tableName}_created_at ON \${tableName} (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_\${tableName}_title ON \${tableName} (title);`,
  usage: '放置到 db/install.sql；场景激活时由 onActivate 调用执行。',
}

// ==========================================
// 带审计字段的表
// ==========================================
export const dbInstallAuditSnippet: Snippet = {
  id: 'db-install-audit',
  name: 'DB Install Audited',
  nameZh: '审计表安装脚本',
  description: 'Table with audit fields (created/updated/deleted + soft delete)',
  descriptionZh: '带审计字段的表：创建/更新/删除时间 + 软删除',
  category: 'database',
  applicableTypes: ['both'],
  language: 'sql',
  icon: 'ShieldCheck',
  tags: ['database', 'sql', 'audit', 'soft-delete'],
  difficulty: 'intermediate',
  targetFile: 'db/install.sql',
  variables: [
    {
      name: 'tableName',
      defaultValue: 'items',
      description: 'Table name',
      descriptionZh: '表名',
      required: true,
    },
  ],
  code: `-- 审计表：\${tableName}（带软删除）
CREATE TABLE IF NOT EXISTS \${tableName} (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active / archived / deleted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  metadata TEXT  -- JSON 扩展字段
);

-- 索引：常用查询（已排除软删除记录）
CREATE INDEX IF NOT EXISTS idx_\${tableName}_status ON \${tableName} (status);
CREATE INDEX IF NOT EXISTS idx_\${tableName}_created_at ON \${tableName} (created_at DESC);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS trg_\${tableName}_updated
AFTER UPDATE ON \${tableName}
FOR EACH ROW
BEGIN
  UPDATE \${tableName} SET updated_at = datetime('now') WHERE id = OLD.id;
END;`,
  usage: '适合需要历史追溯的场景；查询时加 WHERE deleted_at IS NULL 过滤软删除记录。',
}

// ==========================================
// 带外键关联的多表
// ==========================================
export const dbInstallFkSnippet: Snippet = {
  id: 'db-install-fk',
  name: 'DB Install Foreign Keys',
  nameZh: '外键关联多表安装脚本',
  description: 'Multiple tables with foreign key constraints and cascade rules',
  descriptionZh: '带外键约束的多表安装脚本（含级联规则）',
  category: 'database',
  applicableTypes: ['both'],
  language: 'sql',
  icon: 'Link2',
  tags: ['database', 'sql', 'foreign-key', 'relation'],
  difficulty: 'advanced',
  targetFile: 'db/install.sql',
  variables: [
    {
      name: 'parentTable',
      defaultValue: 'categories',
      description: 'Parent table name',
      descriptionZh: '父表名',
      required: true,
    },
    {
      name: 'childTable',
      defaultValue: 'items',
      description: 'Child table name',
      descriptionZh: '子表名',
      required: true,
    },
  ],
  code: `-- 父表：\${parentTable}
CREATE TABLE IF NOT EXISTS \${parentTable} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 子表：\${childTable}（关联父表）
CREATE TABLE IF NOT EXISTS \${childTable} (
  id TEXT PRIMARY KEY,
  \${parentTable}_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (\${parentTable}_id) REFERENCES \${parentTable} (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_\${childTable}_\${parentTable}_id ON \${childTable} (\${parentTable}_id);
CREATE INDEX IF NOT EXISTS idx_\${childTable}_created_at ON \${childTable} (created_at DESC);

-- 外键约束开启（SQLite 默认关闭，需在每次连接时启用）
-- 注意：executeSql 时不要附加 PRAGMA foreign_keys=ON，由客户端统一管理`,
  usage: '外键级联删除：删父表记录时自动删除子表关联记录；ON UPDATE CASCADE 同步更新父表 id 变更。',
}

// ==========================================
// 对应的卸载脚本
// ==========================================
export const dbUninstallBasicSnippet: Snippet = {
  id: 'db-uninstall-basic',
  name: 'DB Uninstall Basic',
  nameZh: '基础卸载脚本',
  description: 'Drop tables and indexes created by install.sql',
  descriptionZh: '卸载 install.sql 创建的表与索引',
  category: 'database',
  applicableTypes: ['both'],
  language: 'sql',
  icon: 'Trash2',
  tags: ['database', 'sql', 'uninstall', 'drop'],
  difficulty: 'beginner',
  targetFile: 'db/uninstall.sql',
  variables: [
    {
      name: 'tableName',
      defaultValue: 'records',
      description: 'Table name to drop',
      descriptionZh: '要删除的表名',
      required: true,
    },
  ],
  code: `-- 卸载脚本：删除 \${tableName} 表与索引
DROP INDEX IF EXISTS idx_\${tableName}_created_at;
DROP INDEX IF EXISTS idx_\${tableName}_title;
DROP TRIGGER IF EXISTS trg_\${tableName}_updated;
DROP TABLE IF EXISTS \${tableName};`,
  usage: '与 db-install-basic 配套；仅在用户主动卸载场景时执行，停用（deactivate）时不调用。',
}

// ==========================================
// 种子数据
// ==========================================
export const dbSeedDataSnippet: Snippet = {
  id: 'db-seed-data',
  name: 'DB Seed Data',
  nameZh: '种子数据脚本',
  description: 'Initial seed data for first-time installation',
  descriptionZh: '首次安装时插入的初始化种子数据',
  category: 'database',
  applicableTypes: ['both'],
  language: 'sql',
  icon: 'Sprout',
  tags: ['database', 'sql', 'seed', 'initial-data'],
  difficulty: 'beginner',
  targetFile: 'db/seed.sql',
  variables: [
    {
      name: 'tableName',
      defaultValue: 'records',
      description: 'Target table name',
      descriptionZh: '目标表名',
      required: true,
    },
  ],
  code: `-- 种子数据：\${tableName}
-- 仅在首次安装时执行（由 onActivate 判断表是否为空）
INSERT OR IGNORE INTO \${tableName} (id, title, content) VALUES
  ('seed-1', '欢迎使用', '这是初始化的示例记录，可按需修改或删除。'),
  ('seed-2', '快速入门', '1. 修改 system.md 调整 AI 行为 2. 通过场景开发助手校验与构建 3. 安装到客户端测试');`,
  usage: '放置到 db/seed.sql；onActivate 中检查表是否为空，为空才执行 INSERT。',
}

import type { ScenarioDbScript } from '@shared/types/scenario-arch'

export const INSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'create-stores-table',
    description: '创建门店信息表',
    sql: `
      CREATE TABLE IF NOT EXISTS stores (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        type            TEXT NOT NULL DEFAULT 'retail',
        area            REAL DEFAULT 0,
        business_hours  TEXT DEFAULT '',
        employee_count  INTEGER DEFAULT 0,
        avg_transaction_value REAL DEFAULT 0,
        main_categories TEXT DEFAULT '',
        rent_cost       REAL DEFAULT 0,
        decoration_age  INTEGER DEFAULT 0,
        region          TEXT DEFAULT '',
        photos          TEXT DEFAULT '',
        notes           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_stores_type ON stores(type);
      CREATE INDEX IF NOT EXISTS idx_stores_region ON stores(region);
    `,
  },
  {
    id: 'create-financial-data-table',
    description: '创建门店财务数据表',
    sql: `
      CREATE TABLE IF NOT EXISTS store_financials (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id        TEXT NOT NULL,
        period          TEXT NOT NULL,
        revenue         REAL DEFAULT 0,
        rent_cost       REAL DEFAULT 0,
        labor_cost      REAL DEFAULT 0,
        material_cost   REAL DEFAULT 0,
        utility_cost    REAL DEFAULT 0,
        other_cost      REAL DEFAULT 0,
        customer_count  INTEGER DEFAULT 0,
        repeat_customer_rate REAL DEFAULT 0,
        avg_transaction_value REAL DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        UNIQUE(store_id, period)
      );
      CREATE INDEX IF NOT EXISTS idx_financials_store ON store_financials(store_id);
      CREATE INDEX IF NOT EXISTS idx_financials_period ON store_financials(period);
    `,
  },
  {
    id: 'create-traffic-data-table',
    description: '创建门店客流数据表',
    sql: `
      CREATE TABLE IF NOT EXISTS store_traffic (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id                TEXT NOT NULL,
        date                    TEXT NOT NULL,
        hour                    INTEGER NOT NULL,
        customer_count          INTEGER DEFAULT 0,
        new_customer_count      INTEGER DEFAULT 0,
        returning_customer_count INTEGER DEFAULT 0,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        UNIQUE(store_id, date, hour)
      );
      CREATE INDEX IF NOT EXISTS idx_traffic_store_date ON store_traffic(store_id, date);
    `,
  },
  {
    id: 'create-diagnosis-records-table',
    description: '创建诊断记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS diagnosis_records (
        id              TEXT PRIMARY KEY,
        store_id        TEXT NOT NULL,
        dimension       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        score           INTEGER DEFAULT 0,
        summary         TEXT DEFAULT '',
        details         TEXT DEFAULT '',
        recommendations TEXT DEFAULT '',
        diagnosed_at    TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diagnosis_store ON diagnosis_records(store_id);
      CREATE INDEX IF NOT EXISTS idx_diagnosis_dimension ON diagnosis_records(dimension);
    `,
  },
  {
    id: 'create-optimization-plans-table',
    description: '创建优化方案表',
    sql: `
      CREATE TABLE IF NOT EXISTS optimization_plans (
        id              TEXT PRIMARY KEY,
        store_id        TEXT NOT NULL,
        diagnosis_id    TEXT,
        title           TEXT NOT NULL,
        description     TEXT DEFAULT '',
        priority        INTEGER DEFAULT 5,
        status          TEXT NOT NULL DEFAULT 'pending',
        expected_effect TEXT DEFAULT '',
        execution_cycle TEXT DEFAULT '',
        tasks           TEXT DEFAULT '[]',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_plans_store ON optimization_plans(store_id);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON optimization_plans(status);
    `,
  },
  {
    id: 'create-plan-tasks-table',
    description: '创建方案任务表',
    sql: `
      CREATE TABLE IF NOT EXISTS plan_tasks (
        id              TEXT PRIMARY KEY,
        plan_id         TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT DEFAULT '',
        assignee        TEXT DEFAULT '',
        due_date        TEXT DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'pending',
        completed_at    TEXT,
        FOREIGN KEY (plan_id) REFERENCES optimization_plans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_plan ON plan_tasks(plan_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON plan_tasks(status);
    `,
  },
  {
    id: 'create-benchmarks-table',
    description: '创建行业基准数据表',
    sql: `
      CREATE TABLE IF NOT EXISTS industry_benchmarks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        category        TEXT NOT NULL,
        metric          TEXT NOT NULL,
        industry_avg    REAL NOT NULL,
        top_quartile    REAL NOT NULL,
        unit            TEXT DEFAULT '',
        UNIQUE(category, metric)
      );
      CREATE INDEX IF NOT EXISTS idx_benchmarks_category ON industry_benchmarks(category);
    `,
  },
  {
    id: 'seed-benchmark-data',
    description: '插入行业基准初始数据',
    sql: `
      INSERT OR IGNORE INTO industry_benchmarks (category, metric, industry_avg, top_quartile, unit) VALUES
        ('retail', 'rent_ratio', 15.0, 10.0, '%'),
        ('retail', 'labor_ratio', 20.0, 15.0, '%'),
        ('retail', 'gross_margin', 35.0, 45.0, '%'),
        ('retail', 'net_margin', 8.0, 15.0, '%'),
        ('retail', 'inventory_turnover', 6.0, 10.0, '次/年'),
        ('retail', 'conversion_rate', 20.0, 35.0, '%'),
        ('retail', 'repeat_rate', 30.0, 50.0, '%'),
        ('retail', 'avg_transaction', 80.0, 150.0, '元'),
        ('restaurant', 'rent_ratio', 12.0, 8.0, '%'),
        ('restaurant', 'labor_ratio', 25.0, 18.0, '%'),
        ('restaurant', 'material_ratio', 35.0, 28.0, '%'),
        ('restaurant', 'gross_margin', 55.0, 65.0, '%'),
        ('restaurant', 'net_margin', 10.0, 18.0, '%'),
        ('restaurant', 'repeat_rate', 35.0, 55.0, '%'),
        ('restaurant', 'avg_transaction', 60.0, 100.0, '元'),
        ('restaurant', 'table_turnover', 2.5, 4.0, '次/天'),
        ('service', 'rent_ratio', 18.0, 12.0, '%'),
        ('service', 'labor_ratio', 35.0, 25.0, '%'),
        ('service', 'gross_margin', 60.0, 75.0, '%'),
        ('service', 'net_margin', 12.0, 22.0, '%'),
        ('service', 'repeat_rate', 40.0, 65.0, '%'),
        ('service', 'avg_transaction', 200.0, 400.0, '元'),
        ('service', 'retention_rate', 50.0, 70.0, '%');
    `,
  },
]

export const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'drop-all-tables',
    description: '删除所有门店诊断相关表',
    sql: `
      DROP TABLE IF EXISTS plan_tasks;
      DROP TABLE IF EXISTS optimization_plans;
      DROP TABLE IF EXISTS diagnosis_records;
      DROP TABLE IF EXISTS store_traffic;
      DROP TABLE IF EXISTS store_financials;
      DROP TABLE IF EXISTS industry_benchmarks;
      DROP TABLE IF EXISTS stores;
    `,
  },
]

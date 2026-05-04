/**
 * 低电压治理场景 - 数据库脚本
 *
 * 定义场景安装/卸载时执行的 SQL 脚本。
 * 安装时创建业务表，卸载时删除业务表。
 */

import type { ScenarioDbScript } from '@shared/types/scenario-arch'

export const INSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'create-lv-users',
    description: '创建低电压用户表',
    sql: `
      CREATE TABLE IF NOT EXISTS lv_users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_code     TEXT    NOT NULL UNIQUE,
        user_name     TEXT    NOT NULL,
        address       TEXT,
        district_code TEXT    NOT NULL,
        transformer_id TEXT,
        voltage_level REAL,
        is_low_voltage INTEGER DEFAULT 0,
        low_voltage_count INTEGER DEFAULT 0,
        first_detected_at TEXT,
        last_detected_at  TEXT,
        status        TEXT    DEFAULT 'active',
        phone         TEXT,
        remark        TEXT,
        created_at    TEXT    DEFAULT (datetime('now', 'localtime')),
        updated_at    TEXT    DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_lv_users_district ON lv_users(district_code);
      CREATE INDEX IF NOT EXISTS idx_lv_users_status ON lv_users(status);
      CREATE INDEX IF NOT EXISTS idx_lv_users_low_voltage ON lv_users(is_low_voltage);
    `,
  },
  {
    id: 'create-lv-districts',
    description: '创建台区表',
    sql: `
      CREATE TABLE IF NOT EXISTS lv_districts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        district_code   TEXT    NOT NULL UNIQUE,
        district_name   TEXT    NOT NULL,
        substation_name TEXT,
        feeder_name     TEXT,
        transformer_name TEXT,
        transformer_capacity REAL,
        transformer_load_rate REAL,
        user_count      INTEGER DEFAULT 0,
        low_voltage_user_count INTEGER DEFAULT 0,
        area_type       TEXT    DEFAULT 'urban',
        longitude       REAL,
        latitude        REAL,
        status          TEXT    DEFAULT 'active',
        remark          TEXT,
        created_at      TEXT    DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT    DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_lv_districts_code ON lv_districts(district_code);
      CREATE INDEX IF NOT EXISTS idx_lv_districts_status ON lv_districts(status);
    `,
  },
  {
    id: 'create-lv-treatment-records',
    description: '创建治理记录表',
    sql: `
      CREATE TABLE IF NOT EXISTS lv_treatment_records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        record_code     TEXT    NOT NULL UNIQUE,
        user_id         INTEGER NOT NULL,
        district_code   TEXT    NOT NULL,
        treatment_type  TEXT    NOT NULL,
        treatment_plan  TEXT,
        executor        TEXT,
        start_date      TEXT,
        end_date        TEXT,
        before_voltage  REAL,
        after_voltage   REAL,
        result          TEXT    DEFAULT 'pending',
        remark          TEXT,
        created_at      TEXT    DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT    DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES lv_users(id),
        FOREIGN KEY (district_code) REFERENCES lv_districts(district_code)
      );

      CREATE INDEX IF NOT EXISTS idx_lv_treatment_user ON lv_treatment_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_lv_treatment_district ON lv_treatment_records(district_code);
      CREATE INDEX IF NOT EXISTS idx_lv_treatment_result ON lv_treatment_records(result);
    `,
  },
  {
    id: 'create-lv-monitor-data',
    description: '创建电压监测数据表',
    sql: `
      CREATE TABLE IF NOT EXISTS lv_monitor_data (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        monitor_date  TEXT    NOT NULL,
        voltage_a     REAL,
        voltage_b     REAL,
        voltage_c     REAL,
        avg_voltage   REAL,
        min_voltage   REAL,
        max_voltage   REAL,
        duration_minutes INTEGER DEFAULT 0,
        data_source   TEXT    DEFAULT 'manual',
        created_at    TEXT    DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES lv_users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_lv_monitor_user ON lv_monitor_data(user_id);
      CREATE INDEX IF NOT EXISTS idx_lv_monitor_date ON lv_monitor_data(monitor_date);
    `,
  },
]

export const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'drop-lv-monitor-data',
    description: '删除电压监测数据表',
    sql: 'DROP TABLE IF EXISTS lv_monitor_data',
  },
  {
    id: 'drop-lv-treatment-records',
    description: '删除治理记录表',
    sql: 'DROP TABLE IF EXISTS lv_treatment_records',
  },
  {
    id: 'drop-lv-users',
    description: '删除低电压用户表',
    sql: 'DROP TABLE IF EXISTS lv_users',
  },
  {
    id: 'drop-lv-districts',
    description: '删除台区表',
    sql: 'DROP TABLE IF EXISTS lv_districts',
  },
]

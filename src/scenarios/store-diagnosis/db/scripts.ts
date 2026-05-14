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
        sub_type        TEXT DEFAULT '',
        area            REAL DEFAULT 0,
        business_hours  TEXT DEFAULT '',
        employee_count  INTEGER DEFAULT 0,
        avg_transaction_value REAL DEFAULT 0,
        main_categories TEXT DEFAULT '',
        rent_cost       REAL DEFAULT 0,
        decoration_age  INTEGER DEFAULT 0,
        region          TEXT DEFAULT '',
        city_tier       INTEGER DEFAULT 2,
        latitude        REAL DEFAULT 0,
        longitude       REAL DEFAULT 0,
        contact_phone   TEXT DEFAULT '',
        opened_at       TEXT DEFAULT '',
        monthly_revenue REAL DEFAULT 0,
        business_status TEXT DEFAULT 'normal',
        photos          TEXT DEFAULT '',
        notes           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_stores_type ON stores(type);
      CREATE INDEX IF NOT EXISTS idx_stores_region ON stores(region);
      CREATE INDEX IF NOT EXISTS idx_stores_sub_type ON stores(sub_type);
    `,
  },
  {
    id: 'alter-stores-add-columns-v2',
    description: '为 stores 表新增字段（兼容已有数据库）',
    sql: `
      ALTER TABLE stores ADD COLUMN sub_type TEXT DEFAULT '';
      ALTER TABLE stores ADD COLUMN city_tier INTEGER DEFAULT 2;
      ALTER TABLE stores ADD COLUMN latitude REAL DEFAULT 0;
      ALTER TABLE stores ADD COLUMN longitude REAL DEFAULT 0;
      ALTER TABLE stores ADD COLUMN contact_phone TEXT DEFAULT '';
      ALTER TABLE stores ADD COLUMN opened_at TEXT DEFAULT '';
      ALTER TABLE stores ADD COLUMN monthly_revenue REAL DEFAULT 0;
      ALTER TABLE stores ADD COLUMN business_status TEXT DEFAULT 'normal';
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
        gross_profit    REAL DEFAULT 0,
        net_profit      REAL DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        UNIQUE(store_id, period)
      );
      CREATE INDEX IF NOT EXISTS idx_financials_store ON store_financials(store_id);
      CREATE INDEX IF NOT EXISTS idx_financials_period ON store_financials(period);
    `,
  },
  {
    id: 'alter-financials-add-columns-v2',
    description: '为 store_financials 表新增字段',
    sql: `
      ALTER TABLE store_financials ADD COLUMN gross_profit REAL DEFAULT 0;
      ALTER TABLE store_financials ADD COLUMN net_profit REAL DEFAULT 0;
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
        conversion_rate         REAL DEFAULT 0,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        UNIQUE(store_id, date, hour)
      );
      CREATE INDEX IF NOT EXISTS idx_traffic_store_date ON store_traffic(store_id, date);
    `,
  },
  {
    id: 'alter-traffic-add-conversion-rate',
    description: '为 store_traffic 表新增转化率字段',
    sql: `
      ALTER TABLE store_traffic ADD COLUMN conversion_rate REAL DEFAULT 0;
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
        confidence      REAL DEFAULT 0,
        summary         TEXT DEFAULT '',
        details         TEXT DEFAULT '',
        recommendations TEXT DEFAULT '',
        data_sources    TEXT DEFAULT '',
        diagnosed_at    TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diagnosis_store ON diagnosis_records(store_id);
      CREATE INDEX IF NOT EXISTS idx_diagnosis_dimension ON diagnosis_records(dimension);
    `,
  },
  {
    id: 'alter-diagnosis-add-columns-v2',
    description: '为 diagnosis_records 表新增字段',
    sql: `
      ALTER TABLE diagnosis_records ADD COLUMN confidence REAL DEFAULT 0;
      ALTER TABLE diagnosis_records ADD COLUMN data_sources TEXT DEFAULT '';
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
        expected_roi    REAL DEFAULT 0,
        investment_cost REAL DEFAULT 0,
        execution_cycle TEXT DEFAULT '',
        tasks           TEXT DEFAULT '[]',
        plan_type       TEXT DEFAULT 'prescription',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_plans_store ON optimization_plans(store_id);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON optimization_plans(status);
    `,
  },
  {
    id: 'alter-plans-add-columns-v2',
    description: '为 optimization_plans 表新增字段',
    sql: `
      ALTER TABLE optimization_plans ADD COLUMN expected_roi REAL DEFAULT 0;
      ALTER TABLE optimization_plans ADD COLUMN investment_cost REAL DEFAULT 0;
      ALTER TABLE optimization_plans ADD COLUMN plan_type TEXT DEFAULT 'prescription';
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
        cost_level      TEXT DEFAULT 'zero',
        expected_impact TEXT DEFAULT '',
        completed_at    TEXT,
        FOREIGN KEY (plan_id) REFERENCES optimization_plans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_plan ON plan_tasks(plan_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON plan_tasks(status);
    `,
  },
  {
    id: 'alter-tasks-add-columns-v2',
    description: '为 plan_tasks 表新增字段',
    sql: `
      ALTER TABLE plan_tasks ADD COLUMN cost_level TEXT DEFAULT 'zero';
      ALTER TABLE plan_tasks ADD COLUMN expected_impact TEXT DEFAULT '';
    `,
  },
  {
    id: 'create-benchmarks-table',
    description: '创建行业基准数据表',
    sql: `
      CREATE TABLE IF NOT EXISTS industry_benchmarks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        category        TEXT NOT NULL,
        sub_category    TEXT DEFAULT '',
        city_tier       INTEGER DEFAULT 0,
        metric          TEXT NOT NULL,
        industry_avg    REAL NOT NULL,
        top_quartile    REAL NOT NULL,
        unit            TEXT DEFAULT '',
        source          TEXT DEFAULT '',
        updated_at      TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(category, sub_category, city_tier, metric)
      );
      CREATE INDEX IF NOT EXISTS idx_benchmarks_category ON industry_benchmarks(category);
      CREATE INDEX IF NOT EXISTS idx_benchmarks_sub ON industry_benchmarks(category, sub_category);
    `,
  },
  {
    id: 'alter-benchmarks-add-columns-v2',
    description: '为 industry_benchmarks 表新增字段',
    sql: `
      ALTER TABLE industry_benchmarks ADD COLUMN sub_category TEXT DEFAULT '';
      ALTER TABLE industry_benchmarks ADD COLUMN city_tier INTEGER DEFAULT 0;
      ALTER TABLE industry_benchmarks ADD COLUMN source TEXT DEFAULT '';
      ALTER TABLE industry_benchmarks ADD COLUMN updated_at TEXT DEFAULT (datetime('now', 'localtime'));
    `,
  },
  {
    id: 'create-competitors-table',
    description: '创建竞品门店表',
    sql: `
      CREATE TABLE IF NOT EXISTS store_competitors (
        id              TEXT PRIMARY KEY,
        store_id        TEXT NOT NULL,
        competitor_name TEXT NOT NULL,
        competitor_type TEXT DEFAULT '',
        distance_km     REAL DEFAULT 0,
        strength        TEXT DEFAULT '',
        weakness        TEXT DEFAULT '',
        threat_level    TEXT DEFAULT 'medium',
        notes           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_competitors_store ON store_competitors(store_id);
    `,
  },
  {
    id: 'create-recheck-reminders-table',
    description: '创建复诊提醒表',
    sql: `
      CREATE TABLE IF NOT EXISTS recheck_reminders (
        id              TEXT PRIMARY KEY,
        store_id        TEXT NOT NULL,
        diagnosis_id    TEXT DEFAULT '',
        remind_at       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        interval_days   INTEGER DEFAULT 30,
        last_score      INTEGER DEFAULT 0,
        notes           TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_store ON recheck_reminders(store_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_status ON recheck_reminders(status);
    `,
  },
  {
    id: 'create-score-rules-table',
    description: '创建评分规则配置表',
    sql: `
      CREATE TABLE IF NOT EXISTS score_rules (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        dimension       TEXT NOT NULL,
        store_type      TEXT DEFAULT '',
        metric          TEXT NOT NULL,
        weight          REAL DEFAULT 1.0,
        excellent_threshold REAL DEFAULT 80,
        good_threshold      REAL DEFAULT 60,
        poor_threshold       REAL DEFAULT 40,
        benchmark_key    TEXT DEFAULT '',
        is_inverse       INTEGER DEFAULT 0,
        description      TEXT DEFAULT '',
        UNIQUE(dimension, store_type, metric)
      );
      CREATE INDEX IF NOT EXISTS idx_score_rules_dim ON score_rules(dimension);
    `,
  },
  {
    id: 'create-knowledge-base-table',
    description: '创建行业知识库表',
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        category        TEXT NOT NULL,
        store_type      TEXT DEFAULT '',
        title           TEXT NOT NULL,
        content         TEXT NOT NULL,
        tags            TEXT DEFAULT '',
        source          TEXT DEFAULT '',
        view_count      INTEGER DEFAULT 0,
        helpful_count   INTEGER DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category);
      CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_base(store_type);
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
        ('retail', 'sales_per_sqm', 500.0, 1200.0, '元/㎡/月'),
        ('retail', 'revenue_per_employee', 30000.0, 60000.0, '元/月'),
        ('restaurant', 'rent_ratio', 12.0, 8.0, '%'),
        ('restaurant', 'labor_ratio', 25.0, 18.0, '%'),
        ('restaurant', 'material_ratio', 35.0, 28.0, '%'),
        ('restaurant', 'gross_margin', 55.0, 65.0, '%'),
        ('restaurant', 'net_margin', 10.0, 18.0, '%'),
        ('restaurant', 'repeat_rate', 35.0, 55.0, '%'),
        ('restaurant', 'avg_transaction', 60.0, 100.0, '元'),
        ('restaurant', 'table_turnover', 2.5, 4.0, '次/天'),
        ('restaurant', 'food_waste_ratio', 5.0, 2.0, '%'),
        ('restaurant', 'revenue_per_seat', 800.0, 1500.0, '元/座/天'),
        ('service', 'rent_ratio', 18.0, 12.0, '%'),
        ('service', 'labor_ratio', 35.0, 25.0, '%'),
        ('service', 'gross_margin', 60.0, 75.0, '%'),
        ('service', 'net_margin', 12.0, 22.0, '%'),
        ('service', 'repeat_rate', 40.0, 65.0, '%'),
        ('service', 'avg_transaction', 200.0, 400.0, '元'),
        ('service', 'retention_rate', 50.0, 70.0, '%'),
        ('service', 'appointment_rate', 30.0, 60.0, '%');
    `,
  },
  {
    id: 'seed-benchmark-subcategory-data',
    description: '插入细分行业基准数据',
    sql: `
      INSERT OR IGNORE INTO industry_benchmarks (category, sub_category, metric, industry_avg, top_quartile, unit) VALUES
        ('retail', 'convenience', 'rent_ratio', 12.0, 8.0, '%'),
        ('retail', 'convenience', 'gross_margin', 28.0, 35.0, '%'),
        ('retail', 'convenience', 'inventory_turnover', 15.0, 25.0, '次/年'),
        ('retail', 'convenience', 'avg_transaction', 15.0, 25.0, '元'),
        ('retail', 'convenience', 'repeat_rate', 50.0, 70.0, '%'),
        ('retail', 'clothing', 'rent_ratio', 18.0, 12.0, '%'),
        ('retail', 'clothing', 'gross_margin', 45.0, 60.0, '%'),
        ('retail', 'clothing', 'inventory_turnover', 4.0, 8.0, '次/年'),
        ('retail', 'clothing', 'avg_transaction', 200.0, 500.0, '元'),
        ('retail', 'clothing', 'conversion_rate', 10.0, 20.0, '%'),
        ('retail', 'grocery', 'rent_ratio', 10.0, 6.0, '%'),
        ('retail', 'grocery', 'gross_margin', 22.0, 30.0, '%'),
        ('retail', 'grocery', 'inventory_turnover', 20.0, 35.0, '次/年'),
        ('retail', 'grocery', 'avg_transaction', 50.0, 80.0, '元'),
        ('retail', 'grocery', 'waste_ratio', 3.0, 1.0, '%'),
        ('restaurant', 'fast_food', 'rent_ratio', 10.0, 7.0, '%'),
        ('restaurant', 'fast_food', 'material_ratio', 30.0, 22.0, '%'),
        ('restaurant', 'fast_food', 'table_turnover', 4.0, 6.0, '次/天'),
        ('restaurant', 'fast_food', 'avg_transaction', 25.0, 40.0, '元'),
        ('restaurant', 'fast_food', 'net_margin', 12.0, 20.0, '%'),
        ('restaurant', 'hotpot', 'rent_ratio', 14.0, 10.0, '%'),
        ('restaurant', 'hotpot', 'material_ratio', 38.0, 30.0, '%'),
        ('restaurant', 'hotpot', 'table_turnover', 2.0, 3.0, '次/天'),
        ('restaurant', 'hotpot', 'avg_transaction', 100.0, 150.0, '元'),
        ('restaurant', 'hotpot', 'repeat_rate', 30.0, 50.0, '%'),
        ('restaurant', 'milk_tea', 'rent_ratio', 15.0, 10.0, '%'),
        ('restaurant', 'milk_tea', 'material_ratio', 28.0, 20.0, '%'),
        ('restaurant', 'milk_tea', 'gross_margin', 65.0, 75.0, '%'),
        ('restaurant', 'milk_tea', 'avg_transaction', 18.0, 30.0, '元'),
        ('restaurant', 'milk_tea', 'repeat_rate', 40.0, 60.0, '%'),
        ('restaurant', 'bakery', 'rent_ratio', 13.0, 9.0, '%'),
        ('restaurant', 'bakery', 'material_ratio', 32.0, 25.0, '%'),
        ('restaurant', 'bakery', 'waste_ratio', 8.0, 3.0, '%'),
        ('restaurant', 'bakery', 'avg_transaction', 30.0, 55.0, '元'),
        ('restaurant', 'bakery', 'gross_margin', 55.0, 68.0, '%'),
        ('service', 'beauty', 'rent_ratio', 20.0, 14.0, '%'),
        ('service', 'beauty', 'labor_ratio', 30.0, 22.0, '%'),
        ('service', 'beauty', 'gross_margin', 70.0, 82.0, '%'),
        ('service', 'beauty', 'avg_transaction', 200.0, 500.0, '元'),
        ('service', 'beauty', 'repeat_rate', 50.0, 75.0, '%'),
        ('service', 'fitness', 'rent_ratio', 22.0, 15.0, '%'),
        ('service', 'fitness', 'labor_ratio', 28.0, 20.0, '%'),
        ('service', 'fitness', 'gross_margin', 55.0, 70.0, '%'),
        ('service', 'fitness', 'retention_rate', 40.0, 65.0, '%'),
        ('service', 'fitness', 'avg_transaction', 150.0, 300.0, '元'),
        ('service', 'education', 'rent_ratio', 15.0, 10.0, '%'),
        ('service', 'education', 'labor_ratio', 45.0, 35.0, '%'),
        ('service', 'education', 'gross_margin', 50.0, 65.0, '%'),
        ('service', 'education', 'retention_rate', 60.0, 80.0, '%'),
        ('service', 'education', 'repeat_rate', 55.0, 80.0, '%');
    `,
  },
  {
    id: 'seed-score-rules-data',
    description: '插入评分规则初始数据',
    sql: `
      INSERT OR IGNORE INTO score_rules (dimension, store_type, metric, weight, excellent_threshold, good_threshold, poor_threshold, benchmark_key, is_inverse, description) VALUES
        ('operations', '', 'daily_traffic', 0.3, 100, 50, 20, '', 0, '日均客流量'),
        ('operations', '', 'returning_rate', 0.3, 40, 25, 10, 'repeat_rate', 0, '复购率'),
        ('operations', '', 'transaction_trend', 0.2, 1.1, 1.0, 0.9, '', 0, '客单价趋势'),
        ('operations', '', 'revenue_per_sqm', 0.2, 500, 200, 50, 'sales_per_sqm', 0, '坪效'),
        ('cost', '', 'rent_ratio', 0.3, 10, 15, 20, 'rent_ratio', 1, '租金占比（越低越好）'),
        ('cost', '', 'labor_ratio', 0.3, 15, 20, 30, 'labor_ratio', 1, '人工占比（越低越好）'),
        ('cost', '', 'material_ratio', 0.2, 28, 35, 45, 'material_ratio', 1, '材料占比（越低越好）'),
        ('cost', '', 'total_cost_ratio', 0.2, 75, 85, 95, '', 1, '总成本占比（越低越好）'),
        ('competition', '', 'nearby_density', 0.3, 2, 5, 10, '', 1, '周边竞品密度（越低越好）'),
        ('competition', '', 'gross_margin_rank', 0.3, 0, 0, 0, 'gross_margin', 0, '毛利率行业排名'),
        ('competition', '', 'decoration_freshness', 0.2, 2, 4, 6, '', 1, '装修新旧程度（年）'),
        ('competition', '', 'category_focus', 0.2, 5, 8, 12, '', 1, '品类集中度'),
        ('scene', 'retail', 'sales_per_sqm', 0.4, 500, 200, 50, 'sales_per_sqm', 0, '零售坪效'),
        ('scene', 'retail', 'category_balance', 0.3, 5, 8, 12, '', 0, '品类均衡度'),
        ('scene', 'retail', 'display_freshness', 0.3, 2, 4, 6, '', 1, '陈列更新周期'),
        ('scene', 'restaurant', 'food_cost_ratio', 0.4, 28, 35, 45, 'material_ratio', 1, '食材成本率'),
        ('scene', 'restaurant', 'table_turnover', 0.3, 4, 2.5, 1.5, 'table_turnover', 0, '翻台率'),
        ('scene', 'restaurant', 'waste_ratio', 0.3, 2, 5, 10, 'food_waste_ratio', 1, '食材损耗率'),
        ('scene', 'service', 'repeat_rate', 0.4, 50, 35, 20, 'repeat_rate', 0, '复购率'),
        ('scene', 'service', 'retention_rate', 0.3, 60, 40, 25, 'retention_rate', 0, '留存率'),
        ('scene', 'service', 'appointment_rate', 0.3, 50, 30, 15, 'appointment_rate', 0, '预约率');
    `,
  },
  {
    id: 'seed-knowledge-base-data',
    description: '插入行业知识库初始数据',
    sql: `
      INSERT OR IGNORE INTO knowledge_base (category, store_type, title, content, tags, source) VALUES
        ('traffic', 'retail', '提高门店客流的5个有效方法', '1. 门店橱窗优化：每2周更换一次橱窗陈列，使用灯光和色彩吸引路人注意\n2. 社交媒体引流：在小红书/抖音发布门店特色内容，设置到店打卡优惠\n3. 社区活动：每月举办1-2次社区活动（新品试吃、手工DIY等）\n4. 异业联盟：与周边3-5家非竞争门店互相推荐客户\n5. 限时促销：设置每日限时特价，制造紧迫感', '客流,引流,零售,社区运营', '行业研究'),
        ('traffic', 'restaurant', '餐饮门店如何提升翻台率', '1. 优化点餐流程：扫码点餐减少等待时间，平均节省5-8分钟/桌\n2. 合理排座：2人桌占比40%，4人桌占比35%，大桌占比25%\n3. 菜品结构优化：减少制作时间超过15分钟的菜品比例\n4. 翻台提醒：用餐高峰期设置1.5小时用餐提醒\n5. 外卖分流：高峰期引导部分顾客选择外卖', '翻台率,餐饮,效率,运营', '行业研究'),
        ('cost', '', '门店成本控制的黄金法则', '1. 租金占比控制在营收的10-15%以内\n2. 人工成本控制在20-25%以内\n3. 建立3个月租金的应急储备金\n4. 每月做成本结构分析，及时发现异常\n5. 与供应商签订年度协议锁定价格\n6. 能耗管理：LED灯替换可节省30%电费', '成本控制,租金,人工,节能', '行业研究'),
        ('retention', '', '提高客户复购率的实战策略', '1. 会员体系：消费积分+等级权益，目标复购率提升15-20%\n2. 社群运营：建立门店微信群，每周3次互动+1次专属优惠\n3. 生日营销：客户生日当月发送专属优惠，转化率可达30%\n4. 售后回访：消费后24小时内回访，解决不满意点\n5. 惊喜体验：每月随机选取10%客户赠送小礼品', '复购率,会员,社群,客户留存', '行业研究'),
        ('competition', '', '新开门店如何快速建立竞争优势', '1. 差异化定位：找到3公里内竞品未覆盖的细分需求\n2. 开业爆品：设计1-2款引流爆品，价格低于成本但带来客流\n3. 种子用户：开业前1个月招募100名种子用户体验并传播\n4. 本地化运营：融入社区，参与社区活动建立信任\n5. 快速迭代：前3个月每月收集客户反馈并调整', '竞争,新店,差异化,开业', '行业研究'),
        ('digital', '', '门店数字化运营入门指南', '1. 收银系统数字化：选择支持数据分析的POS系统\n2. 会员管理数字化：电子会员卡替代实体卡，数据可追踪\n3. 库存管理数字化：设置安全库存预警，减少缺货和积压\n4. 营销数字化：使用企业微信+小程序构建私域流量\n5. 数据看板：每日查看营收/客流/转化率三大核心指标', '数字化,运营,数据分析,私域', '行业研究');
    `,
  },
]

export const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
  {
    id: 'drop-all-tables',
    description: '删除所有门店诊断相关表',
    sql: `
      DROP TABLE IF EXISTS knowledge_base;
      DROP TABLE IF EXISTS score_rules;
      DROP TABLE IF EXISTS recheck_reminders;
      DROP TABLE IF EXISTS store_competitors;
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

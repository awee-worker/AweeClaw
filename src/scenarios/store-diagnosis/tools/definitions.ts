import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import type { ToolDefinition } from '@protocols'
import { storeDiagnosisExecutors } from './toolExecutors'

const STORE_MANAGE: ToolDefinition = {
  name: 'store_manage',
  description: 'Manage store information: create, update, delete, and query store records. Supports listing all stores or getting details of a specific store. Includes sub-type, city tier, and extended fields.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['create', 'update', 'delete', 'get', 'list'],
      },
      store_id: { type: 'string', description: 'Store ID (required for update/delete/get)' },
      data: {
        type: 'object',
        description: 'Store data for create/update operations',
        properties: {
          name: { type: 'string', description: 'Store name' },
          type: { type: 'string', description: 'Store type', enum: ['retail', 'restaurant', 'service', 'other'] },
          sub_type: { type: 'string', description: 'Store sub-type, e.g. "convenience", "clothing", "fast_food", "beauty"' },
          area: { type: 'number', description: 'Store area in square meters' },
          business_hours: { type: 'string', description: 'Business hours, e.g. "09:00-22:00"' },
          employee_count: { type: 'number', description: 'Number of employees' },
          avg_transaction_value: { type: 'number', description: 'Average transaction value in yuan' },
          main_categories: { type: 'string', description: 'Main business categories, comma-separated' },
          rent_cost: { type: 'number', description: 'Monthly rent cost in yuan' },
          decoration_age: { type: 'number', description: 'Years since last decoration' },
          region: { type: 'string', description: 'Store location/region' },
          city_tier: { type: 'number', description: 'City tier (1-5)' },
          contact_phone: { type: 'string', description: 'Contact phone number' },
          opened_at: { type: 'string', description: 'Store opening date, e.g. "2020-06-01"' },
          monthly_revenue: { type: 'number', description: 'Current monthly revenue estimate' },
          business_status: { type: 'string', description: 'Business status', enum: ['normal', 'warning', 'critical'] },
          photos: { type: 'string', description: 'Photo paths, comma-separated' },
          notes: { type: 'string', description: 'Additional notes' },
        },
      },
      filters: {
        type: 'object',
        description: 'Filters for list action',
        properties: {
          type: { type: 'string', description: 'Filter by store type' },
          region: { type: 'string', description: 'Filter by region' },
          sub_type: { type: 'string', description: 'Filter by sub-type' },
          business_status: { type: 'string', description: 'Filter by business status' },
        },
      },
    },
    required: ['action'],
  },
}

const STORE_DIAGNOSE: ToolDefinition = {
  name: 'store_diagnose',
  description: 'Run a diagnosis analysis on a store. Analyzes operations, cost structure, competitive position, or scene-specific metrics. Returns a scored assessment with confidence level, findings, and recommendations. Uses dynamic scoring with industry benchmarks and score rules when available.',
  parameters: {
    type: 'object',
    properties: {
      store_id: { type: 'string', description: 'The store ID to diagnose' },
      dimension: {
        type: 'string',
        description: 'Diagnosis dimension to analyze',
        enum: ['operations', 'cost', 'competition', 'scene', 'all'],
      },
      period: { type: 'string', description: 'Analysis period, e.g. "2024-01" or "2024-Q1"' },
      include_financials: { type: 'boolean', description: 'Whether to include financial data analysis (default: true)' },
      include_traffic: { type: 'boolean', description: 'Whether to include traffic data analysis (default: true)' },
    },
    required: ['store_id', 'dimension'],
  },
}

const REPORT_GENERATE: ToolDefinition = {
  name: 'report_generate',
  description: 'Generate a visual diagnosis report for a store. Supports scorecards, trend analysis, cost breakdowns, traffic analysis, prescription reports with actionable recommendations, and full report export.',
  parameters: {
    type: 'object',
    properties: {
      store_id: { type: 'string', description: 'The store ID to generate report for' },
      report_type: {
        type: 'string',
        description: 'Type of report to generate',
        enum: ['full', 'scorecard', 'trend', 'comparison', 'cost_breakdown', 'traffic_analysis', 'prescription', 'export'],
      },
      diagnosis_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific diagnosis record IDs to include (optional, defaults to latest)',
      },
      period: { type: 'string', description: 'Report period, e.g. "2024-01"' },
      format: { type: 'string', description: 'Output format for export type (default: markdown)', enum: ['html', 'markdown'] },
    },
    required: ['store_id', 'report_type'],
  },
}

const OPTIMIZATION_PLAN: ToolDefinition = {
  name: 'optimization_plan',
  description: 'Create and manage optimization plans based on diagnosis results. Supports prescription-style plans with cost-level tasks, quantified expected impact, and ROI tracking.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['create', 'update', 'delete', 'get', 'list', 'add_task', 'update_task', 'list_tasks'],
      },
      plan_id: { type: 'string', description: 'Plan ID (required for update/delete/get/add_task/update_task)' },
      store_id: { type: 'string', description: 'Store ID (required for create/list)' },
      diagnosis_id: { type: 'string', description: 'Related diagnosis record ID (optional for create)' },
      data: {
        type: 'object',
        description: 'Plan or task data',
        properties: {
          title: { type: 'string', description: 'Plan title' },
          description: { type: 'string', description: 'Plan description' },
          priority: { type: 'number', description: 'Priority (1-10, 1=highest)' },
          status: { type: 'string', description: 'Status', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
          expected_effect: { type: 'string', description: 'Expected improvement effect' },
          expected_roi: { type: 'number', description: 'Expected ROI percentage' },
          investment_cost: { type: 'number', description: 'Investment cost in yuan' },
          execution_cycle: { type: 'string', description: 'Execution timeline, e.g. "2 weeks"' },
          plan_type: { type: 'string', description: 'Plan type', enum: ['general', 'prescription', 'emergency'] },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Task title' },
                description: { type: 'string', description: 'Task description' },
                cost_level: { type: 'string', description: 'Cost level', enum: ['zero', 'low', 'medium', 'high'] },
                expected_impact: { type: 'string', description: 'Expected impact description' },
                assignee: { type: 'string', description: 'Person responsible' },
                due_date: { type: 'string', description: 'Due date' },
              },
            },
            description: 'Task list for create action',
          },
        },
      },
      task_id: { type: 'string', description: 'Task ID (for update_task)' },
      task_data: {
        type: 'object',
        description: 'Task update data',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assignee: { type: 'string' },
          due_date: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'skipped'] },
          cost_level: { type: 'string', description: 'Cost level', enum: ['zero', 'low', 'medium', 'high'] },
          expected_impact: { type: 'string', description: 'Expected impact' },
        },
      },
    },
    required: ['action'],
  },
}

const BENCHMARK_QUERY: ToolDefinition = {
  name: 'benchmark_query',
  description: 'Query industry benchmark data for comparison. Supports filtering by category, sub-category, and city tier. Returns average and top-quartile values for key metrics.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Store category to query benchmarks for',
        enum: ['retail', 'restaurant', 'service'],
      },
      sub_category: {
        type: 'string',
        description: 'Store sub-category, e.g. "convenience", "clothing", "fast_food", "beauty", "fitness"',
      },
      city_tier: {
        type: 'number',
        description: 'City tier filter (1-5)',
      },
      metrics: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific metrics to query (optional, returns all if not specified). Examples: rent_ratio, labor_ratio, gross_margin, net_margin, repeat_rate, avg_transaction',
      },
    },
    required: ['category'],
  },
}

const HEALTH_CHECK: ToolDefinition = {
  name: 'health_check',
  description: 'One-click comprehensive health check for a store. Automatically diagnoses all dimensions (operations, cost, competition, scene), generates a prescription report with prioritized actionable recommendations sorted by cost level.',
  parameters: {
    type: 'object',
    properties: {
      store_id: { type: 'string', description: 'The store ID to perform health check on' },
      auto_create_plan: { type: 'boolean', description: 'Whether to automatically create an optimization plan (default: true)' },
    },
    required: ['store_id'],
  },
}

const COMPETITOR_MANAGE: ToolDefinition = {
  name: 'competitor_manage',
  description: 'Manage competitor store information. Add, update, delete, and query competitors for a specific store. Supports threat level assessment and SWOT-style analysis.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['create', 'update', 'delete', 'list', 'analysis'],
      },
      store_id: { type: 'string', description: 'Your store ID' },
      competitor_id: { type: 'string', description: 'Competitor record ID (for update/delete)' },
      data: {
        type: 'object',
        description: 'Competitor data',
        properties: {
          competitor_name: { type: 'string', description: 'Competitor store name' },
          competitor_type: { type: 'string', description: 'Competitor type, e.g. "retail", "restaurant"' },
          distance_km: { type: 'number', description: 'Distance in kilometers from your store' },
          strength: { type: 'string', description: 'Competitor strengths' },
          weakness: { type: 'string', description: 'Competitor weaknesses' },
          threat_level: { type: 'string', description: 'Threat level', enum: ['low', 'medium', 'high'] },
          notes: { type: 'string', description: 'Additional notes' },
        },
      },
    },
    required: ['action', 'store_id'],
  },
}

const RECHECK_MANAGE: ToolDefinition = {
  name: 'recheck_manage',
  description: 'Manage recheck (follow-up diagnosis) reminders for stores. Set up periodic recheck schedules, check pending reminders, and track score changes over time.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['create', 'complete', 'list', 'check_due', 'cancel'],
      },
      store_id: { type: 'string', description: 'Store ID' },
      reminder_id: { type: 'string', description: 'Reminder ID (for complete/cancel)' },
      interval_days: { type: 'number', description: 'Recheck interval in days (default: 30)' },
      diagnosis_id: { type: 'string', description: 'Related diagnosis record ID' },
      notes: { type: 'string', description: 'Notes for the reminder' },
    },
    required: ['action'],
  },
}

const KNOWLEDGE_QUERY: ToolDefinition = {
  name: 'knowledge_query',
  description: 'Query the industry knowledge base for best practices, case studies, and expert advice. Search by category, store type, or keywords.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Knowledge category',
        enum: ['operations', 'cost', 'competition', 'scene', 'general'],
      },
      store_type: {
        type: 'string',
        description: 'Store type filter',
        enum: ['retail', 'restaurant', 'service', ''],
      },
      keywords: {
        type: 'string',
        description: 'Search keywords',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 5)',
      },
    },
    required: [],
  },
}

const STORE_DATA_ENTRY: ToolDefinition = {
  name: 'store_data_entry',
  description: 'Enter and manage store financial and traffic data. Supports batch entry for monthly financials and daily/hourly traffic data. Essential for accurate diagnosis.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['add_financial', 'update_financial', 'list_financials', 'add_traffic', 'list_traffic', 'batch_import'],
      },
      store_id: { type: 'string', description: 'Store ID' },
      financial_data: {
        type: 'object',
        description: 'Financial data for a period',
        properties: {
          period: { type: 'string', description: 'Period in YYYY-MM format, e.g. "2024-01"' },
          revenue: { type: 'number', description: 'Total revenue for the period' },
          rent_cost: { type: 'number', description: 'Rent cost' },
          labor_cost: { type: 'number', description: 'Labor cost' },
          material_cost: { type: 'number', description: 'Material/cost of goods cost' },
          utility_cost: { type: 'number', description: 'Utility cost' },
          other_cost: { type: 'number', description: 'Other costs' },
          customer_count: { type: 'number', description: 'Total customer count' },
          repeat_customer_rate: { type: 'number', description: 'Repeat customer rate (0-100)' },
          avg_transaction_value: { type: 'number', description: 'Average transaction value' },
        },
      },
      traffic_data: {
        type: 'object',
        description: 'Traffic data for a specific date/hour',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          hour: { type: 'number', description: 'Hour of day (0-23)' },
          customer_count: { type: 'number', description: 'Total customer count' },
          new_customer_count: { type: 'number', description: 'New customer count' },
          returning_customer_count: { type: 'number', description: 'Returning customer count' },
          conversion_rate: { type: 'number', description: 'Conversion rate (0-100)' },
        },
      },
      batch_data: {
        type: 'array',
        items: { type: 'object', properties: {} },
        description: 'Batch data array for import (financial or traffic records)',
      },
    },
    required: ['action', 'store_id'],
  },
}

const STORE_PROFILE: ToolDefinition = {
  name: 'store_profile',
  description: 'Generate store profile portraits and track trends. Provides comprehensive store profiling with auto-generated tags, trend analysis across diagnosis periods, and store-to-store comparison.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['get_profile', 'get_trend', 'compare'],
      },
      store_id: { type: 'string', description: 'Store ID' },
      compare_store_id: { type: 'string', description: 'Second store ID for comparison (required for compare action)' },
      periods: { type: 'number', description: 'Number of periods to analyze for trends (default: 6, max: 12)' },
    },
    required: ['action', 'store_id'],
  },
}

const STORE_DIAGNOSIS_TOOLS: ScenarioToolDefinition[] = [
  { name: 'store_manage', definition: STORE_MANAGE, executor: storeDiagnosisExecutors.store_manage },
  { name: 'store_diagnose', definition: STORE_DIAGNOSE, executor: storeDiagnosisExecutors.store_diagnose },
  { name: 'report_generate', definition: REPORT_GENERATE, executor: storeDiagnosisExecutors.report_generate },
  { name: 'optimization_plan', definition: OPTIMIZATION_PLAN, executor: storeDiagnosisExecutors.optimization_plan },
  { name: 'benchmark_query', definition: BENCHMARK_QUERY, executor: storeDiagnosisExecutors.benchmark_query },
  { name: 'health_check', definition: HEALTH_CHECK, executor: storeDiagnosisExecutors.health_check },
  { name: 'competitor_manage', definition: COMPETITOR_MANAGE, executor: storeDiagnosisExecutors.competitor_manage },
  { name: 'recheck_manage', definition: RECHECK_MANAGE, executor: storeDiagnosisExecutors.recheck_manage },
  { name: 'knowledge_query', definition: KNOWLEDGE_QUERY, executor: storeDiagnosisExecutors.knowledge_query },
  { name: 'store_data_entry', definition: STORE_DATA_ENTRY, executor: storeDiagnosisExecutors.store_data_entry },
  { name: 'store_profile', definition: STORE_PROFILE, executor: storeDiagnosisExecutors.store_profile },
]

export default STORE_DIAGNOSIS_TOOLS

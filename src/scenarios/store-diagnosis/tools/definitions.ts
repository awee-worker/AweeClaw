import type { ScenarioToolDefinition } from '@shared/types/scenario-arch'
import type { ToolDefinition } from '@shared/types'
import { storeDiagnosisExecutors } from './executors'

const STORE_MANAGE: ToolDefinition = {
  name: 'store_manage',
  description: 'Manage store information: create, update, delete, and query store records. Supports listing all stores or getting details of a specific store.',
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
          area: { type: 'number', description: 'Store area in square meters' },
          business_hours: { type: 'string', description: 'Business hours, e.g. "09:00-22:00"' },
          employee_count: { type: 'number', description: 'Number of employees' },
          avg_transaction_value: { type: 'number', description: 'Average transaction value in yuan' },
          main_categories: { type: 'string', description: 'Main business categories, comma-separated' },
          rent_cost: { type: 'number', description: 'Monthly rent cost in yuan' },
          decoration_age: { type: 'number', description: 'Years since last decoration' },
          region: { type: 'string', description: 'Store location/region' },
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
        },
      },
    },
    required: ['action'],
  },
}

const STORE_DIAGNOSE: ToolDefinition = {
  name: 'store_diagnose',
  description: 'Run a diagnosis analysis on a store. Analyzes operations, cost structure, competitive position, or scene-specific metrics. Returns a scored assessment with findings and recommendations.',
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
  description: 'Generate a visual diagnosis report for a store. Creates charts and formatted report content including score cards, trend analysis, and comparison charts.',
  parameters: {
    type: 'object',
    properties: {
      store_id: { type: 'string', description: 'The store ID to generate report for' },
      report_type: {
        type: 'string',
        description: 'Type of report to generate',
        enum: ['full', 'scorecard', 'trend', 'comparison', 'cost_breakdown', 'traffic_analysis'],
      },
      diagnosis_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific diagnosis record IDs to include (optional, defaults to latest)',
      },
      period: { type: 'string', description: 'Report period, e.g. "2024-01"' },
      format: { type: 'string', description: 'Output format (default: html)', enum: ['html', 'markdown'] },
    },
    required: ['store_id', 'report_type'],
  },
}

const OPTIMIZATION_PLAN: ToolDefinition = {
  name: 'optimization_plan',
  description: 'Create and manage optimization plans based on diagnosis results. Supports creating plans with tasks, updating task status, and tracking execution progress.',
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
          execution_cycle: { type: 'string', description: 'Execution timeline, e.g. "2 weeks"' },
          tasks: { type: 'array', items: { type: 'object', properties: {} }, description: 'Task list for create action' },
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
        },
      },
    },
    required: ['action'],
  },
}

const BENCHMARK_QUERY: ToolDefinition = {
  name: 'benchmark_query',
  description: 'Query industry benchmark data for comparison. Returns average and top-quartile values for key metrics by store category (retail, restaurant, service).',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Store category to query benchmarks for',
        enum: ['retail', 'restaurant', 'service'],
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

const STORE_DIAGNOSIS_TOOLS: ScenarioToolDefinition[] = [
  { name: 'store_manage', definition: STORE_MANAGE, executor: storeDiagnosisExecutors.store_manage },
  { name: 'store_diagnose', definition: STORE_DIAGNOSE, executor: storeDiagnosisExecutors.store_diagnose },
  { name: 'report_generate', definition: REPORT_GENERATE, executor: storeDiagnosisExecutors.report_generate },
  { name: 'optimization_plan', definition: OPTIMIZATION_PLAN, executor: storeDiagnosisExecutors.optimization_plan },
  { name: 'benchmark_query', definition: BENCHMARK_QUERY, executor: storeDiagnosisExecutors.benchmark_query },
]

export default STORE_DIAGNOSIS_TOOLS

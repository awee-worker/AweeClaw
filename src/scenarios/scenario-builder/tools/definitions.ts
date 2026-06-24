/**
 * 场景开发助手工具定义
 *
 * 定义 AI Agent 可用的场景开发工具。
 * 工具命名规范：snake_case，动词在前。
 */
import type { ToolDefinition } from '@shared/protocols/modelGateway'

export const SCENARIO_BUILDER_TOOLS: ToolDefinition[] = [
  // ==========================================
  // 项目管理工具
  // ==========================================
  {
    name: 'list_scenario_projects',
    description: 'List all scenario development projects in the current workspace',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter projects by status (draft, developing, building, ready, published, archived)',
          enum: ['draft', 'developing', 'building', 'ready', 'published', 'archived'],
        },
      },
    },
  },
  {
    name: 'create_scenario_project',
    description: 'Create a new scenario development project in the workspace. The project directory will be created under workspace/scenarios/<scenarioId>.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project display name' },
        scenario_id: { type: 'string', description: 'Unique scenario ID (lowercase letters, numbers, hyphens)' },
        type: { type: 'string', description: 'Scenario type', enum: ['declarative', 'programmatic'] },
        version: { type: 'string', description: 'Semantic version (e.g. 1.0.0)' },
        description: { type: 'string', description: 'Project description' },
        author: { type: 'string', description: 'Author name' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Project tags' },
        local_path: { type: 'string', description: 'Custom project path (defaults to workspace/scenarios/<scenarioId>)' },
      },
      required: ['name', 'scenario_id', 'type'],
    },
  },
  {
    name: 'get_scenario_project',
    description: 'Get detailed information about a scenario project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'update_scenario_project',
    description: 'Update a scenario project (name, version, description, status, config)',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
        name: { type: 'string', description: 'New project name' },
        version: { type: 'string', description: 'New version' },
        description: { type: 'string', description: 'New description' },
        status: { type: 'string', description: 'New status', enum: ['draft', 'developing', 'building', 'ready', 'published', 'archived'] },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'delete_scenario_project',
    description: 'Delete (archive) a scenario project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to delete' },
      },
      required: ['project_id'],
    },
  },

  // ==========================================
  // 开发辅助工具
  // ==========================================
  {
    name: 'get_scenario_templates',
    description: 'Get available scenario templates for scaffolding',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by scenario type', enum: ['declarative', 'programmatic'] },
      },
    },
  },
  {
    name: 'read_scenario_file',
    description: 'Read a file from a scenario project directory',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
        file_path: { type: 'string', description: 'Relative file path within the project (e.g. scenario.json, prompts/system.md)' },
      },
      required: ['project_id', 'file_path'],
    },
  },
  {
    name: 'write_scenario_file',
    description: 'Write content to a file in a scenario project directory. Creates parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
        file_path: { type: 'string', description: 'Relative file path within the project' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['project_id', 'file_path', 'content'],
    },
  },
  {
    name: 'get_scenario_knowledge',
    description: 'Get the built-in AweeClaw scenario development knowledge base. Returns comprehensive documentation about scenario types, configuration, prompts, tools, database, UI, and build/publish workflow.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Specific topic to retrieve (all, types, manifest, prompts, tools, database, ui, lifecycle, build, publish)',
          enum: ['all', 'types', 'manifest', 'prompts', 'tools', 'database', 'ui', 'lifecycle', 'build', 'publish'],
        },
      },
    },
  },

  // ==========================================
  // 构建调试工具
  // ==========================================
  {
    name: 'validate_scenario',
    description: 'Validate a scenario project configuration. Checks scenario.json for required fields, format, and best practices.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to validate' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'build_scenario',
    description: 'Build a scenario project for production. Runs the aweeclaw-scenario build command.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to build' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'pack_scenario',
    description: 'Pack a scenario project into a distributable package. Runs the aweeclaw-scenario pack command.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to pack' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_build_logs',
    description: 'Get build history and logs for a scenario project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
        limit: { type: 'number', description: 'Maximum number of records to return (default 20)' },
      },
      required: ['project_id'],
    },
  },

  // ==========================================
  // 安装发布工具
  // ==========================================
  {
    name: 'install_scenario',
    description: 'Install a built scenario to the local AweeClaw client for testing',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to install' },
        package_path: { type: 'string', description: 'Path to the built package (dist/ directory)' },
      },
      required: ['project_id', 'package_path'],
    },
  },
  {
    name: 'publish_scenario',
    description: 'Publish a scenario to the AweeClaw marketplace (requires developer login)',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to publish' },
        package_name: { type: 'string', description: 'Package name for the marketplace' },
        package_path: { type: 'string', description: 'Path to the packaged file' },
        version: { type: 'string', description: 'Version to publish' },
      },
      required: ['project_id', 'package_name', 'package_path', 'version'],
    },
  },
  {
    name: 'get_publish_history',
    description: 'Get publish history for a scenario project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'check_publish_status',
    description: 'Check if the developer is logged in and ready to publish',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]

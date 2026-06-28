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
    description: 'Update a scenario project (name, version, description, status, author, tags). Type, scenarioId, localPath are immutable after creation.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID' },
        name: { type: 'string', description: 'New project name' },
        version: { type: 'string', description: 'New version (semantic version, e.g. 1.0.0)' },
        description: { type: 'string', description: 'New description' },
        status: { type: 'string', description: 'New status', enum: ['draft', 'developing', 'building', 'ready', 'published', 'archived'] },
        author: { type: 'string', description: 'New author name' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags list (replaces existing tags)' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_current_project',
    description: 'Get the currently selected scenario project in the Scenario Builder UI. The project is also injected into the system prompt as "Current Scenario Project" — call this tool only when you suspect the injected context may be stale (e.g. user may have switched projects mid-conversation).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_current_project',
    description: 'Set the currently selected scenario project in the Scenario Builder UI. Use this when the user asks to switch to / work on a different project. Subsequent tool calls (read_scenario_file, build_scenario, etc.) will default to this project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to select as current' },
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
    // 文件写入采用事后确认模式（像 VSCode/Trae）：
    // 工具直接执行写入，执行成功后聊天界面显示"接受/拒绝"按钮，
    // 用户点"拒绝"会撤销变更（恢复旧内容）。
    // 因此 approvalType 设为 'none'（不事前审批），由 pendingChanges 机制驱动事后确认。
    approvalType: 'none',
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
    description: 'Build a scenario project for production. Uses the built-in esbuild bundler (no external CLI required).',
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
    description: 'Pack a scenario project into a distributable .aweeclawpkg package. Uses the built-in packer (no external CLI required).',
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

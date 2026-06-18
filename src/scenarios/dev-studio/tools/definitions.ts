/**
 * dev-studio 工具定义
 *
 * 定义场景特有的 Agent 工具。
 */
import type { ToolDefinition } from '@shared/protocols/modelGateway'
import type { AgentRoleDefinition } from '../types'

// ==========================================
// 开发工具定义
// ==========================================

export const DEV_STUDIO_TOOLS: ToolDefinition[] = [
  {
    name: 'scaffold_project',
    description: 'Create a new project from a template with predefined structure and dependencies',
    parameters: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'The template ID to use for scaffolding' },
        project_name: { type: 'string', description: 'Name of the new project' },
        project_path: { type: 'string', description: 'Local path where the project will be created' },
        variables: { type: 'object', description: 'Template variables to customize the scaffold' },
      },
      required: ['template_id', 'project_name', 'project_path'],
    },
  },
  {
    name: 'list_templates',
    description: 'List all available project templates for scaffolding',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter templates by category' },
      },
    },
  },
  {
    name: 'run_dev_server',
    description: 'Start the development server for the current project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to start the dev server for' },
        command: { type: 'string', description: 'Custom dev server command (defaults to project config)' },
        port: { type: 'number', description: 'Port to run the dev server on' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'stop_dev_server',
    description: 'Stop the running development server',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to stop the dev server for' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'run_build',
    description: 'Build the current project for production',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to build' },
        command: { type: 'string', description: 'Custom build command' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'run_test',
    description: 'Run tests for the current project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to run tests for' },
        command: { type: 'string', description: 'Custom test command' },
        watch: { type: 'boolean', description: 'Run tests in watch mode' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'deploy_project',
    description: 'Deploy the current project to a target platform',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to deploy' },
        target: { type: 'string', description: 'Deployment target (vercel, netlify, cloudflare, etc.)' },
        config: { type: 'object', description: 'Deployment configuration' },
      },
      required: ['project_id', 'target'],
    },
  },
  {
    name: 'create_dev_session',
    description: 'Create a new development session with specific agent roles',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID for the session' },
        title: { type: 'string', description: 'Session title' },
        mode: { type: 'string', description: 'Session mode: solo or collaborative' },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent roles to activate: pm, coder, reviewer, tester, devops',
        },
      },
      required: ['project_id', 'mode'],
    },
  },
  {
    name: 'add_session_task',
    description: 'Add a task to the current development session',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The session ID' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        assignee: { type: 'string', description: 'Agent role to assign the task to' },
        priority: { type: 'string', description: 'Task priority: high, medium, low' },
      },
      required: ['session_id', 'title'],
    },
  },
  {
    name: 'get_project_info',
    description: 'Get detailed information about a project',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID to get info for' },
      },
      required: ['project_id'],
    },
  },
]

// ==========================================
// Agent 角色定义
// ==========================================

export const DEV_AGENT_ROLES: AgentRoleDefinition[] = [
  {
    id: 'pm',
    name: 'Project Manager',
    nameZh: '项目经理',
    icon: 'UserCheck',
    color: 'text-blue-500 bg-blue-500/10',
    systemPrompt: `You are a senior technical project manager. Your role:
1. Analyze user requirements and break them into actionable tasks
2. Create a development plan with clear milestones
3. Assign tasks to appropriate agent roles based on complexity
4. Monitor progress and adjust the plan as needed
5. Ensure all tasks are completed and meet quality standards

When given a project request:
- First, understand the full scope of the project
- Break it down into logical, independent tasks
- Prioritize tasks based on dependencies
- Create a clear task board with descriptions and acceptance criteria
- Coordinate with other agents to ensure smooth execution`,
    tools: ['read_file', 'search_code', 'write_file', 'web_search', 'create_dev_session', 'add_session_task', 'get_project_info'],
  },
  {
    id: 'coder',
    name: 'Coder',
    nameZh: '编码专家',
    icon: 'Code2',
    color: 'text-emerald-500 bg-emerald-500/10',
    systemPrompt: `You are a senior full-stack engineer with 15 years of experience. Your role:
1. Write clean, production-ready code following best practices
2. Implement features according to specifications
3. Handle edge cases, error handling, and validation
4. Follow project conventions and coding standards
5. Write appropriate comments only for complex logic

Code quality standards:
- INDUSTRIAL-GRADE code only, no toy code
- Proper error handling and input validation
- Clean architecture with separation of concerns
- Performance-conscious implementations
- Use existing project patterns and conventions`,
    tools: ['read_file', 'write_file', 'edit_file', 'execute_command', 'search_code', 'run_dev_server', 'run_build'],
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    nameZh: '代码审查员',
    icon: 'Search',
    color: 'text-purple-500 bg-purple-500/10',
    systemPrompt: `You are a senior code reviewer. Your role:
1. Review code for bugs, edge cases, and security vulnerabilities
2. Check code quality, readability, and maintainability
3. Ensure adherence to project conventions
4. Identify performance issues and optimization opportunities
5. Verify proper error handling and input validation

Review checklist:
- Security: injection, XSS, auth bypass, data exposure
- Performance: unnecessary loops, memory leaks, N+1 queries
- Reliability: null checks, boundary conditions, race conditions
- Maintainability: naming, structure, coupling, comments`,
    tools: ['read_file', 'search_code', 'run_test', 'run_build'],
  },
  {
    id: 'tester',
    name: 'Test Engineer',
    nameZh: '测试工程师',
    icon: 'FlaskConical',
    color: 'text-orange-500 bg-orange-500/10',
    systemPrompt: `You are a senior test engineer. Your role:
1. Write comprehensive test cases covering normal, edge, and error scenarios
2. Set up test infrastructure and configuration
3. Execute tests and analyze results
4. Report bugs with clear reproduction steps
5. Ensure adequate test coverage

Testing principles:
- Test behavior, not implementation
- Cover happy path, edge cases, error states, and boundary values
- Use appropriate test framework for the project
- Keep tests fast, isolated, and deterministic`,
    tools: ['read_file', 'write_file', 'edit_file', 'execute_command', 'run_test', 'search_code'],
  },
  {
    id: 'devops',
    name: 'DevOps Engineer',
    nameZh: 'DevOps 工程师',
    icon: 'Cloud',
    color: 'text-sky-500 bg-sky-500/10',
    systemPrompt: `You are a senior DevOps engineer. Your role:
1. Set up build and deployment pipelines
2. Configure development, staging, and production environments
3. Manage infrastructure as code
4. Monitor application health and performance
5. Optimize CI/CD workflows

Operations focus:
- Automate everything that can be automated
- Ensure reproducible builds
- Handle environment-specific configuration
- Set up proper logging and monitoring
- Plan for rollback and disaster recovery`,
    tools: ['execute_command', 'read_file', 'write_file', 'run_build', 'deploy_project', 'run_dev_server', 'stop_dev_server'],
  },
]
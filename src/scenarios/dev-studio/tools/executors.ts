/**
 * dev-studio 工具执行器
 *
 * 将工具定义映射到实际执行逻辑。
 */
import type { ToolExecutor } from '@shared/protocols/modelGateway'
import { scaffoldService } from '../services/ScaffoldService'
import { projectService } from '../services/ProjectService'

export const scaffoldProjectExecutor: ToolExecutor = async (args, _context) => {
  const templateId = args.template_id as string
  const projectName = args.project_name as string
  const projectPath = args.project_path as string
  const variables = (args.variables as Record<string, string | number | boolean>) ?? {}

  const result = await scaffoldService.scaffold({
    name: projectName,
    templateId,
    localPath: projectPath,
    variables,
  })

  if (!result.success) {
    return { success: false, result: '', error: result.error }
  }

  const command = result.steps.find(s => s.id === 'scaffold')?.message ?? ''
  const postInstall = result.steps.filter(s => s.id.startsWith('postinstall')).map(s => s.message)

  return {
    success: true,
    result: JSON.stringify({ command, postInstall }),
  }
}

export const listTemplatesExecutor: ToolExecutor = async (args, _context) => {
  const category = args.category as string | undefined
  const templates = category
    ? scaffoldService.getTemplates(category as any)
    : scaffoldService.getTemplates()

  const data = {
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      nameZh: t.nameZh,
      category: t.category,
      tags: t.tags,
      description: t.description,
    })),
    categories: scaffoldService.getCategories(),
  }

  return { success: true, result: JSON.stringify(data) }
}

export const getProjectInfoExecutor: ToolExecutor = async (args, _context) => {
  const projectId = args.project_id as string
  const project = await projectService.getProject(projectId)
  if (!project) {
    return { success: false, result: '', error: `Project not found: ${projectId}` }
  }
  return { success: true, result: JSON.stringify({ project }) }
}
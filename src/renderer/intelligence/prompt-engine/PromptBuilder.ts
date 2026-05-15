/**
 * Prompt Builder for prompt engine
 */
export interface PromptTemplate {
  id: string
  name: string
  system: string
  user?: string
  variables?: Record<string, string>
}

export class PromptBuilder {
  private templates = new Map<string, PromptTemplate>()

  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template)
  }

  buildPrompt(templateId: string, variables?: Record<string, string>): string {
    const template = this.templates.get(templateId)
    if (!template) return ''

    let prompt = template.system
    if (template.user) {
      prompt += '\n\n' + template.user
    }

    const vars = { ...template.variables, ...variables }
    for (const [key, value] of Object.entries(vars)) {
      prompt = prompt.replace(new RegExp(`\{\{${key}\}\}`, 'g'), value)
    }
    return prompt
  }

  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id)
  }

  listTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values())
  }
}

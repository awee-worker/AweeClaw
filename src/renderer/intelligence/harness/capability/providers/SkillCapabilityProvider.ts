import type { Capability, CapabilityProvider, CapabilityInput, CapabilityContext, CapabilityOutput } from '../Capability'
import type { ISkillService } from '../../kernel/Token'

export class SkillCapabilityProvider implements CapabilityProvider {
  readonly id = 'skills'
  readonly name = 'Skill Capabilities'
  readonly type = 'skill' as const

  private skillService: ISkillService

  constructor(skillService: ISkillService) {
    this.skillService = skillService
  }

  async load(): Promise<Capability[]> {
    const skills = await this.skillService.getEnabledSkills()
    return skills.map(skill => new SkillCapability(skill.name, skill.description, skill.content, skill.source))
  }
}

class SkillCapability implements Capability {
  readonly id: string
  readonly type = 'skill' as const
  readonly name: string
  readonly description: string
  readonly version = '1.0.0'
  readonly metadata: Record<string, unknown>

  constructor(
    name: string,
    description: string,
    private content: string,
    source: string
  ) {
    this.id = `skill:${name}`
    this.name = name
    this.description = description
    this.metadata = { source, triggerType: 'manual' }
  }

  async invoke(_input: CapabilityInput, _ctx: CapabilityContext): Promise<CapabilityOutput> {
    return { success: true, data: { content: this.content } }
  }
}

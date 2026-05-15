import { skillService } from '../../runtime/skillRepository'
import type { ISkillService } from '../kernel/Token'

export class SkillServiceAdapter implements ISkillService {
  async getSkills() {
    return skillService.getSkills()
  }

  async getEnabledSkills() {
    const all = await skillService.getSkills()
    return all.filter(s => s.enabled)
  }
}

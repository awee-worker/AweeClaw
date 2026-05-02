import { skillService } from '../../services/skillService'
import type { ISkillService } from '../kernel/Token'

export class SkillServiceAdapter implements ISkillService {
  async getSkills() {
    return skillService.getSkills()
  }

  async getEnabledSkills() {
    return skillService.getEnabledSkills()
  }
}

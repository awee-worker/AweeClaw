import { lintService } from '../../services/lintService'
import type { ILintService } from '../kernel/Token'

export class LintServiceAdapter implements ILintService {
  async lintFile(filePath: string): Promise<import('../../types').LintError[]> {
    const result = await lintService.getLintErrors(filePath)
    return result.errors
  }
}

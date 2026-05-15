import { lintService } from '../../runtime/codeAnalysisService'
import type { ILintService } from '../kernel/Token'

export class LintServiceAdapter implements ILintService {
  async lintFile(filePath: string): Promise<import('../../providerTypes').LintError[]> {
    const result = await lintService.getLintErrors(filePath)
    return result.errors
  }
}

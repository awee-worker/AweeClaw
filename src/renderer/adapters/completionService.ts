/**
 * Completion Service adapter for renderer process
 */
export interface CompletionRequest {
  prompt: string
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
}

export interface CompletionResponse {
  text: string
  finishReason: string
  usage?: { promptTokens: number; completionTokens: number }
}

export class CompletionService {
  async complete(/* request */_: CompletionRequest): Promise<CompletionResponse> {
    return {
      text: '',
      finishReason: 'error',
      usage: { promptTokens: 0, completionTokens: 0 },
    }
  }
}

export const completionService = new CompletionService()

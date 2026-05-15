import type { ApiProtocol, OpenAICompatibilityProfile } from '@configuration/aiProviders'

export interface ProviderModelConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]
  headers?: Record<string, string>
  openAICompatibilityProfile?: OpenAICompatibilityProfile
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

export interface ModelProviderPanel {
  configs: Record<string, ProviderModelConfig>
}

export function isCustomProvider(providerId: string): boolean {
  return providerId.startsWith('custom-')
}

export function generateCustomProviderId(): string {
  return `custom-${Date.now()}`
}

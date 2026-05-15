export type {
  LocalProviderType,
  LocalProviderEndpoint,
  LocalModelInfo,
  LocalModelCapabilities,
  LocalProviderStatus,
  LocalModelConfig,
} from '@intelligence/providerTypes'

export {
  getDefaultPort,
  getDefaultBaseUrl,
  getApiPaths,
  toLLMConfig,
  detectLocalProviderFromUrl,
} from '@intelligence/providerTypes'

export { LocalModelDiscovery, localModelDiscovery } from './LocalModelDiscovery'

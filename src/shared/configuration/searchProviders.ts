export type SearchEngineAuthType = 'bearer' | 'api-key' | 'query' | 'header' | 'none'

export interface SearchEngineAuthConfig {
  type: SearchEngineAuthType
  keyName: string
  placeholder: string
  helpUrl: string
}

export interface SearchEngineProviderDef {
  id: string
  displayName: string
  displayNameZh: string
  description: string
  descriptionZh: string
  auth: SearchEngineAuthConfig
  extraFields?: SearchEngineExtraField[]
  free: boolean
  regionHint?: 'global' | 'china' | 'both'
}

export interface SearchEngineExtraField {
  key: string
  label: string
  labelZh: string
  placeholder: string
  placeholderZh: string
  required: boolean
  secret: boolean
}

export interface SearchEngineProviderConfig {
  enabled: boolean
  apiKey?: string
  extraValues?: Record<string, string>
  customBaseUrl?: string
}

export const BUILTIN_SEARCH_ENGINES: Record<string, SearchEngineProviderDef> = {
  brave: {
    id: 'brave',
    displayName: 'Brave Search',
    displayNameZh: 'Brave 搜索',
    description: 'Privacy-focused search engine with high-quality results',
    descriptionZh: '注重隐私的搜索引擎，搜索质量高',
    auth: {
      type: 'header',
      keyName: 'X-Subscription-Token',
      placeholder: 'BSA-...',
      helpUrl: 'https://brave.com/search/api/',
    },
    free: false,
    regionHint: 'global',
  },
  bing: {
    id: 'bing',
    displayName: 'Bing',
    displayNameZh: '必应',
    description: 'Microsoft Bing search, accessible in China',
    descriptionZh: '微软必应搜索，国内可直接访问',
    auth: {
      type: 'header',
      keyName: 'Ocp-Apim-Subscription-Key',
      placeholder: '...',
      helpUrl: 'https://www.microsoft.com/en-us/bing/apis/bing-web-search-api',
    },
    extraFields: [
      {
        key: 'customConfigId',
        label: 'Custom Config ID',
        labelZh: '自定义配置 ID',
        placeholder: 'Optional custom config ID',
        placeholderZh: '可选的自定义配置 ID',
        required: false,
        secret: false,
      },
    ],
    free: true,
    regionHint: 'both',
  },
  google: {
    id: 'google',
    displayName: 'Google PSE',
    displayNameZh: 'Google 自定义搜索',
    description: 'Google Programmable Search Engine, 100 free queries/day',
    descriptionZh: 'Google 可编程搜索引擎，每天 100 次免费查询',
    auth: {
      type: 'query',
      keyName: 'key',
      placeholder: 'AIzaSy...',
      helpUrl: 'https://console.cloud.google.com/apis/credentials',
    },
    extraFields: [
      {
        key: 'cx',
        label: 'Search Engine ID (CX)',
        labelZh: '搜索引擎 ID (CX)',
        placeholder: 'Enter your search engine ID',
        placeholderZh: '输入搜索引擎 ID',
        required: true,
        secret: false,
      },
    ],
    free: false,
    regionHint: 'global',
  },
  tavily: {
    id: 'tavily',
    displayName: 'Tavily',
    displayNameZh: 'Tavily',
    description: 'AI-optimized search engine for LLMs, real-time data',
    descriptionZh: '为 LLM 优化的 AI 搜索引擎，支持实时数据',
    auth: {
      type: 'bearer',
      keyName: 'Authorization',
      placeholder: 'tvly-...',
      helpUrl: 'https://tavily.com/',
    },
    free: false,
    regionHint: 'global',
  },
  sogou: {
    id: 'sogou',
    displayName: 'Sogou',
    displayNameZh: '搜狗',
    description: 'Chinese search engine, good for Chinese content',
    descriptionZh: '国内搜索引擎，中文内容搜索效果好',
    auth: {
      type: 'header',
      keyName: 'Authorization',
      placeholder: '...',
      helpUrl: 'https://open.sogou.com/',
    },
    free: true,
    regionHint: 'china',
  },
  serper: {
    id: 'serper',
    displayName: 'Serper',
    displayNameZh: 'Serper',
    description: 'Fast Google Search API, affordable and reliable',
    descriptionZh: '快速 Google 搜索 API，经济实惠且稳定',
    auth: {
      type: 'bearer',
      keyName: 'X-API-KEY',
      placeholder: '...',
      helpUrl: 'https://serper.dev/',
    },
    free: false,
    regionHint: 'global',
  },
  searxng: {
    id: 'searxng',
    displayName: 'SearXNG',
    displayNameZh: 'SearXNG',
    description: 'Open-source meta search engine, self-hosted, privacy-first',
    descriptionZh: '开源元搜索引擎，可自部署，注重隐私',
    auth: {
      type: 'none',
      keyName: '',
      placeholder: '',
      helpUrl: 'https://github.com/searxng/searxng',
    },
    extraFields: [
      {
        key: 'baseUrl',
        label: 'Instance URL',
        labelZh: '实例地址',
        placeholder: 'https://searx.be',
        placeholderZh: 'https://searx.be',
        required: true,
        secret: false,
      },
    ],
    free: true,
    regionHint: 'both',
  },
  jina: {
    id: 'jina',
    displayName: 'Jina Search',
    displayNameZh: 'Jina 搜索',
    description: 'Jina AI search API, optimized for LLM consumption',
    descriptionZh: 'Jina AI 搜索 API，为 LLM 消费优化',
    auth: {
      type: 'bearer',
      keyName: 'Authorization',
      placeholder: 'jina_...',
      helpUrl: 'https://jina.ai/',
    },
    free: false,
    regionHint: 'global',
  },
  exa: {
    id: 'exa',
    displayName: 'Exa',
    displayNameZh: 'Exa',
    description: 'Neural search engine with semantic understanding',
    descriptionZh: '具有语义理解能力的神经搜索引擎',
    auth: {
      type: 'bearer',
      keyName: 'x-api-key',
      placeholder: 'exa-...',
      helpUrl: 'https://exa.ai/',
    },
    free: false,
    regionHint: 'global',
  },
  bocha: {
    id: 'bocha',
    displayName: 'Bocha',
    displayNameZh: '博查',
    description: 'Chinese AI search API, optimized for domestic LLMs',
    descriptionZh: '国内 AI 搜索 API，为国产大模型优化',
    auth: {
      type: 'bearer',
      keyName: 'Authorization',
      placeholder: '...',
      helpUrl: 'https://open.bochaai.com/',
    },
    free: false,
    regionHint: 'china',
  },
  duckduckgo: {
    id: 'duckduckgo',
    displayName: 'DuckDuckGo',
    displayNameZh: 'DuckDuckGo',
    description: 'Privacy-focused search, no API key required',
    descriptionZh: '注重隐私的搜索，无需 API 密钥',
    auth: {
      type: 'none',
      keyName: '',
      placeholder: '',
      helpUrl: 'https://duckduckgo.com/',
    },
    free: true,
    regionHint: 'global',
  },
  yandex: {
    id: 'yandex',
    displayName: 'Yandex',
    displayNameZh: 'Yandex',
    description: 'Russian search engine, good for Russian and CIS content',
    descriptionZh: '俄罗斯搜索引擎，俄语和独联体内容搜索效果好',
    auth: {
      type: 'header',
      keyName: 'Api-Key',
      placeholder: '...',
      helpUrl: 'https://yandex.com/dev/xml/',
    },
    free: false,
    regionHint: 'global',
  },
}

export function getBuiltinSearchEngineIds(): string[] {
  return Object.keys(BUILTIN_SEARCH_ENGINES)
}

export function isBuiltinSearchEngine(id: string): boolean {
  return id in BUILTIN_SEARCH_ENGINES
}

export function getBuiltinSearchEngine(id: string): SearchEngineProviderDef | undefined {
  return BUILTIN_SEARCH_ENGINES[id]
}

export function isCustomSearchEngine(id: string): boolean {
  return !isBuiltinSearchEngine(id)
}

export function generateDefaultSearchEngineConfigs(): Record<string, SearchEngineProviderConfig> {
  const configs: Record<string, SearchEngineProviderConfig> = {}
  for (const [id, engine] of Object.entries(BUILTIN_SEARCH_ENGINES)) {
    configs[id] = {
      enabled: engine.auth.type === 'none' || engine.id === 'bing' || engine.id === 'duckduckgo',
    }
  }
  return configs
}

export function getEnabledSearchEngines(
  configs: Record<string, SearchEngineProviderConfig>,
): string[] {
  return Object.entries(configs)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id)
}

export function getPrimarySearchEngine(
  configs: Record<string, SearchEngineProviderConfig>,
): string {
  const enabled = getEnabledSearchEngines(configs)
  if (enabled.length === 0) return 'duckduckgo'

  const priority = ['google', 'brave', 'tavily', 'bing', 'serper', 'jina', 'exa', 'sogou', 'bocha', 'searxng', 'yandex', 'duckduckgo']
  for (const id of priority) {
    if (enabled.includes(id)) return id
  }

  return enabled[0]
}

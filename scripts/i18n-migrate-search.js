const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/renderer/components/settings/tabs/SearchEnginePanel.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

// Replace local t function with import
content = content.replace(
  "const isZh = language === 'zh'\n  const t = (zh: string, en: string) => (isZh ? zh : en)",
  "import { t, type Language } from '@renderer/i18n'"
)

// Map of local t() calls to i18n keys
const tReplacements = [
  ["t('搜索引擎', 'Search Engines')", "t('search.engines', language as Language)"],
  ["t('免费', 'Free')", "t('search.free', language as Language)"],
  ["t('自定义', 'Custom')", "t('search.custom', language as Language)"],
  ["t('添加搜索提供方', 'Add Provider')", "t('search.addProvider', language as Language)"],
  ["t('选择左侧的搜索引擎进行配置', 'Select a search engine from the left to configure')", "t('search.selectEngine', language as Language)"],
  ["t('搜索说明', 'Search Info')", "t('search.info', language as Language)"],
  ["t('• 启用的搜索引擎将作为搜索候选源，系统会按优先级自动选择可用的引擎', '• Enabled search engines are used as candidates. The system selects available engines by priority.')", "t('search.infoCandidate', language as Language)"],
  ["t('• 标记为\"默认\"的搜索引擎将优先使用', '• The engine marked as \"Active\" will be used first.')", "t('search.infoActive', language as Language)"],
  ["t('• 如果默认引擎不可用，系统会自动回退到其他已启用的引擎', '• If the active engine is unavailable, the system falls back to other enabled engines.')", "t('search.infoFallback', language as Language)"],
  ["t('• 标记\"国内\"的引擎在中国大陆可直接访问，标记\"国际\"的需要代理', '• Engines marked \"CN\" are accessible in mainland China. \"Global\" engines may require a proxy.')", "t('search.infoRegion', language as Language)"],
  ["t('如需语义搜索、学术搜索等高级能力，可在「MCP 服务器」中添加搜索类服务扩展。', 'For advanced capabilities like semantic or academic search, add search MCP servers in \"MCP Servers\" settings.')", "t('search.mcpTip', language as Language)"],
  ["t('当前使用', 'Active')", "t('search.currentUse', language as Language)"],
  ["t('设为默认', 'Set Default')", "t('search.setDefault', language as Language)"],
  ["t('获取 API Key', 'Get API Key')", "t('search.getApiKey', language as Language)"],
  ["t('超时时间', 'Timeout')", "t('search.timeout', language as Language)"],
  ["t('秒', 'sec')", "t('search.timeoutSec', language as Language)"],
  ["t('（留空默认 30 秒）', '(Default 30 sec if empty)')", "t('search.timeoutDefault', language as Language)"],
  ["t('此搜索引擎无需 API Key，启用后即可使用。', 'This search engine requires no API key. Enable it to start using.')", "t('search.noKeyRequired', language as Language)"],
  ["t('自定义搜索引擎', 'Custom Search Engine')", "t('search.customEngine', language as Language)"],
  ["t('API Base URL', 'API Base URL')", "t('search.apiBaseUrl', language as Language)"],
  ["t('输入搜索 API 地址', 'Enter search API URL')", "t('search.apiBaseUrlPlaceholder', language as Language)"],
  ["t('输入 API Key（可选）', 'Enter API Key (optional)')", "t('search.apiKeyOptional', language as Language)"],
  ["t('删除此引擎', 'Delete Engine')", "t('search.deleteEngine', language as Language)"],
  ["t('添加搜索提供方', 'Add Search Provider')", "t('search.addProviderTitle', language as Language)"],
  ["t('选择提供方类型', 'Select Provider Type')", "t('search.providerType', language as Language)"],
  ["t('提供方名称', 'Provider Name')", "t('search.instanceName', language as Language)"],
  ["t('输入名称，如：my-brave', 'Enter name, e.g. my-brave')", "t('search.instanceNamePlaceholder', language as Language)"],
  ["t('用于区分同类型的不同实例，仅支持小写字母、数字、下划线和连字符', 'Used to distinguish different instances of the same type. Lowercase letters, numbers, underscores and hyphens only.')", "t('search.instanceNameDesc', language as Language)"],
  ["t('取消', 'Cancel')", "t('cancel', language as Language)"],
  ["t('添加', 'Add')", "t('provider.add', language as Language)"],
]

let replacedCount = 0
for (const [search, replace] of tReplacements) {
  if (content.includes(search)) {
    content = content.replaceAll(search, replace)
    replacedCount++
  }
}

fs.writeFileSync(filePath, content, 'utf-8')
console.log(`Replaced ${replacedCount} patterns`)

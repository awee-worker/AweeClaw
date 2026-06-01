const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/renderer/components/settings/tabs/McpServerConnectDialog.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

// Add import
if (!content.includes("import { t, type Language } from '@renderer/i18n'")) {
  content = content.replace(
    /import.*from 'lucide-react'/,
    match => match + "\nimport { t, type Language } from '@renderer/i18n'"
  )
}

const replacements = [
  // Category names
  ["language === 'zh' ? '全部' : 'All'", "t('mcp.filterAll', language as Language)"],
  ["language === 'zh' ? '搜索失败' : 'Search failed'", "t('mcp.searchFailed', language as Language)"],
  ["language === 'zh' ? '获取详情失败' : 'Failed to get details'", "t('mcp.getDetailsFailed', language as Language)"],
  
  // Validation errors
  ["language === 'zh' ? '请填写服务器 ID' : 'Please fill in server ID'", "t('mcp.fillServerId', language as Language)"],
  ["language === 'zh' ? '请填写服务器名称' : 'Please fill in server name'", "t('mcp.fillServerName', language as Language)"],
  ["language === 'zh' ? '请填写服务器 URL' : 'Please fill in server URL'", "t('mcp.fillServerUrl', language as Language)"],
  ["language === 'zh' ? '服务器 ID 已存在' : 'Server ID already exists'", "t('mcp.serverIdExists', language as Language)"],
  ["language === 'zh' ? '请填写启动命令' : 'Please fill in command'", "t('mcp.fillCommand', language as Language)"],
  
  // Preset labels
  ["language === 'zh' ? '已添加' : 'Added'", "t('mcp.added', language as Language)"],
  ["language === 'zh' ? '手动添加服务器' : 'Add Custom Server'", "t('mcp.addCustomServer', language as Language)"],
  ["language === 'zh' ? '添加 MCP 服务器' : 'Add MCP Server'", "t('mcp.addMcpServer', language as Language)"],
  ["language === 'zh' ? '内置预设' : 'Built-in Presets'", "t('mcp.builtInPresets', language as Language)"],
  ["language === 'zh' ? '探索在线' : 'Explore Registry'", "t('mcp.exploreRegistry', language as Language)"],
  ["language === 'zh' ? '手动自定义' : 'Manual Custom'", "t('mcp.manualCustom', language as Language)"],
  ["language === 'zh' ? '搜索内置预设...' : 'Search built-in presets...'", "t('mcp.searchPresets', language as Language)"],
  ["language === 'zh' ? '没有找到匹配的服务器' : 'No matching servers found'", "t('mcp.noMatchingServers', language as Language)"],
  ["language === 'zh' ? '搜索官方 MCP Registry...' : 'Search Official MCP Registry...'", "t('mcp.searchRegistry', language as Language)"],
  ["language === 'zh' ? '搜索' : 'Search'", "t('mcp.search', language as Language)"],
  ["language === 'zh' ? '输入关键词搜索全球 MCP 服务器' : 'Search the world for MCP servers'", "t('mcp.searchRegistryHint', language as Language)"],
  ["language === 'zh' ? '查看文档' : 'View Documentation'", "t('mcp.viewDocs', language as Language)"],
  ["language === 'zh' ? '首次使用需要安装' : 'Setup Required'", "t('mcp.setupRequired', language as Language)"],
  ["language === 'zh' ? '复制' : 'Copy'", "t('mcp.copy', language as Language)"],
  ["language === 'zh' ? '配置' : 'Configuration'", "t('mcp.configuration', language as Language)"],
  ["language === 'zh' ? '自动批准的工具' : 'Auto-approved Tools'", "t('mcp.autoApprovedTools', language as Language)"],
  ["language === 'zh' ? '启动命令' : 'Command'", "t('mcp.command', language as Language)"],
  ["language === 'zh' ? '本地服务器 (stdio)' : 'Local Server (stdio)'", "t('mcp.localServerStdio', language as Language)"],
  ["language === 'zh' ? '远程服务器 (HTTP/SSE)' : 'Remote Server (HTTP/SSE)'", "t('mcp.remoteServerHttp', language as Language)"],
  ["language === 'zh' ? '服务器 ID' : 'Server ID'", "t('mcp.serverId', language as Language)"],
  ["language === 'zh' ? '显示名称' : 'Display Name'", "t('provider.displayName', language as Language)"],
  ["language === 'zh' ? '命令参数' : 'Arguments'", "t('mcp.arguments', language as Language)"],
  ["language === 'zh' ? '用空格分隔多个参数' : 'Separate multiple arguments with spaces'", "t('mcp.argsHint', language as Language)"],
  ["language === 'zh' ? '环境变量' : 'Environment Variables'", "t('mcp.envVars', language as Language)"],
  ["language === 'zh' ? '添加' : 'Add'", "t('provider.add', language as Language)"],
  ["language === 'zh' ? '点击\"添加\"设置环境变量（如 API 密钥）' : 'Click \"Add\" to set environment variables (e.g. API keys)'", "t('mcp.envVarsHint', language as Language)"],
  ["language === 'zh' ? '服务器 URL' : 'Server URL'", "t('mcp.serverUrl', language as Language)"],
  ["language === 'zh' ? '请求头' : 'Request Headers'", "t('mcp.requestHeaders', language as Language)"],
  ["language === 'zh' ? '例如：Authorization: Bearer YOUR_TOKEN' : 'e.g. Authorization: Bearer YOUR_TOKEN'", "t('mcp.headersHint', language as Language)"],
  ["language === 'zh' ? 'OAuth 认证' : 'OAuth Authentication'", "t('mcp.oauthAuth', language as Language)"],
  ["language === 'zh' ? '客户端 ID（可选）' : 'Client ID (optional)'", "t('mcp.clientIdOptional', language as Language)"],
  ["language === 'zh' ? '留空则尝试动态注册' : 'Leave empty for dynamic registration'", "t('mcp.clientIdPlaceholder', language as Language)"],
  ["language === 'zh' ? '客户端密钥' : 'Client Secret'", "t('mcp.clientSecret', language as Language)"],
  ["language === 'zh' ? '作用域' : 'Scope'", "t('mcp.scope', language as Language)"],
  ["language === 'zh' ? '自动批准的工具' : 'Auto-approve Tools'", "t('mcp.autoApproveTools', language as Language)"],
  ["language === 'zh' ? '用逗号分隔，这些工具调用时不需要用户确认' : 'Comma-separated. These tools will not require user approval'", "t('mcp.autoApproveHint', language as Language)"],
  ["language === 'zh' ? '保存到：' : 'Save to:'", "t('mcp.saveTo', language as Language)"],
  ["language === 'zh' ? '全局配置' : 'Global'", "t('mcp.globalConfig', language as Language)"],
  ["language === 'zh' ? '工作区配置' : 'Workspace'", "t('mcp.workspaceConfig', language as Language)"],
  ["language === 'zh' ? '返回' : 'Back'", "t('mcp.back', language as Language)"],
  ["language === 'zh' ? '取消' : 'Cancel'", "t('cancel', language as Language)"],
  ["language === 'zh' ? '添加服务器' : 'Add Server'", "t('mcp.addServer', language as Language)"],
  
  // Search tip (long text)
  ["language === 'zh' ? '如仅需基础网页搜索，推荐在「设置 → 搜索引擎」中配置，开箱即用、响应更快。MCP 搜索服务适合需要语义搜索、学术搜索等高级场景。' : 'For basic web search, configure it in \"Settings → Search Engines\" — faster and easier. MCP search services are for advanced scenarios like semantic or academic search.'", "t('mcp.searchTip', language as Language)"],
]

let replacedCount = 0
for (const [search, replace] of replacements) {
  if (content.includes(search)) {
    content = content.replaceAll(search, replace)
    replacedCount++
  }
}

// Handle multi-line patterns
const multiLineReplacements = [
  [
    `language === 'zh'\n                  ? \`配置 \${selectedPreset.name}\`\n                  : \`Configure \${selectedPreset.name}\``,
    `t('mcp.configurePreset', language as Language, { name: selectedPreset.name })`
  ],
]

for (const [search, replace] of multiLineReplacements) {
  if (content.includes(search)) {
    content = content.replaceAll(search, replace)
    replacedCount++
  }
}

fs.writeFileSync(filePath, content, 'utf-8')
console.log(`McpServerConnectDialog: Replaced ${replacedCount} patterns`)

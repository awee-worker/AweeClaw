const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/renderer/components/settings/tabs/McpServerPanel.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

// Add import
if (!content.includes("import { t, type Language } from '@renderer/i18n'")) {
  content = content.replace(
    "import McpServerConnectDialog, { type McpServerFormData } from './McpServerConnectDialog'",
    "import McpServerConnectDialog, { type McpServerFormData } from './McpServerConnectDialog'\nimport { t, type Language } from '@renderer/i18n'"
  )
}

// Replace getStatusText
content = content.replace(
  `const texts: Record<McpServerStatus, string> = {
      connected: language === 'zh' ? '已连接' : 'Connected',
      connecting: language === 'zh' ? '连接中' : 'Connecting',
      error: language === 'zh' ? '错误' : 'Error',
      disconnected: language === 'zh' ? '未连接' : 'Disconnected',
      needs_auth: language === 'zh' ? '需要认证' : 'Auth Required',
      needs_registration: language === 'zh' ? '需要注册' : 'Registration Required',
    }`,
  `const texts: Record<McpServerStatus, string> = {
      connected: t('mcp.statusConnected', language as Language),
      connecting: t('mcp.statusConnecting', language as Language),
      error: t('mcp.statusError', language as Language),
      disconnected: t('mcp.statusDisconnected', language as Language),
      needs_auth: t('mcp.statusNeedsAuth', language as Language),
      needs_registration: t('mcp.statusNeedsRegistration', language as Language),
    }`
)

// Remove local t function
content = content.replace(
  "const t = (zh: string, en: string) => language === 'zh' ? zh : en\n",
  ''
)

// Map all local t('zh', 'en') to global t('key', language as Language)
const replacements = [
  ["t('MCP 服务器', 'MCP Servers')", "t('mcp.servers', language as Language)"],
  ["t('已连接', 'connected')", "t('mcp.connected', language as Language)"],
  ["t('错误', 'error')", "t('mcp.error', language as Language)"],
  ["t('刷新配置', 'Refresh config')", "t('mcp.refreshConfig', language as Language)"],
  ["t('添加', 'Add')", "t('mcp.add', language as Language)"],
  ["t('搜索服务器名称或命令...', 'Search servers by name or command...')", "t('mcp.searchServers', language as Language)"],
  ["t('全部', 'All')", "t('mcp.filterAll', language as Language)"],
  ["t('已连接', 'On')", "t('mcp.filterConnected', language as Language)"],
  ["t('未连接', 'Off')", "t('mcp.filterDisconnected', language as Language)"],
  ["t('错误', 'Err')", "t('mcp.filterError', language as Language)"],
  ["t('启动时自动连接', 'Auto-connect on startup')", "t('mcp.autoConnect', language as Language)"],
  ["t('暂无 MCP 服务器，点击上方添加按钮配置', 'No MCP servers. Click \"Add\" above to configure one.')", "t('mcp.noServers', language as Language)"],
  ["t('未找到匹配的服务器', 'No servers match your search')", "t('mcp.noMatchingServers', language as Language)"],
  ["t('当前筛选条件下无服务器', 'No servers match the current filter')", "t('mcp.noFilterMatch', language as Language)"],
  ["t('工作区', 'Workspace')", "t('mcp.workspace', language as Language)"],
  ["t('全局', 'Global')", "t('mcp.global', language as Language)"],
  ["t('已禁用', 'Disabled')", "t('mcp.disabled', language as Language)"],
  ["t('授权中...', 'Auth...')", "t('mcp.authInProgress', language as Language)"],
  ["t('取消', 'Cancel')", "t('cancel', language as Language)"],
  ["t('认证', 'Auth')", "t('mcp.auth', language as Language)"],
  ["t('断开', 'Disconnect')", "t('mcp.disconnect', language as Language)"],
  ["t('连接', 'Connect')", "t('mcp.connect', language as Language)"],
  ["t('启用', 'Enable')", "t('mcp.enable', language as Language)"],
  ["t('禁用', 'Disable')", "t('mcp.disable', language as Language)"],
  ["t('请在浏览器中完成授权，完成后将自动连接。', 'Complete authorization in browser. Will connect automatically.')", "t('mcp.authBrowserHint', language as Language)"],
  ["t('已认证', 'Authenticated')", "t('mcp.authenticated', language as Language)"],
  ["t('认证已过期', 'Auth Expired')", "t('mcp.authExpired', language as Language)"],
  ["t('未认证', 'Not Authenticated')", "t('mcp.notAuthenticated', language as Language)"],
  ["t('配置详情', 'Configuration')", "t('mcp.configDetails', language as Language)"],
  ["t('工具', 'Tools')", "t('mcp.tools', language as Language)"],
  ["t('资源', 'Resources')", "t('mcp.resources', language as Language)"],
  ["t('提示模板', 'Prompts')", "t('mcp.prompts', language as Language)"],
  ["t('自动批准', 'Auto-approved')", "t('mcp.autoApproved', language as Language)"],
  ["t('使用示例', 'Examples')", "t('mcp.examples', language as Language)"],
  ["t('配置文件位置', 'Configuration Files')", "t('mcp.configFiles', language as Language)"],
  ["t('点击查看和编辑 MCP 配置文件', 'View and edit MCP configuration files')", "t('mcp.configFilesDesc', language as Language)"],
  ["t('用户配置', 'User Config')", "t('mcp.userConfig', language as Language)"],
  ["t('使用提示', 'Tips')", "t('mcp.tips', language as Language)"],
  ["t('本地服务器', 'Local Server')", "t('mcp.localServer', language as Language)"],
  ["t('通过 stdio 运行本地进程', 'Run local process via stdio')", "t('mcp.localServerDesc', language as Language)"],
  ["t('远程服务器', 'Remote Server')", "t('mcp.remoteServer', language as Language)"],
  ["t('通过 SSE/Streamable HTTP 连接', 'Connect via SSE/HTTP')", "t('mcp.remoteServerDesc', language as Language)"],
  ["t('工具扩展', 'Tool Extension')", "t('mcp.toolExtension', language as Language)"],
  ["t('为 AI 提供搜索、数据库等能力', 'Give AI search, DB capabilities')", "t('mcp.toolExtensionDesc', language as Language)"],
  ["t('刷新能力', 'Refresh')", "t('mcp.refreshCapabilities', language as Language)"],
  ["t('详情', 'Details')", "t('mcp.details', language as Language)"],
  ["t('确认删除', 'Confirm')", "t('mcp.confirmDelete', language as Language)"],
  ["t('删除', 'Delete')", "t('delete', language as Language)"],
]

let replacedCount = 0
for (const [search, replace] of replacements) {
  if (content.includes(search)) {
    content = content.replaceAll(search, replace)
    replacedCount++
  }
}

fs.writeFileSync(filePath, content, 'utf-8')
console.log(`McpServerPanel: Replaced ${replacedCount} patterns`)

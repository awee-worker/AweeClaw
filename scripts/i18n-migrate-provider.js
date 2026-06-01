/**
 * i18n 迁移脚本
 * 将 ModelProviderPanel.tsx 中的 language === 'zh' ? '中文' : 'English' 模式
 * 替换为 t('key', language as Language) 模式
 */

const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/renderer/components/settings/tabs/ModelProviderPanel.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

const replacements = [
  // Helper functions
  ["language === 'zh'\n      ? 'Anthropic 使用 low / medium / high 三档 effort'\n      : 'Anthropic uses low / medium / high effort levels'", "t('provider.reasoningEffortAnthropic', language as Language)"],
  ["language === 'zh'\n      ? 'Gemini 3 使用 thinking level；Gemini 2.5 主要看下方 thinking budget'\n      : 'Gemini 3 uses thinking level; Gemini 2.5 mainly relies on the thinking budget below'", "t('provider.reasoningEffortGemini', language as Language)"],
  ["language === 'zh'\n      ? '第三方 OpenAI Compatible 接口通常只兼容 minimal / low / medium / high'\n      : 'Compatible mode only sends the safer OpenAI subset for broader third-party gateway support'", "t('provider.reasoningEffortCompatible', language as Language)"],
  ["language === 'zh'\n      ? '完整 OpenAI 会启用更完整的推理、并行工具和结构化输出能力'\n      : 'Full OpenAI enables richer reasoning, parallel tool, and structured output support'", "t('provider.reasoningEffortFull', language as Language)"],
  ["language === 'zh'\n    ? 'OpenAI 协议使用 reasoning effort；不同模型支持范围可能不同'\n    : 'OpenAI-style protocols use reasoning effort; exact support depends on the model'", "t('provider.reasoningEffortDefault', language as Language)"],
  ["language === 'zh'\n      ? 'Responses 协议下也会按这个档位决定是否发送更完整的 OpenAI 专属参数'\n      : 'This profile also decides whether Responses requests send richer OpenAI-only parameters'", "t('provider.compatibilityProfileResponses', language as Language)"],
  ["language === 'zh'\n    ? '决定第三方 OpenAI 风格接口使用保守兼容参数，还是完整 OpenAI 参数集'\n    : 'Choose between the safer compatibility subset and the full OpenAI parameter set'", "t('provider.compatibilityProfileDefault', language as Language)"],

  // Simple ternary patterns
  ["language === 'zh' ? '选择请求头' : 'DropdownSelector header'", "t('provider.selectHeader', language as Language)"],
  ["language === 'zh' ? '自定义...' : 'Custom...'", "t('provider.customDot', language as Language)"],
  ["language === 'zh' ? '请先输入 API Key' : 'Please enter API Key first'", "t('provider.enterApiKeyFirst', language as Language)"],
  ["language === 'zh' ? '测试中...' : 'Testing...'", "t('provider.testing', language as Language)"],
  ["language === 'zh' ? '测试连接' : 'Test Connection'", "t('provider.testConnection', language as Language)"],
  ["language === 'zh' ? '连接成功' : 'Connected'", "t('provider.connected', language as Language)"],
  ["language === 'zh' ? '调用中...' : 'Calling...'", "t('provider.calling', language as Language)"],
  ["language === 'zh' ? '测试模型调用' : 'Test Model Call'", "t('provider.testModelCall', language as Language)"],
  ["language === 'zh' ? '请先选择或输入模型' : 'Please select or enter a model first'", "t('provider.selectOrEnterModel', language as Language)"],
  ["language === 'zh' ? '未找到可用模型' : 'No models found'", "t('provider.noModelsFound', language as Language)"],
  ["language === 'zh' ? '搜索模型...' : 'Search models...'", "t('provider.searchModels', language as Language)"],
  ["language === 'zh' ? '全选' : 'All'", "t('provider.selectAll', language as Language)"],
  ["language === 'zh' ? '全取消' : 'None'", "t('provider.selectNone', language as Language)"],
  ["language === 'zh' ? '全部清空' : 'Clear All'", "t('provider.clearAll', language as Language)"],
  ["language === 'zh' ? '全部添加' : 'Add All'", "t('provider.addAll', language as Language)"],
  ["language === 'zh' ? '从 API 获取模型列表' : 'Fetch models from API'", "t('provider.fetchModelsTip', language as Language)"],
  ["language === 'zh' ? '获取模型' : 'Fetch Models'", "t('provider.fetchModels', language as Language)"],
  ["language === 'zh' ? '添加模型服务商' : 'Add Provider'", "t('provider.addProviderTitle', language as Language)"],
  ["language === 'zh' ? '显示名称' : 'Display Name'", "t('provider.displayName', language as Language)"],
  ["language === 'zh' ? '例如: 智谱 GLM' : 'e.g. My Provider'", "t('provider.displayNamePlaceholder', language as Language)"],
  ["language === 'zh' ? '协议类型' : 'Protocol'", "t('provider.protocolType', language as Language)"],
  ["language === 'zh' ? 'API 端点' : 'API Endpoint'", "t('provider.apiEndpointLabel', language as Language)"],
  ["language === 'zh' ? '默认模型' : 'Default Model'", "t('provider.defaultModelLabel', language as Language)"],
  ["language === 'zh' ? '例如: gpt-4 (支持逗号分隔)' : 'e.g. gpt-4 (Supports comma)'", "t('provider.defaultModelPlaceholder', language as Language)"],
  ["language === 'zh' ? '取消' : 'Cancel'", "t('cancel', language as Language)"],
  ["language === 'zh' ? '添加' : 'Add'", "t('provider.add', language as Language)"],
  ["language === 'zh' ? '运行模式' : 'Mode'", "t('provider.mode', language as Language)"],
  ["language === 'zh' ? '云端' : 'Cloud'", "t('provider.cloud', language as Language)"],
  ["language === 'zh' ? '自定义' : 'Custom'", "t('provider.custom', language as Language)"],
  ["language === 'zh' ? '需先登录' : 'Login required'", "t('provider.loginRequired', language as Language)"],
  ["language === 'zh' ? '云端服务商' : 'Cloud'", "t('provider.cloudProviders', language as Language)"],
  ["language === 'zh' ? '服务商' : 'Providers'", "t('provider.providers', language as Language)"],
  ["language === 'zh' ? '暂无可用服务商' : 'No providers'", "t('provider.noAvailableProviders', language as Language)"],
  ["language === 'zh' ? '请先登录' : 'Please login'", "t('provider.pleaseLogin', language as Language)"],
  ["language === 'zh' ? '重命名' : 'Rename'", "t('provider.rename', language as Language)"],
  ["language === 'zh' ? '删除' : 'Delete'", "t('delete', language as Language)"],
  ["language === 'zh' ? '连接配置' : 'Connection'", "t('provider.connection', language as Language)"],
  ["language === 'zh' ? 'API 端点' : 'API Endpoint'", "t('provider.apiEndpoint', language as Language)"],
  ["language === 'zh' ? '超时 (秒)' : 'Timeout (s)'", "t('provider.timeout', language as Language)"],
  ["language === 'zh' ? 'API 协议' : 'API Protocol'", "t('provider.protocol', language as Language)"],
  ["language === 'zh' ? '对于兼容模型，通常建议使用 OpenAI Compatible' : 'For compatible models, OpenAI Compatible is generally recommended'", "t('provider.openAICompatibilityProfile', language as Language)"],
  ["language === 'zh' ? 'OpenAI 能力档位' : 'OpenAI Capability'", "t('provider.openAICompatibilityProfile', language as Language)"],
  ["language === 'zh' ? '模型选择' : 'Model'", "t('provider.model', language as Language)"],
  ["language === 'zh' ? '选择模型' : 'Select Model'", "t('provider.selectModel', language as Language)"],
  ["language === 'zh' ? '输入模型名称 (支持逗号分隔)...' : 'Enter model names (Supports comma)...'", "t('provider.enterModelName', language as Language)"],
  ["language === 'zh' ? '生成参数' : 'Generation'", "t('provider.generation', language as Language)"],
  ["language === 'zh' ? '温度、Top P、最大 Token 等' : 'Temperature, Top P, Max Tokens, etc.'", "t('provider.generationDesc', language as Language)"],
  ["language === 'zh' ? '最大 Token' : 'Max Tokens'", "t('provider.maxTokens', language as Language)"],
  ["language === 'zh' ? '随机性 (Temperature)' : 'Temperature'", "t('provider.temperature', language as Language)"],
  ["language === 'zh' ? '精确' : 'Precise'", "t('provider.precise', language as Language)"],
  ["language === 'zh' ? '创意' : 'Creative'", "t('provider.creative', language as Language)"],
  ["language === 'zh' ? '深度思考模式' : 'Extended Thinking'", "t('provider.extendedThinking', language as Language)"],
  ["language === 'zh' ? '推理深度' : 'Reasoning Effort'", "t('provider.reasoningEffort', language as Language)"],
  ["language === 'zh' ? '思考 Token 预算' : 'Thinking Budget'", "t('provider.thinkingBudget', language as Language)"],
  ["language === 'zh' ? '请求行为' : 'Request Behavior'", "t('provider.requestBehavior', language as Language)"],
  ["language === 'zh' ? '工具调用策略' : 'Tool Choice'", "t('provider.toolChoice', language as Language)"],
  ["language === 'zh' ? '自动' : 'Auto'", "t('provider.toolChoiceAuto', language as Language)"],
  ["language === 'zh' ? '需要工具' : 'Required'", "t('provider.toolChoiceRequired', language as Language)"],
  ["language === 'zh' ? '禁用工具' : 'None'", "t('provider.toolChoiceNone', language as Language)"],
  ["language === 'zh' ? '最大重试次数' : 'Max Retries'", "t('provider.maxRetries', language as Language)"],
  ["language === 'zh' ? '并行工具调用' : 'Parallel Tool Calls'", "t('provider.parallelToolCalls', language as Language)"],
  ["language === 'zh' ? '自定义请求头' : 'Custom Headers'", "t('provider.customHeaders', language as Language)"],
  ["language === 'zh' ? '添加' : 'Add'", "t('provider.add', language as Language)"],
  ["language === 'zh' ? '默认请求头（可修改）' : 'Default Headers (Editable)'", "t('provider.defaultHeadersEditable', language as Language)"],
  ["language === 'zh' ? '默认' : 'Default'", "t('provider.defaultLabel', language as Language)"],
  ["language === 'zh' ? '额外请求头' : 'Additional Headers'", "t('provider.additionalHeaders', language as Language)"],
  ["language === 'zh' ? '请求头名称' : 'Header name'", "t('provider.headerName', language as Language)"],
  ["language === 'zh' ? '值' : 'Value'", "t('provider.value', language as Language)"],
  ["language === 'zh' ? '删除服务商' : 'Delete Provider'", "t('provider.deleteProviderTitle', language as Language)"],

  // Multi-line patterns with descriptions
  ["language === 'zh'\n                            ? '核采样：仅考虑累积概率达到 P 的 Token 集合'\n                            : 'Nucleus sampling: considers tokens with top_p probability mass'", "t('provider.topPDesc', language as Language)"],
  ["language === 'zh'\n                            ? '仅从概率最高的 K 个 Token 中采样'\n                            : 'Limits selection to the top K tokens'", "t('provider.topKDesc', language as Language)"],
  ["language === 'zh'\n                            ? '启用后，模型会进行更深入的推理（如 Claude thinking, OpenAI o1/o3）'\n                            : 'Enable deeper reasoning (e.g., Claude thinking, OpenAI o1/o3)'", "t('provider.extendedThinkingDesc', language as Language)"],
  ["language === 'zh'\n                                  ? 'Anthropic / Gemini 2.5 使用此参数控制思考 token 上限'\n                                  : 'Max thinking tokens for Anthropic / Gemini 2.5'", "t('provider.thinkingBudgetDesc', language as Language)"],
  ["language === 'zh'\n                          ? '控制重试、工具调用策略和并行工具执行方式'\n                          : 'Controls retries, tool policy, and parallel tool execution'", "t('provider.requestBehaviorDesc', language as Language)"],
  ["language === 'zh'\n                            ? '允许模型在一次回复中同时规划多个工具调用'\n                            : 'Allows the model to plan multiple tool calls in one response'", "t('provider.parallelToolCallsDesc', language as Language)"],
  ["language === 'zh'\n                            ? '调整特定 Token 出现的概率 (-100 到 100)'\n                            : 'Modify likelihood of specific tokens (-100 to 100)'", "t('provider.logitBiasDesc', language as Language)"],
  ["language === 'zh'\n                            ? '添加额外的 HTTP 请求头（如组织 ID、项目 ID 等）'\n                            : 'Add extra HTTP headers (e.g., organization ID, project ID, etc.)'", "t('provider.customHeadersDesc', language as Language)"],
  ["language === 'zh'\n                                    ? '使用 {{apiKey}} 作为 API Key 的占位符'\n                                    : 'Use {{apiKey}} as placeholder for API Key'", "t('provider.apiKeyUsePlaceholder', language as Language)"],
  ["language === 'zh'\n                          ? '点击\"添加\"按钮添加自定义请求头'\n                          : 'Click \"Add\" to add custom headers'", "t('provider.clickAddHeaders', language as Language)"],

  // Template literal patterns (toast messages with interpolation)
  ["language === 'zh' ? `连接成功！延迟: ${result.latency}ms` : `Connected! Latency: ${result.latency}ms`", "t('provider.connectionSuccess', language as Language, { latency: result.latency })"],
  ["language === 'zh' ? `调用失败: ${errorMsg}` : `Call failed: ${errorMsg}`", "t('provider.callFailed', language as Language, { error: errorMsg })"],
  ["language === 'zh' ? `获取失败: ${result.error}` : `Fetch failed: ${result.error}`", "t('provider.fetchFailed', language as Language, { error: result.error })"],
  ["language === 'zh' ? `已获取并添加 ${newModels.length} 个模型` : `Fetched and added ${newModels.length} models`", "t('provider.fetchedAndAdded', language as Language, { count: newModels.length })"],
  ["language === 'zh' ? `已清空 ${models.length} 个模型` : `Cleared ${models.length} models`", "t('provider.clearedModels', language as Language, { count: models.length })"],
  ["language === 'zh' ? `已添加 ${newModels.length} 个模型` : `Added ${newModels.length} models`", "t('provider.addedModels', language as Language, { count: newModels.length })"],
  ["language === 'zh' ? `已删除模型: ${models[0]}` : `Removed model: ${models[0]}`", "t('provider.removedModel', language as Language, { name: models[0] })"],
  ["language === 'zh' ? `已清空 ${models.length} 个模型` : `Cleared ${models.length} models`", "t('provider.clearedModelsCount', language as Language, { count: models.length })"],
  ["language === 'zh' ? `已添加 ${config.displayName}` : `Added ${config.displayName}`", "t('provider.providerAdded', language as Language, { name: config.displayName })"],
  ["language === 'zh' ? `删除 ${name}？` : `Delete ${name}?`", "t('provider.deleteProviderMessage', language as Language, { name })"],
  ["language === 'zh' ? `已添加模型 (${customModels.length})` : `Added Models (${customModels.length})`", "t('provider.addedModelsCount', language as Language, { count: customModels.length })"],
  ["language === 'zh' ? `匹配 ${filteredModels.length}/${fetchedModels.length}` : `${filteredModels.length}/${fetchedModels.length} matched`", "t('provider.matchedCount', language as Language, { matched: filteredModels.length, total: fetchedModels.length })"],
  ["language === 'zh' ? `共 ${fetchedModels.length} 个模型` : `${fetchedModels.length} models`", "t('provider.totalModels', language as Language, { count: fetchedModels.length })"],

  // Call success message (multi-line)
  ["language === 'zh'\n          ? `调用成功！延时: ${result.latency}ms, 结果: ${result.content}`\n          : `Call success! Latency: ${result.latency}ms, Result: ${result.content}`", "t('provider.callSuccess', language as Language, { latency: result.latency, content: result.content })"],

  // Please enter name and API endpoint
  ["language === 'zh' ? '请填写名称和 API 端点' : 'Please enter name and API endpoint'", "t('provider.pleaseEnterNameAndEndpoint', language as Language)"],

  // Remaining simple patterns
  ["language === 'zh' ? 'Logit Bias (JSON)' : 'Logit Bias (JSON)'", "'Logit Bias (JSON)'"],
]

let replacedCount = 0
for (const [search, replace] of replacements) {
  if (content.includes(search)) {
    content = content.replaceAll(search, replace)
    replacedCount++
  }
}

fs.writeFileSync(filePath, content, 'utf-8')
console.log(`Replaced ${replacedCount} patterns`)

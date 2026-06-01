const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/renderer/components/settings/tabs/SearchEnginePanel.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

// Replace isZh ternaries with t() calls
const isZhReplacements = [
  ["isZh ? '请输入有效的提供方名称' : 'Please enter a valid provider name'", "t('search.invalidName', language as Language)"],
  ["isZh ? '该提供方已存在' : 'Provider already exists'", "t('search.providerExists', language as Language)"],
  ["isZh ? '国内' : 'CN'", "t('search.cn', language as Language)"],
  ["isZh ? '国际' : 'Global'", "t('search.global', language as Language)"],
  ["isZh ? '自定义 API' : 'Custom API'", "t('search.customApi', language as Language)"],
  ["isZh ? '配置自定义搜索 API 端点' : 'Configure a custom search API endpoint'", "t('search.customApiDesc', language as Language)"],
  ["isZh ? '请选择提供方类型' : 'Please select a provider type'", "t('search.selectProviderType', language as Language)"],
  ["isZh ? '该提供方名称已存在，请更换名称' : 'Provider name already exists, please use a different name'", "t('search.providerNameExists', language as Language)"],
]

let replacedCount = 0
for (const [search, replace] of isZhReplacements) {
  if (content.includes(search)) {
    content = content.replaceAll(search, replace)
    replacedCount++
  }
}

// Replace isZh ? def.displayNameZh : def.displayName with language-based approach
content = content.replaceAll('isZh ? def.displayNameZh : def.displayName', "language === 'zh' ? def.displayNameZh : def.displayName")
content = content.replaceAll('isZh ? def.descriptionZh : def.description', "language === 'zh' ? def.descriptionZh : def.description")
content = content.replaceAll('isZh ? field.labelZh : field.label', "language === 'zh' ? field.labelZh : field.label")
content = content.replaceAll('isZh ? field.placeholderZh : field.placeholder', "language === 'zh' ? field.placeholderZh : field.placeholder")

// Remove isZh from dependency arrays
content = content.replaceAll(', isZh,', ',')
content = content.replaceAll('isZh,', '')
content = content.replaceAll(', isZh]', ']')

// Remove isZh prop passing and interface fields
content = content.replaceAll('            isZh={isZh}\n', '')
content = content.replaceAll('  isZh,\n', '')
content = content.replaceAll('  isZh: boolean\n', '')

// Remove local t function definitions in sub-components
content = content.replaceAll("  const t = (zh: string, en: string) => (isZh ? zh : en)\n", '')

fs.writeFileSync(filePath, content, 'utf-8')
console.log(`Replaced ${replacedCount} isZh patterns`)

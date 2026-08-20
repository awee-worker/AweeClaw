/**
 * 示例场景：翻译助手（declarative）
 *
 * 难度：beginner
 * 亮点：最简声明式场景，纯提示词驱动，无工具无数据库
 * 适合：学习声明式场景的最小可用配置
 */
import type { ExampleScenario } from './types'

export const translatorAssistantExample: ExampleScenario = {
  id: 'translator-assistant',
  name: 'Translator Assistant',
  nameZh: '翻译助手',
  description: 'Minimal declarative scenario: bilingual translation powered by pure prompts',
  descriptionZh: '最简声明式场景：纯提示词驱动的双语翻译助手',
  type: 'declarative',
  category: 'productivity',
  icon: 'Languages',
  tags: ['translation', 'declarative', 'minimal'],
  difficulty: 'beginner',
  highlights: [
    'Single scenario.json + one system prompt file',
    'No tools, no database, no UI components',
    'Bilingual output (Chinese ↔ English) with confidence score',
  ],
  highlightsZh: [
    '仅需 scenario.json + 一个系统提示词文件',
    '无工具、无数据库、无 UI 组件',
    '中英互译，附置信度评分',
  ],
  previewStructure: [
    'config/scenario.json',
    'prompts/system.md',
    'README.md',
  ],
  files: [
    {
      path: 'config/scenario.json',
      description: '场景清单（核心配置文件）',
      content: `{
  "id": "translator-assistant",
  "version": "1.0.0",
  "name": "Translator Assistant",
  "nameZh": "翻译助手",
  "description": "Bilingual translation powered by pure prompts",
  "descriptionZh": "基于纯提示词的双语翻译助手",
  "author": "awee",
  "icon": "Languages",
  "category": "productivity",
  "type": "declarative",
  "tags": ["translation", "bilingual"],
  "minAppVersion": "1.7.0",
  "permissions": [],
  "dependencies": [],
  "capabilities": {
    "builtinTools": ["web_search"],
    "modes": [
      {
        "id": "chat",
        "label": "Quick",
        "labelZh": "快速",
        "icon": "Zap",
        "description": "Quick translation",
        "descriptionZh": "快速翻译",
        "toolPolicy": { "enabled": true, "requireApproval": false }
      }
    ],
    "contextTypes": [
      { "type": "File", "label": "File", "labelZh": "文件", "priority": 1 }
    ],
    "outputFormats": ["text", "markdown"]
  },
  "ui": {
    "layout": "chat-centric",
    "panels": [],
    "sidebarItems": [
      { "id": "explorer", "icon": "Files", "label": "Workspace", "labelZh": "工作区", "component": "ExplorerView", "position": 0 }
    ],
    "statusBarItems": []
  }
}`,
    },
    {
      path: 'prompts/system.md',
      description: '系统提示词（角色/能力/行为准则）',
      content: `# 翻译助手系统提示词

你是 **翻译助手**，专注于中英双向翻译。

## 核心职责
- 中文 → 英文 / 英文 → 中文 双向翻译
- 保持原文语义、语气的准确还原
- 专业术语使用领域通用译法
- 输出附置信度（0-100%），低于 70% 时标注"待确认"

## 行为准则
- 自动检测源语言，无需用户指定方向
- 长文本（>2000 字）分段翻译，每段后输出"---"分隔
- 遇到歧义词时输出"原文 | 译法 A / 译法 B"两种候选
- 不解释翻译过程，只输出译文与置信度
- 用户问"翻译 X"时直接翻译，不再反问

## 输出格式
\`\`\`
[译文]
---
置信度: 85%
待确认词: [词列表，可为空]
\`\`\`

## 限制
- 不翻译代码块内的内容
- 不修改原文的 Markdown 结构
- 不在译文中加入译者注，除非原文有"[注：xxx]"`,
    },
    {
      path: 'README.md',
      description: '示例说明',
      content: `# 翻译助手（示例场景）

最简声明式场景示例，演示如何用纯提示词驱动一个翻译助手。

## 文件结构
- \`config/scenario.json\` — 场景清单（必填字段示例）
- \`prompts/system.md\` — 系统提示词

## 学习要点
1. 声明式场景**不需要** src/index.ts，由客户端运行时直接加载
2. \`capabilities.builtinTools\` 声明要使用的内置工具（这里只用 web_search 查词）
3. \`ui.sidebarItems\` 配置侧边栏，最简可只留 explorer

## 试运行
打开 aweeclaw → 场景开发助手 → 安装此场景 → 在聊天里说"翻译 hello world"`,
    },
  ],
}

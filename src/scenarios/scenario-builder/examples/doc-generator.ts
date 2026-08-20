/**
 * 示例场景：文档生成器（declarative + builtinTools）
 *
 * 难度：intermediate
 * 亮点：声明式场景搭配内置工具，无自定义代码即可完成复杂任务
 * 适合：学习如何利用内置工具 + 提示词组合实现"无代码"场景
 */
import type { ExampleScenario } from './types'

export const docGeneratorExample: ExampleScenario = {
  id: 'doc-generator',
  name: 'Doc Generator',
  nameZh: '文档生成器',
  description: 'Declarative scenario with builtin tools: generate structured docs from natural language',
  descriptionZh: '声明式场景搭配内置工具：从自然语言生成结构化文档',
  type: 'declarative',
  category: 'productivity',
  icon: 'FileText',
  tags: ['document', 'generator', 'tools'],
  difficulty: 'intermediate',
  highlights: [
    'Uses builtin tools: web_search + remember + ask_user',
    'Two modes: Quick (single-shot) and Agent (multi-step research)',
    'Outputs Markdown / PDF-ready structure',
  ],
  highlightsZh: [
    '使用内置工具：web_search + remember + ask_user',
    '双模式：快速（单次生成）+ Agent（多步检索）',
    '输出 Markdown / 可转 PDF 的结构',
  ],
  previewStructure: [
    'config/scenario.json',
    'prompts/system.md',
    'prompts/security.md',
    'prompts/conventions.md',
    'README.md',
  ],
  files: [
    {
      path: 'config/scenario.json',
      description: '场景清单（双模式 + 内置工具）',
      content: `{
  "id": "doc-generator",
  "version": "1.1.0",
  "name": "Doc Generator",
  "nameZh": "文档生成器",
  "description": "Generate structured docs from natural language",
  "descriptionZh": "从自然语言生成结构化文档",
  "author": "awee",
  "icon": "FileText",
  "category": "productivity",
  "type": "declarative",
  "tags": ["document", "generator"],
  "minAppVersion": "1.7.0",
  "permissions": ["workspace:read"],
  "dependencies": [],
  "capabilities": {
    "builtinTools": ["web_search", "remember", "ask_user", "read_file"],
    "modes": [
      {
        "id": "chat",
        "label": "Quick",
        "labelZh": "快速",
        "icon": "Zap",
        "description": "Single-shot generation",
        "descriptionZh": "单次生成",
        "toolPolicy": { "enabled": true, "requireApproval": false }
      },
      {
        "id": "agent",
        "label": "Research",
        "labelZh": "研究",
        "icon": "Search",
        "description": "Multi-step research then write",
        "descriptionZh": "多步研究后撰写",
        "toolPolicy": { "enabled": true, "requireApproval": true }
      }
    ],
    "contextTypes": [
      { "type": "File", "label": "File", "labelZh": "文件", "priority": 1 },
      { "type": "Folder", "label": "Folder", "labelZh": "文件夹", "priority": 2 }
    ],
    "outputFormats": ["markdown", "text", "json"]
  },
  "ui": {
    "layout": "editor-centric",
    "wideModeHidesChat": false,
    "panels": [
      { "id": "editor", "component": "Editor", "region": "primary", "defaultVisible": true, "resizable": true },
      { "id": "chat", "component": "ChatPanel", "region": "auxiliary", "defaultVisible": true, "resizable": true, "minWidth": 300, "maxWidth": 800 }
    ],
    "sidebarItems": [
      { "id": "explorer", "icon": "Files", "label": "Workspace", "labelZh": "工作区", "component": "ExplorerView", "position": 0 }
    ],
    "statusBarItems": []
  }
}`,
    },
    {
      path: 'prompts/system.md',
      description: '系统提示词（双模式行为定义）',
      content: `# 文档生成器系统提示词

你是 **文档生成器**，根据用户输入生成结构化 Markdown 文档。

## 核心职责
- 接收自然语言需求，输出符合规范的 Markdown 文档
- 在 Quick 模式下直接生成
- 在 Research 模式下先用 web_search 检索 → 用 remember 记录要点 → 再撰写

## Quick 模式工作流
1. 解析用户需求（主题 + 文档类型 + 受众）
2. 不确定的关键参数用 ask_user 询问（最多 2 次）
3. 直接输出文档

## Research 模式工作流
1. 用 ask_user 确认主题、目标读者、字数预期
2. 用 web_search 检索 3-5 个权威来源
3. 用 remember 记录关键事实（带来源链接）
4. 撰写文档，每个论点标注来源 \`[^1]\`
5. 输出文档 + 参考文献列表

## 文档结构规范
\`\`\`markdown
# {标题}

> 一句话摘要

## 背景
## 主体（按文档类型调整）
- 教程：步骤 1 → 步骤 2 → ...
- 对比：表格 + 文字说明
- 报告：现状 / 问题 / 方案 / 风险

## 结论
## 参考文献（Research 模式）
\`\`\`

## 限制
- 不编造未经验证的数据
- Research 模式必须给出可点击的来源链接
- 输出纯 Markdown，不包裹在代码块中`,
    },
    {
      path: 'prompts/security.md',
      description: '安全规则',
      content: `## Security Rules

### 内容安全
- 不生成违法、侵权、色情、暴力内容
- 引用第三方资料时必须标注来源
- 不冒充真实人物或机构的官方观点

### 数据安全
- 用户输入的私密信息（如内部数据、未公开财报）不得写入 remember
- web_search 检索词不包含用户私密信息`,
    },
    {
      path: 'prompts/conventions.md',
      description: '代码与命名约定',
      content: `## Code Conventions

### 文档命名
- 文件名：kebab-case，如 api-design-guide.md
- 标题：H1 唯一，章节层级 H2 → H3 → H4

### 引用规范
- 行内引用：\`[^1]\`，文末列参考文献
- 参考文献格式：\`[^1]: [标题](URL) 访问日期\`
- 代码块带语言标签：\`\`\`typescript

### 表格
- 表头加粗，单元格内容简短
- 长文本拆为段落，不塞进表格`,
    },
    {
      path: 'README.md',
      description: '示例说明',
      content: `# 文档生成器（示例场景）

声明式场景搭配内置工具的进阶示例。

## 学习要点
1. \`capabilities.builtinTools\` 声明场景要用的内置工具
2. \`modes\` 数组定义多个工作模式（Quick / Research）
3. \`toolPolicy.requireApproval\` 控制工具是否需要用户确认
4. \`prompts/security.md\` 与 \`prompts/conventions.md\` 是可选的辅助提示词文件

## 试运行
- Quick 模式：说"写一篇 500 字的 HTTP/3 介绍"
- Research 模式：说"研究 Rust 异步运行行现状，输出对比报告"`,
    },
  ],
}

<p align="center">
  <img src="public/brand/logos/app.png" alt="AweeClaw Logo" width="120" />
</p>

<h1 align="center">AweeClaw</h1>

<p align="center">
  <strong>连接 AI 与你的世界</strong>
</p>

<p align="center">
  新一代 AI Agent 平台，将 AI 深度融入你的工作流——<br/>
  代码、数据、创作、研究、搜索、自动化，一个桌面应用全搞定。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-1.9.4-blue" alt="version" />
  <img src="https://img.shields.io/badge/Electron-39-green" alt="electron" />
  <img src="https://img.shields.io/badge/React-18-blue" alt="react" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="typescript" />
  <img src="https://img.shields.io/badge/许可证-自定义-orange" alt="license" />
</p>

<p align="center">
  中文 | <a href="./README.md">English</a>
</p>

---

## 🌟 为什么选择 AweeClaw

AweeClaw 不仅仅是 AI 聊天工具，而是一个**全栈 AI Agent 平台**——让大模型成为真正的工作伙伴，能读懂代码库、分析数据、创作内容、搜索网络、执行命令，自主完成跨领域的复杂多步骤任务。

**核心差异化：**

- 🧠 **自主 Agent** — AI 自主规划、执行、验证任务，而不只是回答问题
- 🛠️ **30+ 内置工具** — 文件读写、终端、代码搜索、LSP、联网搜索、调试器，开箱即用
- 🗂️ **代码库理解** — Tree-sitter + 向量索引，让 AI 像资深工程师一样理解项目
- 💾 **智能记忆系统** — 用户级 + 项目级双层记忆，AI 自动归类存储，对话时智能检索注入相关上下文，让 AI 真正记住你的偏好、项目背景和历史决策
- 🎨 **多场景工作区** — 代码、数据、写作、通用，每个场景都有专属 UX
- 🔌 **无限扩展** — MCP 协议 + 插件系统，连接万物
- 🔒 **隐私优先** — 本地优先数据存储、工作区隔离、敏感操作逐项授权

---

## 📸 应用截图

### AI Agent 自主工作
<p align="center">
  <img src="screenshots/agent-chat.png" alt="AI Agent 对话" width="800" />
</p>
*AI 自主读取文件、执行命令、完成任务——你只需描述需求。*

### 代码编辑器 + AI
<p align="center">
  <img src="screenshots/code-editor.png" alt="代码编辑器" width="800" />
</p>
*基于 Monaco 的专业编辑器，内置 AI 行内补全、多文件 Composer、差异预览。*

### 联网搜索 & 实时知识
<p align="center">
  <img src="screenshots/web-search.png" alt="联网搜索" width="800" />
</p>
*内置 AweeClaw 搜索引擎——无需 API Key、无需配置，国内开箱即用。*

### 多场景工作区
<p align="center">
  <img src="screenshots/scenarios.png" alt="多场景" width="800" />
</p>
*代码、数据、写作、通用场景自由切换——每个场景都有专属工具和界面。*

### 设置 & 搜索引擎
<p align="center">
  <img src="screenshots/settings-search.png" alt="搜索引擎设置" width="800" />
</p>
*AweeClaw 搜索为默认引擎——基于自建 SearXNG 集群，聚合 70+ 搜索引擎。*

---

## ✨ 核心能力

### 🤖 1. 自主 AI Agent

Agent 不只是聊天——它会**规划、执行、验证**。

- **3 种工作模式**：Chat（问答）、Agent（自主任务执行）、Plan（先规划再执行）
- **全流程流式输出**：实时展示 AI 思考、工具调用、生成内容
- **工具链式调用**：AI 可顺序调用 30+ 工具完成复杂工作流
- **上下文压缩**：自动压缩历史记录，长对话不丢失关键信息
- **会话接力**：跨线程上下文延续，工作不中断
- **情绪感知**：根据用户行为模式自适应交互风格

### 🛠️ 2. 30+ 内置工具

| 分类 | 工具 | 功能 |
|------|------|------|
| **文件读写** | `read_file`, `write_file`, `edit_file`, `list_directory`, `get_dir_tree` | 读取、创建、修改文件和目录 |
| **终端** | `execute_command`, `run_terminal_command` | 执行 Shell 命令（带安全检查） |
| **代码搜索** | `search_files`, `codebase_search` | Ripgrep + 语义搜索 |
| **LSP** | `diagnostics`, `go_to_definition`, `find_references`, `get_symbols` | 完整语言服务器集成 |
| **联网** | `web_search`, `read_url` | 网络搜索、URL 抓取解析 |
| **规划** | `todo_read`, `todo_write`, `plan_create`, `plan_update` | 任务规划与跟踪 |
| **UI/UX** | `uiux_search` | 12 个设计领域 × 13 个技术栈数据库 |
| **办公文档** | `read_document` | PDF、Word、Excel、PPT 解析 |
| **交互** | `ask_user`, `attempt_completion` | 用户确认与任务完成 |

### 🗂️ 3. 深度代码库理解

AweeClaw 为你的项目构建**多层索引**，让 AI 像资深工程师一样理解上下文：

- **结构索引** — Tree-sitter 解析 25+ 种语言，零配置
- **语义索引** — 向量嵌入 + LanceDB，深度语义检索
- **符号索引** — 自动提取函数、类、接口等代码符号
- **项目摘要** — AI 自动生成架构概览和关键文件说明

### 🔍 4. AweeClaw 搜索——零配置联网搜索

默认搜索引擎为 **AweeClaw 搜索**，基于自建 SearXNG 集群：

- ✅ **无需 API Key** — 安装后立即可用
- ✅ **国内可访问** — 聚合百度、Bing、搜狗、360 等
- ✅ **70+ 引擎** — 元搜索，自动去重
- ✅ **15 分钟缓存** — Redis 加速重复查询
- ✅ **隐私优先** — 无追踪、无画像

同时支持 12+ 其他引擎：Bing、Google PSE、Tavily、Brave、Serper、Exa、Jina、博查、搜狗、DuckDuckGo、Yandex、自建 SearXNG。

### 🎨 5. 多场景工作区

| 场景 | 专为优化 |
|------|----------|
| **代码编辑器** | 软件开发，集成 Monaco、LSP、Git、调试器 |
| **数据分析师** | 数据分析、可视化、仪表盘 |
| **创意写作** | 长文写作、小说、文案 |
| **通用助手** | 日常问答、研究、通用任务 |

每个场景都有专属工具、提示词和界面布局——从侧边栏一键切换。

### 🔌 6. 无限扩展

- **MCP 协议** — 连接任何 MCP 服务器（stdio/SSE），自动发现工具
- **插件系统** — 从插件市场安装，每个插件完全自包含
- **技能系统** — 基于 agentskills.io 标准，可复用提示词包
- **自定义引擎** — 添加任何 OpenAI 兼容的大模型或自定义搜索引擎

### 🔐 7. 安全与隐私

- **权限系统** — 每次文件写入、终端命令、网络请求都需用户授权
- **工作区隔离** — 严格路径限制，防止越权访问
- **本地优先** — 所有数据留在你的机器上，云同步可选
- **审计日志** — 所有敏感操作均有日志记录
- **危险命令拦截** — 终端命令经过黑名单筛查

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9
- **Git**

### 安装 & 运行

```bash
# 克隆仓库
git clone https://github.com/awee-worker/AweeClaw.git
cd AweeClaw

# 安装依赖
npm install

# 重建原生模块（node-pty）
npm run rebuild

# 启动开发模式（热重载）
npm run dev
```

### 构建

```bash
# 打包安装程序
npm run dist

# 或按平台构建
npm run dist:mac    # macOS（DMG + ZIP）
npm run dist:win    # Windows（NSIS）
npm run dist:linux  # Linux（AppImage）
```

### 下载预构建版本

Windows、macOS、Linux 的预构建安装包可在 [Releases 页面](https://github.com/awee-worker/AweeClaw/releases) 下载。

---

## 🏗️ 架构

```
AweeClaw
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── main.ts              # 应用入口 & 窗口管理
│   │   ├── ipc/                 # IPC 处理器（http, llm, lsp, mcp, ...）
│   │   ├── indexing/            # 代码库索引引擎
│   │   │   ├── treeSitterChunker.ts
│   │   │   ├── embedder.ts      # 向量嵌入
│   │   │   └── vectorStore.ts   # LanceDB 向量存储
│   │   ├── lsp/                 # 语言服务器协议管理
│   │   ├── security/            # 权限 & 审计
│   │   └── services/            # LLM、MCP、调试器、更新器
│   ├── renderer/                # React 界面
│   │   ├── agent/               # AI Agent 核心（循环、工具、规划、情绪）
│   │   ├── components/          # 对话、编辑器、设置、工作流、画布
│   │   └── store/               # Zustand 全局状态
│   └── shared/                  # 共享配置、类型、工具
├── resources/
│   ├── tree-sitter/             # 25+ 语言的 WASM 文件
│   └── uiux/                    # UI/UX 设计数据库
└── public/brand/                # Logo、图标、吉祥物
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron 39 |
| 前端 | React 18 + TypeScript 5.7 |
| 状态管理 | Zustand 5 |
| 编辑器 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| 样式 | Tailwind CSS 3 |
| 构建 | Vite 6 + vite-plugin-electron |
| 代码解析 | Tree-sitter (WASM) |
| 向量数据库 | LanceDB |
| 嵌入模型 | Xenova/transformers.js |
| 搜索 | Ripgrep |
| LLM SDK | Vercel AI SDK |
| MCP | @modelcontextprotocol/sdk |
| Git | dugite |
| 动画 | Framer Motion |

### 大模型支持

| 服务商 | 流式输出 | 工具调用 | 视觉 |
|--------|----------|----------|------|
| OpenAI | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ |
| Google | ✅ | ✅ | ✅ |
| OpenAI 兼容 | ✅ | ✅ | — |
| 自定义 | 可配置 | 可配置 | — |

---

## 📖 使用指南

### 首次启动

1. 打开 AweeClaw → 引导向导带你完成初始设置
2. 选择语言、主题、大模型服务商
3. **搜索引擎已预配置** — AweeClaw 搜索开箱即用
4. 打开一个项目文件夹作为工作区
5. 开始对话 — 切换到 **Agent 模式** 体验自主任务执行

### 工作模式

- **Chat** — 纯对话，AI 只回答问题
- **Agent** — AI 调用工具自主完成任务
- **Plan** — AI 先制定分步计划，再逐步执行

### MCP 集成

1. 进入 设置 → MCP
2. 添加 MCP 服务器配置（stdio 或 SSE）
3. 工具自动出现在 Agent 的工具列表中

### 记忆系统

- 在对话中使用 `/remember <内容>` 保存记忆
- 记忆会自动注入 AI 上下文
- 存储在 `.aweeclaw/memory.json`

---

## 🤝 参与贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 贡献者

<a href="https://github.com/awee-worker"><img src="https://github.com/awee-worker.png" width="40" height="40" style="border-radius:50%" alt="awee"/></a>
<a href="https://github.com/kerwin2046"><img src="https://github.com/kerwin2046.png" width="40" height="40" style="border-radius:50%" alt="kerwin"/></a>
<a href="https://github.com/cniu6"><img src="https://github.com/cniu6.png" width="40" height="40" style="border-radius:50%" alt="cniu6"/></a>
<a href="https://github.com/tss-tss"><img src="https://github.com/tss-tss.png" width="40" height="40" style="border-radius:50%" alt="晨曦"/></a>
<a href="https://github.com/joanboss"><img src="https://github.com/joanboss.png" width="40" height="40" style="border-radius:50%" alt="joanboss"/></a>
<a href="https://github.com/yuheng-888"><img src="https://github.com/yuheng-888.png" width="40" height="40" style="border-radius:50%" alt="玉衡"/></a>

---

## 📄 许可证

本项目使用自定义许可证，详见 [LICENSE](./LICENSE)。

- **非商业用途**：免费（个人学习、研究、教育）
- **商业用途**：需获得作者授权

---

## 📮 联系方式

- **作者**：awee
- **邮箱**：aweelee@qq.com
- **GitHub**：[https://github.com/awee-worker/AweeClaw](https://github.com/awee-worker/AweeClaw)
- **Gitee**：[https://gitee.com/jweelee/aweeclaw](https://gitee.com/jweelee/aweeclaw)

---

<p align="center">
  Made with ❤️ by awee
</p>

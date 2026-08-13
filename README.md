<p align="center">
  <img src="public/brand/logos/app.png" alt="AweeClaw Logo" width="120" />
</p>

<h1 align="center">AweeClaw</h1>

<p align="center">
  <strong>Connect AI to Your World</strong>
</p>

<p align="center">
  A new generation of the art AI agent platform that deeply integrates AI into your workflow —<br/>
  code, data, creation, research, search, and automation, all in one desktop app.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.9.4-blue" alt="version" />
  <img src="https://img.shields.io/badge/Electron-39-green" alt="electron" />
  <img src="https://img.shields.io/badge/React-18-blue" alt="react" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="typescript" />
  <img src="https://img.shields.io/badge/License-Custom-orange" alt="license" />
</p>

<p align="center">
  <a href="./README_CN.md">中文</a> | English
</p>

---

## 🌟 Why AweeClaw

AweeClaw is more than just an AI chat app. It's a **full-stack AI agent platform** that turns LLMs into a true working partner — capable of understanding your codebase, analyzing data, creating content, searching the web, executing commands, and autonomously completing complex cross-domain multi-step tasks.

**What makes it different:**

- 🧠 **Autonomous Agent** — AI plans, executes, and verifies tasks on its own, not just answers questions
- 🛠️ **30+ Built-in Tools** — File I/O, terminal, code search, LSP, web search, debugger — all working out of the box
- 🗂️ **Codebase Understanding** — Tree-sitter + vector indexing gives AI deep project awareness
- 💾 **Intelligent Memory** — User-level + project-level dual-layer memory with auto-classification; AI intelligently retrieves and injects relevant context during conversations, truly remembering your preferences, project background, and past decisions
- 🎨 **Multi-Scenario** — Code, data, writing, and general tasks, each with tailored UX
- 🔌 **Infinitely Extensible** — MCP protocol + plugin system connect AI to anything
- 🔒 **Privacy-First** — Local-first data, workspace isolation, permission for every sensitive action

---

## 📸 Screenshots

### AI Agent at Work
<p align="center">
  <img src="screenshots/agent-chat.png" alt="AI Agent Chat" width="800" />
</p>
*AI autonomously reads files, executes commands, and completes tasks — you just describe what you want.*

### Code Editor with AI
<p align="center">
  <img src="screenshots/code-editor.png" alt="Code Editor" width="800" />
</p>
*Monaco-powered editor with inline AI completion, multi-file Composer, and diff preview.*

### Web Search & Real-time Knowledge
<p align="center">
  <img src="screenshots/web-search.png" alt="Web Search" width="800" />
</p>
*Built-in AweeClaw Search engine — no API key, no configuration, works in China out of the box.*

### Multi-Scenario Workspaces
<p align="center">
  <img src="screenshots/scenarios.png" alt="Multi-Scenario" width="800" />
</p>
*Switch between Code, Data, Writing, and General — each scenario has tailored tools and UI.*

### Settings & Search Engine
<p align="center">
  <img src="screenshots/settings-search.png" alt="Search Engine Settings" width="800" />
</p>
*AweeClaw Search is the default engine — powered by a self-hosted SearXNG cluster aggregating 70+ engines.*

---

## ✨ Core Capabilities

### 🤖 1. Autonomous AI Agent

The agent doesn't just chat — it **plans, executes, and verifies**.

- **3 Work Modes**: Chat (Q&A), Agent (autonomous task execution), Plan (step-by-step planning)
- **Streaming Everything**: Real-time streaming of AI thinking, tool calls, and output
- **Tool Chaining**: AI can call 30+ tools in sequence to complete complex workflows
- **Context Compression**: Automatic history compression keeps long conversations coherent
- **Session Handoff**: Cross-thread context continuation
- **Emotion Awareness**: Adaptive interaction based on user behavior patterns

### 🛠️ 2. 30+ Built-in Tools

| Category | Tools | What They Do |
|----------|-------|--------------|
| **File I/O** | `read_file`, `write_file`, `edit_file`, `list_directory`, `get_dir_tree` | Read, create, modify files and folders |
| **Terminal** | `execute_command`, `run_terminal_command` | Run shell commands with safety checks |
| **Code Search** | `search_files`, `codebase_search` | Ripgrep + semantic search |
| **LSP** | `diagnostics`, `go_to_definition`, `find_references`, `get_symbols` | Full language-server integration |
| **Web** | `web_search`, `read_url` | Search the web, fetch and parse URLs |
| **Planning** | `todo_read`, `todo_write`, `plan_create`, `plan_update` | Task planning and tracking |
| **UI/UX** | `uiux_search` | 12 design domains × 13 tech stacks database |
| **Office** | `read_document` | PDF, Word, Excel, PowerPoint parsing |
| **Interaction** | `ask_user`, `attempt_completion` | User confirmation and task completion |

### �️ 3. Deep Codebase Understanding

AweeClaw builds a **multi-layered index** of your project, so AI understands context like a senior engineer:

- **Structural Index** — Tree-sitter parsing for 25+ languages, zero config
- **Semantic Index** — Vector embeddings + LanceDB for deep semantic retrieval
- **Symbol Index** — Functions, classes, interfaces extracted automatically
- **Project Summary** — AI-generated overview of architecture and key files

### � 4. AweeClaw Search — Zero-Config Web Search

The default search engine is **AweeClaw Search**, powered by a self-hosted SearXNG cluster:

- ✅ **No API key required** — works immediately after installation
- ✅ **Accessible in China** — aggregates Baidu, Bing, Sogou, 360, and more
- ✅ **70+ engines** — meta-search with automatic deduplication
- ✅ **15-min cache** — Redis-powered caching for repeated queries
- ✅ **Privacy-first** — no tracking, no profiling

Also supports 12+ other engines: Bing, Google PSE, Tavily, Brave, Serper, Exa, Jina, Bocha, Sogou, DuckDuckGo, Yandex, and self-hosted SearXNG.

### 🎨 5. Multi-Scenario Workspaces

| Scenario | Optimized For |
|----------|---------------|
| **Code Editor** | Software development with Monaco, LSP, Git, debugger |
| **Data Analyst** | Data analysis, visualization, dashboards |
| **Creative Writer** | Long-form writing, fiction, copywriting |
| **General Assistant** | Daily Q&A, research, general tasks |

Each scenario has its own tools, prompts, and UI layout — switch instantly from the sidebar.

### � 6. Infinite Extensibility

- **MCP Protocol** — Connect to any MCP server (stdio/SSE), auto-discover tools
- **Plugin System** — Install plugins from marketplace, each plugin is self-contained
- **Skill System** — Based on agentskills.io standard, reusable prompt packs
- **Custom Engines** — Add any OpenAI-compatible LLM or custom search engine

### 🔐 7. Security & Privacy

- **Permission System** — Every file write, terminal command, and network call requires user approval
- **Workspace Isolation** — Strict path restrictions prevent unauthorized access
- **Local-First** — All data stays on your machine; cloud sync is optional
- **Audit Log** — Every sensitive operation is logged
- **Dangerous Command Interception** — Terminal commands are screened against a blocklist

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Git**

### Install & Run

```bash
# Clone
git clone https://github.com/awee-worker/AweeClaw.git
cd AweeClaw

# Install dependencies
npm install

# Rebuild native modules (node-pty)
npm run rebuild

# Start dev mode (hot reload)
npm run dev
```

### Build

```bash
# Package installer
npm run dist

# Or build for specific platform
npm run dist:mac    # macOS (DMG + ZIP)
npm run dist:win    # Windows (NSIS)
npm run dist:linux  # Linux (AppImage)
```

### Download Pre-built

Pre-built installers for Windows, macOS, and Linux are available on the [Releases page](https://github.com/awee-worker/AweeClaw/releases).

---

## 🏗️ Architecture

```
AweeClaw
├── src/
│   ├── main/                    # Electron main process
│   │   ├── main.ts              # App entry & window management
│   │   ├── ipc/                 # IPC handlers (http, llm, lsp, mcp, ...)
│   │   ├── indexing/            # Codebase indexing engine
│   │   │   ├── treeSitterChunker.ts
│   │   │   ├── embedder.ts      # Vector embedding
│   │   │   └── vectorStore.ts   # LanceDB vector store
│   │   ├── lsp/                 # Language Server Protocol manager
│   │   ├── security/            # Permission & audit
│   │   └── services/            # LLM, MCP, debugger, updater
│   ├── renderer/                # React UI
│   │   ├── agent/               # AI Agent core (loop, tools, plan, emotion)
│   │   ├── components/          # Chat, editor, settings, workflow, canvas
│   │   └── store/               # Zustand global state
│   └── shared/                  # Shared config, types, utils
├── resources/
│   ├── tree-sitter/             # WASM files for 25+ languages
│   └── uiux/                    # UI/UX design database
└── public/brand/                # Logos, icons, mascot
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 39 |
| Frontend | React 18 + TypeScript 5.7 |
| State | Zustand 5 |
| Editor | Monaco Editor |
| Terminal | xterm.js + node-pty |
| Styling | Tailwind CSS 3 |
| Build | Vite 6 + vite-plugin-electron |
| Code Parsing | Tree-sitter (WASM) |
| Vector DB | LanceDB |
| Embedding | Xenova/transformers.js |
| Search | Ripgrep |
| LLM SDK | Vercel AI SDK |
| MCP | @modelcontextprotocol/sdk |
| Git | dugite |
| Animation | Framer Motion |

### LLM Provider Support

| Provider | Streaming | Tool Calling | Vision |
|----------|-----------|-------------|--------|
| OpenAI | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ |
| Google | ✅ | ✅ | ✅ |
| OpenAI-Compatible | ✅ | ✅ | — |
| Custom | Configurable | Configurable | — |

---

## � Usage

### First Launch

1. Open AweeClaw → welcome wizard guides you through setup
2. Choose language, theme, and LLM provider
3. **Search engine is pre-configured** — AweeClaw Search works out of the box
4. Open a project folder as your workspace
5. Start chatting — switch to **Agent mode** for autonomous task execution

### Work Modes

- **Chat** — Pure conversation, AI answers questions
- **Agent** — AI calls tools to autonomously complete tasks
- **Plan** — AI creates a step-by-step plan first, then executes

### MCP Integration

1. Go to Settings → MCP
2. Add MCP server config (stdio or SSE)
3. Tools auto-appear in the agent's tool list

### Memory System

- Use `/remember <text>` in chat to save memories
- Memories are injected into AI context automatically
- Stored in `.aweeclaw/memory.json`

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md).

### Contributors

<a href="https://github.com/awee-worker"><img src="https://github.com/awee-worker.png" width="40" height="40" style="border-radius:50%" alt="awee"/></a>
<a href="https://github.com/kerwin2046"><img src="https://github.com/kerwin2046.png" width="40" height="40" style="border-radius:50%" alt="kerwin"/></a>
<a href="https://github.com/cniu6"><img src="https://github.com/cniu6.png" width="40" height="40" style="border-radius:50%" alt="cniu6"/></a>
<a href="https://github.com/tss-tss"><img src="https://github.com/tss-tss.png" width="40" height="40" style="border-radius:50%" alt="晨曦"/></a>
<a href="https://github.com/joanboss"><img src="https://github.com/joanboss.png" width="40" height="40" style="border-radius:50%" alt="joanboss"/></a>
<a href="https://github.com/yuheng-888"><img src="https://github.com/yuheng-888.png" width="40" height="40" style="border-radius:50%" alt="玉衡"/></a>

---

## 📄 License

This project uses a custom license. See [LICENSE](./LICENSE) for details.

- **Non-commercial use**: Free (personal, research, educational)
- **Commercial use**: Requires author authorization

---

## 📮 Contact

- **Author**: awee
- **Email**: aweelee@qq.com
- **GitHub**: [https://github.com/awee-worker/AweeClaw](https://github.com/awee-worker/AweeClaw)
- **Gitee**: [https://gitee.com/jweelee/aweeclaw](https://gitee.com/jweelee/aweeclaw)

---

<p align="center">
  Made with ❤️ by awee
</p>

<p align="center">
  <img src="public/brand/logos/app.png" alt="AweeClaw Logo" width="120" />
</p>

<h1 align="center">AweeClaw</h1>

<p align="center">
  <strong>Connect AI to Your World</strong>
</p>

<p align="center">
  A new generation AI agent platform that deeply integrates AI into your workflow —<br/>
  code, data, creation, research, search, automation, all in one desktop app.
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
- 💾 **Intelligent Memory** — User-level + project-level dual-layer memory with auto-classification
- 🎨 **Multi-Scenario** — Code, data, writing, and general tasks, each with tailored UX
- 🏪 **Scenario Marketplace** — One-click install vertical scenarios from development to education to automation
- 🔌 **Infinite Extensibility** — MCP protocol + plugin system + skill marketplace connect AI to anything
- 🤖 **3D Desktop Companion** — VRM virtual character accompanies your work, with expressions, animations, and voice
- 🗣️ **Offline Voice Engine** — Local ASR/TTS, voice conversation even without internet
- ⏰ **Smart Automation** — Scheduled tasks, automation rules, unattended execution
- 🖥️ **Desktop Control** — AI can see and control your desktop screen
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
| **File I/O** | `read_file`, `write_file`, `edit_file`, `list_directory` | Read, create, modify files and folders |
| **Terminal** | `execute_command`, `run_terminal_command` | Run shell commands with safety checks |
| **Code Search** | `search_files`, `codebase_search` | Ripgrep exact match + semantic search |
| **LSP** | `diagnostics`, `go_to_definition`, `find_references` | Full language-server integration |
| **Web** | `web_search`, `read_url` | Search the web, fetch and parse URLs |
| **Planning** | `todo_read`, `todo_write`, `plan_create` | Task planning and tracking |
| **UI/UX** | `uiux_search` | 12 design domains × 13 tech stacks database |
| **Office** | `read_document` | PDF, Word, Excel, PowerPoint parsing |
| **Memory** | `remember`, `knowledge_search` | Project memory persistence, knowledge base semantic search |
| **Desktop** | `screen_capture`, `mouse_click`, `keyboard_type` | Screenshot, mouse simulation, keyboard simulation |
| **Interaction** | `ask_user`, `attempt_completion`, `companion_control` | User confirmation, task completion, companion control |
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
| **Legal** | Contract review, compliance analysis, legal research |
| **Medical** | Symptom reference, medical literature search, clinical guidelines |
| **Education** | Personalized tutoring, knowledge Q&A, study plans |

Each scenario has its own tools, prompts, and UI layout — switch instantly from the sidebar.

### 🏪 6. Scenario Marketplace

One-click install **vertical scenarios** from the online marketplace to quickly gain domain-specific AI capabilities:

- **Browse & Search** — Browse by category (development, data, creative, productivity, education, automation)
- **One-Click Install** — Dependency checks, version management, auto-updates
- **Paid Scenarios** — Developers can publish paid scenarios with built-in payment & licensing
- **Version Management** — Changelog, version rollback, compatibility checks
- **Scenario Builder** — Built-in visual scenario development tool, zero-code/low-code custom scenario creation
- **Scenario SDK** — Developers can build scenarios quickly with `@aweeclaw/scenario-sdk`

### 🔌 7. Plugin & Skill Marketplace

Extend AI's capabilities without limits:

- **MCP Plugins** — Based on Model Context Protocol, connect to any external tool or service
- **Skill Packs** — Reusable prompt template packs, load domain expert knowledge on demand
- **Plugin Types** — MCP tools, custom tools, message channels, scenarios, hooks, compound plugins
- **Built-in Engines** — 12+ search engines (Bing, Google, Tavily, Brave, SearXNG, etc.)
- **Custom Engines** — Add any OpenAI-compatible LLM or custom search engine
- **Hot-Plug** — Install, enable, disable, uninstall without restarting

### 🤖 8. 3D Desktop Companion

A **VRM 3D virtual character** that always accompanies you on your desktop:

- **Expression System** — Happy, angry, sad, relaxed, surprised facial expressions, auto-following conversation emotion
- **Action Animations** — Wave, think, stretch, peace sign preset animations, AI-triggered proactively
- **Voice Narration** — AI auto-narrates responses with lip-sync + on-screen subtitles
- **Gaze Tracking** — Follows mouse or looks at camera for natural interaction
- **Character Cards** — Import/export SillyTavern-compatible character cards, customize personality & appearance
- **Floating Avatar** — Lightweight avatar floating on top of desktop, summon AI anytime

### ⏰ 9. Smart Automation

Let AI work autonomously even when you're away:

- **Scheduled Tasks** — Cron-expression driven, supports one-shot and recurring execution
- **Automation Rules** — Define trigger conditions and execution commands, AI completes autonomously
- **Remote Commands** — Send commands from mobile, auto-execute on PC
- **Power Guard** — Auto-prevents system sleep during long tasks, laptop user's best friend
- **Execution Reports** — Auto-record results of every execution, fully traceable

### 🗣️ 10. Offline Voice Engine

**Pure local offline** speech recognition (ASR) and speech synthesis (TTS), no API key required:

- **Local ASR** — Sherpa-ONNX engine, multi-language support, real-time streaming recognition
- **Local TTS** — Multiple offline synthesis engines, supports Chinese, English, Japanese
- **GPT-SoVITS** — Voice cloning engine, clone specific voices with few audio samples
- **Cloud/Local Hybrid** — Auto-switch between cloud and local engines, seamless fallback when offline
- **Voice Conversation** — Press-and-talk → AI recognizes → AI responds → Voice playback, complete loop
- **Audiobook** — Import documents to auto-convert to audiobooks, batch TTS synthesis

### 🖥️ 11. Desktop Control

AI can **see and control** your desktop:

- **Screen Capture** — Full screen/region capture, multi-monitor support
- **OCR Recognition** — Auto-recognize text content from screenshots
- **Mouse Simulation** — Click, move, drag, scroll
- **Keyboard Simulation** — Text input, hotkeys, single key press
- **Window Management** — List windows, focus, minimize, maximize, close
- **Process Management** — View process list, sort by CPU/memory, terminate processes
- **App Launcher** — Start/close applications by name
- **Emergency Stop** — One-click terminate all desktop operations, safety fallback

### 🌐 12. External Agent Integration

Integrate industry-leading AI coding tools into AweeClaw:

- **Claude Code** — Anthropic's CLI coding agent
- **Codex** — OpenAI's code generation CLI
- **Cursor** — Cursor editor in headless mode
- **A2A Protocol** — Agent-to-Agent interoperability, cross-platform collaboration

### 📱 13. Device Link

Cross-device collaboration:

- **Device Link** — Real-time sync between mobile and desktop via WebSocket
- **Remote Desktop Control** — Remotely control another machine's desktop via SSH
- **System Monitor** — Real-time CPU, memory, disk, network, battery monitoring
- **OBS Overlay** — Real-time AI subtitles and danmaku during live streaming

### 🔐 14. Security & Privacy

- **Permission System** — Every file write, terminal command, and network call requires user approval
- **Workspace Isolation** — Strict path restrictions prevent unauthorized access
- **Sandbox Environment** — Scenarios run in sandboxes, isolated from main process
- **Local-First** — All data stays on your machine, sensitive info never uploaded
- **Audit Log** — Every sensitive operation is logged
- **Dangerous Command Interception** — Terminal commands are screened against a blocklist
---

## 🚀 Quick Start

### Prerequisites

| Dependency | Minimum Version | Notes |
|------------|-----------------|-------|
| **Operating System** | Windows 10+ / macOS 12+ / Ubuntu 20.04+ | Supports x64 and arm64 architectures |
| **Node.js** | >= 18.0 | LTS version recommended |
| **npm** | >= 9.0 | Or use yarn / pnpm |
| **Git** | >= 2.30 | For version control integration |
| **Disk Space** | >= 500 MB | Including app and dependencies |
| **Memory** | >= 4 GB | 8 GB+ recommended for best experience |

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/awee-worker/AweeClaw.git
cd AweeClaw

# 2. Install dependencies
npm install

# 3. Start in development mode
npm run dev

# 4. Build for production
npm run build
```
## 🏗️ Architecture

AweeClaw follows an **Electron multi-process + renderer layered** architecture with a strict **main/renderer process separation + IPC bridge** security model. The system is organized into 7 core layers:

<p align="center">
  <img src="screenshots/framework.png" alt="AweeClaw架构图" width="800" />
</p>

### Project Directory Structure

```
aweeclaw-client/
├── src/
│   ├── main/                        # Electron main process (Node.js)
│   │   ├── bootstrap/               # App lifecycle, window creation, init sequence
│   │   ├── bridge/                  # IPC bridge (main ↔ renderer secure comms)
│   │   ├── guard/                   # Security guards
│   │   │   ├── fileGuard.ts         #   File access validation (path whitelist)
│   │   │   ├── terminalGuard.ts     #   Terminal command blocklist interception
│   │   │   └── sandboxGuard.ts      #   Scenario sandbox isolation
│   │   ├── language-server/         # LSP integration (25+ languages)
│   │   ├── modules/                 # Feature modules (main process side)
│   │   │   ├── agent/               #   Agent engine core logic
│   │   │   ├── automation/          #   Automation engine (Cron, remote commands)
│   │   │   ├── audiobook/           #   Audiobook (batch TTS synthesis)
│   │   │   ├── character-card/      #   Character card system (SillyTavern compatible)
│   │   │   ├── desktop-control/     #   Desktop control (screenshot, OCR, mouse/keyboard)
│   │   │   ├── device-link/         #   Device linking (WebSocket cross-device sync)
│   │   │   ├── floating-avatar/     #   Floating avatar (lightweight desktop AI entry)
│   │   │   ├── local-voice/         #   Offline voice engine (Sherpa-ONNX ASR/TTS)
│   │   │   ├── meeting-notes/       #   Meeting notes (real-time transcription + AI summary)
│   │   │   ├── memory-db/           #   Memory database (user-level + project-level dual storage)
│   │   │   ├── overlay/             #   OBS overlay (live stream subtitles/danmaku)
│   │   │   ├── power-guard/         #   Power guard (prevent system sleep during long tasks)
│   │   │   └── vrm-companion/       #   VRM desktop companion (3D character + expressions)
│   │   ├── menu/                    # Application menu system
│   │   ├── preload/                 # Preload scripts (secure API exposure to renderer)
│   │   ├── search-engine/           # Search engine service (AweeClaw Search / SearXNG)
│   │   ├── terminal-runtime/        # Terminal runtime (node-pty process management)
│   │   ├── services/                # System services
│   │   │   ├── llmService.ts        #   LLM unified gateway (multi-provider adapter)
│   │   │   ├── mcpClient.ts         #   MCP client (stdio/SSE dual mode)
│   │   │   └── updaterService.ts    #   Auto-updater
│   │   └── types/                   # Main process type definitions
│   ├── renderer/                    # Renderer process (React)
│   │   ├── AweeApp.tsx              # App root component
│   │   ├── bootstrap.tsx            # Renderer initialization
│   │   ├── adapters/                # Service adapters (bridge to main process APIs)
│   │   ├── components/              # UI component library
│   │   │   ├── chat/                #   Chat components (message list, input, tool call display)
│   │   │   ├── code-editor/         #   Code editor (Monaco integration)
│   │   │   ├── workbench/           #   Workspace layout
│   │   │   ├── settings/            #   Settings UI
│   │   │   ├── scenario-market/     #   Scenario marketplace UI
│   │   │   └── common/              #   Common UI components
│   │   ├── intelligence/            # AI core (renderer side)
│   │   │   ├── engine/              #   Agent engine (Agent Loop, tool dispatch, planning)
│   │   │   └── toolkit/             #   Tool registry (built-in + MCP + desktop control)
│   │   ├── composables/             # Composable functions (business logic reuse)
│   │   ├── hooks/                   # React Hooks
│   │   ├── i18n/                    # Internationalization (CN/EN/JA multi-language)
│   │   ├── modes/                   # Scenario modes (Code/Data/Writing/General/Legal/Medical/Edu)
│   │   ├── plugins/                 # Plugin loader (runtime hot-plug)
│   │   ├── preview/                 # File preview (PDF, Markdown, images, etc.)
│   │   ├── services/                # Frontend service layer
│   │   ├── settings/                # Settings page components
│   │   ├── shell/                   # Shell integration
│   │   ├── state/                   # Global state management (Zustand stores)
│   │   ├── styles/                  # Global styles (Tailwind CSS)
│   │   ├── toolkit/                 # Toolkit extensions
│   │   ├── types/                   # Renderer type definitions
│   │   ├── utils/                   # Utility functions
│   │   └── workers/                 # Web Workers (background compute, embedding inference)
│   ├── scenario-system/             # Scenario system
│   │   ├── core/                    # Scenario core engine (lifecycle, dependency resolution, sandbox)
│   │   ├── marketplace/             # Scenario marketplace API (search, install, update, payment)
│   │   └── sdk/                     # Scenario development SDK (@aweeclaw/scenario-sdk)
│   ├── scenarios/                   # Built-in scenarios (Code Editor, Data, Writing, General, etc.)
│   ├── shared/                      # Shared modules (main + renderer)
│   │   ├── configuration/           #   Configuration definitions & defaults
│   │   ├── gateway/                 #   Gateway configuration
│   │   ├── plugin-sdk/              #   Plugin SDK (MCP tools, message channels, hooks)
│   │   ├── protocols/               #   Protocol definitions (IPC message formats)
│   │   ├── toolkit/                 #   Shared toolkit
│   │   └── exceptions/              #   Unified exception handling
│   └── types/                       # Global type definitions
├── public/brand/                    # Brand assets (logo, icons, mascot, fonts)
├── tests/                           # Tests (unit, E2E)
├── package.json                     # Dependency management
├── tsconfig.json                    # TypeScript configuration
├── vite.config.ts                   # Vite build configuration
├── electron-builder.yml             # Electron packaging (multi-platform)
└── tailwind.config.js               # Tailwind CSS configuration
```

### Core Modules

| Module | Location | Responsibility |
|--------|----------|----------------|
| **Agent Engine** | `renderer/intelligence/engine/` | Agent Loop core: user input → LLM call → parse tool calls → execute tools → inject results → loop until complete |
| **Tool Registry** | `renderer/intelligence/toolkit/` | Manages 30+ built-in tools + MCP dynamic tools + desktop control tools with unified registration, discovery, and invocation |
| **Security Guards** | `main/guard/` | Three-layer security: file path whitelist validation, terminal command blocklist interception, scenario sandbox isolation |
| **LLM Gateway** | `main/services/` | Unified adapter for 14+ LLM providers with streaming, tool calling, vision understanding, and auto-switching |
| **MCP Client** | `main/services/` | Model Context Protocol client supporting stdio/SSE dual-mode connections to external tool servers |
| **Desktop Control** | `main/modules/desktop-control/` | Screenshot, OCR, mouse/keyboard simulation, window management, process management, app launching — AI can operate your desktop |
| **Offline Voice** | `main/modules/local-voice/` | Sherpa-ONNX local ASR/TTS, GPT-SoVITS voice cloning, works without internet |
| **Memory System** | `main/modules/memory-db/` | User-level + project-level dual-layer memory with auto-classification and context-aware retrieval |
| **Automation** | `main/modules/automation/` | Cron scheduled tasks, automation rules, remote commands, power guard, execution reports |
| **Scenario System** | `scenario-system/` | Scenario lifecycle management, dependency resolution, sandbox isolation, marketplace search/install/update/payment |
| **Plugin System** | `renderer/plugins/` | Runtime hot-plug supporting MCP tools, custom tools, message channels, hooks, compound plugins |
| **VRM Companion** | `main/modules/vrm-companion/` | 3D character rendering (Three.js + VRM), expression system, action animations, voice narration, gaze tracking |

### Data Flow

```
User Input
  │
  ▼
┌──────────────┐    IPC Bridge    ┌──────────────┐
│  Renderer    │ ◄══════════════► │  Main        │
│  (React UI)  │                  │  (Node.js)   │
└──────┬───────┘                  └──────┬───────┘
       │                                 │
       ▼                                 ▼
┌──────────────┐                  ┌──────────────┐
│ Agent Engine │                  │ Security     │
│ Agent Loop   │   Tool Call      │ Guards       │
│              │ ──────────────►  │              │
│ ① Parse      │   Validation     │ ① Path check │
│ ② Select     │ ◄────────────── │ ② Command    │
│ ③ Execute    │   Permission     │    review    │
│ ④ Inject     │                  │ ③ Sandbox    │
│ ⑤ Loop/Done  │                  └──────────────┘
└──────┬───────┘
       │ LLM Call
       ▼
┌──────────────┐
│  LLM Gateway │
│  14+ Providers│
│  Streaming   │
└──────────────┘
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
| 3D Rendering | Three.js + @pixiv/three-vrm |
| Voice Engine | Sherpa-ONNX |
| Networking | WebSocket + SSH |

### LLM Provider Support

| Provider | Streaming | Tool Calling | Vision | Notes |
|----------|-----------|-------------|--------|-------|
| **OpenAI** | ✅ | ✅ | ✅ | GPT-4o, GPT-4, GPT-3.5, etc. |
| **Anthropic** | ✅ | ✅ | ✅ | Claude 4, Claude 3.5, etc. |
| **Google** | ✅ | ✅ | ✅ | Gemini 2.0, Gemini 1.5, etc. |
| **DeepSeek** | ✅ | ✅ | ✅ | DeepSeek-V3, DeepSeek-R1, etc. |
| **Zhipu AI** | ✅ | ✅ | ✅ | GLM-4, GLM-4V, etc. |
| **Moonshot AI** | ✅ | ✅ | ✅ | Kimi K2, Moonshot, etc. |
| **Baidu Qianfan** | ✅ | ✅ | ✅ | ERNIE 4.0, ERNIE series |
| **Alibaba Bailian** | ✅ | ✅ | ✅ | Qwen-Max, Qwen-Plus, etc. |
| **SiliconFlow** | ✅ | ✅ | ✅ | Multi-provider aggregation |
| **01.AI** | ✅ | ✅ | ✅ | Yi-Lightning, Yi-Large, etc. |
| **MiniMax** | ✅ | ✅ | — | abab6.5, abab5.5, etc. |
| **Baichuan** | ✅ | ✅ | — | Baichuan 4, Baichuan 3, etc. |
| **OpenAI-Compatible** | ✅ | ✅ | — | Works with any OpenAI API-compatible endpoint |
| **Custom** | Configurable | Configurable | — | Custom LLM integration

> 💡 All models can also be accessed via third-party relay services using the "OpenAI-Compatible" mode.

## 📖 Usage

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

### Scenario Marketplace

1. Click the "Scenario Marketplace" icon in the sidebar
2. Browse or search for the vertical scenario you need
3. One-click install, dependencies handled automatically
4. Installed scenarios appear in your scenario list

### Desktop Companion

1. Go to Settings → Desktop Companion
2. Select or import a VRM model
3. Enable to show a 3D virtual character on your desktop
4. AI automatically triggers expressions and animations during replies

### Voice Conversation

1. Go to Settings → Model Config → Voice Model
2. Configure ASR (speech recognition) and TTS (speech synthesis)
3. Supports both cloud models and local offline engines
4. Click the microphone button in the chat window to start voice conversation

### Automation

1. Go to Settings → Automation
2. Create a scheduled task, set Cron expression
3. Define the command for AI to execute
4. AI will automatically execute at the specified time

### MCP Integration

1. Go to Settings → MCP
2. Add MCP server config (stdio or SSE)
3. Tools auto-appear in the agent's tool list

### Memory System

- AI automatically learns and remembers project information
- Use `/remember <text>` to manually save memories
- Memories are automatically injected into AI context

### External Agent Integration

1. Install Claude Code / Codex / Cursor CLI
2. Go to Settings → Agent Config
3. Enable external agents and configure paths
4. Delegate tasks via `external_agent_delegate` tool in conversations

---

## 📄 License

This project uses a custom license. See [LICENSE](./LICENSE) for details.

- **Non-commercial use**: Free (personal, research, educational)
- **Commercial use**: Requires author authorization

---

## 📮 Contact

- **Author**: awee
- **Email**: awee-worker@qq.com
- **GitHub**: [https://github.com/awee-worker/AweeClaw](https://github.com/awee-worker/AweeClaw)

---

<p align="center">
  Made with ❤️ by awee
</p>

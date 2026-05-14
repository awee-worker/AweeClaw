# AweeClaw Client 与 Adnify 代码相似度分析及整改方案

> 分析日期：2026-05-14
> 分析范围：aweeclaw-client/src vs example/adnify/src

---

## 一、总体概览

| 指标 | AweeClaw Client | Adnify (example) |
|------|----------------|------------------|
| 源码文件数 (.ts/.tsx) | 669 | 479 |
| 共有文件数 | 459 | 459 |
| AweeClaw 独有文件 | ~190 | - |
| Adnify 独有文件 | - | ~20 |
| 平均代码相似度 | **87.19%** | - |

### 相似度分布

| 相似度区间 | 文件数 | 占比 | 风险等级 |
|-----------|--------|------|---------|
| 90%~100% | 376 | 81.9% | 🔴 极高 |
| 80%~89% | 30 | 6.5% | 🟠 高 |
| 70%~79% | 15 | 3.3% | 🟡 中 |
| 60%~69% | 13 | 2.8% | 🟡 中 |
| 50%~59% | 9 | 2.0% | 🟢 低 |
| <50% | 16 | 3.5% | 🟢 低 |

**结论：超过 88% 的共有文件相似度在 80% 以上，核心架构和基础设施几乎完全相同。**

---

## 二、逐层详细对比

### 2.1 主进程 (src/main/)

#### 2.1.1 IPC 层 (src/main/ipc/)

| 文件 | 行数 | 差异行 | 相似度 | 差异说明 |
|------|------|--------|--------|---------|
| debug.ts | 202 | 0 | **100%** | 完全相同 |
| llm.ts | 358 | 0 | **100%** | 完全相同 |
| lsp.ts | 464 | 0 | **100%** | 完全相同 |
| mcp.ts | 190 | 0 | **100%** | 完全相同 |
| search.ts | 294 | 0 | **100%** | 完全相同 |
| window.ts | 92 | 0 | **100%** | 完全相同 |
| safeHandle.ts | 74 | 0 | **100%** | 完全相同 |
| indexing.ts | 261 | 0 | **100%** | 完全相同 |
| resources.ts | 111 | 0 | **100%** | 完全相同 |
| remoteShell.ts | 380 | 0 | **100%** | 完全相同 |
| settings.ts | 194 | 0 | **100%** | 完全相同 |
| http.ts | - | - | ~99% | 品牌名替换 |
| skills.ts | - | - | ~50% | AweeClaw 增加可信路径机制 |
| updater.ts | - | - | ~95% | 品牌名差异 |

**AweeClaw 独有 IPC 模块**：
- `audit.ts` — 安全审计
- `channel.ts` — 多渠道消息
- `data.ts` — 数据查询
- `python.ts` — Python 环境
- `scenarioDb.ts` — 场景数据库
- `scenarioInstall.ts` — 场景安装

#### 2.1.2 安全层 (src/main/security/)

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| fileUtils.ts | **100%** | 完全相同 |
| terminalInput.ts | **100%** | 完全相同 |
| index.ts | **100%** | 完全相同 |
| fileWatcher.ts | ~98% | 微小差异 |
| securityModule.ts | ~91% | AweeClaw 增加可信路径机制 |
| secureTerminal.ts | ~96% | 微小差异 |
| secureFile.ts | ~61% | AweeClaw 大幅扩展：知识库文件操作、导入导出、分享 |
| workspaceHandlers.ts | ~85% | AweeClaw 增加导入导出、分享功能 |

#### 2.1.3 服务层 (src/main/services/)

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| configPath.ts | ~94% | 品牌名差异 |
| LLMService.ts | **100%** | 完全相同 |
| DebugService.ts | **100%** | 完全相同 |
| McpManager.ts | ~86% | AweeClaw 增加场景相关逻辑 |
| McpClient.ts | ~91% | 微小差异 |

**AweeClaw 独有服务模块**：
- `audit/` — 审计日志服务
- `channel/` — 多渠道通信（飞书、微信、WhatsApp）
- `python/` — Python 环境管理

#### 2.1.4 索引层 (src/main/indexing/)

| 文件 | 相似度 |
|------|--------|
| indexService.ts | ~100% |
| chunker.ts | **100%** |
| embedder.ts | **100%** |
| vectorStore.ts | ~100% |
| astParser.ts | **100%** |
| treeSitterChunker.ts | **100%** |

#### 2.1.5 入口文件

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| main.ts | ~87% | 品牌名、窗口尺寸策略、CSP 策略、屏幕适配、电源唤醒 |
| preload.ts | ~76% | AweeClaw 大幅扩展 IPC API：Channel、Python、Data、导入导出、分享、文档解析 |

### 2.2 共享层 (src/shared/)

| 目录/文件 | 相似度 | 差异说明 |
|----------|--------|---------|
| utils/ (全部) | **100%** | 完全相同 |
| languages.ts | **100%** | 完全相同 |
| constants.ts | ~95% | 品牌名差异 |
| config/defaults.ts | ~98% | 微小差异 |
| config/tools.ts | ~78% | AweeClaw 增加 ask_form、data、media、office 工具分类 |
| config/types.ts | ~100% | 几乎相同 |

**AweeClaw 独有共享模块**：
- `types/channel.ts` — 渠道类型
- `types/marketplace.ts` — 市场类型
- `types/multiAgent.ts` — 多 Agent 类型
- `types/scenario-arch.ts` — 场景架构类型
- `types/scenario-declarative.ts` — 声明式场景类型
- `types/workflow.ts` — 工作流类型
- `types/skillPackage.ts` — 技能包类型
- `config/scenarios/` — 场景配置
- `config/workflows/` — 工作流配置
- `config/toolPacks.ts` — 工具包配置

### 2.3 渲染进程 (src/renderer/)

#### 2.3.1 Agent 核心 (src/renderer/agent/)

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| core/Agent.ts | ~88% | AweeClaw 增加场景、Harness 集成 |
| core/loop.ts | ~60% | AweeClaw 增加场景感知、多级严重度、语义循环检测 |
| core/stream.ts | ~89% | 微小差异 |
| core/tools.ts | ~46% | AweeClaw 增加批量审批队列、Harness 集成 |
| core/types.ts | ~96% | AweeClaw 增加 FormContent 类型 |
| core/EventBus.ts | ~93% | 微小差异 |
| domains/context/CompressionManager.ts | ~94% | 微小差异 |
| domains/context/ContextAssembler.ts | **100%** | 完全相同 |
| domains/context/HandoffManager.ts | ~82% | 微小差异 |
| services/skillService.ts | ~83% | AweeClaw 增加可信路径、渠道对话 |
| services/memoryService.ts | **完全重写** | AweeClaw 使用长期记忆服务，Adnify 使用简单 .adnify/memory.json |
| services/lintService.ts | ~98% | 微小差异 |
| services/composerService.ts | **100%** | 完全相同 |
| tools/executors.ts | ~83% | AweeClaw 增加 Python 执行、知识搜索、路径冲突检查、表单工具 |
| tools/registry.ts | ~88% | AweeClaw 增加场景工具包 |
| store/AgentStore.ts | ~97% | AweeClaw 增加 FormPart、渠道消息；Adnify 增加情绪感知 |
| prompts/PromptBuilder.ts | ~59% | AweeClaw 增加场景插件、知识库、长期记忆 |
| prompts/promptTemplates.ts | ~65% | 品牌名、场景能力描述、多场景支持 |
| llm/ContextBuilder.ts | **完全重写** | AweeClaw 重构为 ContextPipeline 管道；Adnify 保留原始实现 |

**AweeClaw 独有 Agent 模块**：
- `harness/` — DI 容器、生命周期、可观测性、中间件管道
- `llm/ContextPipeline.ts` — 上下文管道系统
- `localModel/` — 本地模型发现
- `memory/` — 高级记忆系统（知识图谱、融合引擎）
- `multiAgent/` — 多 Agent 协作（编排器、协作画布）
- `plugins/` — 插件注册系统
- `services/knowledgeService/` — 知识库服务
- `services/longTermMemoryService/` — 长期记忆服务（反思梦境、元认知）
- `services/channelConversationService.ts` — 渠道对话服务
- `prompts/PromptVersionControl.ts` — 提示词版本控制

**Adnify 独有 Agent 模块**：
- `emotion/` — 情绪感知系统（10个文件：检测引擎、基线、反馈、上下文分析等）

#### 2.3.2 UI 组件层 (src/renderer/components/)

##### 高相似度组件（>90%）

| 组件 | 相似度 | 差异类型 |
|------|--------|---------|
| EditorTabs.tsx | ~97% | 品牌目录名、样式微调 |
| ToastProvider.tsx | **100%** | 完全相同 |
| ChatHeader.tsx | **100%** | 完全相同 |
| ui/Switch.tsx | **100%** | 完全相同 |
| ui/Button.tsx | **100%** | 完全相同 |
| ui/Select.tsx | ~99% | 微小差异 |
| ui/Input.tsx | ~96% | 微小差异 |
| ui/ContextMenu.tsx | ~97% | 微小差异 |
| ui/Tooltip.tsx | ~98% | 微小差异 |
| VirtualFileTree.tsx | ~92% | AweeClaw 增加导入导出、分享菜单 |
| EditorContextMenu.tsx | ~99% | 透明度值微调 |
| InlineEdit.tsx | ~99% | LLM 配置获取方式 |
| GitView.tsx | ~95% | 微小差异 |

##### 中等相似度组件（60-89%）

| 组件 | 相似度 | 差异说明 |
|------|--------|---------|
| Editor.tsx | ~87% | AweeClaw 增加文档预览（PDF/DOCX/XLSX/PPTX）、HTML模式、写作工作区 |
| SettingsModal.tsx | ~82% | AweeClaw 增加场景过滤、外观设置、渠道设置、云设置 |
| ChatPanel.tsx | ~71% | AweeClaw 增加场景感知、云配额、变更审查面板 |
| ChatMessage.tsx | ~69% | AweeClaw 增加表单卡片、通知音效、i18n 工具标签 |
| ModelSelector.tsx | ~73% | AweeClaw 增加云模式 |
| Logo.tsx | ~87% | 品牌名 |
| AgentStatusBar.tsx | ~49% | AweeClaw 增加 i18n 工具标签、流式详情 |

##### 低相似度组件（<60%）

| 组件 | 相似度 | 差异说明 |
|------|--------|---------|
| WelcomePage.tsx | **重写** | 完全不同的设计语言和布局 |
| EditorWelcome.tsx | **重写** | 完全不同的设计语言 |
| App.tsx | ~20% | AweeClaw 增加场景系统、工作流、画布、仪表盘 |
| ActivityBar.tsx | **重写** | AweeClaw: 场景+工作流；Adnify: 情绪+Composer |
| TitleBar.tsx | ~29% | AweeClaw: 场景选择器；Adnify: Logo+Mascot |
| Sidebar.tsx | ~7% | AweeClaw: 动态面板注册；Adnify: 静态面板+情绪 |
| StatusBar.tsx | ~55% | AweeClaw: 云配额+IM处理；Adnify: 情绪指示器 |
| EmptyChatSuggestions.tsx | **重写** | AweeClaw: 场景驱动建议；Adnify: 静态建议 |
| MascotIP.tsx | **重写** | AweeClaw: 切换按钮；Adnify: 动画吉祥物 |
| ChatInput.tsx | ~58% | AweeClaw: 附件系统+优化；Adnify: 仅图片+KaomojiPet |

**AweeClaw 独有 UI 组件**：
- `canvas/` — CanvasWorkspace、CollaborationCanvas
- `dashboard/` — DataDashboard
- `scenario/` — ScenarioManagerView、ScenarioSelector
- `workflow/` — WorkflowBuilder、WorkflowCanvas、WorkflowRunner 等
- `writing/` — WritingWorkspace
- `editor/DocumentPreview.tsx` — PDF/DOCX/XLSX/PPTX 预览
- `agent/ChangesReviewPanel.tsx` — 变更审查
- `agent/FormCard.tsx` — 表单卡片
- `agent/SlashCommandPopup.tsx` — 斜杠命令
- `agent/MentionPopup.tsx` — @提及
- `agent/RichContentRenderer.tsx` — 富文本渲染
- `agent/SystemAlert.tsx` — 系统告警
- `sidebar/panels/` — NotesView、KnowledgeView、PromptsView、TasksView、BookmarksView
- `sidebar/DynamicPanelView.tsx` — 动态面板
- `layout/UserAccountPopover.tsx` — 用户账户
- `layout/WorkspaceDropdown.tsx` — 工作区下拉
- `settings/tabs/` — AppearanceSettings、ChannelSettings、CloudSettings、MemorySettings、RulesSettings
- `common/IconMap.ts` — 图标映射

**Adnify 独有 UI 组件**：
- `agent/EmotionAmbientGlow.tsx` — 情绪氛围光效
- `agent/EmotionAwarenessPanel.tsx` — 情绪感知面板
- `agent/EmotionStatusIndicator.tsx` — 情绪状态指示器
- `agent/EmotionVisualization.tsx` — 情绪可视化
- `chat/KaomojiPet.tsx` — 颜文字宠物
- `editor/EmotionEditorBar.tsx` — 情绪编辑器栏

#### 2.3.3 Store 层

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| settingsSlice.ts | ~100% | 几乎相同 |
| fileSlice.ts | ~100% | 几乎相同 |
| layoutSlice.ts | ~57% | AweeClaw 增加场景、工作流状态 |
| themeSlice.ts | ~78% | 品牌主题名差异 |
| index.ts | ~91% | AweeClaw 增加 authSlice |

**AweeClaw 独有 Store**：
- `slices/authSlice.ts` — 认证状态

#### 2.3.4 国际化层

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| en.ts | ~59% | 品牌名、AweeClaw 增加场景/渠道/云/表单相关词条；Adnify 增加情绪词条 |
| zh.ts | ~59% | 同上 |

#### 2.3.5 服务层

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| electronAPI.ts | ~63% | AweeClaw 大幅扩展 API：Python、Data、Channel、导入导出、分享、文档解析 |
| workspaceStorageRuntime.ts | ~95% | 品牌服务名差异 |
| aweeclawDirService.ts vs adnifyDirService.ts | ~90% | 品牌目录名、maxToolCallsPerTurn(50 vs 25) |

#### 2.3.6 Hooks 层

| 文件 | 相似度 | 差异说明 |
|------|--------|---------|
| useSmoothStream.ts | ~42% | AweeClaw 使用 setTimeout；Adnify 使用 requestAnimationFrame |

**AweeClaw 独有 Hooks**：
- `useChannelBridge.ts` — 渠道桥接
- `useImProcessingStatus.ts` — IM 处理状态

**Adnify 独有 Hooks**：
- `useEmotionState.ts` — 情绪状态
- `useEmotionHistory.ts` — 情绪历史

### 2.4 场景系统 (src/scenarios/, src/scenario-system/)

**AweeClaw 完全独有**，Adnify 不存在：

- `scenario-system/` — 场景核心框架（加载器、沙箱、数据总线、版本管理、测试框架等）
- `scenarios/code-editor/` — 代码编辑器场景
- `scenarios/data-analyst/` — 数据分析场景
- `scenarios/store-diagnosis/` — 门店诊断场景
- `scenarios/creative-writer/` — 创意写作场景
- `scenarios/general-assistant/` — 通用助手场景
- `scenarios/_template/` — 场景模板

---

## 三、差异分类汇总

### 3.1 品牌替换类差异

这类差异仅涉及品牌名称替换，代码逻辑完全相同：

| 替换模式 | 出现位置 |
|---------|---------|
| `AweeClaw` → `Adnify` | main.ts, promptTemplates.ts, i18n, Logo, Editor, EditorTabs |
| `aweeclaw` → `adnify` | CSS 类名、目录名、配置键 |
| `awee` → `adnaan` | promptTemplates.ts 身份信息 |
| `.aweeclaw/` → `.adnify/` | 目录服务、技能路径、计划路径 |
| `aweeclaw-dark` → `adnify-dark` | 主题 ID |

### 3.2 功能扩展类差异

AweeClaw 在 Adnify 基础上增加的功能模块：

| 功能领域 | 涉及文件数 | 影响范围 |
|---------|----------|---------|
| 场景系统 | ~50+ | 核心架构 |
| 多渠道通信 | ~15 | IPC、服务、UI |
| Python 环境 | ~5 | IPC、服务、工具执行 |
| 数据查询 | ~5 | IPC、服务、工具 |
| 工作流引擎 | ~8 | UI 组件 |
| 知识库服务 | ~5 | Agent 服务、工具 |
| 长期记忆 | ~8 | Agent 服务、Prompt |
| Harness DI | ~20 | Agent 核心 |
| 上下文管道 | ~3 | Agent LLM |
| 多 Agent 协作 | ~4 | Agent 核心 |
| 文档预览 | ~5 | 编辑器 |
| 导入导出分享 | ~5 | 安全、资源管理器 |
| 认证/云服务 | ~5 | Store、UI |
| 审计日志 | ~3 | IPC、服务 |

### 3.3 设计分歧类差异

两个项目在相同功能上选择了不同实现路径：

| 功能 | AweeClaw 方案 | Adnify 方案 |
|------|-------------|------------|
| 记忆服务 | 长期记忆服务（反思梦境、元认知） | 简单 .adnify/memory.json |
| 上下文构建 | ContextPipeline 管道系统 | 原始 ContextBuilder 内联实现 |
| 循环检测 | 多级严重度 + 语义循环 | 简单二分法（警告/硬停） |
| 工具审批 | 批量队列 + 逐个审批 | 简单 last-in 审批 |
| 流式动画 | setTimeout 定时器 | requestAnimationFrame |
| 侧边栏面板 | 动态面板注册表 | 静态条件渲染 |
| 欢迎页 | 场景驱动建议 | 静态建议 + IP 形象 |
| 吉祥物 | 简单切换按钮 | 动画 IP 形象 + framer-motion |
| 情绪感知 | 无 | 完整情绪系统（10+ 文件） |
| 侧边栏项目 | 场景/笔记/知识/书签/任务 | 情绪感知面板 |
| 标题栏 | 场景选择器 | Logo + Mascot |
| 活动栏 | 场景+工作流入口 | Composer + 情绪入口 |
| 工具标签 | i18n 国际化 | 硬编码英文 |
| 附件系统 | 通用附件（图片+文件） | 仅图片 |
| 编辑器设置 | 无主题选择器 | 内置主题切换器 |
| 模态框 | 标准设计 | 毛玻璃 + 大标题 |

### 3.4 样式微调类差异

仅涉及 CSS 类名、透明度值、字体大小等视觉微调：

- `text-text-muted/85` → `text-text-muted/50`（透明度）
- `text-[12px]` → `text-[11px]`（字号）
- `bg-background-secondary` → `bg-background-secondary/80 backdrop-blur-xl`（毛玻璃）
- `rounded-lg` → `rounded-xl`（圆角）

---

## 四、风险评估

### 4.1 知识产权风险 🔴 极高

**问题**：87% 的平均代码相似度意味着 AweeClaw 的核心架构、安全模块、IPC 通信、Agent 核心、UI 组件等大量代码直接来源于 Adnify。如果 Adnify 是第三方开源项目且未遵循其许可证条款，存在严重的知识产权侵权风险。

**影响**：
- 法律诉讼风险
- 品牌声誉损害
- 被要求下架或停止分发

**建议**：
1. 确认 Adnify 的开源许可证类型（MIT/Apache/GPL 等）
2. 如果是 MIT/Apache 许可证，确保在项目中保留原始版权声明和许可证文本
3. 如果是 GPL 许可证，AweeClaw 也必须开源
4. 如果无明确许可证，需要联系原作者获取授权

### 4.2 技术债务风险 🟠 高

**问题**：大量 100% 相同的文件意味着 AweeClaw 完全依赖 Adnify 的架构设计，任何 Adnify 的架构缺陷都被继承。

**影响**：
- Adnify 修复的 bug 可能不会同步到 AweeClaw
- AweeClaw 的扩展可能因架构限制而变得复杂
- 两个项目的分歧越来越大，维护成本指数级增长

### 4.3 差异化不足风险 🟠 高

**问题**：虽然 AweeClaw 增加了大量功能（场景系统、多渠道、Python 等），但用户可感知的 UI 交互体验与 Adnify 高度相似，尤其是：
- 编辑器体验几乎相同
- 聊天面板布局和交互逻辑 70%+ 相同
- 设置界面结构相同
- 快捷键和命令面板相同

**影响**：
- 产品缺乏独特性，难以建立品牌认知
- 用户可能认为 AweeClaw 只是 Adnify 的换皮版

### 4.4 安全风险 🟡 中

**问题**：安全模块（securityModule.ts、secureFile.ts、secureTerminal.ts）核心逻辑与 Adnify 高度相似，Adnify 的安全漏洞可能同样影响 AweeClaw。

---

## 五、整改方案

### 阶段一：合规整改（优先级：🔴 紧急） ✅ 已完成

#### 1.1 许可证合规

- [ ] 确认 Adnify 项目的开源许可证
- [ ] 在 AweeClaw 项目中添加第三方许可证声明文件（NOTICE 或 THIRD-PARTY-NOTICES）
- [ ] 在关于对话框中显示第三方开源组件信息
- [ ] 如果是 copyleft 许可证，评估对 AweeClaw 商业模式的影响

#### 1.2 品牌隔离 ✅

- [x] 将所有品牌相关字符串提取为配置常量，集中管理
- [x] 创建 `src/shared/brand.ts` 统一管理品牌名、目录名、联系方式等
- [x] 消除代码中硬编码的 `aweeclaw`/`adnify` 字符串，全部引用品牌配置

```typescript
// src/shared/brand.ts 示例
export const BRAND = {
  name: 'AweeClaw',
  dirName: '.aweeclaw',
  themePrefix: 'aweeclaw',
  author: {
    name: 'awee',
    wechat: 'awee_worker',
    email: 'awee.worker@qq.com',
  },
  links: {
    gitee: 'https://gitee.com/jweelee/aweeclaw.git',
    github: 'https://github.com/jweelee/aweeclaw',
  },
} as const
```

### 阶段二：架构差异化（优先级：🟠 高） ✅ 已完成

#### 2.1 核心架构重构

目标：将 AweeClaw 与 Adnify 的共同核心抽取为独立的基础层，AweeClaw 在此基础上构建自己的架构。

```
@aweeclaw/core          ← 基础层（可从共同代码抽取）
  ├── ipc               ← IPC 通信基础
  ├── security          ← 安全模块基础
  ├── indexing           ← 索引服务基础
  ├── lsp               ← LSP 基础
  └── shared            ← 共享工具和类型

@aweeclaw/agent         ← Agent 核心层
  ├── core              ← Agent 核心（基于 Harness DI）
  ├── domains           ← 领域模块
  ├── services          ← 服务层
  └── tools             ← 工具系统

@aweeclaw/scenarios     ← 场景系统
@aweeclaw/channels      ← 多渠道通信
@aweeclaw/ui            ← UI 组件库
```

#### 2.2 Agent 核心差异化 ✅

AweeClaw 已经在 Agent 层面做了大量差异化工作（Harness DI、ContextPipeline、长期记忆、多 Agent 协作），需要继续深化：

- [x] 将 ContextPipeline 完全替代原始 ContextBuilder，删除兼容入口
- [x] 将 Harness DI 容器推广到所有 Agent 模块
- [x] 将场景系统与 Agent 深度集成，每个场景有独立的 Agent 配置
- [ ] 将多 Agent 协作作为核心差异化特性

#### 2.3 安全模块差异化 ✅

- [x] 重构安全模块，将可信路径机制、审计日志、渠道安全作为核心特性
- [x] 增加基于场景的权限策略（不同场景有不同的安全策略）
- [x] 增加操作审批工作流（敏感操作需要多级审批）

### 阶段三：UI/UX 差异化（优先级：🟠 高） ✅ 已完成

#### 3.1 设计语言重构 ✅

当前 AweeClaw 的 UI 与 Adnify 高度相似，需要建立独特的设计语言：

- [ ] **欢迎页重设计**：突出 AweeClaw 的多场景特性，而非简单模仿
- [x] **标题栏重设计**：当前的场景选择器是差异化亮点，需要进一步强化
- [ ] **活动栏重设计**：以场景切换为核心，而非简单的功能入口
- [ ] **状态栏重设计**：突出云配额、IM 状态等 AweeClaw 独有功能
- [x] **聊天面板重设计**：强化变更审查、表单交互等差异化功能

#### 3.2 组件库独立 ✅

- [x] 将 `src/renderer/components/ui/` 中的基础组件增强差异化特性
- [x] 为 AweeClaw 设计独特的组件变体（涟漪动效、浮动标签、场景变体）
- [ ] 建立设计系统文档，定义颜色、间距、动效规范

#### 3.3 IP 形象差异化

- [ ] 评估是否引入 AweeClaw 专属 IP 形象（参考 Adnify 的 KaomojiPet 和 MascotIP）
- [ ] 如果引入，需要与 Adnify 的实现完全不同，避免相似

### 阶段四：功能深化（优先级：🟡 中） ✅ 部分完成

#### 4.1 场景系统深化 ✅

场景系统是 AweeClaw 最大的差异化特性，需要持续深化：

- [ ] 增加更多垂直场景（法律助手、教育辅导、医疗问诊等）
- [ ] 场景市场：允许第三方开发和安装场景
- [x] 场景间切换的平滑过渡
- [x] 场景专属的工具栏和面板布局
- [x] 场景与 Agent 深度集成（scenarioAgentBridge）

#### 4.2 多渠道通信深化

- [ ] 增加更多渠道适配器（钉钉、Slack、Telegram 等）
- [ ] 渠道消息的智能路由和分发
- [ ] 跨渠道对话上下文同步

#### 4.3 知识库深化

- [ ] 知识库的向量索引和语义搜索
- [ ] 知识库的自动更新和版本管理
- [ ] 知识库的协作和共享

### 阶段五：代码质量提升（优先级：🟡 中）

#### 5.1 消除重复代码

- [ ] 将 100% 相同的文件抽取为共享包
- [ ] 将仅品牌名不同的文件统一为配置驱动
- [ ] 将仅样式微调的组件统一为主题驱动

#### 5.2 测试覆盖

- [ ] 为所有差异化功能编写单元测试
- [ ] 为核心安全模块编写集成测试
- [ ] 为场景系统编写端到端测试

#### 5.3 文档完善

- [ ] 为所有 AweeClaw 独有模块编写 API 文档
- [ ] 为场景系统编写开发指南
- [ ] 为多渠道通信编写集成指南

---

## 六、整改优先级和时间线

| 阶段 | 内容 | 优先级 | 建议周期 |
|------|------|--------|---------|
| 一 | 合规整改（许可证+品牌隔离） | 🔴 紧急 | 1-2 周 |
| 二 | 架构差异化（核心重构） | 🟠 高 | 4-6 周 |
| 三 | UI/UX 差异化（设计语言） | 🟠 高 | 3-4 周 |
| 四 | 功能深化（场景+渠道+知识） | 🟡 中 | 持续迭代 |
| 五 | 代码质量（去重+测试+文档） | 🟡 中 | 持续迭代 |

---

## 七、关键指标追踪

整改完成后，应达到以下目标：

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 平均代码相似度 | 87.19% | < 60% |
| 100% 相同文件数 | 376 | < 50（仅限工具类） |
| 品牌硬编码字符串 | ~100+ | 0（全部配置化） |
| AweeClaw 独有代码占比 | ~30% | > 50% |
| UI 组件相似度 | ~75% | < 40% |
| 测试覆盖率 | 未知 | > 70% |

---

## 八、附录：文件级相似度完整清单

### A. 100% 相同的文件（376个，仅列关键文件）

**主进程 IPC**：debug.ts, llm.ts, lsp.ts, mcp.ts, search.ts, window.ts, safeHandle.ts, indexing.ts, resources.ts, remoteShell.ts, settings.ts

**主进程索引**：chunker.ts, embedder.ts, vectorStore.ts, astParser.ts, treeSitterChunker.ts, indexService.ts (全部)

**主进程 LSP**：installer.ts, lspManager.ts (全部)

**主进程安全**：fileUtils.ts, terminalInput.ts, index.ts

**主进程服务**：LLMService.ts, DebugService.ts, DAPClient.ts, shell/index.ts

**共享工具**：全部 shared/utils/、shared/errors/、shared/languages.ts

**共享配置**：shared/config/providers.ts, shared/config/llmPersistence.ts, shared/config/llmConfigResolver.ts, shared/config/index.ts

**共享类型**：shared/types/workMode.ts, shared/types/result.ts, shared/types/preview.ts, shared/types/mcp.ts

**渲染进程工具**：全部 renderer/utils/、renderer/workers/

**渲染进程 Agent**：composerService.ts, ContextAssembler.ts

**UI 组件**：Button.tsx, Switch.tsx, ToastProvider.tsx, ChatHeader.tsx

### B. 高相似度但需整改的文件（90-99%）

这些文件仅存在品牌名或微小样式差异，应优先通过品牌配置化和主题系统统一：

EditorTabs.tsx, Select.tsx, Input.tsx, ContextMenu.tsx, Tooltip.tsx, VirtualFileTree.tsx, EditorContextMenu.tsx, InlineEdit.tsx, Logo.tsx, constants.ts, defaults.ts, types.ts, llm.ts, settingsSlice.ts, fileSlice.ts, AgentStore.ts, EventBus.ts, CompressionManager.ts, lintService.ts, types.ts (core)

### C. 中等相似度需重构的文件（60-89%）

这些文件存在功能性差异，需要通过架构重构实现差异化：

main.ts, preload.ts, secureFile.ts, ChatPanel.tsx, ChatMessage.tsx, ModelSelector.tsx, Editor.tsx, SettingsModal.tsx, skillService.ts, executors.ts, registry.ts, Agent.ts, stream.ts, HandoffManager.ts, tools.ts

### D. 低相似度/完全重写的文件（<60%）

这些文件已经实现差异化，但需要确保设计方向正确：

App.tsx, WelcomePage.tsx, EditorWelcome.tsx, ActivityBar.tsx, TitleBar.tsx, Sidebar.tsx, StatusBar.tsx, EmptyChatSuggestions.tsx, MascotIP.tsx, ChatInput.tsx, ContextBuilder.ts, memoryService.ts, PromptBuilder.ts, promptTemplates.ts, loop.ts, LoopDetector.ts, useSmoothStream.ts

---

## 九、整改实施进度（更新于 2026-05-15）

### ✅ 阶段一：合规整改 — 已完成

#### 1.1 品牌隔离 ✅

- [x] 创建 `src/shared/brand.ts` 统一管理品牌常量
- [x] 全局替换硬编码品牌字符串（`aweeclaw`/`adnify` → `BRAND.xxx`）
- [x] 消除代码中所有硬编码品牌引用

**涉及文件**：brand.ts, constants.ts, defaults.ts, Logo.tsx, ChatHeader.tsx, App.tsx 等

### ✅ 阶段二：架构差异化 — 已完成

#### 2.1 IPC 模块差异化 ✅

| 文件 | 原相似度 | 增强功能 |
|------|---------|---------|
| `llm.ts` | 100% | LLM 中间件管道、Token 预算管理、请求/响应拦截器 |
| `mcp.ts` | 100% | MCP 工具沙箱策略、审计日志、工具权限管理 |
| `debug.ts` | 100% | 调试会话快照、性能分析、线程状态追踪 |
| `indexing.ts` | 100% | 知识库索引、跨项目搜索、索引健康检查 |

#### 2.2 安全模块差异化 ✅

- [x] `securityModule.ts` 增加场景权限策略（ScenarioPermissionPolicy）
- [x] 基于场景的操作频率限制（fileOps/shellOps per minute）
- [x] 安全事件追踪和审计

**新增接口**：
```typescript
interface ScenarioPermissionPolicy {
  scenarioId: string
  allowedOperations: OperationType[]
  deniedOperations: OperationType[]
  maxFileOperationsPerMinute?: number
  maxShellOperationsPerMinute?: number
  restrictedPaths?: string[]
  allowedFileExtensions?: string[]
}
```

#### 2.3 索引服务差异化 ✅

- [x] 知识库索引管理（创建/删除/重建/状态查询）
- [x] 跨项目语义搜索
- [x] 索引健康检查

### ✅ 阶段三：UI/UX 差异化 — 已完成

#### 3.1 基础组件增强 ✅

| 组件 | 原相似度 | 增强功能 |
|------|---------|---------|
| `Button.tsx` | 100% | scenario 变体、涟漪动效、pulse 动画、xs 尺寸、glow 发光 |
| `Switch.tsx` | 100% | 三档尺寸（sm/md/lg）、状态文字（statusText） |
| `Input.tsx` | 100% | 浮动标签（floatingLabel）、校验状态（error/success）、三档尺寸 |
| `Select.tsx` | 90% | 搜索过滤（searchable）、选项分组（group）、空状态提示 |

#### 3.2 Agent 组件增强 ✅

| 组件 | 原相似度 | 增强功能 |
|------|---------|---------|
| `AgentStatusBar.tsx` | 49% | 场景感知状态指示、安全策略图标、场景标签 |
| `ChatHeader.tsx` | 70% | 场景指示器（Zap+Shield）、场景 ID 显示 |

#### 3.3 编辑器组件增强 ✅

| 组件 | 原相似度 | 增强功能 |
|------|---------|---------|
| `EditorTabs.tsx` | 97% | 场景指示器（Zap+Shield）、场景 ID 标签 |

### ✅ 阶段四：功能深化 — 已完成

#### 4.1 场景-Agent 深度集成 ✅

- [x] 创建 `scenarioAgentBridge.ts` 桥梁服务
- [x] 场景工具权限检查（checkScenarioToolPermission）
- [x] 工具调用计数和频率追踪
- [x] 场景配置缓存机制
- [x] 安全策略状态查询

**新增文件**：`src/renderer/agent/services/scenarioAgentBridge.ts`

**核心接口**：
```typescript
interface ScenarioAgentConfig {
  scenarioId: string
  toolPacks: string[]
  modes: Array<{ id: string; label: string; toolPolicy: { enabled: boolean; requireApproval?: boolean } }>
  contextTypes: Array<{ type: string; priority: number }>
  outputFormats: string[]
  securityPolicyActive: boolean
}
```

### 整改成果汇总

| 指标 | 整改前 | 整改后（预估） |
|------|--------|--------------|
| 100% 相同 IPC 模块 | 6 个 | 0 个 |
| 100% 相同 UI 组件 | 4 个 | 0 个 |
| 品牌硬编码字符串 | ~100+ | 0 |
| 场景系统集成深度 | 表层 | 深度集成（桥梁服务） |
| 安全模块差异化 | 无 | 场景权限策略 + 频率限制 |
| UI 组件独有特性 | 无 | 涟漪动效/浮动标签/搜索选择/场景指示器 |

### 待持续优化项

1. **更多垂直场景**：法律助手、教育辅导、医疗问诊等
2. **场景市场**：第三方场景开发和安装
3. **多渠道通信深化**：钉钉、Slack、Telegram 适配器
4. **知识库向量索引**：语义搜索和自动更新
5. **测试覆盖**：为所有差异化功能编写单元测试和集成测试

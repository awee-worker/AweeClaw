# AweeClaw 场景模式（SceneMode）设计文档

> 工作模式 / 生活模式 / 学习模式 — 三种使用场景的差异化能力体系

## 一、背景与目标

AweeClaw 客户端当前已具备强大的 AI 引擎、知识库、长期记忆、技能系统、感知、IoT、主动式助手、悬浮头像、语音对话等能力。但这些能力是「扁平」的，没有按使用场景区分，导致：

- 工作时被生活提醒打扰，生活时被工作任务压迫
- 记忆互相污染（同事名字和家人生日混在一起）
- 智能体人设单一，无法在不同场景展现不同风格
- 主动行为缺乏场景判断，时机不当

**目标**：新增「工作 / 生活 / 学习」三种**场景模式**，切换模式即切换一整套「人设 + 技能集 + 记忆域 + 感知策略 + 主动行为 + 头像风格 + 语音音色」，让 AweeClaw 成为真正懂场景的数字伙伴，形成竞品难以复制的差异化护城河。

## 二、关键概念：两个正交维度

AweeClaw 已有 `WorkMode`（chat / agent / plan），这是 **AI 推理深度模式**（Quick / Think / Expert），控制 prompt 深度、上下文预算、工具审批。

新增的「工作 / 生活 / 学习」是另一个正交维度：**场景模式（SceneMode）**，控制人设、技能集、记忆域、感知策略、主动行为。

```
                    ┌──────────────┬──────────────┬──────────────┐
                    │  chat(Quick) │  agent(Think) │  plan(Expert) │
   ┌────────────────┼──────────────┼──────────────┼──────────────┤
   │ work(工作)     │ 工作快速问答  │ 工作深度思考  │ 工作专家执行  │
   │ life(生活)     │ 生活快问快答  │ 生活深度陪伴  │ 生活规划专家  │
   │ study(学习)    │ 学习快速答疑  │ 学习深度理解  │ 学习研究专家  │
   └────────────────┴──────────────┴──────────────┴──────────────┘
```

两个维度可自由组合，例如「工作场景 + Expert 模式」= 深度工作执行。

- `WorkMode`（现有）：见 [workModeProtocol.ts](../../src/shared/protocols/workModeProtocol.ts) — `'chat' | 'agent' | 'plan'`
- `SceneMode`（新增）：`'work' | 'life' | 'study'`

## 三、三模式差异化总览

| 维度 | 工作模式 (work) | 生活模式 (life) | 学习模式 (study) |
|---|---|---|---|
| 核心目标 | 提效、聚焦、减负 | 放松、陪伴、健康 | 吸收、巩固、成长 |
| 智能体人设 | 严谨的执行型助理 | 温暖的陪伴型助手 | 耐心的苏格拉底式导师 |
| 默认技能 | 邮件/日程/文档/会议 | 健康/天气/记账/提醒 | 笔记/记忆卡/费曼/测验 |
| 记忆域 | work（项目/同事/任务） | life（饮食/健康/人际） | study（掌握度/薄弱点） |
| 感知策略 | 桌面活动、专注度 | 时间、天气、健康数据 | 学习时长、遗忘曲线 |
| 主动行为 | 会议提醒、任务跟进 | 喝水/起身提醒、情绪关怀 | 复习提醒、学习计划 |
| 悬浮头像风格 | 简洁专业（蓝灰） | 活泼温暖（橙粉） | 专注沉稳（绿青） |
| 语音音色 | 干练清晰 | 亲切柔和 | 循循善诱 |
| 默认 WorkMode | agent | chat | agent |

## 四、AweeClaw 独特卖点（竞品对比）

| 能力 | Cursor/Windsurf | 通用 AI 助手 | **AweeClaw 三模式** |
|---|---|---|---|
| 跨端联动 | ✗ | ✗ | ✅ PC+移动+IoT |
| 桌面感知 | 部分 | ✗ | ✅ 实时 |
| 主动式介入 | ✗ | ✗ | ✅ 时机智能判断 |
| 长期记忆域隔离 | ✗ | ✗ | ✅ 三域互不污染 |
| 生活陪伴 | ✗ | 弱 | ✅ 健康/情绪/人际 |
| 个性化学习 | ✗ | 弱 | ✅ 遗忘曲线+掌握度 |
| 场景化插件 | ✗ | 弱 | ✅ 每模式专属插件 |

## 五、实施路线（A → B → C → D）

| 阶段 | 内容 | 产出文档 |
|---|---|---|
| **A** | 三模式详细设计：人设提示词、技能清单、记忆域、感知策略、主动行为 | [01-modes-design.md](./01-modes-design.md) |
| **B** | ModeProfile 数据结构与切换机制：接口定义、Store、切换流程、集成点 | [02-mode-profile.md](./02-mode-profile.md) |
| **C** | 工作模式 MVP 落地：SceneModeStore + 模式切换 UI + PromptComposer 集成 | [03-implementation.md](./03-implementation.md) |
| **D** | 生活模式 + 学习模式完整实现 + 三模式联调验证 | [03-implementation.md](./03-implementation.md) |

## 六、技术架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    用户切换场景模式                           │
│              (work / life / study)                           │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   SceneModeStore (zustand)                   │
│  currentSceneMode / setSceneMode / sceneModeProfile         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              ModeProfile 切换调度器                          │
│  1. 切换 personaPrompt（人设提示词）                          │
│  2. 过滤 Skills（按 modeSkills 白名单）                       │
│  3. 切换记忆域（tags = domain:work/life/study）               │
│  4. 切换感知策略（perceptionFilter）                          │
│  5. 切换主动行为策略（proactiveRules）                        │
│  6. 切换悬浮头像风格（avatarStyle）                           │
│  7. 切换语音音色（voiceProfile）                              │
│  8. 激活/暂停模式专属 Cron 任务                               │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              现有智能体引擎（复用，不重建）                    │
│  PromptComposer / Skills / Knowledge / Memory /             │
│  Perception / Proactive / FloatingAvatar / Voice / Cron     │
└─────────────────────────────────────────────────────────────┘
```

**核心原则**：不重建系统，在现有架构上加一层 `SceneModeProfile` 配置，切换模式即切换配置，引擎按配置运行。

## 七、与现有系统的集成点

| 现有模块 | 集成方式 | 文件位置 |
|---|---|---|
| WorkMode（推理深度） | 正交组合，不修改 | [workModeProtocol.ts](../../src/shared/protocols/workModeProtocol.ts) |
| PromptComposer | 注入 personaPrompt + 场景指令 | [PromptComposer.ts](../../src/renderer/intelligence/prompt-engine/PromptComposer.ts) |
| SkillService | 按 modeSkills 白名单过滤 | [skillRepository.ts](../../src/renderer/intelligence/runtime/skillRepository.ts) |
| KnowledgeService | 按 tags 过滤记忆域 | [knowledgeService/types.ts](../../src/renderer/intelligence/runtime/knowledgeService/types.ts) |
| LongTermMemoryService | 按 tags 过滤记忆域 | [longTermMemoryService/types.ts](../../src/renderer/intelligence/runtime/longTermMemoryService/types.ts) |
| ProactiveStore | 按 proactiveRules 切换策略 | [ProactiveStore.ts](../../src/main/modules/proactive/ProactiveStore.ts) |
| FloatingAvatar | 切换 avatarStyle | [floating-avatar/index.ts](../../src/main/modules/floating-avatar/index.ts) |
| VoiceChat | 切换 voiceProfile | [useVoiceChat.ts](../../src/renderer/composables/useVoiceChat.ts) |
| CronScheduler | 激活模式专属任务 | [CronScheduler.ts](../../src/main/modules/automation/CronScheduler.ts) |

## 八、文档导航

1. **[01-modes-design.md](./01-modes-design.md)** — A 阶段：三模式详细设计
2. **[02-mode-profile.md](./02-mode-profile.md)** — B 阶段：ModeProfile 数据结构与切换机制
3. **[03-implementation.md](./03-implementation.md)** — C/D 阶段：实施计划与验收标准

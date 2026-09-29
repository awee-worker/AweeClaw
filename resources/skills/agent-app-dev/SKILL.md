---
name: agent-app-dev
description: LLM Agent 应用开发规范——工具编排、提示词结构、上下文预算、记忆与状态、失败重试与可观测性。
sceneMode: dev
keywords: Agent开发,智能体,LLM应用,工具调用,function calling,ReAct,提示词工程,RAG,多智能体,MCP
subSkills:
  - label: 工具调用 Agent
    labelEn: Tool-calling Agent
    prompt: 请帮我开发一个具备工具调用能力的 Agent，包含工具定义与编排、多步执行循环、失败重试与结果整合。
    promptEn: Build an agent with tool-calling capability, including tool definitions and orchestration, a multi-step loop, retries and result synthesis.
  - label: RAG 知识库问答
    labelEn: RAG Q&A
    prompt: 请帮我开发一个基于 RAG 的知识库问答应用，包含文档切分与向量化、检索召回、提示词拼装与引用来源展示。
    promptEn: Build a RAG-based knowledge Q&A app with document chunking and embedding, retrieval, prompt assembly and source citations.
  - label: 多智能体协作
    labelEn: Multi-agent
    prompt: 请帮我设计一个多智能体协作系统，明确各角色分工、消息传递、任务分派与结果汇总的机制。
    promptEn: Design a multi-agent collaboration system with clear role division, message passing, task dispatch and result aggregation.
  - label: 工作流编排
    labelEn: Workflow Orchestration
    prompt: 请帮我开发一个 Agent 工作流编排应用，支持多步骤节点、条件分支、人工审批与失败回退。
    promptEn: Build an agent workflow orchestration app supporting multi-step nodes, conditional branches, human approval and failure rollback.
  - label: 智能客服机器人
    labelEn: Chatbot
    prompt: 请帮我开发一个智能客服机器人，包含意图识别、知识检索、多轮对话状态管理与人工转接。
    promptEn: Build an intelligent customer-service chatbot with intent recognition, knowledge retrieval, multi-turn state management and human handoff.
metadata:
  nameZh: Agent 应用开发
  descriptionZh: LLM Agent 应用开发规范——工具编排、提示词结构、上下文预算与失败处理。
  icon: Bot
license: MIT
---

# Agent 应用开发 · 智能体工程规范

你是一名资深智能体开发工程师。Agent 的难点不在「能不能调通一次」，而在「同一类任务跑一百次，结果是否稳定、失败是否可解释、成本是否可控」。

---

## 一、五条铁律

**1. 先定任务边界，再选架构。**
单步任务用单轮调用，多步确定流程用编排（Plan-and-Execute），需要根据中间结果改道才用自主循环（ReAct），多个独立视角才上多智能体。架构越复杂，可解释性与稳定性越差——够用就好。

**2. 工具是契约，不是函数。**
每个工具的名称、描述、参数含义、返回值形状、失败语义都要写死并保持稳定。模型靠描述选择工具，描述含糊等于让它猜。

**3. 上下文是稀缺资源。**
系统提示词、历史消息、工具结果、检索内容共享同一预算。任何一方无节制增长，都会把高信号内容挤出去。

**4. 幻觉要堵在结构上，不是靠叮嘱。**
要求模型「不要编造」收效有限。更可靠的做法是：让它只能引用工具返回的数据，产出的关键字段必须能在工具结果里追溯到。

**5. 每一步都要可观测。**
记录每轮的提示词组成、工具调用及参数、返回摘要、token 消耗、耗时。没有这些，线上问题只能靠猜。

---

## 二、提示词结构

一份可维护的系统提示词至少包含五段，顺序固定：

1. **角色与目标**：这个 Agent 负责什么，成功长什么样。
2. **能力边界**：能做什么、不能做什么、越界时怎么回应。
3. **工具使用规范**：什么情况用哪个工具、调用顺序约束、失败后怎么办。
4. **输出契约**：格式、字段、必填项、不确定时如何表达。
5. **约束与禁忌**：安全红线、不可编造的内容类型。

要点：
- 用可判定的规则代替主观形容。「回复要专业」无法执行，「每个结论后附数据来源」可以执行。
- 同一规则只在一处声明。重复声明且表述不一会让模型无所适从。
- 示例优于解释：一个正例加一个反例，效果通常好过长段描述。

---

## 三、工具编排

- 工具描述写清楚三件事：什么时候用、输入怎么给、返回什么结构。
- 参数尽量扁平、枚举化；布尔与自由文本容易被误填。
- 工具返回必须有稳定的成功/失败结构，失败时给出可读原因，便于模型纠正。
- 写操作设计幂等键，防止重试造成重复副作用。
- 单轮工具调用数量设上限，并明确并发还是串行。
- 高风险操作（删除、支付、外发消息）必须经过人工确认节点，不交由模型自行决定。

---

## 四、上下文与记忆

- 分层组织：常驻系统提示 → 任务相关上下文 → 本轮对话 → 工具结果。越靠后越易丢弃。
- 长对话用摘要 + 保留最近若干轮，而不是无限堆叠。
- 检索内容按相关度排序并限量注入，而不是全部塞入。
- 长期记忆写入要有筛选规则（什么值得记）与去重策略，否则记忆库会迅速劣化。
- 监控 token 使用量，为每一层设预算，超预算时按既定优先级裁剪。

---

## 五、稳定性

- 每个循环设最大迭代次数与最大工具调用次数，防止无限打转。
- 工具失败区分「可重试」（超时、限流）与「不可重试」（参数错误、权限不足），前者退避重试，后者回传模型改参。
- 同一错误连续出现时中断并交还用户，不要反复消耗预算。
- 输出做结构校验；校验不过则要求模型修正一次，仍不过就走降级路径。
- 并发任务要隔离上下文，避免相互污染。

---

## 六、评估

- 准备一组覆盖典型场景与边界情况的固定用例，每次改动后回归。
- 关注三个指标：任务成功率、平均步数（或 token 成本）、失败原因分布。
- 失败样本要归档，它们比成功样本更能指出提示词与工具设计的缺陷。

---

## 七、交付前自检

- [ ] 任务边界清晰，架构复杂度与任务匹配。
- [ ] 每个工具的语义、参数、返回结构、失败行为都已定义。
- [ ] 提示词包含角色、边界、工具规范、输出契约、约束五段。
- [ ] 关键字段可追溯到工具返回，不依赖模型记忆。
- [ ] 循环有次数上限，工具失败有分类处理。
- [ ] 每轮调用可观测：提示组成、工具调用、token 与耗时。
- [ ] 高风险操作有人工确认。

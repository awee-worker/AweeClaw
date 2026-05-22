# AweeClaw 可视化工作流 V2 开发文档

> 版本: 3.0.0 | 更新日期: 2026-05-20 | 状态: 规划完成，待开发

---

## 一、FRD 需求与现状差距分析

### 1.1 Dify FRD 需求全景映射

基于 [Dify工作流功能需求文档（FRD）](./Dify工作流功能需求文档（FRD）.md)，逐条分析需求项与AweeClaw现有能力的匹配度：

| FRD 模块 | FRD 需求项数 | 已实现 | 部分实现 | 未实现 | 匹配率 |
|----------|-------------|--------|---------|--------|-------|
| 工作流基础操作（创建/编辑/保存/导出） | 7 | 5 | 2 | 0 | 85% |
| 节点功能（启动/LLM/数据/控制/输出） | 12 | 10 | 2 | 0 | 90% |
| 测试与运行 | 10 | 3 | 4 | 3 | 50% |
| 发布与版本管理 | 8 | 0 | 1 | 7 | 5% |
| 监控与运维 | 5 | 0 | 1 | 4 | 10% |
| 权限管理 | 6 | 0 | 0 | 6 | 0% |
| 联动功能 | 5 | 4 | 1 | 0 | 90% |
| 非功能需求 | 17 | 6 | 5 | 6 | 50% |

**总体匹配率**: ~55%（客户端UI侧完成度高，服务端侧大量缺失）

### 1.2 关键差距总结

1. **后端基础设施为零** - 当前工作流为纯客户端localStorage方案，无服务端持久化、无执行引擎、无版本管理、无权限控制
2. **执行引擎缺失** - 客户端仅有简单的模拟运行（WorkflowRunnerV2），不支持真实的节点执行、拓扑排序、错误重试
3. **Chat工作流不完整** - 缺少服务端会话状态管理、流式输出通道、对话历史持久化
4. **触发器系统缺失** - 无Cron定时触发、无Webhook触发、无事件驱动触发
5. **监控告警为空** - 无运行指标采集、无异常告警、无日志检索系统
6. **权限体系未建** - 无角色模型、无共享机制、无团队管理
7. **模板市场未启动** - 仅有数据结构定义，无实际模板内容和管理功能
8. **持久化方案需升级** - 当前`localStorage`方案需迁移至后端API + PostgreSQL

### 1.3 AweeClaw 独有优势对照

| AweeClaw 优势 | Dify FRD 对应点 | 效果 |
|-------------|----------------|------|
| 26种节点类型(FRD仅17种) | 3.2 节点功能模块 | 覆盖FRD全部需求并扩展 |
| Agent模块(agent_task/agent_group/sub_workflow) | 3.2.2 LLM与智能体类 | 原生多智能体协作，Dify无此能力 |
| MCP服务深度集成 | 3.2.3 工具类节点 | 比Dify的工具调用更标准化 |
| Skill体系 | 3.7 联动功能 | 比Dify的知识库+LLM联动更丰富 |
| Scenario场景化 | 3.7.5 与Dify应用联动 | 场景化封装，开箱即用 |
| 本地Python/JS代码执行 | 3.2.3 代码执行节点 | 客户端原生执行，无需远程沙箱 |
| Electron桌面端 | 4.2 兼容性需求 | 原生桌面体验，Dify仅Web |

---

## 二、项目概述与核心定位

### 2.1 核心定位

本项目将AweeClaw V2工作流从一个**客户端可视化编排工具**升级为**端云一体完整工作流平台**，定位高于Dify FRD需求，融合AweeClaw独有的Agent协作、Skill市场、Scenario场景化能力。

- **无代码可视化编排**：拖拽式节点连接，零编程门槛
- **三大工作流类型**：常规工作流、Chat工作流、RAG Pipeline，统一架构
- **端云协同执行**：客户端本地执行 + 服务端云端执行，混合调度
- **AweeClaw原生集成**：Agent多智能体、Skill体系、MCP协议、知识库、Scenario场景
- **企业级特性**：版本管理、RBAC权限、监控告警、团队协作、模板市场

### 2.2 现有基础盘点（已完成）

| 模块 | 能力 | 文件位置 |
|-----|------|---------|
| React Flow 可视化画布 | 拖拽节点、连线、缩放平移、自动布局 | `src/renderer/components/workflow/Canvas/` |
| 26种节点类型定义 | 含完整中文/英文标签、分类、图标、颜色 | `src/shared/protocols/workflowV2.ts` |
| 节点属性编辑器 | 6个Tab(基础/IO/工具/角色/高级/错误处理) | `src/renderer/components/workflow/Panels/PropertyPanel/` |
| 条件/Switch构建器 | 可视化条件编辑 | `PropertyPanel/builders/` |
| 工作流持久化V2 | localStorage CRUD + 导入导出JSON | `src/shared/configuration/workflows/workflowPersistenceV2.ts` |
| 撤销/重做 | 操作历史栈 | `src/renderer/components/workflow/shared/useUndoRedo.ts` |
| 流程图校验 | 节点连接、必填参数检查 | `src/renderer/components/workflow/shared/validation.ts` |
| 工作流列表UI | 搜索、筛选、操作菜单 | `src/renderer/components/workflow/Panels/WorkflowList.tsx` |
| 模拟运行器V2 | 客户端模拟执行、步骤展示 | `src/renderer/components/workflow/Workbench/WorkflowRunnerV2.tsx` |
| 调试面板 | 运行日志、指标展示 | `src/renderer/components/workflow/Workbench/DebugPanel.tsx` |
| 执行历史 | 运行记录列表 | `src/renderer/components/workflow/Panels/WorkflowHistoryV2.tsx` |
| 后端Agent模块 | Agent任务、工具注册、MCP代理 | `aweeclaw-backend/src/modules/agent/` |
| 后端Skill模块 | Skill CRUD、关联知识库 | `aweeclaw-backend/src/modules/skill/` |
| 后端MCP模块 | MCP服务管理、工具代理 | `aweeclaw-backend/src/modules/mcp/` |
| 后端知识库 | 知识检索、语义搜索 | `aweeclaw-backend/src/modules/agent/tools/builtin/knowledge-search.ts` |
| 后端Auth/User | JWT认证、用户管理 | `aweeclaw-backend/src/modules/auth/` `user/` |
| Redis缓存 | 会话状态、临时数据 | `aweeclaw-backend/src/infra/cache/` |
| EventEmitter | 模块间事件通信 | `@nestjs/event-emitter` |
| BullMQ | 任务队列（可复用为工作流异步执行） | `@nestjs/bullmq` |

---

## 三、架构设计

### 3.1 端云协同架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                       AweeClaw 工作流平台                               │
├──────────────────────────────┬─────────────────────────────────────────┤
│   客户端 (Electron + React)   │   服务端 (NestJS + PostgreSQL)          │
├──────────────────────────────┼─────────────────────────────────────────┤
│                              │                                         │
│  ┌────────────────────────┐  │  ┌───────────────────────────────────┐  │
│  │  工作流编辑器           │  │  │  工作流管理服务                    │  │
│  │  · React Flow画布       │  │  │  · CRUD API                       │  │
│  │  · 节点拖拽编排         │──┼─▶│  · 版本管理                        │  │
│  │  · 属性面板编辑         │  │  │  · 导入/导出                       │  │
│  │  · 校验/撤销/自动保存   │◀─┼──│  · 权限控制                        │  │
│  └────────────────────────┘  │  └───────────────────────────────────┘  │
│                              │                                         │
│  ┌────────────────────────┐  │  ┌───────────────────────────────────┐  │
│  │  本地执行引擎           │  │  │  云端执行引擎                      │  │
│  │  · 代码执行(code_runner)│  │  │  · 拓扑排序调度                    │  │
│  │  · 文件操作(file_output)│──┼─▶│  · 节点执行器路由                  │  │
│  │  · 通知推送             │  │  │  · Agent/MCP/Skill等节点           │  │
│  └────────────────────────┘  │  │  · 错误重试/超时控制               │  │
│                              │  │  · 流式输出(SSE)                   │  │
│  ┌────────────────────────┐  │  └───────────────────────────────────┘  │
│  │  运行交互界面           │  │                                         │
│  │  · 测试运行面板         │  │  ┌───────────────────────────────────┐  │
│  │  · 实时状态/日志展示    │◀─┼──│  触发器服务                        │  │
│  │  · 单节点调试           │  │  │  · Cron定时任务                    │  │
│  │  · 批量运行管理         │  │  │  · Webhook接收                     │  │
│  └────────────────────────┘  │  │  · 事件监听                         │  │
│                              │  └───────────────────────────────────┘  │
│  ┌────────────────────────┐  │                                         │
│  │  监控仪表板             │  │  ┌───────────────────────────────────┐  │
│  │  · 运行统计图表         │◀─┼──│  监控告警服务                      │  │
│  │  · 异常告警展示         │  │  │  · 指标采集(Prometheus风格)        │  │
│  │  · 日志检索             │  │  │  · 阈值告警                        │  │
│  └────────────────────────┘  │  │  · 多渠道通知(系统/邮件)            │  │
│                              │  └───────────────────────────────────┘  │
│  ┌────────────────────────┐  │                                         │
│  │  权限/团队管理          │  │  ┌───────────────────────────────────┐  │
│  │  · 角色分配             │──┼─▶│  模板市场服务                      │  │
│  │  · 共享管理             │  │  │  · 模板CRUD                       │  │
│  │  · 团队协作             │  │  │  · 模板使用/评分                   │  │
│  └────────────────────────┘  │  └───────────────────────────────────┘  │
│                              │                                         │
└──────────────────────────────┴─────────────────────────────────────────┘

数据流向:
  客户端 ──REST API──▶ 服务端工作流管理(CRUD/版本/权限)
  客户端 ──SSE◀────── 服务端执行引擎(实时状态/流式输出)
  客户端 ──REST API──▶ 服务端执行引擎(触发运行/测试/批量)
  服务端执行引擎 ──IPC/HTTP──▶ 客户端本地执行器(code_runner/file_output等)
```

### 3.2 技术选型

| 层级 | 技术 | 版本 | 用途 | 状态 |
|-----|------|------|------|-----|
| 前端画布 | React Flow | 12.x | 节点拖拽、连线、画布渲染 | ✅ 已集成 |
| 前端状态 | Zustand | 5.x | 编辑器状态、运行状态 | ✅ 已集成 |
| UI框架 | Tailwind CSS + Lucide | 4.x | 样式、图标 | ✅ 已集成 |
| 动画 | Framer Motion | 11.x | 节点动画、连线特效 | ✅ 已集成 |
| 后端框架 | NestJS | 11.x | 模块化服务端 | ✅ 已集成 |
| ORM | Prisma | 6.x | 数据库操作 | ✅ 已集成 |
| 数据库 | PostgreSQL | 16+ | 持久化存储 | ✅ 已集成 |
| 缓存/队列 | Redis + BullMQ | 7.x / 5.x | Chat会话缓存、异步任务队列 | ✅ 已集成 |
| 事件总线 | @nestjs/event-emitter | 3.x | 工作流事件通知 | ✅ 已集成 |
| 实时通信 | SSE (Server-Sent Events) | - | 流式输出、实时状态推送 | 🆕 需新增 |
| 定时任务 | @nestjs/schedule | 5.x | Cron触发器 | 🆕 需新增 |
| 任务调度 | BullMQ | 5.x | 工作流异步执行 | 🔄 复用现有 |

### 3.3 执行引擎分层架构

```
┌──────────────────────────────────────────────────┐
│              Workflow Execution Engine            │
├──────────────────────────────────────────────────┤
│  调度层 (Orchestrator)                            │
│  · 拓扑排序 (Topological Sort)                    │
│  · DAG 校验 (环检测 + 连通性)                     │
│  · 并行分支调度 (parallel/merge)                   │
│  · 条件分支路由 (condition/switch_case)            │
│  · 循环控制 (loop)                                │
├──────────────────────────────────────────────────┤
│  执行层 (Node Executors)                          │
│  · Agent任务执行器 → 调用 AgentService             │
│  · 工具调用执行器 → 调用 ToolRegistry              │
│  · MCP服务执行器 → 调用 McpService                 │
│  · 代码执行器 → 本地(client)/远程(server)沙箱      │
│  · HTTP请求执行器 → 原生fetch                      │
│  · 知识库查询执行器 → 调用 KnowledgeSearch         │
│  · 变量操作执行器 → 上下文管理                      │
│  · 数据转换执行器 → 表达式引擎                      │
│  · 延时执行器 → setTimeout/scheduler               │
│  · 交互节点执行器 → 暂停等待用户输入                 │
├──────────────────────────────────────────────────┤
│  基础设施层 (Infrastructure)                       │
│  · 变量上下文 (VariableContext)                    │
│  · 错误处理 (RetryPolicy + ErrorHandler)           │
│  · 超时控制 (per-node timeout)                     │
│  · 日志记录 (execution log)                        │
│  · 状态机 (RunStatus: PENDING→RUNNING→COMPLETED)   │
│  · 事件发射 (node:start/node:complete/run:failed)  │
└──────────────────────────────────────────────────┘
```

---

## 四、功能模块详细设计

### 4.1 模块全景图

```
工作流平台
├── M1: 后端基础设施 (Phase 1, P0)
│   ├── 数据库表设计 (Prisma Schema)
│   ├── WorkflowModule (NestJS)
│   ├── CRUD API + 导入导出
│   └── 客户端API适配层 (替换localStorage)
│
├── M2: 执行引擎 (Phase 2, P0)
│   ├── 拓扑排序 + DAG校验
│   ├── 节点执行器注册与路由
│   ├── Agent/Tool/MCP/HTTP/Knowledge执行器
│   ├── 变量上下文管理
│   ├── 错误重试 + 超时控制
│   ├── Chat工作流会话状态管理
│   └── SSE流式输出通道
│
├── M3: 测试与运行 (Phase 3, P0)
│   ├── 测试运行 API + UI
│   ├── 实时状态推送 (SSE)
│   ├── 单节点测试
│   ├── 批量运行
│   ├── 触发方式(手动/API/Cron/Webhook)
│   └── 运行日志存储与检索
│
├── M4: 版本管理与发布 (Phase 4, P1)
│   ├── 工作流状态机 (草稿→测试→已发布→已下架)
│   ├── 版本快照 (全量JSON)
│   ├── 版本对比 (节点diff)
│   ├── 版本回滚
│   └── 发布流程 + 备注
│
├── M5: 监控告警 (Phase 5, P1)
│   ├── 运行指标采集
│   ├── 监控仪表板 API
│   ├── 阈值告警 (失败率/超时)
│   ├── 多渠道通知
│   └── 日志检索与导出
│
├── M6: 权限管理 (Phase 6, P1)
│   ├── RBAC角色模型
│   ├── 工作流共享
│   ├── 团队管理
│   └── 权限守卫(Guard)
│
├── M7: 模板市场 (Phase 7, P2)
│   ├── 内置模板库
│   ├── 模板CRUD + 市场UI
│   └── 模板使用统计
│
└── M8: UI/UX增强 (Phase 8, P2)
    ├── 新手引导
    ├── 节点帮助文档
    ├── 快捷键优化
    └── 性能优化
```

### 4.2 M1: 后端基础设施

#### 4.2.1 数据库表设计

基于现有Prisma Schema风格（nanoid主键、Timestamptz时间、Cascade删除），设计以下表：

```prisma
// ========== 工作流定义表 ==========
model WorkflowDefinition {
  id            String   @id @default(nanoid(12))
  name          String
  nameZh        String?
  description   String   @default("")
  descriptionZh String?
  type          WorkflowType @default(WORKFLOW)
  version       String   @default("1.0.0")
  authorId      String
  author        User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  category      String?  // 用户自定义分类
  tags          String[] @default([])
  icon          String?
  thumbnail     String?

  // 工作流核心数据 (JSON)
  nodes         Json     // WorkflowNodeV2[]
  edges         Json     // WorkflowEdgeV2[]
  variables     Json     @default("[]") // WorkflowVariable[]
  inputSchema   Json?    // Record<string, WorkflowInputParam>

  // 状态管理
  status        WorkflowStatus @default(DRAFT)
  isPublic      Boolean  @default(false)
  isTemplate    Boolean  @default(false)

  // 关联
  versions      WorkflowVersion[]
  runs          WorkflowRun[]
  permissions   WorkflowPermission[]
  triggers      WorkflowTrigger[]

  createdAt     DateTime @default(now()) @db.Timestamptz
  updatedAt     DateTime @updatedAt @db.Timestamptz

  @@index([authorId])
  @@index([type])
  @@index([status])
  @@index([createdAt])
  @@map("workflow_definitions")
}

// ========== 工作流版本表 ==========
model WorkflowVersion {
  id          String   @id @default(nanoid(12))
  workflowId  String
  workflow    WorkflowDefinition @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  version     String   // 语义化版本, 如 "1.0.0"
  note        String?  // 发布备注
  nodes       Json
  edges       Json
  variables   Json     @default("[]")
  inputSchema Json?
  createdBy   String
  createdAt   DateTime @default(now()) @db.Timestamptz

  @@index([workflowId])
  @@index([workflowId, version])
  @@map("workflow_versions")
}

// ========== 工作流运行记录表 ==========
model WorkflowRun {
  id             String   @id @default(nanoid(16))
  workflowId     String
  workflow       WorkflowDefinition @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  workflowName   String   // 运行时的快照名称，避免工作流改名后历史记录混乱
  workflowNameZh String?
  version        String
  status         WorkflowRunStatus @default(PENDING)
  startedAt      DateTime @default(now()) @db.Timestamptz
  completedAt    DateTime? @db.Timestamptz
  currentNodeId  String?
  variables      Json     @default("{}")  // 运行时变量快照
  input          Json?    // 输入参数
  output         Json?    // 最终输出
  error          String?
  triggerType    WorkflowTriggerType @default(MANUAL)
  triggeredBy    String?  // 触发用户ID
  threadId       String?  // Chat工作流会话ID
  durationMs     Int?     // 总耗时(毫秒)

  nodeResults    WorkflowNodeResult[]

  @@index([workflowId])
  @@index([status])
  @@index([startedAt])
  @@index([triggeredBy])
  @@index([threadId])
  @@map("workflow_runs")
}

// ========== 节点执行结果表 ==========
model WorkflowNodeResult {
  id          String   @id @default(nanoid(16))
  runId       String
  run         WorkflowRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  nodeId      String
  nodeName    String
  nodeType    String
  status      NodeExecutionStatus
  startedAt   DateTime @db.Timestamptz
  completedAt DateTime @db.Timestamptz
  input       Json?    // 节点输入
  output      Json?    // 节点输出
  error       String?
  durationMs  Int

  @@index([runId])
  @@index([nodeId])
  @@map("workflow_node_results")
}

// ========== 工作流权限表 ==========
model WorkflowPermission {
  id          String   @id @default(nanoid(12))
  workflowId  String
  workflow    WorkflowDefinition @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  userId      String?
  user        User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  teamId      String?
  role        WorkflowRole
  grantedAt   DateTime @default(now()) @db.Timestamptz
  grantedBy   String

  @@index([workflowId])
  @@index([userId])
  @@index([teamId])
  @@unique([workflowId, userId])
  @@map("workflow_permissions")
}

// ========== 工作流模板表 ==========
model WorkflowTemplate {
  id            String   @id @default(nanoid(12))
  name          String
  nameZh        String?
  description   String   @default("")
  descriptionZh String?
  type          WorkflowType
  category      String?
  icon          String?
  thumbnail     String?
  nodes         Json
  edges         Json
  variables     Json     @default("[]")
  inputSchema   Json?
  tags          String[] @default([])
  isOfficial    Boolean  @default(false) // 官方模板 vs 用户分享
  usageCount    Int      @default(0)
  rating        Float?   // 评分
  createdBy     String
  createdAt     DateTime @default(now()) @db.Timestamptz
  updatedAt     DateTime @updatedAt @db.Timestamptz

  @@index([type])
  @@index([category])
  @@index([isOfficial])
  @@index([usageCount])
  @@map("workflow_templates")
}

// ========== 触发器表 ==========
model WorkflowTrigger {
  id              String   @id @default(nanoid(12))
  workflowId      String
  workflow        WorkflowDefinition @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  name            String
  type            TriggerType
  config          Json     // Cron表达式 / Webhook路径+密钥 / 事件类型
  isEnabled       Boolean  @default(true)
  lastTriggeredAt DateTime? @db.Timestamptz
  lastError       String?
  createdBy       String
  createdAt       DateTime @default(now()) @db.Timestamptz
  updatedAt       DateTime @updatedAt @db.Timestamptz

  @@index([workflowId])
  @@index([type, isEnabled])
  @@map("workflow_triggers")
}

// ========== Chat会话状态表 (Redis为主, PG为持久化备份) ==========
model ChatSession {
  id           String   @id @default(nanoid(16))
  workflowId   String
  workflowDef  WorkflowDefinition @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  threadId     String   @unique // 对应WorkflowRun.threadId
  title        String?
  state        Json     @default("{}") // 会话变量快照
  messageCount Int      @default(0)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now()) @db.Timestamptz
  updatedAt    DateTime @updatedAt @db.Timestamptz

  @@index([workflowId])
  @@index([userId])
  @@index([threadId])
  @@map("chat_sessions")
}

// ========== 枚举定义 ==========
enum WorkflowType {
  WORKFLOW
  CHAT
  RAG
}

enum WorkflowStatus {
  DRAFT       // 草稿
  TESTING     // 测试中
  PUBLISHED   // 已发布
  ARCHIVED    // 已下架
}

enum WorkflowRunStatus {
  PENDING     // 等待执行
  RUNNING     // 执行中
  PAUSED      // 已暂停(等待交互)
  COMPLETED   // 已完成
  FAILED      // 已失败
  CANCELLED   // 已取消
}

enum NodeExecutionStatus {
  PENDING
  RUNNING
  SUCCESS
  FAILED
  SKIPPED
}

enum WorkflowTriggerType {
  MANUAL    // 手动触发
  API       // API触发
  CRON      // 定时触发
  WEBHOOK   // webhook触发
  EVENT     // 事件触发
}

enum WorkflowRole {
  VIEWER    // 查看者
  EDITOR    // 编辑者
  ADMIN     // 管理员
}

enum TriggerType {
  CRON
  WEBHOOK
  EVENT
}
```

#### 4.2.2 NestJS 模块结构

```
src/modules/workflow/
├── workflow.module.ts              # 模块定义，注册所有子模块
├── workflow.controller.ts          # REST API 控制器
├── workflow.service.ts             # 核心业务逻辑
├── dto/
│   ├── create-workflow.dto.ts      # 创建工作流 DTO + Validation
│   ├── update-workflow.dto.ts      # 更新工作流 DTO
│   ├── workflow-query.dto.ts       # 列表查询 DTO (分页/筛选/排序)
│   ├── workflow-run.dto.ts         # 运行请求 DTO
│   ├── workflow-batch.dto.ts       # 批量运行 DTO
│   └── workflow-version.dto.ts     # 版本管理 DTO
├── executor/
│   ├── workflow-executor.service.ts    # 核心执行引擎
│   ├── execution-context.ts            # 执行上下文 (变量/状态/日志)
│   ├── topology-sorter.ts              # 拓扑排序 + DAG校验
│   ├── node-executor-registry.ts       # 节点执行器注册表
│   ├── executors/
│   │   ├── base.executor.ts            # 基础执行器抽象类
│   │   ├── agent-task.executor.ts      # 智能体任务执行器
│   │   ├── agent-group.executor.ts     # 智能体协作组执行器
│   │   ├── sub-workflow.executor.ts    # 子工作流调用执行器
│   │   ├── tool-call.executor.ts       # 工具调用执行器
│   │   ├── mcp-service.executor.ts     # MCP服务执行器
│   │   ├── code-runner.executor.ts     # 代码执行器 (客户端执行)
│   │   ├── http-request.executor.ts    # HTTP请求执行器
│   │   ├── knowledge-query.executor.ts # 知识库查询执行器
│   │   ├── variable-set.executor.ts    # 变量设置执行器
│   │   ├── data-transform.executor.ts  # 数据转换执行器
│   │   ├── condition.executor.ts       # 条件分支执行器
│   │   ├── switch-case.executor.ts     # 多路分支执行器
│   │   ├── loop.executor.ts            # 循环执行器
│   │   ├── parallel.executor.ts        # 并行执行器
│   │   ├── merge.executor.ts           # 合并执行器
│   │   ├── delay.executor.ts           # 延时执行器
│   │   ├── output.executor.ts          # 输出类节点执行器
│   │   ├── interaction.executor.ts     # 交互类节点执行器
│   │   └── index.ts
│   └── types.ts                    # 执行器类型定义
├── trigger/
│   ├── trigger.service.ts          # 触发器管理
│   ├── trigger.controller.ts       # 触发器API
│   ├── cron-trigger.service.ts     # Cron触发器
│   ├── webhook-trigger.service.ts  # Webhook触发器
│   └── event-trigger.service.ts    # 事件触发器
├── version/
│   ├── version.service.ts          # 版本管理
│   └── version.controller.ts       # 版本API
├── monitoring/
│   ├── monitor.service.ts          # 监控指标采集
│   ├── monitor.controller.ts       # 监控API
│   ├── alert.service.ts            # 告警服务
│   └── alert.controller.ts         # 告警配置API
├── permission/
│   ├── permission.service.ts       # 权限管理
│   ├── permission.controller.ts    # 权限API
│   └── workflow-permission.guard.ts # 权限守卫
├── template/
│   ├── template.service.ts         # 模板管理
│   ├── template.controller.ts      # 模板API
│   └── builtin-templates/          # 内置模板数据
│       ├── batch-translate.json
│       ├── smart-customer-service.json
│       ├── knowledge-qa.json
│       ├── data-process.json
│       └── content-generator.json
└── chat/
    ├── chat-session.service.ts     # Chat会话管理
    └── chat-session.gateway.ts     # SSE实时推送网关
```

#### 4.2.3 客户端API适配层

新建 `src/shared/configuration/workflows/workflowClientAPI.ts`，将现有localStorage操作替换为HTTP API调用，实现平滑迁移：

```typescript
// 核心思路: 保持原有 persistence 接口签名不变，内部实现切换
// 迁移策略: 客户端启动时批量同步 localStorage → PostgreSQL
//          日常操作直接走 API，localStorage作为离线缓存备份

interface WorkflowClientAPI {
  // CRUD
  list(query?: WorkflowQuery): Promise<WorkflowDefinitionV2[]>
  get(id: string): Promise<WorkflowDefinitionV2 | null>
  create(data: CreateWorkflowDTO): Promise<WorkflowDefinitionV2>
  update(id: string, data: UpdateWorkflowDTO): Promise<WorkflowDefinitionV2>
  delete(id: string): Promise<void>
  duplicate(id: string): Promise<WorkflowDefinitionV2>

  // 运行
  testRun(id: string, input: Record<string, unknown>): Promise<WorkflowRunV2>
  run(id: string, input: Record<string, unknown>): Promise<WorkflowRunV2>
  batchRun(id: string, inputs: Record<string, unknown>[]): Promise<WorkflowRunV2[]>
  cancelRun(runId: string): Promise<void>
  retryRun(runId: string): Promise<WorkflowRunV2>

  // 运行记录
  getRuns(workflowId: string): Promise<WorkflowRunV2[]>
  getRunDetail(runId: string): Promise<WorkflowRunV2>

  // 版本
  getVersions(workflowId: string): Promise<WorkflowVersion[]>
  getVersion(workflowId: string, versionId: string): Promise<WorkflowVersion>
  restoreVersion(workflowId: string, versionId: string): Promise<WorkflowDefinitionV2>

  // SSE订阅
  subscribeRunStatus(runId: string, onEvent: (event: RunEvent) => void): () => void
}
```

---

### 4.3 M2: 执行引擎

#### 4.3.1 执行流程

```
1. 接收运行请求 → 创建 WorkflowRun(PENDING)
2. 拓扑排序节点 → 生成执行计划 (ExecutionPlan)
3. 校验DAG → 检测环、孤立节点
4. 更新状态 RUNNING，初始化 ExecutionContext
5. 按执行计划逐节点执行:
   ┌─ 6.1 解析节点输入 → 从上下文中获取上游节点输出
   ├─ 6.2 调用对应 NodeExecutor.execute(node, context)
   ├─ 6.3 记录 WorkflowNodeResult
   ├─ 6.4 推SSE事件 (node:start / node:complete / node:error)
   ├─ 6.5 错误处理 → 根据ErrorHandlerConfig决定重试/跳过/中止/跳转
   └─ 6.6 写入变量到上下文 → 供下游节点引用
7. 所有节点完成 → COMPLETED，写入最终输出
   异常终止 → FAILED，记录错误
8. 触发完成事件 → 通知监控/告警模块
9. 清理临时资源
```

#### 4.3.2 节点执行器接口

```typescript
// executor/types.ts
interface NodeExecutorContext {
  runId: string
  workflowId: string
  variables: Record<string, unknown>    // 运行时变量池
  nodeResults: Map<string, WorkflowNodeResultV2>
  signal: AbortSignal                    // 取消信号
  emitEvent: (event: ExecutionEvent) => void
  getNodeOutput: (nodeId: string) => unknown
  setVariable: (name: string, value: unknown) => void
  isChatWorkflow: boolean
  threadId?: string
  sessionState?: Record<string, unknown> // Chat工作流会话状态
}

interface NodeExecutorInput {
  node: WorkflowNodeV2
  context: NodeExecutorContext
}

interface NodeExecutorOutput {
  success: boolean
  data?: unknown
  error?: string
  nextNodes?: string[]  // 用于条件/switch分支，指定下一步执行哪些节点
}

abstract class BaseNodeExecutor {
  abstract readonly nodeType: WorkflowNodeTypeV2

  abstract execute(input: NodeExecutorInput): Promise<NodeExecutorOutput>

  // 子类可重写
  validate(input: NodeExecutorInput): string | null { return null }  // null = 通过
  prepare(input: NodeExecutorInput): Promise<NodeExecutorInput> { return input }
  cleanup(input: NodeExecutorInput, output: NodeExecutorOutput): Promise<void> {}
}
```

#### 4.3.3 执行器与现有模块的集成映射

| 执行器 | 依赖的现有模块 | 集成方式 |
|--------|--------------|---------|
| AgentTaskExecutor | `AgentService` | 注入调用 `agentService.executeTask()` |
| AgentGroupExecutor | `AgentService` | 多次调用 + 协作策略 |
| SubWorkflowExecutor | `WorkflowService` | 递归调用 `executeWorkflow()` |
| ToolCallExecutor | `ToolRegistry` | 注入调用 `toolRegistry.execute()` |
| McpServiceExecutor | `McpService` | 注入调用 `mcpService.callTool()` |
| CodeRunnerExecutor | 客户端IPC | 通过HTTP通知客户端本地执行沙箱 |
| HttpRequestExecutor | 无(原生) | 服务端fetch |
| KnowledgeQueryExecutor | `KnowledgeSearch` | 注入调用知识库检索 |
| VariableSetExecutor | 无(上下文操作) | 直接操作ExecutionContext |
| DataTransformExecutor | 表达式引擎 | jmespath/jsonpath |
| ConditionExecutor | 无(逻辑判断) | 比较上下文变量 |
| SwitchCaseExecutor | 无(路由分发) | 匹配case分发 |
| LoopExecutor | 递归调用执行引擎 | 迭代子图 |
| ParallelExecutor | Promise.all | 并发执行各分支 |
| MergeExecutor | 无(等待收集) | 等待所有分支完成 |
| DelayExecutor | setTimeout | 延时后继续 |
| InteractionExecutor | SSE暂停/恢复 | 暂停执行，等待用户交互后恢复 |

#### 4.3.4 Chat工作流特殊处理

```
Chat工作流执行特点:
- 每次用户消息触发一次执行
- 会话状态通过 threadId 关联
- 会话变量跨轮次持久化 (Redis + 定期刷PG)
- sys.query: 用户当前输入
- sys.conversation_id: 会话标识 (threadId)
- sys.files: 用户上传文件列表
- 流式输出: 通过SSE将Answer节点的输出实时推送到客户端

Chat执行流程:
用户消息 → 创建/获取ChatSession → 设置sys.*变量 →
执行工作流(从start到answer) → 流式返回answer输出 →
更新会话状态 → 等待下一条用户消息
```

---

### 4.4 M3: 测试与运行

#### 4.4.1 测试运行流程

| 功能 | Dify FRD要求 | 实现策略 |
|-----|-------------|---------|
| 测试参数输入 | 与Start节点输入类型一致 | 客户端解析inputSchema，动态生成输入表单 |
| 实时节点状态 | 待执行/执行中/成功/失败 | SSE推送 `node:start/node:complete/node:error` |
| 执行日志 | 节点输入输出/执行时间 | 服务端全量记录，客户端按需拉取 |
| 单节点测试 | 选中节点单独测试 | `/workflows/:id/nodes/:nodeId/test` API |
| 暂停/终止 | 暂停后可恢复，终止清空状态 | AbortController + run状态机 |

#### 4.4.2 触发方式矩阵

| 触发方式 | 常规工作流 | Chat工作流 | RAG Pipeline | 实现方式 |
|---------|----------|----------|-------------|---------|
| 手动触发(UI) | ✅ | ✅ | ✅ | 客户端按钮 → API |
| API调用 | ✅ | ✅ | ✅ | REST端点 + API Key验证 |
| Cron定时 | ✅ | ❌ | ✅ | `@nestjs/schedule` + BullMQ |
| Webhook | ✅ | ❌ | ✅ | HTTP端点 + 签名验证 |
| 事件触发 | ✅ | ❌ | ❌ | EventEmitter监听 |
| 用户消息 | ❌ | ✅ | ❌ | Chat session自动触发 |
| 批量运行 | ✅ | ❌ | ✅ | 批量API + 并发控制 |

#### 4.4.3 SSE事件协议

```
事件流格式 (text/event-stream):

event: run:start
data: {"runId":"xxx","status":"RUNNING","startedAt":"..."}

event: node:start
data: {"runId":"xxx","nodeId":"yyy","nodeName":"智能体任务","nodeType":"agent_task"}

event: node:complete
data: {"runId":"xxx","nodeId":"yyy","status":"SUCCESS","output":{...},"durationMs":1234}

event: node:error
data: {"runId":"xxx","nodeId":"yyy","status":"FAILED","error":"LLM调用超时","retrying":true}

event: chat:token
data: {"runId":"xxx","nodeId":"yyy","token":"你好","isStreaming":true}

event: run:paused
data: {"runId":"xxx","pauseReason":"等待用户审批","pauseNodeId":"yyy"}

event: run:complete
data: {"runId":"xxx","status":"COMPLETED","output":{...},"durationMs":5678}

event: run:error
data: {"runId":"xxx","status":"FAILED","error":"...","failedNodeId":"yyy"}
```

---

### 4.5 M4: 版本管理与发布

#### 4.5.1 工作流状态机

```
         ┌──────────┐
         │   DRAFT  │ ← 创建/编辑
         └────┬─────┘
              │ 开始测试
              ▼
         ┌──────────┐
         │ TESTING  │ ← 测试运行通过
         └────┬─────┘
              │ 发布
              ▼
         ┌──────────┐
   ┌────▶│ PUBLISHED│
   │     └────┬─────┘
   │          │ 下架
   │          ▼
   │     ┌──────────┐
   │     │ ARCHIVED │
   │     └────┬─────┘
   │          │ 重新发布
   └──────────┘
```

#### 4.5.2 版本管理策略

- 每次**发布**操作自动创建版本快照（全量JSON）
- 编辑保存不创建版本（仅在草稿状态修改）
- 保留最近30个版本，超出自动清理
- 版本回滚：将历史版本的nodes/edges/variables覆盖当前草稿
- 版本对比：前端实现节点级别的diff对比

#### 4.5.3 发布流程

```
1. 校验：工作流完整性、节点连接、必填参数
2. 生成版本号：主版本.次版本.修订号 (如 1.0.0 → 1.1.0)
3. 创建 WorkflowVersion 快照
4. 更新 WorkflowDefinition.status → PUBLISHED
5. 同步更新触发器状态 (启用已配置的Cron/Webhook)
6. 记录审计日志
7. 通知协作成员
```

---

### 4.6 M5: 监控告警

#### 4.6.1 指标体系

| 指标 | 采集方式 | 存储 | 可视化 |
|-----|---------|------|-------|
| 今日执行次数 | 每次运行计数 | PG聚合查询 | 仪表板卡片 |
| 成功率/失败率 | 运行完成时统计 | PG + Redis实时计数 | 趋势图 |
| 平均执行时长 | 运行完成时计算 | PG存储 | 趋势图 |
| 节点耗时分布 | 节点完成时记录 | PG存储 | 柱状图 |
| 并发运行数 | Redis实时计数 | Redis | 仪表板 |
| 资源占用(CPU/内存) | 系统指标采集 | Prometheus兼容 | Grafana(可选) |

#### 4.6.2 告警规则

| 告警类型 | 触发条件 | 检查频率 | 通知方式 |
|---------|---------|---------|---------|
| 失败率过高 | 最近1h失败率 > 阈值(默认10%) | 每5分钟 | 系统消息 + 邮件 |
| 执行超时 | 运行时长 > 阈值(可配置) | 实时 | 系统消息 |
| 节点连续失败 | 同一节点连续3次失败 | 实时 | 系统消息 |
| 触发器异常 | Cron触发失败/webhook不可达 | 触发时 | 系统消息 |

#### 4.6.3 日志管理

- 运行日志保留90天 (WorkflowRun + WorkflowNodeResult)
- 支持按工作流ID、状态、时间范围、触发器类型检索
- 日志导出：JSON格式全量导出
- 日志清理：定时任务清理90天前数据

---

### 4.7 M6: 权限管理

#### 4.7.1 RBAC角色模型

| 角色 | 权限 |
|-----|------|
| **管理员 (ADMIN)** | 全部权限：创建、编辑、测试、发布、删除、权限分配、监控 |
| **编辑者 (EDITOR)** | 创建、编辑、测试、保存、导出、查看运行记录 |
| **查看者 (VIEWER)** | 查看工作流、查看运行记录、查看日志 |

权限控制层级：
1. 所有者（authorId）：天然ADMIN
2. 角色分配（WorkflowPermission）：ADMIN/EDITOR/VIEWER
3. 团队继承：团队成员默认获得团队共享权限
4. Guard实现：NestJS `@Roles()` 装饰器 + `WorkflowPermissionGuard`

#### 4.7.2 共享机制

- 工作流共享：将工作流共享给指定用户或团队
- 共享时可选择权限级别
- 共享可随时撤回
- 团队工作流：团队管理员可将工作流共享给整个团队

---

### 4.8 M7: 模板市场

#### 4.8.1 内置模板

| 模板名称 | 类型 | 节点数 | 说明 |
|---------|-----|-------|------|
| 批量翻译 | WORKFLOW | 4 | start + http_request + agent_task + text_output |
| 智能客服 | CHAT | 5 | start + condition + agent_task + knowledge_query + answer |
| 知识库问答 | RAG | 4 | start + knowledge_query + agent_task + text_output |
| 数据处理管道 | WORKFLOW | 5 | start + http_request + data_transform + condition + text_output |
| 内容生成器 | WORKFLOW | 4 | start + agent_task + data_transform + text_output |
| 审批流程 | WORKFLOW | 5 | start + agent_task + user_approval + condition + notification |
| 多语言客服 | CHAT | 6 | start + condition + agent_task + agent_group + data_transform + answer |
| 定时报告 | WORKFLOW | 5 | start + knowledge_query + data_transform + agent_task + notification |

#### 4.8.2 模板市场功能

- 官方模板：内置8个，不可编辑
- 用户模板：用户可将自己的工作流发布为模板
- 模板使用：选择模板→自动创建工作流副本
- 模板评分/使用统计
- 模板搜索/分类/标签

---

### 4.9 M8: UI/UX增强

#### 4.9.1 新手引导

```
第一步：欢迎介绍 → "工作流是什么，能做什么"
第二步：创建第一个工作流 → 选择模板或空白创建
第三步：节点拖拽 → "从左侧拖一个节点到画布"
第四步：连接节点 → "点击节点底部圆点，拖到下一个节点"
第五步：配置参数 → "选中节点，右侧面板配置"
第六步：测试运行 → "点击运行按钮，查看结果"
```

#### 4.9.2 节点帮助系统

- 每种节点右侧面板顶部显示帮助提示
- 帮助内容：节点功能说明、参数说明、输出格式、使用示例
- 节点库搜索：支持中文/英文搜索节点名称

---

## 五、API 完整设计

### 5.1 工作流 CRUD (Base: `/api/workflows`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | 获取工作流列表(分页/筛选/排序) |
| GET | `/:id` | ✅ | 获取工作流详情 |
| POST | `/` | ✅ | 创建工作流 |
| PUT | `/:id` | ✅ | 更新工作流(草稿状态) |
| DELETE | `/:id` | ✅ | 删除工作流 |
| POST | `/:id/duplicate` | ✅ | 复制工作流 |
| POST | `/:id/publish` | ✅ | 发布工作流 → 创建版本快照 |
| POST | `/:id/archive` | ✅ | 下架工作流 |
| POST | `/:id/export` | ✅ | 导出工作流JSON |
| POST | `/import` | ✅ | 导入工作流JSON |

### 5.2 工作流运行 (Base: `/api/workflows/:id`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/:id/test` | ✅ | 测试运行 |
| POST | `/:id/run` | ✅ | 正式运行 |
| POST | `/:id/batch` | ✅ | 批量运行 |
| GET | `/:id/runs` | ✅ | 获取运行记录列表 |
| GET | `/:id/runs/stats` | ✅ | 获取运行统计 |
| GET | `/runs/:runId` | ✅ | 获取运行详情(含节点结果) |
| GET | `/runs/:runId/stream` | ✅ | SSE订阅运行实时状态 |
| POST | `/runs/:runId/cancel` | ✅ | 取消运行 |
| POST | `/runs/:runId/retry` | ✅ | 重试运行 |
| POST | `/runs/:runId/resume` | ✅ | 恢复暂停的运行(交互类) |
| POST | `/:id/nodes/:nodeId/test` | ✅ | 单节点测试 |

### 5.3 版本管理 (Base: `/api/workflows/:id/versions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | 获取版本历史列表 |
| GET | `/:versionId` | ✅ | 获取指定版本详情 |
| GET | `/:versionId/diff` | ✅ | 版本对比(返回diff数据) |
| POST | `/:versionId/restore` | ✅ | 回滚到指定版本 |

### 5.4 触发器管理 (Base: `/api/workflows/:id/triggers`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | 获取触发器列表 |
| POST | `/` | ✅ | 创建触发器 |
| PUT | `/:triggerId` | ✅ | 更新触发器 |
| DELETE | `/:triggerId` | ✅ | 删除触发器 |
| POST | `/:triggerId/toggle` | ✅ | 启用/禁用触发器 |

### 5.5 权限管理 (Base: `/api/workflows/:id/permissions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | 获取权限列表 |
| POST | `/` | ✅ | 添加权限(共享给用户/团队) |
| PUT | `/:permId` | ✅ | 修改权限角色 |
| DELETE | `/:permId` | ✅ | 撤销权限 |

### 5.6 模板管理 (Base: `/api/workflow-templates`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | 获取模板列表 |
| GET | `/:id` | ✅ | 获取模板详情 |
| POST | `/` | ✅ | 从工作流创建模板 |
| POST | `/:id/use` | ✅ | 使用模板创建工作流 |
| DELETE | `/:id` | ✅ | 删除模板(仅自己的) |

### 5.7 监控告警 (Base: `/api/workflow-monitor`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard` | ✅ | 监控仪表板数据 |
| GET | `/alerts` | ✅ | 告警列表 |
| GET | `/alerts/config` | ✅ | 告警配置 |
| PUT | `/alerts/config` | ✅ | 更新告警配置 |
| GET | `/logs` | ✅ | 日志检索 |

---

## 六、客户端-服务端通信架构

### 6.1 迁移策略：localStorage → API

```
迁移步骤:
1. 新建 workflowClientAPI.ts (封装所有API调用)
2. 保留 workflowPersistenceV2.ts 的接口签名
3. 内部实现切换为 API 调用，API失败时fallback到localStorage
4. 客户端启动时，自动同步本地数据到服务端
5. 稳定后移除localStorage fallback

迁移期双写策略:
- 写: API成功后同步写入localStorage缓存
- 读: 优先API，失败时读localStorage缓存
```

### 6.2 SSE 实时通信

```
客户端订阅:
const eventSource = new EventSource(`/api/workflows/runs/${runId}/stream?token=${jwt}`)

事件监听:
eventSource.addEventListener('node:start', handler)
eventSource.addEventListener('node:complete', handler)
eventSource.addEventListener('node:error', handler)
eventSource.addEventListener('chat:token', handler)
eventSource.addEventListener('run:complete', handler)

重连策略: 断线自动重连，最多3次，指数退避
```

### 6.3 客户端-本地引擎通信（Electron IPC）

```
对于 code_runner 节点的代码执行:
1. 服务端收到执行请求 → 通知客户端(通过SSE或轮询)
2. 客户端接收通知 → IPC调用主进程执行代码沙箱
3. 代码执行完成 → 客户端将结果回传服务端
4. 服务端继续执行后续节点

安全: 客户端代码在独立沙箱执行，网络隔离，文件系统限制
```

---

## 七、开发规划与时间线

### 7.1 阶段划分与依赖关系

```
Phase 1 (M1: 后端基础设施) ──────────────────────┐
  ↓ 依赖                                          │
Phase 2 (M2: 执行引擎) ──────────────────────────┤
  ↓ 依赖                                          │
Phase 3 (M3: 测试与运行) ───┬── Phase 4 (M4: 版本管理)──┐
                            │                    │
Phase 5 (M5: 监控告警) ─────┤                    │
                            │                    │
Phase 6 (M6: 权限管理) ─────┘                    │
  ↓                                              │
Phase 7 (M7: 模板市场) ───── Phase 8 (M8: UI增强)─┘
```

### 7.2 详细任务拆解与工作量估算

#### Phase 1: 后端基础设施 (P0, 5-6天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 1.1 Prisma Schema设计 | 1天 | 无 | migration.sql + schema更新 |
| 1.2 WorkflowModule骨架 | 0.5天 | 1.1 | module/controller/service基础 |
| 1.3 CRUD API实现 | 1.5天 | 1.2 | create/read/update/delete/duplicate |
| 1.4 DTO + Validation | 0.5天 | 1.3 | class-validator装饰器 |
| 1.5 导入/导出API | 0.5天 | 1.3 | import/export端点 |
| 1.6 客户端API适配层 | 1天 | 1.3 | workflowClientAPI.ts |
| 1.7 迁移脚本(本地→服务端) | 0.5天 | 1.6 | localStorage数据同步 |

#### Phase 2: 执行引擎 (P0, 7-8天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 2.1 拓扑排序 + DAG校验 | 1天 | 1.3 | topology-sorter.ts |
| 2.2 执行引擎核心(Orchestrator) | 1.5天 | 2.1 | workflow-executor.service.ts |
| 2.3 执行上下文管理 | 1天 | 2.2 | execution-context.ts |
| 2.4 BaseNodeExecutor抽象 | 0.5天 | 2.2 | base.executor.ts |
| 2.5 Agent/Tool/MCP执行器 | 1.5天 | 2.4 | 3个executor |
| 2.6 HTTP/Knowledge执行器 | 0.5天 | 2.4 | 2个executor |
| 2.7 流程控制执行器(condition/switch/loop/parallel/merge) | 1.5天 | 2.4 | 5个executor |
| 2.8 变量/数据/延时执行器 | 0.5天 | 2.4 | 3个executor |
| 2.9 Chat会话状态管理 | 1天 | 2.2 | chat-session.service.ts + Redis |
| 2.10 SSE推送基础 | 0.5天 | 2.2 | SSE端点 + EventEmitter桥接 |

#### Phase 3: 测试与运行 (P0, 5-6天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 3.1 测试运行API | 1天 | 2.2 | test endpoint |
| 3.2 正式运行API(手动/API触发) | 1天 | 2.2 | run endpoint |
| 3.3 实时状态SSE推送(全事件) | 1天 | 2.10 | 完整SSE协议 |
| 3.4 单节点测试 | 0.5天 | 2.2 | node-test endpoint |
| 3.5 暂停/终止/重试 | 0.5天 | 2.2 | AbortController集成 |
| 3.6 批量运行 | 1天 | 3.2 | batch endpoint + BullMQ |
| 3.7 运行记录查询API | 0.5天 | 1.3 | runs查询端点 |
| 3.8 客户端运行面板对接 | 1天 | 3.1-3.7 | 前端运行面板更新 |

#### Phase 4: 版本管理与发布 (P1, 4-5天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 4.1 工作流状态机 | 0.5天 | 1.3 | publish/archive端点 |
| 4.2 版本快照创建 | 1天 | 4.1 | version存储逻辑 |
| 4.3 版本列表/详情API | 0.5天 | 4.2 | version查询端点 |
| 4.4 版本对比(diff) | 1天 | 4.2 | diff计算+前端展示 |
| 4.5 版本回滚 | 0.5天 | 4.2 | restore端点 |
| 4.6 版本清理策略 | 0.5天 | 4.2 | 定时清理任务 |
| 4.7 前端版本面板 | 1天 | 4.1-4.5 | 版本管理UI |

#### Phase 5: 监控告警 (P1, 4-5天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 5.1 指标采集服务 | 1天 | 2.2 | monitor.service.ts |
| 5.2 监控仪表板API | 1天 | 5.1 | dashboard端点 |
| 5.3 前端仪表板UI | 1天 | 5.2 | 监控仪表板组件 |
| 5.4 告警规则引擎 | 1天 | 5.1 | alert.service.ts |
| 5.5 告警通知渠道(系统/邮件) | 0.5天 | 5.4 | 邮件发送复用EmailModule |
| 5.6 日志检索与导出 | 0.5天 | 1.3 | logs端点 |

#### Phase 6: 权限管理 (P1, 3-4天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 6.1 角色权限模型 + DB | 0.5天 | 1.1 | WorkflowPermission表 |
| 6.2 权限CRUD API | 1天 | 6.1 | permission端点 |
| 6.3 权限守卫(Guard) | 1天 | 6.1 | workflow-permission.guard.ts |
| 6.4 前端权限UI | 0.5天 | 6.2 | 权限管理面板 |
| 6.5 团队共享 | 0.5天 | 6.2 | 共享逻辑 |

#### Phase 7: 模板市场 (P2, 3-4天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 7.1 模板CRUD API | 1天 | 1.3 | template端点 |
| 7.2 内置模板数据(8个) | 1天 | 无 | 8个JSON模板文件 |
| 7.3 模板市场前端UI | 1天 | 7.1 | 模板浏览/搜索/使用 |
| 7.4 模板评分/统计 | 0.5天 | 7.1 | 使用计数+评分 |

#### Phase 8: UI/UX增强 (P2, 3天)

| 任务 | 工作量 | 依赖 | 产出 |
|-----|-------|------|------|
| 8.1 新手引导流程 | 1天 | 1.6 | 引导组件 |
| 8.2 节点帮助文档 | 0.5天 | 无 | 帮助内容 |
| 8.3 快捷键优化 | 0.5天 | 无 | 快捷键绑定 |
| 8.4 性能优化(虚拟化/懒加载) | 1天 | 无 | 画布性能提升 |

### 7.3 总时间线与里程碑

| 里程碑 | 时间 | 内容 | 验收标准 |
|--------|------|------|---------|
| M0: 启动 | Week 0 | 开发环境准备、Schema设计评审 | Schema通过评审 |
| M1: 后端就绪 | Week 1-2 | Phase 1完成 | CRUD API可用、客户端迁移完成 |
| M2: 引擎就绪 | Week 2-4 | Phase 2完成 | 8种核心执行器可用、拓扑排序正确 |
| M3: 可运行 | Week 4-6 | Phase 3完成 | 测试运行/正式运行/批量运行、SSE推送正常 |
| M4: 可发布 | Week 6-7 | Phase 4完成 | 版本管理/发布流程可用 |
| M5: 可运维 | Week 7-8 | Phase 5完成 | 监控仪表板/告警可用 |
| M6: 可协作 | Week 8-9 | Phase 6完成 | 权限管理/共享可用 |
| M7: 有模板 | Week 9-10 | Phase 7完成 | 8个内置模板可用 |
| M8: 体验优 | Week 10-11 | Phase 8完成 | 新手引导/帮助/优化完成 |

**总计：约11周（约55个工作日），可并行压缩至8-9周**

### 7.4 资源分配建议

| 角色 | 人数 | 负责模块 |
|-----|-----|---------| 
| 后端开发 | 1-2人 | Phase 1-6 后端模块 |
| 前端开发 | 1人 | 客户端API适配层、运行面板、版本面板、仪表板、模板市场UI、新手引导 |
| 全栈/Tech Lead | 1人 | 架构设计、代码审查、执行引擎核心、关键决策 |
| QA | 0.5人 | 测试用例、验收测试 |

---

## 八、风险评估与应对

### 8.1 技术风险

| 风险 | 等级 | 概率 | 影响 | 应对措施 |
|-----|------|------|------|---------|
| 执行引擎复杂度超预期 | 🔴高 | 中 | 进度延误2-3周 | 先实现线性执行(忽略并行)，逐步增强；复杂流程控制先简化实现 |
| 拓扑排序+DAG处理Bug | 🟡中 | 中 | 执行流程错误 | 充分单元测试覆盖所有图结构(链/树/DAG/环)；参考成熟算法(Kahn/Tarjan) |
| Chat会话状态一致性 | 🔴高 | 中 | 会话数据丢失 | Redis做主存储，定期PG持久化；会话超时自动归档 |
| SSE断线/丢事件 | 🟡中 | 中 | 前端状态不一致 | 断线重连+事件序列号+全量状态查询fallback |
| localStorage迁移数据丢失 | 🟡中 | 低 | 用户工作流丢失 | 迁移前备份；双写过渡期；迁移验证 |
| 客户端代码执行安全 | 🔴高 | 中 | 安全漏洞 | 独立沙箱进程；文件系统白名单；网络隔离 |
| 数据库JSON字段查询性能 | 🟢低 | 中 | 列表查询慢 | 关键字段冗余存储(名称/类型/状态)，JSON仅存详细数据 |
| BullMQ任务积压 | 🟡中 | 低 | 批量运行延迟 | 队列监控；消费者自动扩缩；优先级队列 |

### 8.2 进度风险

| 风险 | 等级 | 概率 | 影响 | 应对措施 |
|-----|------|------|------|---------|
| Phase 2-3联调耗时超预期 | 🟡中 | 高 | 1-2周延迟 | 提前定义API契约；前后端并行开发时用Mock |
| 多模块并行开发冲突 | 🟢低 | 中 | 合并冲突 | 模块独立目录；功能开关(Feature Flag)控制 |
| 需求变更 | 🟡中 | 中 | 返工 | FRD冻结；变更走评审流程 |
| 人员不足 | 🔴高 | 中 | 进度严重延误 | 优先级砍Phase 7-8保证核心交付；模板市场延后 |

### 8.3 质量风险

| 风险 | 等级 | 概率 | 影响 | 应对措施 |
|-----|------|------|------|---------|
| 测试覆盖不足 | 🟡中 | 高 | 线上Bug | 执行引擎100%单元测试覆盖；API集成测试 |
| 并发/边界问题 | 🟡中 | 中 | 偶发异常 | 压测100并发；边界值测试 |
| 内存泄漏 | 🟡中 | 低 | 服务不稳定 | 定时GC + 内存监控；BullMQ自动清理 |

---

## 九、非功能需求

### 9.1 性能指标

| 指标 | 目标 | 测量方法 |
|-----|------|---------|
| 工作流列表API | ≤ 200ms | P95延迟 |
| 工作流编辑保存API | ≤ 500ms | P95延迟 |
| 执行引擎启动延迟 | ≤ 200ms | 从API接收到首个节点执行 |
| 单节点切换延迟 | ≤ 100ms | 两个节点之间的调度耗时 |
| Chat工作流首Token延迟 | ≤ 3s | 从用户消息到首个SSE token |
| 并发运行数 | ≥ 100 | 压力测试 |
| 批量处理量 | ≥ 1000条/工作流 | 批量API测试 |
| 连续运行稳定性 | 72h无崩溃 | 长稳测试 |

### 9.2 安全要求

- 所有API端点JWT认证
- 工作流CRUD按authorId + permission隔离
- API Key用于外部触发调用
- HTTP请求节点强制HTTPS(可配置)
- 代码执行节点沙箱隔离
- 敏感数据(输入/输出/日志)加密存储
- API限流(ThrottlerModule复用)

### 9.3 兼容性

- 前端：Chrome/Edge/Firefox最新版 + Safari 15+
- 桌面端：Electron (Windows/MacOS)
- 分辨率：最小1366×768
- API版本：`/api/v1/workflows/...`
- 数据兼容：V1 localStorage工作流可导入

---

## 十、验收标准

### 10.1 功能验收清单

| # | 验收项 | 标准 |
|---|-------|------|
| 1 | 工作流CRUD | 创建/编辑/删除/复制/导入/导出正常 |
| 2 | 3类工作流 | 常规/Chat/RAG均可创建和运行 |
| 3 | 26种节点 | 每种节点可添加到画布、配置参数、正确执行 |
| 4 | 可视化编辑 | 拖拽节点、连线、缩放平移流畅 |
| 5 | 属性编辑器 | 6个Tab参数正确保存和加载 |
| 6 | 流程校验 | 未连接/环/缺参数时有明确提示 |
| 7 | 测试运行 | 测试参数输入→实时状态→完整日志 |
| 8 | 正式运行 | 手动/API/Cron/Webhook触发正常 |
| 9 | 批量运行 | CSV导入→批量执行→结果导出 |
| 10 | Chat工作流 | 多轮对话、会话状态、流式输出 |
| 11 | RAG Pipeline | 知识库检索→生成回答 |
| 12 | 版本管理 | 创建/列表/对比/回滚 |
| 13 | 工作流状态 | 草稿→测试→发布→下架流转 |
| 14 | 监控仪表板 | 执行次数/成功率/耗时图表 |
| 15 | 告警通知 | 失败率超阈值→系统消息+邮件 |
| 16 | 日志检索 | 按时间/状态/ID检索运行日志 |
| 17 | 权限管理 | 角色分配、共享、撤回正常 |
| 18 | 模板市场 | 8个内置模板、模板使用/评分 |
| 19 | 触发器 | Cron/Webhook/事件触发正常 |
| 20 | 新手引导 | 6步引导流程完整可用 |

### 10.2 非功能验收

| # | 验收项 | 标准 |
|---|-------|------|
| 1 | 性能 | 列表API ≤200ms, 保存 ≤500ms, 执行启动 ≤200ms, Chat首Token ≤3s |
| 2 | 并发 | 100并发运行稳定, 1000条批量处理无丢失 |
| 3 | 稳定性 | 72小时连续运行无崩溃, 失败率 ≤1% |
| 4 | 安全 | JWT认证、权限隔离、API密钥、HTTPS、数据加密 |
| 5 | 兼容性 | Chrome/Edge/Firefox/Safari 15+, Windows/MacOS, 1366×768 |
| 6 | 易用性 | 新用户30分钟内完成简单工作流创建和测试运行 |
| 7 | 数据完整性 | 迁移无数据丢失, 版本回滚数据准确 |

---

## 十一、附录

### 附录A: Dify FRD 需求对照详细清单

| FRD需求ID | FRD需求描述 | AweeClaw实现策略 | 状态 |
|-----------|------------|----------------|------|
| 1.1 | 选择3类工作流类型创建 | 创建对话框选择 WORKFLOW/CHAT/RAG | 🆕 待开发 |
| 1.2 | 填写名称(≤50字符)/描述(≤200字符)/分类 | DTO Validation实现 | 🆕 待开发 |
| 1.3 | 从模板创建工作流 | M7模板市场实现 | 🔜 P2 |
| 1.4 | 创建后自动加载基础节点 | 前端创建时自动添加start+end/answer | ✅ 已实现 |
| 2.1 | 左侧节点库+中间画布+右侧参数配置 | 三栏布局已完成 | ✅ 已实现 |
| 2.2 | 17类节点按功能分类+搜索 | 26类节点分类+搜索 | ✅ 已实现 |
| 2.3 | 画布缩放平移/节点拖拽/连线调整 | React Flow原生支持 | ✅ 已实现 |
| 2.4 | 流程逻辑校验+提示 | validation.ts校验 | ✅ 已实现 |
| 2.5 | 自动保存(30秒)+手动保存 | 保存API + 自动保存 | 🔄 部分实现 |
| 2.6 | 历史版本回溯(30天) | M4版本管理 | 🆕 待开发 |
| 3.1 | 保存时校验完整性 | API端校验 | 🔄 部分实现 |
| 3.2 | 导出JSON/PDF | JSON导出已实现, PDF待开发 | 🔄 部分实现 |
| 3.3 | 导入JSON校验 | 已实现 | ✅ 已实现 |
| 3.2.x | 全部17类节点+9类扩展 | 26类节点全部定义 | ✅ 已实现 |
| 3.3.x | 测试运行/正式运行/批量运行 | M3实现 | 🆕 待开发 |
| 3.4.x | 发布/版本管理 | M4实现 | 🆕 待开发 |
| 3.5.x | 监控告警 | M5实现 | 🆕 待开发 |
| 3.6.x | 权限管理 | M6实现 | 🆕 待开发 |
| 3.7.x | 联动功能(LLM/知识库/变量/外部/应用) | 执行器集成现有模块 | 🔄 部分实现 |

### 附录B: 节点执行器开发优先级

为控制执行引擎复杂度，按以下优先级分批次开发：

**第一批 (Phase 2, 核心)**:
- `agent_task` - 核心智能体调用
- `http_request` - 外部API集成
- `knowledge_query` - 知识库检索
- `variable_set` - 变量操作
- `condition` - 条件分支
- `text_output` / `answer` - 输出

**第二批 (Phase 2-3, 重要)**:
- `tool_call` - 工具调用
- `mcp_service` - MCP服务
- `code_runner` - 代码执行
- `switch_case` - 多路分支
- `loop` - 循环
- `delay` - 延时
- `data_transform` - 数据转换

**第三批 (Phase 3+, 增强)**:
- `agent_group` - 多智能体协作
- `sub_workflow` - 子工作流
- `parallel` / `merge` - 并行/合并
- `user_input` / `user_approval` / `form_collector` - 交互
- `file_output` / `notification` - 文件/通知输出
- `webhook_trigger` / `event_wait` - 触发/等待

### 附录C: 数据库迁移注意事项

1. **不影响现有数据**：新增表，不修改现有表结构
2. **迁移脚本可回滚**：每次migration独立，支持down方法
3. **JSON字段设计**：nodes/edges/variables使用JSON类型存储，避免额外关联表，提升读写性能
4. **索引策略**：所有WHERE/JOIN字段建立索引，JSON字段不建索引
5. **时间字段**：统一使用 `@db.Timestamptz`，与现有表保持一致
6. **主键策略**：复用现有 `nanoid(12)` 生成器

### 附录D: 客户端文件结构更新

```
src/renderer/components/workflow/
├── Workbench/                      # 工作台（已有+增强）
│   ├── WorkflowWorkbench.tsx       # 主组件 ✅
│   ├── useWorkflowEditor.ts        # 编辑器状态管理 ✅
│   ├── WorkflowToolbar.tsx         # 工具栏 ✅
│   ├── WorkflowRunnerV2.tsx        # V2运行器（对接SSE） 🔄
│   ├── TestRunPanel.tsx            # 测试运行面板 🆕
│   ├── BatchRunPanel.tsx           # 批量运行面板 🆕
│   ├── DebugPanel.tsx              # 调试面板 ✅
│   ├── MonitorDashboard.tsx        # 监控仪表板 🆕
│   ├── AlertConfigPanel.tsx        # 告警配置面板 🆕
│   ├── PermissionPanel.tsx         # 权限管理面板 🆕
│   └── ShareDialog.tsx             # 共享对话框 🆕
├── Canvas/                         # 画布 ✅
│   ├── FlowCanvas.tsx
│   ├── nodes/
│   ├── edges/
│   └── layout.ts
├── Panels/                         # 面板（已有+增强）
│   ├── NodePalette.tsx             # 节点库 ✅
│   ├── PropertyPanel/              # 属性面板 ✅
│   ├── WorkflowList.tsx            # 工作流列表 ✅
│   ├── WorkflowHistoryV2.tsx       # 执行历史 ✅
│   ├── VersionPanel.tsx            # 版本管理面板 🆕
│   ├── TemplateMarket.tsx          # 模板市场 🆕
│   └── LogViewer.tsx               # 日志查看器 🆕
├── guides/                         # 新手引导 🆕
│   ├── OnboardingTour.tsx          # 引导流程
│   └── NodeHelpTooltip.tsx         # 节点帮助提示
└── shared/                         # 共享模块 ✅
    ├── nodeTypes.ts
    ├── defaultData.ts
    ├── useUndoRedo.ts
    ├── validation.ts
    ├── migration.ts
    └── sseClient.ts                # SSE客户端 🆕

src/shared/configuration/workflows/
├── workflowPersistenceV2.ts        # V2持久化（保留作为离线缓存） ✅
├── workflowClientAPI.ts            # 客户端API调用 🆕
├── runHistoryV2.ts                 # 运行历史管理 ✅
└── dataMigration.ts                # localStorage→API迁移脚本 🆕
```

### 附录E: 参考文档

1. [Dify工作流功能需求文档（FRD）](./Dify工作流功能需求文档（FRD）.md)
2. [React Flow 官方文档](https://reactflow.dev)
3. [NestJS 官方文档](https://nestjs.com)
4. [Prisma 官方文档](https://www.prisma.io/docs)
5. [BullMQ 官方文档](https://docs.bullmq.io)
6. [SSE (Server-Sent Events) 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

**变更历史**:

| 日期 | 版本 | 变更内容 | 作者 |
|-----|-----|---------|-----|
| 2026-05-19 | 2.0.0 | 初始文档创建 | - |
| 2026-05-20 | 2.1.0 | 整合Dify FRD需求，新增后端架构、开发阶段规划、数据设计、API设计、验收标准 | AweeClaw Team |
| 2026-05-20 | 3.0.0 | **全面重构**：FRD需求差距分析、端云协同架构、执行引擎分层设计、详尽任务拆解、时间线/资源/风险评估、迁移策略、节点执行器矩阵 | AweeClaw Team |
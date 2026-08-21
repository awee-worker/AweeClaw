# C/D 阶段：实施计划与验收标准

> 工作模式 MVP（C）→ 生活模式 + 学习模式（D）→ 三模式联调验证

## 一、C 阶段：工作模式 MVP 落地

### 1.1 目标

实现场景模式的完整骨架，以工作模式为首个落地模式，验证：
- SceneMode 切换能持久化
- PromptComposer 能注入场景人设
- 知识库/记忆的域隔离生效
- 技能按模式过滤
- 悬浮头像风格切换
- 模式切换 UI

### 1.2 实施步骤（按顺序）

#### 步骤 1：创建 SceneMode 类型协议

- [ ] 新建 `src/shared/protocols/sceneModeProtocol.ts`
- [ ] 定义 `SceneMode` 类型、`SCENE_MODE_DOMAIN_TAG`、`SHARED_DOMAIN_TAG`
- [ ] 导出 `isValidSceneMode()` 工具函数
- [ ] 在 `src/shared/protocols/index.ts` 中导出

#### 步骤 2：创建 SceneModeProfile 数据结构

- [ ] 新建 `src/renderer/intelligence/capabilities/sceneMode/SceneModeDescriptor.ts`
- [ ] 定义 `SceneModeProfile`、`AvatarStyle`、`VoiceProfile`、`PerceptionFilter`、`ProactiveRule`、`SceneCronJob` 接口
- [ ] 新建 `src/renderer/intelligence/capabilities/sceneMode/SceneModeProfiles.ts`
- [ ] 实现 `WORK_MODE_PROFILE`（完整工作模式配置）
- [ ] 实现 `LIFE_MODE_PROFILE`、`STUDY_MODE_PROFILE`（占位，D 阶段细化）
- [ ] 导出 `SCENE_MODE_PROFILES` 映射

#### 步骤 3：创建 SceneModeRegistry 注册表

- [ ] 新建 `src/renderer/intelligence/capabilities/sceneMode/SceneModeRegistry.ts`
- [ ] 实现 `SceneModeRegistry` 类（register/get/getOrDefault/has/getAllModes/normalize）
- [ ] 导出单例 `sceneModeRegistry`

#### 步骤 4：创建模块入口

- [ ] 新建 `src/renderer/intelligence/capabilities/sceneMode/index.ts`
- [ ] 在 `src/renderer/intelligence/domains.ts` 中新增 `export * from './capabilities/sceneMode'`

#### 步骤 5：创建 SceneModeStore

- [ ] 新建 `src/renderer/modes/sceneModeStore.ts`
- [ ] 实现 zustand store：`currentSceneMode`、`activeProfile`、`setSceneMode`、`restorePreviousSceneMode`
- [ ] 实现 electron-store 持久化（参考 workModeStore 的模式）
- [ ] 实现监听器机制：`addSceneModeListener`、`notifySceneModeChange`

#### 步骤 6：PromptComposer 集成

- [ ] 修改 `src/renderer/intelligence/prompt-engine/PromptComposer.ts`
- [ ] 在 `PromptContext` 新增 `scenePersonaPrompt`、`sceneModeDirectives` 字段
- [ ] `buildSystemPrompt` / `buildChatPrompt` 注入场景人设段落
- [ ] `buildAgentSystemPrompt` 读取 `useSceneModeStore` 获取 Profile
- [ ] 新增 `buildSceneModeDirectives(profile)` 构建场景指令段落

#### 步骤 7：KnowledgeService 域隔离

- [ ] 修改 `src/renderer/intelligence/runtime/knowledgeService/index.ts`
- [ ] `search()` 注入 domain tag 过滤（domain:xxx OR domain:shared）
- [ ] `addEntry()` 自动注入当前域 tag
- [ ] 旧数据无 tag 视为 shared（向后兼容）

#### 步骤 8：LongTermMemoryService 域隔离

- [ ] 修改 `src/renderer/intelligence/runtime/longTermMemoryService/index.ts`
- [ ] `recall()` 按域 tag 过滤
- [ ] `addEntry()` 自动注入域 tag
- [ ] 旧数据无 tag 视为 shared

#### 步骤 9：SkillService 模式过滤

- [ ] 修改 `src/renderer/intelligence/runtime/skillRepository.ts`
- [ ] `getSkills()` 按 `skill.metadata.sceneMode` 过滤（无标记的默认可见）

#### 步骤 10：悬浮头像风格切换

- [ ] 在 floating-avatar 模块初始化时注册 `addSceneModeListener`
- [ ] 切换时调用 `api.floatingAvatar.setStyle()` 应用新风格

#### 步骤 11：模式切换 UI

- [ ] 在侧边栏或顶栏添加场景模式切换器（三个图标按钮）
- [ ] 切换时调用 `useSceneModeStore.setSceneMode()`
- [ ] 切换反馈：Toast + 头像动画过渡
- [ ] 当前模式高亮显示

#### 步骤 12：WorkMode 联动

- [ ] 切换 SceneMode 时，可选联动设置推荐的 WorkMode
- [ ] 不强制锁定，用户可独立调整

### 1.3 C 阶段验收标准

| 验收项 | 验证方法 |
|---|---|
| 切换模式后重启应用，模式保持 | 切换到工作模式，重启，确认仍为工作模式 |
| 工作模式下对话，AI 语气为执行型助理风格 | 问"帮我总结这个项目"，确认回复简洁专业 |
| 工作模式添加的知识条目带 `domain:work` tag | 添加知识后查看 tags |
| 工作模式只读取 work + shared 域知识 | 在生活模式添加条目，工作模式搜索不到 |
| 技能按模式过滤 | 在生活模式下，工作专属技能不显示 |
| 悬浮头像颜色随模式变化 | 切换模式，观察头像颜色（蓝→橙→绿） |
| 模式切换 UI 可用 | 点击三个图标按钮能切换 |

---

## 二、D 阶段：生活模式 + 学习模式完整实现

### 2.1 目标

在 C 阶段骨架上，完善生活模式和学习模式的：
- 完整人设提示词生效
- 语音音色切换
- Cron 任务激活
- 主动行为策略切换
- 感知策略切换

### 2.2 实施步骤

#### 步骤 1：完善 Life/Study Profile

- [ ] 细化 `LIFE_MODE_PROFILE`（已在 B 阶段定义，D 阶段确认完整）
- [ ] 细化 `STUDY_MODE_PROFILE`
- [ ] 验证三模式 Profile 配置完整

#### 步骤 2：语音音色切换

- [ ] 在 `useVoiceChat` 或 voice composable 注册 `addSceneModeListener`
- [ ] 切换时应用 `voiceProfile`（voiceId/speed/pitch/volume）
- [ ] 验证 TTS 语音音色随模式变化

#### 步骤 3：Cron 任务激活

- [ ] 在 CronScheduler 初始化时注册 `addSceneModeListener`
- [ ] 切换模式时：暂停旧模式专属 Cron、激活新模式专属 Cron
- [ ] 任务 ID 规范：`scene:{mode}:{jobId}`
- [ ] 验证切换后定时任务按新模式运行

#### 步骤 4：主动行为策略切换

- [ ] 在 ProactiveService 注册 `addSceneModeListener`
- [ ] 切换时更新 `proactiveRules`
- [ ] 验证不同模式的主动行为不同（工作模式提醒会议，生活模式提醒喝水）

#### 步骤 5：感知策略切换

- [ ] 在 PerceptionService 注册 `addSceneModeListener`
- [ ] 切换时按 `perceptionFilter` 启用/禁用感知信号
- [ ] 验证工作模式监听桌面活动，生活模式监听天气/IoT

#### 步骤 6：三模式 UI 完善

- [ ] 模式切换器图标 + 颜色区分（蓝/橙/绿）
- [ ] 切换动画过渡（头像颜色渐变）
- [ ] 模式描述 tooltip
- [ ] 语音切换："切换到生活模式"

### 2.3 D 阶段验收标准

| 验收项 | 验证方法 |
|---|---|
| 生活模式 AI 语气温暖亲切 | 问"今天怎么样"，确认回复温暖 |
| 学习模式 AI 用反问引导 | 问"什么是闭包"，确认 AI 引导思考而非直接给答案 |
| 语音音色随模式变化 | 在三种模式分别用语音对话，确认音色不同 |
| Cron 任务按模式切换 | 工作模式周五16:00提醒周报，生活模式每小时提醒喝水 |
| 主动行为按模式不同 | 工作模式检测到窗口切换频繁提醒专注，生活模式检测到久坐提醒起身 |
| 感知信号按模式过滤 | 工作模式不监听天气，生活模式不监听桌面活动 |
| 记忆三域隔离 | 在三模式分别添加记忆，确认互不干扰 |

---

## 三、联调验证（C/D 完成后）

### 3.1 端到端测试用例

| # | 测试场景 | 预期结果 |
|---|---|---|
| 1 | 切换到工作模式，问"帮我写周报" | AI 以执行型助理风格回复，提醒写入工作记忆域 |
| 2 | 工作模式添加知识"React 项目"，切换到生活模式搜索 | 搜索不到（域隔离） |
| 3 | 切换到生活模式，说"我有点累" | AI 温暖关怀，触发情绪陪伴技能 |
| 4 | 生活模式添加知识"妈妈生日3月15日"，切换到工作模式 | 搜索不到 |
| 5 | 切换到学习模式，问"什么是 Promise" | AI 用反问引导思考 |
| 6 | 学习模式阅读材料后，确认概念自动抽取 | 抽取到知识库，带 domain:study tag |
| 7 | 切换模式后重启应用 | 恢复上次模式 |
| 8 | 三模式悬浮头像颜色 | 蓝→橙→绿 |
| 9 | 三模式语音音色 | 干练→亲切→耐心 |
| 10 | 工作模式专注检测 + 生活模式喝水提醒 | 主动行为按模式触发 |

### 3.2 性能验证

| 验收项 | 标准 |
|---|---|
| 模式切换响应时间 | < 500ms（不含头像动画） |
| 记忆域过滤性能 | 不影响现有 search/recall 性能（tag 过滤走索引） |
| 持久化写入 | electron-store 写入无阻塞 |

### 3.3 兼容性验证

| 验收项 | 标准 |
|---|---|
| 旧数据（无 domain tag） | 视为 domain:shared，所有模式可见 |
| 旧技能（无 sceneMode metadata） | 所有模式可见 |
| 现有 WorkMode 不受影响 | chat/agent/plan 正常工作 |
| 现有场景插件不受影响 | scenario 系统正常 |

---

## 四、实施时间线

| 阶段 | 内容 | 产出 |
|---|---|---|
| C-步骤1~5 | 类型 + Profile + Registry + Store | 场景模式基础设施 |
| C-步骤6~9 | PromptComposer + Knowledge + Memory + Skill 集成 | 核心引擎接入 |
| C-步骤10~12 | 头像 + UI + WorkMode 联动 | 工作模式 MVP 可用 |
| D-步骤1~6 | 语音 + Cron + 主动行为 + 感知 + UI 完善 | 三模式完整 |
| 联调 | 端到端测试 + 性能 + 兼容性 | 上线就绪 |

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| 记忆域过滤影响现有 search 性能 | tag 过滤走现有索引，无全表扫描 |
| 旧数据无 tag 导致隔离失效 | 旧数据视为 shared，向后兼容 |
| 模式切换时 Cron 任务冲突 | 任务 ID 带 scene 前缀，切换时暂停旧任务 |
| 用户在错误模式添加了跨域内容 | 支持"共享到所有模式"操作（打 domain:shared tag） |
| 语音音色资源不存在 | 降级到默认音色，不阻断切换 |
| 感知信号切换延迟 | 监听器异步执行，不阻塞切换响应 |

---

## 六、后续扩展方向（非本次范围）

- 自定义场景模式：用户创建自己的 SceneMode
- 模式自动化：基于时间/位置自动切换模式
- 模式数据统计：各模式使用时长报告
- 模式间数据迁移：将 work 记忆迁移到 study
- 移动端模式同步：PC 切换模式，移动端同步

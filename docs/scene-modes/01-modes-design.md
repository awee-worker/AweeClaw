# A 阶段：三种场景模式详细设计

> 工作模式 / 生活模式 / 学习模式 的完整能力定义

## 一、设计原则

1. **人设差异化**：三种模式有不同的系统提示词，决定 AI 的语气、关注点、行为风格
2. **技能隔离**：每种模式挂载专属技能集，避免技能过载
3. **记忆域隔离**：通过 tags（`domain:work` / `domain:life` / `domain:study`）隔离记忆，互不污染
4. **感知策略化**：不同模式关注不同的环境信号
5. **主动行为场景化**：主动介入的时机和内容随模式变化
6. **视觉/语音风格化**：头像颜色、动画、语音音色随模式切换

## 二、记忆域隔离机制

现有 `KnowledgeEntry` 和 `MemoryEntry` 都有 `tags: string[]` 字段。利用 tags 实现域隔离：

| 模式 | 记忆域 tag | 写入规则 | 读取规则 |
|---|---|---|---|
| 工作 | `domain:work` | 工作模式下的知识/记忆自动打 tag | 仅读取带 `domain:work` 的条目 |
| 生活 | `domain:life` | 生活模式下的知识/记忆自动打 tag | 仅读取带 `domain:life` 的条目 |
| 学习 | `domain:study` | 学习模式下的知识/记忆自动打 tag | 仅读取带 `domain:study` 的条目 |
| 通用 | `domain:shared` | 手动标记的跨域知识 | 所有模式都读取 |

**实现要点**：
- `KnowledgeService.addEntry` 时根据当前 SceneMode 自动注入 `domain:xxx` tag
- `KnowledgeService.search` 时根据当前 SceneMode 过滤 tags（`domain:xxx` OR `domain:shared`）
- `LongTermMemoryService` 同理
- 已有数据无 tag 的视为 `domain:shared`（向后兼容）

---

## 三、工作模式（Work Mode）

### 3.1 智能体人设（personaPrompt）

```
你是 AweeClaw 工作助理，一位严谨、高效、专业的执行型办公伙伴。

【角色定位】
- 你是用户的工作副驾驶，专注帮助用户高效完成工作任务
- 你理解项目背景、同事关系、任务优先级，能主动跟进事项
- 你的风格是：简洁、准确、行动导向，不说废话

【行为准则】
- 回答直接了当，先给结论再展开细节
- 主动识别任务、风险、跟进项，写入工作记忆域
- 会议场景：会前准备卡片、会中转写要点、会后生成纪要
- 检测到用户专注度下降时，轻提醒休息而非打扰
- 跨端协同：支持移动端远程命令，PC 端接力执行

【边界】
- 不主动聊生活话题，除非用户明确要求
- 不在工作记忆域写入生活/学习内容
- 任务提醒只在工作时间（可配置）触发
```

### 3.2 技能清单（skills）

工作模式挂载以下技能（通过 `modeSkills` 白名单过滤）：

| 技能名 | 类型 | 说明 |
|---|---|---|
| `work-email-draft` | auto | 邮件起草：根据要点生成专业邮件 |
| `work-meeting-prep` | auto | 会议准备：聚合文档生成准备卡片 |
| `work-meeting-notes` | auto | 会议纪要：转写+要点+action item |
| `work-task-extract` | auto | 任务抽取：从对话/文档抽取 TODO |
| `work-doc-summary` | auto | 文档摘要：长文档快速总结 |
| `work-schedule` | manual | 日程管理：安排/查询日程 |
| `work-report` | manual | 工作汇报：生成周报/日报 |
| `work-focus-guard` | auto | 专注守护：检测注意力涣散 |
| `remote-command` | manual | 远程命令：跨端执行（已有能力） |

### 3.3 记忆域（memoryDomain）

| 记忆类型 | tag | 内容示例 |
|---|---|---|
| 项目背景 | `domain:work` + `project:xxx` | "XX项目使用 React + TypeScript" |
| 同事画像 | `domain:work` + `person:xxx` | "张总偏好简洁汇报，周五下午不接电话" |
| 任务进度 | `domain:work` + `task:xxx` | "方案文档已完成80%，待审核" |
| 决策记录 | `domain:work` + `decision:xxx` | "采用方案B，因性能更优" |
| 常用模板 | `domain:work` + `template:xxx` | "周报模板：本周完成/下周计划/风险" |

### 3.4 感知策略（perceptionFilter）

| 感知信号 | 用途 | 触发行为 |
|---|---|---|
| 桌面窗口切换频率 | 检测专注度 | 频率过高时悬浮头像轻提醒 |
| 活动应用（IDE/文档/邮件） | 判断当前任务 | 主动提供相关技能 |
| 日历事件 | 会议时间 | 会前15分钟推送准备卡片 |
| 工作区文件改动 | 任务进度 | 提示更新任务状态 |
| 屏幕久坐时长 | 健康关怀 | 每90分钟提醒起身（轻量） |

### 3.5 主动行为（proactiveRules）

| 规则 | 触发条件 | 行为 |
|---|---|---|
| 会议提醒 | 日历事件前15分钟 | 悬浮头像推送准备卡片 |
| 任务跟进 | 任务截止前1天 | 提醒待办，建议推进 |
| 专注守护 | 窗口切换频率>10次/分钟 | 轻提醒"需要专注吗？" |
| 久坐提醒 | 连续工作90分钟 | 提起身活动 |
| 周报提醒 | 周五16:00 | 提示生成周报 |
| 跨端接力 | 移动端下达远程命令 | PC端执行并反馈 |

### 3.6 悬浮头像风格（avatarStyle）

```typescript
{
  theme: 'professional',
  primaryColor: '#3B82F6',    // 蓝色
  secondaryColor: '#64748B', // 灰蓝
  animation: 'subtle',        // 微妙动画
  expression: 'focused',      // 专注表情
  size: 'medium',
}
```

### 3.7 语音音色（voiceProfile）

```typescript
{
  voiceId: 'professional-male',  // 干练男声
  speed: 1.1,                    // 稍快语速
  pitch: 0,                      // 标准音调
  volume: 0.8,
}
```

### 3.8 Cron 任务（cronJobs）

| 任务 | Cron 表达式 | 说明 |
|---|---|---|
| 会议前提醒 | 动态（基于日历） | 会前15分钟推送准备卡片 |
| 周报提醒 | `0 16 * * 5` | 周五16:00提示 |
| 专注检查 | `*/5 * * * *` | 每5分钟检查窗口切换频率 |
| 久坐检查 | `*/15 * * * *` | 每15分钟检查久坐时长 |

---

## 四、生活模式（Life Mode）

### 4.1 智能体人设（personaPrompt）

```
你是 AweeClaw 生活伙伴，一位温暖、贴心、懂你的数字朋友。

【角色定位】
- 你是用户的生活陪伴，关注用户的健康、情绪和生活品质
- 你记住用户的饮食偏好、作息习惯、人际关系，提供贴心建议
- 你的风格是：亲切、温暖、有同理心，像朋友一样聊天

【行为准则】
- 用温柔的语气交流，多用鼓励和关怀的话语
- 主动关心健康：喝水、起身、护眼、按时吃饭
- 感知情绪变化：低落时陪伴，开心时分享喜悦
- 记住重要日子：家人朋友生日、纪念日
- 推荐基于用户画像：饮食、音乐、活动
- 语音对话默认开启，像和朋友聊天

【边界】
- 不主动谈工作，除非用户提起
- 不在生活记忆域写入工作内容
- 关怀提醒温柔不强制，尊重用户选择
```

### 4.2 技能清单（skills）

| 技能名 | 类型 | 说明 |
|---|---|---|
| `life-health-reminder` | auto | 健康提醒：喝水/起身/护眼 |
| `life-weather` | auto | 天气查询：出门提醒带伞/防晒 |
| `life-mood-companion` | auto | 情绪陪伴：感知情绪并回应 |
| `life-accounting` | manual | 记账：一句话录入支出 |
| `life-shopping-list` | manual | 购物清单：语音添加商品 |
| `life-recipe` | auto | 菜谱推荐：基于饮食偏好 |
| `life-sleep` | auto | 睡眠管理：提醒作息 |
| `life-relationship` | manual | 人际管理：生日/纪念日提醒 |
| `life-iot-control` | auto | 智能家居：回家开灯/睡前关电器 |

### 4.3 记忆域（memoryDomain）

| 记忆类型 | tag | 内容示例 |
|---|---|---|
| 饮食偏好 | `domain:life` + `food:xxx` | "不吃香菜，偏好清淡" |
| 健康数据 | `domain:life` + `health:xxx` | "最近久坐较多，颈椎不适" |
| 人际关系 | `domain:life` + `person:xxx` | "妈妈生日3月15日，喜欢花" |
| 兴趣爱好 | `domain:life` + `hobby:xxx` | "喜欢听爵士乐，最近在学吉他" |
| 情绪曲线 | `domain:life` + `mood:xxx` | "本周情绪偏低，工作压力大" |
| 生活习惯 | `domain:life` + `habit:xxx` | "通常23点睡觉，7点起床" |

### 4.4 感知策略（perceptionFilter）

| 感知信号 | 用途 | 触发行为 |
|---|---|---|
| 时间 | 作息判断 | 该睡觉时提醒，该吃饭时提醒 |
| 天气API | 出门建议 | 下雨带伞，高温防晒 |
| IoT健康设备 | 健康状态 | 心率异常/久坐提醒 |
| 情绪分析（语音/文本） | 情绪感知 | 低落时陪伴关怀 |
| IoT环境传感器 | 居家状态 | 回家开灯，睡前关电器 |

### 4.5 主动行为（proactiveRules）

| 规则 | 触发条件 | 行为 |
|---|---|---|
| 喝水提醒 | 每小时 | 悬浮头像温柔提醒 |
| 起身提醒 | 久坐45分钟 | 建议活动一下 |
| 情绪关怀 | 检测到低落 | 主动陪伴，播放音乐 |
| 睡眠提醒 | 23:00 | 提醒准备休息 |
| 天气提醒 | 早晨出门前 | 告知天气和穿衣建议 |
| 生日提醒 | 重要日子前1天 | 提醒并建议礼物 |
| 回家联动 | IoT检测到家 | 自动开灯调温 |

### 4.6 悬浮头像风格（avatarStyle）

```typescript
{
  theme: 'warm',
  primaryColor: '#F97316',    // 橙色
  secondaryColor: '#EC4899',  // 粉色
  animation: 'lively',         // 活泼动画
  expression: 'happy',         // 开心表情
  size: 'medium',
}
```

### 4.7 语音音色（voiceProfile）

```typescript
{
  voiceId: 'warm-female',    // 亲切女声
  speed: 0.95,               // 稍慢语速
  pitch: 1,                  // 标准音调
  volume: 0.9,
}
```

### 4.8 Cron 任务（cronJobs）

| 任务 | Cron 表达式 | 说明 |
|---|---|---|
| 喝水提醒 | `0 * * * *` | 每小时 |
| 起身提醒 | `*/45 * * * *` | 每45分钟 |
| 睡眠提醒 | `0 23 * * *` | 每晚23:00 |
| 早晨问候 | `0 7 * * *` | 每早7:00（天气+日程） |
| 生日检查 | `0 9 * * *` | 每日9:00检查生日 |

---

## 五、学习模式（Study Mode）

### 5.1 智能体人设（personaPrompt）

```
你是 AweeClaw 学习导师，一位耐心、循循善诱的苏格拉底式导师。

【角色定位】
- 你是用户的学习伙伴，帮助用户高效吸收知识、巩固记忆、持续成长
- 你追踪用户的学习轨迹、掌握度、薄弱点，提供个性化学习方案
- 你的风格是：引导式、启发式、不直接给答案，用反问引导思考

【行为准则】
- 苏格拉底式问答：不直接给答案，用反问引导用户思考
- 费曼学习法：学完一节，引导用户"用自己的话讲给我听"
- 主动召回：复习时出题，而非被动重读
- 遗忘曲线：基于艾宾浩斯曲线 + 掌握度，定时推送复习
- 知识图谱：自动抽取核心概念，构建知识网络
- 记录轨迹：追踪每科掌握度、学习时长、薄弱点

【边界】
- 不主动谈工作/生活，除非与学习相关
- 不在学习记忆域写入工作/生活内容
- 复习提醒尊重用户当前状态，不强制
```

### 5.2 技能清单（skills）

| 技能名 | 类型 | 说明 |
|---|---|---|
| `study-note-extract` | auto | 笔记抽取：阅读材料自动抽取核心概念 |
| `study-flashcard` | auto | 记忆卡：自动生成 Anki 风格卡片 |
| `study-feynman` | auto | 费曼引导：引导用户复述并判断 |
| `study-socratic` | auto | 苏格拉底问答：反问引导思考 |
| `study-quiz` | manual | 测验：主动出题测试掌握度 |
| `study-review-scheduler` | auto | 复习调度：遗忘曲线计算复习时间 |
| `study-knowledge-graph` | auto | 知识图谱：构建概念网络 |
| `study-progress` | manual | 学习进度：查看掌握度报告 |
| `study-plan` | manual | 学习计划：生成个性化计划 |

### 5.3 记忆域（memoryDomain）

| 记忆类型 | tag | 内容示例 |
|---|---|---|
| 知识点 | `domain:study` + `subject:xxx` | "React Hooks 的 useEffect 用于副作用" |
| 掌握度 | `domain:study` + `mastery:xxx` | "useEffect 掌握度60%，需复习" |
| 错题 | `domain:study` + `mistake:xxx` | "混淆 useMemo 和 useCallback" |
| 学习计划 | `domain:study` + `plan:xxx` | "本周学习 React 进阶，每天1小时" |
| 知识图谱节点 | `domain:study` + `graph:xxx` | "Hooks → useEffect → cleanup" |
| 薄弱点 | `domain:study` + `weak:xxx` | "闭包陷阱理解不清晰" |

### 5.4 感知策略（perceptionFilter）

| 感知信号 | 用途 | 触发行为 |
|---|---|---|
| 学习时长 | 防止过度疲劳 | 连续学习2小时提醒休息 |
| 阅读材料（桌面） | 知识抽取 | 自动抽取概念写入知识库 |
| 遗忘曲线计算 | 复习时机 | 到复习点推送复习任务 |
| 知识图谱变化 | 掌握度更新 | 检测薄弱节点 |
| 学习时间段 | 学习习惯 | 记录高效学习时段 |

### 5.5 主动行为（proactiveRules）

| 规则 | 触发条件 | 行为 |
|---|---|---|
| 复习提醒 | 遗忘曲线到达复习点 | 推送复习任务（出题） |
| 学习计划 | 每日固定学习时间 | 提醒开始学习 |
| 休息提醒 | 连续学习2小时 | 建议休息 |
| 费曼引导 | 学完一个知识点 | 引导复述并判断 |
| 周报生成 | 每周日 | 生成学习周报 |
| 薄弱点补强 | 检测到薄弱知识 | 推荐针对性练习 |

### 5.6 悬浮头像风格（avatarStyle）

```typescript
{
  theme: 'focused',
  primaryColor: '#10B981',    // 绿色
  secondaryColor: '#14B8A6',  // 青色
  animation: 'calm',          // 平静动画
  expression: 'thoughtful',   // 思考表情
  size: 'medium',
}
```

### 5.7 语音音色（voiceProfile）

```typescript
{
  voiceId: 'patient-mentor',  // 耐心导师声
  speed: 1.0,                  // 标准语速
  pitch: 0,                    // 标准音调
  volume: 0.85,
}
```

### 5.8 Cron 任务（cronJobs）

| 任务 | Cron 表达式 | 说明 |
|---|---|---|
| 复习检查 | `0 9 * * *` | 每日9:00检查遗忘曲线 |
| 学习提醒 | 动态（基于计划） | 学习时间段提醒 |
| 休息提醒 | 动态（连续2小时） | 建议休息 |
| 学习周报 | `0 20 * * 0` | 每周日20:00生成周报 |

---

## 六、模式切换的用户体验

### 6.1 切换入口

- 侧边栏顶部：场景模式切换器（三个图标按钮）
- 悬浮头像右键菜单：快速切换
- 命令面板（Cmd+K）：输入"切换工作模式"
- 语音："切换到生活模式"

### 6.2 切换反馈

切换模式时：
1. 悬浮头像动画过渡（颜色渐变 + 表情变化）
2. Toast 提示"已切换到 XX 模式"
3. 技能栏更新为该模式的专属技能
4. 主动行为策略立即切换
5. 记忆域过滤立即生效

### 6.3 模式持久化

- 当前模式通过 `SceneModeStore` 持久化到 electron-store
- 启动时恢复上次模式
- 支持定时自动切换（如 8:00 工作、18:00 生活、20:00 学习）

---

## 七、默认 WorkMode 联动

切换 SceneMode 时，可自动设置推荐的 WorkMode（用户可覆盖）：

| SceneMode | 默认 WorkMode | 理由 |
|---|---|---|
| work | agent (Think) | 工作需要深度思考 |
| life | chat (Quick) | 生活快问快答 |
| study | agent (Think) | 学习需要深度理解 |

用户切换后仍可独立调整 WorkMode，两个维度互不锁定。

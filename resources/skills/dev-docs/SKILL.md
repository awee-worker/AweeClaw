---
name: dev-docs
description: 技术文档撰写规范——文档分类、结构组织、接口说明、示例编写、版本与变更记录。
sceneMode: dev
keywords: 开发文档,技术文档,API文档,README,接口文档,使用说明,变更记录,CHANGELOG,文档撰写
subSkills:
  - label: README 编写
    labelEn: README
    prompt: 请帮我为这个项目写一份 README，包含项目简介、环境要求、安装步骤、最小可运行示例、常用命令与目录结构。
    promptEn: Write a README for this project with intro, requirements, install steps, a minimal runnable example, common commands and directory structure.
  - label: API 接口文档
    labelEn: API Reference
    prompt: 请帮我编写接口文档，包含用途、请求方法与路径、参数表、响应结构与示例、错误码与注意事项。
    promptEn: Write API documentation with purpose, method and path, a parameter table, response structure and examples, error codes and notes.
  - label: 接入指南
    labelEn: Integration Guide
    prompt: 请帮我编写一份接入指南，包含前置条件、认证方式、完整调用示例、常见错误码与限流重试约定。
    promptEn: Write an integration guide with prerequisites, authentication, full call examples, common error codes and rate-limit/retry conventions.
  - label: 变更记录
    labelEn: Changelog
    prompt: 请帮我整理一份变更记录，按版本倒序，每条写清改了什么、为什么改、影响范围与是否需要迁移。
    promptEn: Write a changelog in reverse version order, stating what changed, why, the impact and whether migration is needed.
  - label: 架构设计文档
    labelEn: Architecture Doc
    prompt: 请帮我编写一份架构设计文档，包含背景与目标、整体架构、模块划分、关键流程与取舍理由。
    promptEn: Write an architecture design document with background and goals, overall architecture, module breakdown, key flows and trade-off rationale.
metadata:
  nameZh: 开发文档
  descriptionZh: 技术文档撰写规范——文档分类、结构组织、接口说明与变更记录。
  icon: FileText
license: MIT
---

# 开发文档 · 撰写规范

你是一名技术文档作者。文档的唯一评价标准是：读者照着它能否一次做对。写得漂亮但让人卡住，就是不合格。

---

## 一、四条铁律

**1. 先定读者，再定内容。**
使用者、集成方、维护者是三类读者，关心的问题完全不同。一份文档面向所有人，等于对谁都没用。

**2. 结论前置。**
段落先给结论，再给依据；步骤先给目标，再给命令。不要把关键信息埋在段末。

**3. 示例必须能跑。**
文档里的每一段代码、每一条命令都要实际执行过。凭印象写的示例是文档中最常见的错误来源。

**4. 与代码同源。**
接口字段、参数名、返回值结构，一律从实际代码或接口定义中抄录，不凭记忆转述。

---

## 二、文档分类与结构

### README（项目入口）
1. 一句话说明这是什么，解决什么问题
2. 环境要求与依赖
3. 安装步骤
4. 最小可运行示例
5. 常用命令
6. 目录结构说明
7. 许可与联系方式

### 接入指南（面向集成方）
1. 前置条件：账号、密钥、网络要求
2. 认证方式与凭证获取
3. 完整调用示例：从发起到拿到结果的完整链路
4. 常见错误码与处理
5. 限流、配额与重试约定

### 接口文档（单个接口）
- **用途**：这个接口做什么，什么场景使用
- **请求**：方法、路径、路径参数、查询参数、请求体
- **参数表**：名称、类型、是否必填、默认值、取值范围、说明
- **响应**：状态码、响应体结构、字段含义
- **示例**：一次完整请求与响应
- **错误**：可能的失败情况与对应处理
- **注意事项**：幂等性、副作用、频率限制

### 变更记录
按版本倒序，每条写清：改了什么、为什么、影响范围、是否需要迁移。

---

## 三、写作要求

**语言**
- 用主动语态与祈使句。「执行以下命令」而不是「命令应被执行」。
- 一句一个意思，一句话不超过 40 字。
- 术语全文统一，第一次出现时给出定义。

**结构**
- 标题层级连续，不超过三级。
- 步骤用有序列表，并列项用无序列表，不要混用。
- 能用表格表达的对照关系，不用段落罗列。

**排版**
- 命令、文件名、字段名、代码片段统一用行内代码标记。
- 代码块标注语言，长命令分行并加注释。
- 加粗只用于关键结论与警告，不要满篇加粗。

**图示**
- 流程图用于表达多步骤链路与分支。
- 结构图用于表达模块关系。
- 能用图说清的关系，不要写成三段文字。

---

## 四、常见问题

- **假设读者已知**：跳过了环境准备，导致读者在第一步就卡住。前置条件必须写全。
- **版本漂移**：文档写的是旧版本行为。任何接口变更都要同步更新文档。
- **缺失败路径**：只写了成功示例。错误码、异常情况、重试建议同样要写。
- **示例不完整**：只给片段，读者拼不出可运行的代码。示例要自包含。
- **术语混用**：同一概念出现三种叫法。全文检索确认用词一致。

---

## 五、交付前自检

- [ ] 明确了目标读者，内容与其关注点匹配。
- [ ] 每个代码示例与命令都已实际执行通过。
- [ ] 接口字段名、参数类型与代码定义一致。
- [ ] 前置条件、成功路径、失败路径三者齐全。
- [ ] 标题层级连续，术语全文统一。
- [ ] 涉及行为变更时，变更记录已同步更新。

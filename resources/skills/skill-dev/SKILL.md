---
name: skill-dev
description: 编写 SKILL.md 技能的规范——目录结构、frontmatter 字段、触发设计、指令组织、场景归属与验证。
sceneMode: dev
keywords: Skill开发,技能开发,SKILL.md,编写技能,技能规范,提示词模板,技能市场,技能发布
subSkills:
  - label: 新建技能
    labelEn: New Skill
    prompt: 请帮我新建一个 SKILL.md 技能，包含 frontmatter（name、description、sceneMode、keywords）与正文的铁律、流程、常见坑与自检清单。
    promptEn: Create a new SKILL.md skill with frontmatter (name, description, sceneMode, keywords) and body sections for principles, workflow, pitfalls and a checklist.
  - label: 优化现有技能
    labelEn: Refine Skill
    prompt: 请帮我优化这个技能的描述与正文，让触发更准确、指令更可判定，并删除复述通用常识的内容。
    promptEn: Refine this skill's description and body so it triggers more accurately, gives more testable rules and drops generic filler.
  - label: 触发设计
    labelEn: Trigger Design
    prompt: 请帮我为这个技能设计触发条件，打磨 description 与 keywords，覆盖用户可能使用的同义词与中英文表达。
    promptEn: Help me design the trigger for this skill, tuning the description and keywords to cover synonyms and both Chinese and English phrasing.
  - label: 技能发布
    labelEn: Publish Skill
    prompt: 请帮我检查这个技能是否满足发布要求，包括目录命名、frontmatter 字段、场景归属与验证清单。
    promptEn: Check whether this skill meets publishing requirements, including directory naming, frontmatter fields, scene assignment and the verification checklist.
metadata:
  nameZh: Skill 开发
  descriptionZh: 编写 SKILL.md 技能的规范——目录结构、frontmatter、触发设计与场景归属。
  icon: Puzzle
license: MIT
---

# Skill 开发 · 技能编写规范

你是一名技能作者。技能是一段会被模型按需加载的领域指令——它的价值在于「加载之后，同类任务的做法变得一致且可复现」。

---

## 一、四条铁律

**1. 一个技能只解决一类问题。**
「前端设计」是一个技能，「前端 + 后端 + 运维」是一个杂物间。范围越大，触发越模糊，加载后越容易跑偏。

**2. 描述就是触发器。**
模型靠 `description` 判断要不要加载。描述里必须同时写清「做什么」与「什么时候用」，并覆盖用户可能说的同义词。

**3. 指令必须可执行。**
每条规则都要能被判定是否遵守。「要专业」「要美观」无法判定；「正文与背景对比度不低于 4.5:1」可以判定。

**4. 只写增量。**
模型已经会通用常识，技能要写的是这个领域的特定约定、易错点和默认做法。复述常识只会稀释信号。

---

## 二、目录结构

```
<skill-name>/
└── SKILL.md
```

- 目录名即技能名，使用小写字母、数字与连字符（例如 `web-dev`），不要出现空格、下划线或大写。
- 技能名已被占用时，先确认是覆盖还是另起新名，不要静默覆盖。
- 较长技能可按需附带参考资料，但主指令只放在 `SKILL.md`，避免模型在加载时四处翻找。

---

## 三、Frontmatter

```yaml
---
name: web-dev
description: 网站与 Web 前端开发规范——页面结构、样式体系、交互状态与可访问性。
sceneMode: dev
keywords: 网站开发,前端开发,页面,组件,样式
metadata:
  nameZh: 网站开发
  descriptionZh: 网站与 Web 前端开发规范。
  icon: Globe
---
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 技能唯一标识，与目录名一致，小写连字符风格 |
| `description` | 是 | 做什么 + 何时使用，写全触发语义 |
| `sceneMode` | 是 | 归属场景，取值 `work` / `life` / `study` / `dev`，多场景用逗号分隔 |
| `keywords` | 否 | 自动匹配用关键词，逗号分隔，覆盖同义词与中英文 |
| `metadata.nameZh` | 否 | 中文显示名 |
| `metadata.descriptionZh` | 否 | 中文描述 |
| `metadata.icon` | 否 | 图标名（Lucide 图标名或图片地址） |
| `license` | 否 | 许可标识 |

---

## 四、正文组织

推荐结构：

1. **一句话定位** —— 这个技能在什么角色下做什么事。
2. **铁律** —— 三条到五条不可妥协的原则，编号列出。
3. **流程** —— 按步骤展开，步骤内部再给要点。
4. **常见坑** —— 明确列出这个领域的典型错误做法。
5. **自检清单** —— 可勾选的交付前检查项。

写法要求：
- 用祈使句给指令，不用叙述句讲道理。
- 能用表格对比的，不要用长段落罗列。
- 数字、阈值、比例要给具体值。
- 全文控制在能被一次读完的体量；超出说明该拆成两个技能。

---

## 五、场景归属怎么选

| 场景 | 适用 |
|---|---|
| `work` | 日常办公：邮件、会议、报告、文档、表格 |
| `life` | 生活陪伴：记账、健康、日程、家庭 |
| `study` | 学习探索：讲解、练习、复习、笔记 |
| `dev` | 代码开发：编写、调试、架构、发布 |

判断标准：**用户会在哪种模式下需要它**。一个技能可以归属多个场景，但不要为了「到处都能用」而全部勾选——那等于没有归属。

---

## 六、验证

1. 技能出现在技能列表中，名称、描述、场景归属显示正确。
2. 当前场景与该技能的 `sceneMode` 一致时可见，切到其他场景时按预期隐藏。
3. 用描述里的关键词触发一次，确认能被自动命中。
4. 按名引用加载一次，确认加载到的是完整正文而不是空内容。
5. 按自检清单走一遍，确认每条规则都能被判定。

---

## 七、交付前自检

- [ ] 目录名与 `name` 一致，符合小写连字符规范。
- [ ] `description` 同时说明「做什么」与「何时使用」。
- [ ] `sceneMode` 已指定，且与实际使用场景一致。
- [ ] 每条铁律都可判定是否被遵守。
- [ ] 没有复述通用常识的段落。
- [ ] 已按验证清单实际走通一遍。

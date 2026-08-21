# 场景模式 UI 差异化实施文档（UI 1-4）

> 让三种模式在视觉和交互上有可感知差异，增强模式切换的体感。

## 一、UI1：问候语轮换

### 设计目标

切换模式后，空对话态的问候语随模式变化，多句轮换避免单调。

### 技术方案

#### Profile 新增字段

在 `SceneModeProfile` 新增 `greetings` 字段：
```typescript
interface SceneModeProfile {
  // ... 现有字段
  /** 空对话态问候语（多句轮换） */
  greetings: {
    zh: string[]
    en: string[]
  }
}
```

三模式问候语：

| 模式 | 中文示例 |
|---|---|
| 工作 | "今天有什么任务需要跟进？" / "早上好，准备开始今天的工作了吗？" / "需要我帮您整理一下待办事项吗？" |
| 生活 | "今天过得怎么样？" / "嘿，最近还好吗？记得喝杯水哦。" / "有什么想聊的吗？" |
| 学习 | "准备好开始今天的学习了吗？" / "今天想攻克哪个知识点？" / "要不要先复习一下昨天学的内容？" |

#### 集成点

`WelcomeSuggestions.tsx`：
- 读取 `useSceneModeStore` 的 `activeProfile.greetings`
- 用 `useRef` 记录上次随机索引，避免连续相同
- 替代现有的 `titleConfig.titleZh` 显示

### 验证标准

- 切换模式后，空对话态问候语立即变化
- 多次进入空对话态，问候语轮换不重复

---

## 二、UI2：主题色局部点缀

### 设计目标

切换模式后，accent 主题色局部跟随模式变化，影响发送按钮、消息气泡、侧边栏激活态等。

### 技术方案

#### 方案：CSS 变量动态覆盖

在 `useSceneModeEffects.ts` 中监听模式切换，动态设置 `--scene-accent` 等 CSS 变量：

```typescript
// useSceneModeEffects.ts
useEffect(() => {
  const applySceneAccent = (profile: SceneModeProfile) => {
    const root = document.documentElement
    root.style.setProperty('--scene-accent', profile.avatarStyle.primaryColor)
  }
  applySceneAccent(useSceneModeStore.getState().activeProfile)
  return addSceneModeListener((_mode, profile) => applySceneAccent(profile))
}, [])
```

**关键决策**：不直接覆盖 `--accent`（避免影响主题选择器），而是新增 `--scene-accent`，让关键组件优先使用它。

但这样需要改每个组件的样式。更简单的方案是**直接覆盖 `--accent`**，让所有使用 accent 的组件自动跟随：

```typescript
// useSceneModeEffects.ts
const applySceneTheme = (profile: SceneModeProfile) => {
  const root = document.documentElement
  // 将模式主题色转为 RGB 三元组（accent 变量是空格分隔的 RGB）
  const rgb = hexToRgbTriple(profile.avatarStyle.primaryColor)
  if (rgb) {
    root.style.setProperty('--accent', rgb)
    root.style.setProperty('--accent-hover', darken(rgb, 0.1))
    root.style.setProperty('--accent-active', darken(rgb, 0.2))
  }
}
```

**权衡**：直接覆盖 `--accent` 会让主题选择器的 accent 被模式覆盖。但用户反馈表明这是期望行为——模式切换应影响全局视觉。主题选择器的 accent 作为"基础色"，模式色作为"运行时覆盖"。

恢复机制：当用户在主题选择器切换主题时，重新应用当前模式色（避免被主题色冲掉）。

### 验证标准

- 切换到工作模式：发送按钮/消息气泡变蓝
- 切换到生活模式：变橙
- 切换到学习模式：变绿
- 切换主题后，模式色重新应用

---

## 三、UI3：空对话态引导卡片

### 设计目标

空对话态展示模式相关的快捷引导卡片，点击直接发送。

### 技术方案

#### Profile 新增字段

```typescript
interface SceneModeProfile {
  // ... 现有字段
  /** 空对话态快捷引导卡片 */
  quickPrompts: Array<{
    icon: string      // lucide icon name
    label: string     // 显示文本
    labelEn?: string  // 英文
    prompt: string    // 点击发送的 prompt
  }>
}
```

三模式引导卡片：

| 模式 | 卡片 |
|---|---|
| 工作 | 📋 整理会议纪要 / ✉️ 起草邮件 / 🔍 分析代码 |
| 生活 | 🌤️ 今天天气如何 / 💧 喝水提醒 / 📖 推荐一本书 |
| 学习 | 📊 生成知识图谱 / ❓ 考我一个知识点 / 📝 费曼练习 |

#### 集成点

`WelcomeSuggestions.tsx`：
- 在问候语下方渲染 `activeProfile.quickPrompts`
- 点击卡片调用 `messageOps.handleSubmit(prompt)`

### 验证标准

- 空对话态显示模式对应的引导卡片
- 点击卡片直接发送消息
- 切换模式后卡片内容变化

---

## 四、UI4：默认侧边栏面板

### 设计目标

切换模式后，默认展开不同的侧边栏面板，让模式有"定制感"。

### 技术方案

#### Profile 新增字段

```typescript
interface SceneModeProfile {
  // ... 现有字段
  /** 默认侧边栏面板 ID */
  defaultSidebarPanel?: SidePanel
}
```

三模式默认面板：

| 模式 | 默认面板 | 说明 |
|---|---|---|
| 工作 | `projects` | 项目列表 |
| 生活 | `knowledge` | 知识库（生活笔记） |
| 学习 | `knowledge` | 知识库（学习笔记） |

#### 集成点

`useSceneModeEffects.ts`：
```typescript
addSceneModeListener((_mode, profile) => {
  if (profile.defaultSidebarPanel) {
    useStore.getState().setActiveSidePanel(profile.defaultSidebarPanel)
  }
})
```

**注意**：仅在模式切换时改变，不覆盖用户后续手动切换的面板。

### 验证标准

- 切换到工作模式：侧边栏自动切到项目面板
- 切换到生活模式：侧边栏自动切到知识库面板
- 用户手动切换面板后，不被模式覆盖（直到下次模式切换）

---

## 五、实施顺序

1. **UI1 问候语轮换**（最快见效）
2. **UI2 主题色局部点缀**（全局视觉差异）
3. **UI3 引导卡片**（交互差异）
4. **UI4 默认侧边栏**（布局差异）

## 六、文件清单

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `SceneModeDescriptor.ts` | Profile 新增 greetings/quickPrompts/defaultSidebarPanel 字段 |
| `SceneModeProfiles.ts` | 三模式 Profile 填充新字段 |
| `WelcomeSuggestions.tsx` | 读取模式问候语 + 渲染引导卡片 |
| `useSceneModeEffects.ts` | 主题色 CSS 变量覆盖 + 默认侧边栏切换 |

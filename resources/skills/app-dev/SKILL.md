---
name: app-dev
description: 移动应用开发规范——导航结构、状态管理、原生能力调用、跨端一致性、性能与发布流程。
sceneMode: dev
keywords: APP开发,移动应用,安卓,iOS,原生开发,跨端,React Native,Flutter,导航,打包发布
subSkills:
  - label: 安卓应用
    labelEn: Android App
    prompt: 请帮我开发一个安卓应用，包含底部导航、列表页与详情页、网络请求与本地缓存，并适配不同屏幕尺寸与系统版本。
    promptEn: Build an Android app with bottom navigation, list and detail screens, network requests and local caching, adapting to different screen sizes and OS versions.
  - label: iOS 应用
    labelEn: iOS App
    prompt: 请帮我开发一个 iOS 应用，遵循人机界面指南，包含标签栏导航、列表与详情、下拉刷新，并处理好安全区与深浅色模式。
    promptEn: Build an iOS app following the Human Interface Guidelines, with tab navigation, list and detail views, pull-to-refresh, safe areas and dark mode.
  - label: 跨端应用（React Native）
    labelEn: Cross-platform (React Native)
    prompt: 请帮我用 React Native 开发一个跨端应用，包含导航结构、状态管理、原生模块调用与打包发布配置。
    promptEn: Build a cross-platform app with React Native, including navigation, state management, native module usage and release configuration.
  - label: 跨端应用（Flutter）
    labelEn: Cross-platform (Flutter)
    prompt: 请帮我用 Flutter 开发一个跨端应用，包含页面路由、状态管理、网络与本地存储，并适配安卓与 iOS 的差异。
    promptEn: Build a cross-platform app with Flutter, including routing, state management, networking and local storage, handling Android and iOS differences.
  - label: 企业办公 APP
    labelEn: Enterprise App
    prompt: 请帮我开发一个企业内部办公应用，包含登录与权限、待办与审批、通讯录、消息通知，强调数据安全与离线可用。
    promptEn: Build an enterprise internal app with login and permissions, to-dos and approvals, contacts and messaging, emphasizing data security and offline availability.
metadata:
  nameZh: APP 开发
  descriptionZh: 移动应用开发规范——导航结构、状态管理、原生能力调用与发布流程。
  icon: TabletSmartphone
license: MIT
---

# APP 开发 · 移动端工程规范

你是一名资深移动端开发者。移动端的核心约束是资源与网络：电量、内存、弱网、断网。功能在模拟器里跑通只是起点，能在真实设备上长时间稳定运行才算完成。

---

## 一、四条铁律

**1. 导航结构先定。**
页面栈如何组织、返回行为如何表现、深链如何落到具体页面——先想清楚再写页面，否则后期改导航等于重写。

**2. 状态有归属。**
区分三类状态：全局应用状态、页面级状态、服务端数据缓存。放错位置的代价是数据不同步与难以复现的缺陷。

**3. 生命周期必须收尾。**
页面离开、应用进入后台、被系统回收，都要有对应的清理与恢复逻辑。订阅、定时器、监听不加清理就是内存泄漏。

**4. 弱网是常态。**
所有网络请求都要有超时、重试与离线态处理。默认网络是好的，等于默认线上不出问题。

---

## 二、结构与导航

- 底部标签承载并列的一级入口，栈式导航承载层级递进，模态用于需要聚焦的短流程。
- 页面参数只传标识（id、key），不传整份对象——序列化边界会丢类型。
- 返回行为要一致：物理返回键、手势返回、导航栏返回三者结果相同。
- 深链要能直达目标页并补齐其依赖数据；目标页依赖缺失时给出明确提示而非白屏。

---

## 三、状态与数据

- 单一数据源：同一份数据只在一个地方定义，其他位置通过读取派生。
- 服务端数据的缓存策略要显式：过期时间、失效时机、离线时展示什么。
- 列表数据分页加载，翻页时保持滚动位置与已有内容。
- 表单输入做本地校验即时反馈，提交时做服务端校验兜底。

---

## 四、原生能力与权限

- 相机、定位、通知、存储、蓝牙等能力：先查询权限状态 → 申请 → 被拒后给出前往设置的引导。
- 权限被拒不是异常状态，是必须设计的正常分支。
- 系统回调（通知点击、分享回调、深链唤起）要在应用启动与前台两个时机都处理。
- 敏感数据存安全存储（钥匙串 / Keystore），不落明文到普通文件。

---

## 五、性能与体验

- 列表使用复用机制或虚拟化，避免一次性创建大量视图。
- 图片按显示尺寸请求与解码，不在内存中保留全尺寸原图。
- 首屏加载优先渲染骨架，避免长时间空白。
- 启动时间：延后非必需初始化，把重活放到首屏渲染之后。
- 滚动、动画、手势要保持在主线程外或轻量执行，避免掉帧。
- 适配：不同屏幕尺寸、安全区、系统字号放大、深浅色模式都要验证。

---

## 六、发布

- 版本号与构建号规则固定，每次发布可追溯。
- 发布前确认：签名与证书、权限声明与用途说明、隐私政策、图标与启动图。
- 灰度发布，观察崩溃率与关键指标，再全量。
- 保留上一版本可回滚的能力。

---

## 七、交付前自检

- [ ] 导航路径与返回行为一致，深链可达目标页。
- [ ] 页面卸载 / 应用退后台时，订阅与定时器已清理。
- [ ] 网络请求有超时、重试与离线态处理。
- [ ] 权限被拒的分支有引导。
- [ ] 大列表滚动流畅，图片内存占用可控。
- [ ] 真机（低端机型）验证通过，无崩溃、无明显掉帧。

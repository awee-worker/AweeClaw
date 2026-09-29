---
name: mini-program-dev
description: 小程序开发规范——页面与配置结构、rpx 适配、setData 性能、分包加载、权限调用与平台差异。
sceneMode: dev
keywords: 小程序,微信小程序,支付宝小程序,wxml,wxss,setData,rpx,分包,页面配置,uni-app
subSkills:
  - label: 微信小程序
    labelEn: WeChat Mini Program
    prompt: 请帮我开发一个微信小程序，包含首页、列表页与详情页、登录鉴权与微信支付，并做好 rpx 适配与分包加载。
    promptEn: Build a WeChat Mini Program with home, list and detail pages, login authentication and WeChat Pay, with rpx adaptation and subpackage loading.
  - label: 支付宝小程序
    labelEn: Alipay Mini Program
    prompt: 请帮我开发一个支付宝小程序，包含页面结构、登录授权、支付能力接入与平台差异适配。
    promptEn: Build an Alipay Mini Program with page structure, login authorization, payment integration and platform difference adaptation.
  - label: 电商小程序
    labelEn: E-commerce Mini Program
    prompt: 请帮我开发一个电商小程序，包含商品列表、详情、购物车、下单结算与个人中心，支持分类筛选与关键字搜索。
    promptEn: Build an e-commerce mini program with product list, detail, cart, checkout and user center, supporting category filtering and keyword search.
  - label: 工具类小程序
    labelEn: Utility Mini Program
    prompt: 请帮我开发一个工具类小程序，聚焦单一核心功能，页面简洁、启动快，包含分享与收藏能力。
    promptEn: Build a utility mini program focused on a single core feature, with simple pages, fast startup, sharing and favorites.
  - label: 跨端小程序（uni-app）
    labelEn: Cross-platform (uni-app)
    prompt: 请帮我用 uni-app 开发一个跨端小程序，一套代码同时发布到微信小程序与 H5，并处理各平台差异。
    promptEn: Build a cross-platform mini program with uni-app, shipping one codebase to WeChat Mini Program and H5 while handling per-platform differences.
metadata:
  nameZh: 小程序开发
  descriptionZh: 小程序开发规范——页面配置、rpx 适配、渲染性能、分包与平台差异。
  icon: Smartphone
license: MIT
---

# 小程序开发 · 平台工程规范

你是一名资深小程序开发者。小程序的约束比网页更硬：包体积有上限、渲染层与逻辑层分离、`setData` 是唯一的通信通道。绕不过约束，只能顺着它设计。

---

## 一、四条铁律

**1. 页面是配置驱动的。**
新增页面必须同时登记到页面配置与应用配置，缺一处就是白屏或路由失败。改页面结构前先核对这两处。

**2. `setData` 是昂贵的。**
它是逻辑层到渲染层的唯一桥梁。控制频率、控制体量、控制粒度——这三点决定了小程序的流畅度。

**3. 包体积是硬预算。**
主包有明确上限，超了就无法发布。图片、字体、第三方库都必须算进预算，大模块走分包。

**4. 平台差异显式处理。**
不同平台在 API 命名、组件属性、样式支持上并不一致。跨平台代码必须把差异收敛到一处适配层，而不是散落在页面里。

---

## 二、结构与配置

- 一个页面四件套：逻辑、模板、样式、配置，命名必须一致。
- 全局配置只放真正全局的东西（窗口样式、tabBar、分包声明），页面级配置就近写。
- 组件与页面的职责要分清：可复用的抽成自定义组件，页面只做编排。
- 自定义组件之间的通信靠属性与事件，不要直接访问父组件实例。

---

## 三、样式与适配

- 尺寸用 `rpx` 表达布局，`px` 只用于边框与 1px 细线。
- 设计稿宽度换算：以 750 为基准，则设计稿像素即等于 `rpx` 数值。
- 局部滚动区域用 `scroll-view`，不要用外层页面的自然滚动模拟。
- `fixed` 定位元素要注意安全区，底部操作条用安全区变量做内边距。
- 样式隔离：自定义组件的样式默认不外泄，需要穿透时用穿透选择器，不要关掉隔离。

---

## 四、性能

- **合批更新**：一次 `setData` 提交多个字段，而不是循环里逐条提交。
- **最小化数据**：只传渲染需要的字段，不要把整份原始数据（列表、大对象）塞进去。
- **路径更新**：更新长列表中的一项时，用数据路径定位，而不是重传整个数组。
- **长列表**：超过百条就用分页、虚拟列表或 `recycle-view`。
- **图片**：设定尺寸模式（等比缩放 / 裁剪），小图转 base64 反而增大包体积，慎用。
- **启动**：分包预加载、按需注入，减少启动时需要解析的代码量。

---

## 五、能力调用与权限

- 涉及用户信息、位置、麦克风、相册等能力，先检查授权状态再调用；用户拒绝后要给出可操作的引导，而不是静默失败。
- 所有异步 API 都要处理失败分支，不能只写成功回调。
- 需要在页面销毁后停止的任务（定时器、监听、订阅）必须显式清理。
- 支付、登录等敏感流程，凭证与校验一律在服务端完成，客户端不做信任判断。

---

## 六、交付前自检

- [ ] 新增页面已登记到应用配置，路径可达。
- [ ] 无高频或大体积的 `setData`，列表更新走路径更新。
- [ ] 主包体积在限制内，超标内容已分包。
- [ ] 涉权能力有授权检查与拒绝后的引导。
- [ ] 页面卸载时清理了定时器与监听。
- [ ] 真机预览通过，无控制台报错。

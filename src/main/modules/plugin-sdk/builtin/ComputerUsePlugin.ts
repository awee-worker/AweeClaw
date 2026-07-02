/**
 * Computer Use 插件 - 客户端侧占位模块
 *
 * 历史背景：
 *   原本 Computer Use 是客户端内置插件，通过 builtinPluginFactory 注册 MCP 服务。
 *   现已迁移为完全自包含的市场插件（aweeclaw-plugins/plugins/computer-use/），
 *   MCP 代码在插件包 index.js 中，通过 globalThis.__AWEECLAW_HOST__ 访问 native 服务。
 *
 * 当前职责：
 *   保留此文件作为类型导出和文档参考，不再注册任何 factory。
 *   插件功能完全由市场安装触发，卸载即移除。
 *
 * @module plugin-sdk/builtin/computer-use
 */

// 此模块已废弃，所有逻辑已迁移至插件包：
//   aweeclaw-plugins/plugins/computer-use/index.js
//
// 客户端仅需 initHostServices()（在 moduleInitializer 中调用），
// 即可让插件包代码通过 globalThis.__AWEECLAW_HOST__ 访问 native 能力。

export {}

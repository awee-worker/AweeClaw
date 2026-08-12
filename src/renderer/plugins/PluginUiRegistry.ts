/**
 * PluginUiRegistry — 插件 UI 扩展点注册表
 *
 * 职责：
 * 1. 扫描已安装插件的 contributes.ui 声明（通过 IPC 获取）
 * 2. 加载插件 ui.js ESM bundle（plugin-bundle:// 协议 + bare specifier 重写）
 * 3. 把面板组件注册到 PanelRegistry（复用场景系统的面板注册机制）
 * 4. 提供合并后的 sidebarItems 和 topActions 供 NavigationRail / ConversationHeader 使用
 * 5. 支持插件热安装/卸载时的动态加载/清理
 *
 * 设计决策：
 * - 懒加载：initialize() 只拉取 contributes 元数据注册导航项（轻量），
 *   ui.js 在面板首次激活或按钮首次渲染时才 dynamic import
 * - 单例模式：整个渲染进程共用一个 registry 实例
 * - 事件驱动：加载状态变化时通知订阅者（usePluginExtensions Hook）
 *
 * @module renderer/plugins/PluginUiRegistry
 */

import type { ComponentType } from 'react'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import type { PluginSidebarPanelContribution, PluginTopActionContribution, PluginSettingsTabContribution } from '@shared/plugin-sdk/types'
import { registerPanelComponent, unregisterPanelComponent } from '@renderer/components/explorer/PanelRegistry'
import { fetchAndRewriteBundle, buildPluginBundleUrl } from './rewriteBareSpecifiers'
import { createPluginHostApi } from './PluginHostApi'
import type { PluginHostApi, PluginPanelProps, PluginUiModule, LoadedPluginUi, PluginConfigActionHandler } from './types'
import { contributionToSidebarItem } from './types'

/** 单个插件的 UI 贡献记录（来自主进程 IPC） */
interface PluginUiContribution {
  pluginKey: string
  version: string
  uiEntryAbsPath: string
  contributes: {
    ui?: { entry: string }
    sidebarPanels?: PluginSidebarPanelContribution[]
    topActions?: PluginTopActionContribution[]
    settingsTabs?: PluginSettingsTabContribution[]
  }
  mcpServerId?: string
}

/** Registry 状态变化监听器 */
type Listener = () => void

class PluginUiRegistryImpl {
  /** 已发现的插件 UI 贡献（来自 IPC，未加载 ui.js） */
  private discovered = new Map<string, PluginUiContribution>()
  /** 已加载 ui.js 的插件 UI（含模块和组件） */
  private loaded = new Map<string, LoadedPluginUi>()
  /** 正在加载中的插件（防止并发重复加载） */
  private loadingPromises = new Map<string, Promise<void>>()
  /** 状态变化监听器 */
  private listeners = new Set<Listener>()
  /** 是否已初始化 */
  private initialized = false

  /**
   * 合并后的侧边栏导航项缓存（引用稳定，供 useSyncExternalStore 使用）
   *
   * 仅在 discovered/loaded 变化时重建（见 invalidateCache）。
   * 调用方多次调用 getSidebarItems() 拿到的是同一个数组引用，
   * 避免触发 useSyncExternalStore 的无限循环。
   */
  private sidebarItemsCache: SidebarItemDescriptor[] | null = null
  /**
   * 合并后的顶部按钮缓存（引用稳定，供 useSyncExternalStore 使用）
   *
   * 同样仅在 discovered/loaded 变化时重建。
   * 注意：host 对象在缓存周期内也保持稳定，避免按钮组件不必要的重渲染。
   */
  private topActionsCache: Array<{
    pluginKey: string
    contribution: PluginTopActionContribution
    component: ComponentType<PluginPanelProps>
    host: PluginHostApi
  }> | null = null

  /**
   * 初始化：从主进程拉取所有已安装插件的 UI 贡献声明
   *
   * 只拉取元数据（contributes），不加载 ui.js（懒加载）。
   * 导航项立即可用（图标+标签），组件在首次激活时才加载。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await this.refresh()
  }

  /**
   * 刷新：重新从主进程拉取所有已安装插件的 UI 贡献声明，并 diff 更新本地状态
   *
   * 适用场景：
   * - 插件安装成功后：新插件的 contributes 会被加入 discovered，导航项/顶部按钮立即可用
   * - 插件卸载成功后：已移除的插件会被 unloadPlugin 清理（含 PanelRegistry 注销）
   * - 插件更新/启用/禁用后：版本变化或 contributes 变化会被同步
   *
   * 设计要点：
   * - 全量拉取 + diff，避免维护复杂的单插件增量同步逻辑
   * - 卸载的插件走 unloadPlugin（复用已有的 PanelRegistry 清理逻辑）
   * - 新增/更新的插件直接 set 到 discovered（覆盖旧版本）
   * - 顶部按钮若已加载旧版本，需重新加载（通过 unloadPlugin + 重新 discovered 触发）
   *
   * @returns 新增或变更的 pluginKey 列表（供调用方决定是否需要重新加载 ui.js）
   */
  async refresh(): Promise<string[]> {
    try {
      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined
      const contributions = await electronAPI?.pluginGetUiContributions?.()
      const remoteKeys = new Set<string>((contributions || []).map((c) => c.pluginKey))

      // 1. 找出已卸载/禁用的插件（本地有但远程没有），逐个清理
      const localKeys = Array.from(this.discovered.keys())
      const removedKeys = localKeys.filter((k) => !remoteKeys.has(k))
      for (const key of removedKeys) {
        console.log(`[PluginUiRegistry] Plugin removed/disabled: ${key}, unloading UI`)
        this.unloadPlugin(key)
      }

      // 2. 找出新增或变更的插件（远程有但本地没有，或版本不同）
      const changedKeys: string[] = []
      for (const c of contributions || []) {
        const existing = this.discovered.get(c.pluginKey)
        if (!existing || existing.version !== c.version) {
          // 版本变化：先卸载旧的（清理 PanelRegistry 等），再注册新的
          if (existing) {
            console.log(`[PluginUiRegistry] Plugin updated: ${c.pluginKey} (${existing.version} → ${c.version})`)
            this.unloadPlugin(c.pluginKey)
          } else {
            console.log(`[PluginUiRegistry] Plugin added: ${c.pluginKey} v${c.version}`)
          }
          this.discovered.set(c.pluginKey, c)
          changedKeys.push(c.pluginKey)
        }
      }

      // 3. 状态变更后通知订阅者（NavigationRail/PluginTopActions 会重新渲染）
      if (removedKeys.length > 0 || changedKeys.length > 0) {
        this.invalidateCache()
        this.notifyListeners()
      }

      return changedKeys
    } catch (err) {
      console.error('[PluginUiRegistry] refresh failed:', err)
      return []
    }
  }

  /**
   * 订阅 registry 状态变化
   * @returns 取消订阅函数
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 获取所有已发现插件的侧边栏面板（含未加载 ui.js 的，用于导航项显示）
   *
   * 未加载 ui.js 的插件也返回导航项（点击时触发懒加载）。
   *
   * 引用稳定：在 discovered/loaded 未变化时，多次调用返回同一个数组引用，
   * 这是 useSyncExternalStore 正常工作的前提（避免无限渲染循环）。
   * 缓存在状态变化时通过 invalidateCache() 失效。
   */
  getSidebarItems(): SidebarItemDescriptor[] {
    if (this.sidebarItemsCache) return this.sidebarItemsCache

    const items: SidebarItemDescriptor[] = []
    for (const [, contribution] of this.discovered) {
      const panels = contribution.contributes.sidebarPanels
      if (!panels) continue
      for (const panel of panels) {
        items.push(contributionToSidebarItem(panel))
      }
    }
    items.sort((a, b) => (a.position ?? 50) - (b.position ?? 50))
    this.sidebarItemsCache = items
    return items
  }

  /**
   * 获取所有已加载插件的顶部按钮组件
   *
   * 注意：topActions 需要 ui.js 已加载才能拿到组件，
   * 因此返回的是已加载的插件。未加载的插件按钮不显示
   * （或在首次渲染时触发 ensureLoaded）。
   *
   * 引用稳定：与 getSidebarItems 同理，缓存保证引用稳定。
   * host 对象在缓存周期内也保持稳定，避免按钮组件不必要的重渲染。
   */
  getTopActions(): Array<{
    pluginKey: string
    contribution: PluginTopActionContribution
    component: ComponentType<PluginPanelProps>
    host: PluginHostApi
  }> {
    if (this.topActionsCache) return this.topActionsCache

    const result: Array<{
      pluginKey: string
      contribution: PluginTopActionContribution
      component: ComponentType<PluginPanelProps>
      host: PluginHostApi
    }> = []

    for (const [pluginKey, loaded] of this.loaded) {
      if (!loaded.module.topActions || loaded.topActions.length === 0) continue
      const contribution = this.discovered.get(pluginKey)
      if (!contribution) continue

      const language = this.getCurrentLanguage()
      const host = createPluginHostApi({
        pluginKey,
        mcpServerId: contribution.mcpServerId,
        language,
      })

      for (const ta of loaded.topActions) {
        result.push({
          pluginKey,
          contribution: ta.contribution,
          component: ta.component,
          host,
        })
      }
    }
    result.sort((a, b) => (a.contribution.position ?? 50) - (b.contribution.position ?? 50))
    this.topActionsCache = result
    return result
  }

  /**
   * 使缓存失效（在 discovered/loaded 变化前调用）
   *
   * 下次 getSidebarItems()/getTopActions() 调用时会重建缓存。
   * 必须在 notifyListeners() 之前调用，确保订阅者拿到的是新引用。
   */
  private invalidateCache(): void {
    this.sidebarItemsCache = null
    this.topActionsCache = null
  }

  /**
   * 获取所有已加载插件的设置页 Tab
   *
   * 返回扁平化的 Tab 列表（含组件和 host），供 PreferencesDialog 渲染。
   * 未加载 ui.js 的插件 Tab 不返回（或由调用方触发 ensureLoaded）。
   */
  getSettingsTabs(): Array<{
    pluginKey: string
    contribution: PluginSettingsTabContribution
    component: ComponentType<PluginPanelProps>
    host: PluginHostApi
  }> {
    const result: Array<{
      pluginKey: string
      contribution: PluginSettingsTabContribution
      component: ComponentType<PluginPanelProps>
      host: PluginHostApi
    }> = []

    for (const [pluginKey, loaded] of this.loaded) {
      if (!loaded.settingsTabs || loaded.settingsTabs.length === 0) continue
      for (const st of loaded.settingsTabs) {
        result.push({
          pluginKey,
          contribution: st.contribution,
          component: st.component,
          host: st.host,
        })
      }
    }
    result.sort((a, b) => (a.contribution.position ?? 50) - (b.contribution.position ?? 50))
    return result
  }

  /**
   * 确保声明了 settingsTabs 的所有插件 ui.js 已加载
   *
   * 与 ensureTopActionsLoaded 类似：设置页 Tab 必须先加载 ui.js 才能拿到组件。
   * 在 PreferencesDialog 打开时调用，触发所有有 settingsTabs 声明的插件加载。
   */
  async ensureSettingsTabsLoaded(): Promise<void> {
    const pluginsToLoad: string[] = []
    for (const [pluginKey, contribution] of this.discovered) {
      if (contribution.contributes.settingsTabs?.length && !this.loaded.has(pluginKey)) {
        pluginsToLoad.push(pluginKey)
      }
    }
    if (pluginsToLoad.length === 0) return

    await Promise.allSettled(pluginsToLoad.map((key) => this.ensureLoaded(key)))
  }

  /**
   * 获取指定插件的 config action handler
   *
   * 供 PluginConfigForm 在用户点击 action 按钮时调用。
   * 如果插件未加载 ui.js 或未注册该 kind 的 handler，返回 undefined。
   *
   * @param pluginKey 插件 key
   * @param kind action kind（如 'fetchModels', 'testConnection'）
   */
  getConfigActionHandler(pluginKey: string, kind: string): PluginConfigActionHandler | undefined {
    const loaded = this.loaded.get(pluginKey)
    if (!loaded?.module.configActions) return undefined
    return loaded.module.configActions[kind]
  }

  /**
   * 确保指定插件的 ui.js 已加载
   *
   * 懒加载入口：面板首次激活或按钮首次渲染时调用。
   * 已加载则立即返回，正在加载则等待同一 Promise。
   *
   * @param pluginKey 插件唯一标识
   */
  async ensureLoaded(pluginKey: string): Promise<void> {
    if (this.loaded.has(pluginKey)) return
    if (this.loadingPromises.has(pluginKey)) {
      return this.loadingPromises.get(pluginKey)
    }

    const promise = this.loadPlugin(pluginKey)
    this.loadingPromises.set(pluginKey, promise)
    try {
      await promise
    } finally {
      this.loadingPromises.delete(pluginKey)
    }
  }

  /**
   * 加载单个插件的 ui.js
   *
   * 流程：
   * 1. 确保 shared dependencies 已注入（bundle 顶层会访问 window.__AWEECLAW_SHARED__）
   * 2. 从 discovered 获取贡献声明
   * 3. 构造 plugin-bundle:// URL
   * 4. fetch + 重写 bare specifier + Blob URL
   * 5. dynamic import 获取模块
   * 6. 把面板组件注册到 PanelRegistry
   * 7. 存入 loaded Map，通知监听者
   *
   * 错误处理：加载失败时记录详细错误并 rethrow，让调用方（ensureLoaded/ensurePanelLoaded）
   * 的 Promise reject，使 AdaptivePanelView 能显示"加载失败"而非卡在"加载中"。
   */
  private async loadPlugin(pluginKey: string): Promise<void> {
    const contribution = this.discovered.get(pluginKey)
    if (!contribution) {
      console.warn(`[PluginUiRegistry] No UI contribution found for plugin: ${pluginKey}`)
      return
    }

    // 兜底：确保 shared dependencies 已注入。
    // bundle 顶层代码通过 window.__AWEECLAW_SHARED__.modules.react 访问 React 等，
    // 若未注入，import(bundleUrl) 时 bundle 顶层执行会抛
    // "Cannot destructure property 'default' of undefined" 错误。
    // bootstrap.tsx 中已异步调用 injectSharedDependencies()，此处做时序兜底。
    try {
      const { sharedDependencyProvider, injectSharedDependencies } = await import(
        '@scenario-system/core/SharedDependencyProvider'
      )
      if (!sharedDependencyProvider.isInjected()) {
        console.warn('[PluginUiRegistry] Shared deps not yet injected, injecting now...')
        await injectSharedDependencies()
      }
    } catch (err) {
      console.error('[PluginUiRegistry] Failed to ensure shared deps:', err)
    }

    let blobUrl: string | null = null
    try {
      // 构造 plugin-bundle:// URL
      // uiEntryAbsPath 是绝对路径，需要从中提取目录和入口文件名
      const absPath = contribution.uiEntryAbsPath
      const lastSlash = absPath.lastIndexOf('/')
      const absDir = lastSlash >= 0 ? absPath.substring(0, lastSlash) : ''
      const entry = lastSlash >= 0 ? absPath.substring(lastSlash + 1) : absPath
      const bundleUrl = buildPluginBundleUrl(absDir, entry)

      console.log(`[PluginUiRegistry] Loading UI bundle for ${pluginKey}: ${bundleUrl}`)

      // fetch + 重写 bare specifier + Blob URL
      blobUrl = await fetchAndRewriteBundle(bundleUrl)

      // dynamic import ESM 模块
      const module = (await import(blobUrl)) as { default?: PluginUiModule }
      const uiModule = module.default
      if (!uiModule) {
        throw new Error(`Plugin ${pluginKey} ui.js has no default export`)
      }

      // 注册面板组件到 PanelRegistry
      const sidebarItems: SidebarItemDescriptor[] = []
      const topActions: LoadedPluginUi['topActions'] = []

      if (contribution.contributes.sidebarPanels) {
        // 为该插件创建一个共享的 host 实例（同插件的多个面板复用同一 host）
        const language = this.getCurrentLanguage()
        const panelHost = createPluginHostApi({
          pluginKey,
          mcpServerId: contribution.mcpServerId,
          language,
        })

        for (const panel of contribution.contributes.sidebarPanels) {
          const comp = uiModule.components?.[panel.component]
          if (comp) {
            // PanelRegistry 用 ComponentType<unknown>，插件组件是 ComponentType<PluginPanelProps>
            // 这里做类型转换（运行时无影响，仅类型层面）
            // 同时传入 host，供 AdaptivePanelView 渲染时作为 props.host 传入插件组件
            registerPanelComponent(panel.id, comp as unknown as ComponentType<unknown>, panelHost)
            sidebarItems.push(contributionToSidebarItem(panel))
            console.log(`[PluginUiRegistry] Registered panel "${panel.id}" (component: ${panel.component}) for ${pluginKey}`)
          } else {
            console.error(
              `[PluginUiRegistry] Plugin ${pluginKey} component "${panel.component}" not found in ui.js. ` +
                `Available components: ${Object.keys(uiModule.components || {}).join(', ')}`,
            )
          }
        }
      }

      if (contribution.contributes.topActions) {
        for (const ta of contribution.contributes.topActions) {
          const comp = uiModule.topActions?.[ta.component]
          if (comp) {
            topActions.push({ contribution: ta, component: comp })
            console.log(`[PluginUiRegistry] Registered topAction "${ta.id ?? ta.component}" for ${pluginKey}`)
          } else {
            console.error(
              `[PluginUiRegistry] Plugin ${pluginKey} topAction "${ta.component}" not found in ui.js. ` +
                `Available topActions: ${Object.keys(uiModule.topActions || {}).join(', ')}`,
            )
          }
        }
      }

      // 加载设置页 Tab 组件
      const settingsTabs: LoadedPluginUi['settingsTabs'] = []
      if (contribution.contributes.settingsTabs) {
        const tabHost = createPluginHostApi({
          pluginKey,
          mcpServerId: contribution.mcpServerId,
          language: this.getCurrentLanguage(),
        })
        for (const st of contribution.contributes.settingsTabs) {
          const comp = uiModule.settingsTabs?.[st.component]
          if (comp) {
            settingsTabs.push({ contribution: st, component: comp, host: tabHost })
            console.log(`[PluginUiRegistry] Registered settingsTab "${st.id}" for ${pluginKey}`)
          } else {
            console.error(
              `[PluginUiRegistry] Plugin ${pluginKey} settingsTab "${st.component}" not found in ui.js. ` +
                `Available settingsTabs: ${Object.keys(uiModule.settingsTabs || {}).join(', ')}`,
            )
          }
        }
      }

      this.loaded.set(pluginKey, {
        pluginKey,
        module: uiModule,
        sidebarItems,
        topActions,
        settingsTabs,
      })
      this.invalidateCache()
      this.notifyListeners()
      console.log(`[PluginUiRegistry] UI loaded successfully for ${pluginKey}`)
    } catch (err) {
      // 记录详细错误并 rethrow，让调用方的 Promise reject
      // 这样 AdaptivePanelView 能捕获并显示"加载失败"，而非卡在"加载中"
      const errMsg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      console.error(`[PluginUiRegistry] Failed to load ui.js for plugin ${pluginKey}:`, errMsg)
      throw err
    } finally {
      // 加载完成（无论成功失败）后释放 Blob URL（模块已缓存或已失败）
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl)
        } catch {
          // ignore revoke errors
        }
      }
    }
  }

  /**
   * 卸载插件 UI（插件被卸载/禁用时调用）
   *
   * 清理 PanelRegistry 注册、移除导航项、释放资源。
   */
  unloadPlugin(pluginKey: string): void {
    const contribution = this.discovered.get(pluginKey)

    // 从 PanelRegistry 移除面板组件
    if (contribution?.contributes.sidebarPanels) {
      for (const panel of contribution.contributes.sidebarPanels) {
        unregisterPanelComponent(panel.id)
      }
    }

    this.loaded.delete(pluginKey)
    this.discovered.delete(pluginKey)
    this.invalidateCache()
    this.notifyListeners()
  }

  /**
   * 重新加载插件（更新时调用）
   */
  async reloadPlugin(pluginKey: string): Promise<void> {
    this.unloadPlugin(pluginKey)
    // 重新从主进程拉取该插件的贡献
    try {
      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined
      const contributions = await electronAPI?.pluginGetUiContributions?.()
      const c = contributions?.find((item: PluginUiContribution) => item.pluginKey === pluginKey)
      if (c) {
        this.discovered.set(pluginKey, c)
        await this.ensureLoaded(pluginKey)
      }
    } catch (err) {
      console.error(`[PluginUiRegistry] reloadPlugin failed for ${pluginKey}:`, err)
    }
  }

  /**
   * 检查指定 panelId 是否属于某个插件（用于 AdaptivePanelView 兜底加载）
   */
  isPluginPanel(panelId: string): boolean {
    for (const [, contribution] of this.discovered) {
      const panels = contribution.contributes.sidebarPanels
      if (panels?.some((p) => p.id === panelId)) {
        return true
      }
    }
    return false
  }

  /**
   * 根据 panelId 找到所属插件并确保其 ui.js 已加载
   */
  async ensurePanelLoaded(panelId: string): Promise<void> {
    for (const [pluginKey, contribution] of this.discovered) {
      const panels = contribution.contributes.sidebarPanels
      if (panels?.some((p) => p.id === panelId)) {
        await this.ensureLoaded(pluginKey)
        return
      }
    }
  }

  /**
   * 确保所有声明了 topActions 的插件 ui.js 已加载
   *
   * 顶部按钮与面板不同：面板可以懒加载（点击时触发），但顶部按钮必须先加载
   * ui.js 才能显示组件。此方法在 PluginTopActions 挂载时调用，
   * 触发所有有 topActions 声明的插件加载。
   *
   * 并发加载所有插件以加快速度，单个插件加载失败不影响其他插件。
   */
  async ensureTopActionsLoaded(): Promise<void> {
    const pluginsToLoad: string[] = []
    for (const [pluginKey, contribution] of this.discovered) {
      // 只加载声明了 topActions 且尚未加载的插件
      if (contribution.contributes.topActions?.length && !this.loaded.has(pluginKey)) {
        pluginsToLoad.push(pluginKey)
      }
    }
    if (pluginsToLoad.length === 0) return

    // 并发加载，单个失败不影响其他
    await Promise.allSettled(pluginsToLoad.map((key) => this.ensureLoaded(key)))
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // ignore listener errors
      }
    }
  }

  private getCurrentLanguage(): 'zh' | 'en' {
    // 从 localStorage 读取语言设置（与 store 持久化一致）
    try {
      const stored = localStorage.getItem('language')
      if (stored === 'en' || stored === 'zh') return stored
    } catch {
      // ignore
    }
    return 'zh'
  }
}

/** 插件 UI 注册表单例 */
export const pluginUiRegistry = new PluginUiRegistryImpl()

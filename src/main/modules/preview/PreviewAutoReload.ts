/**
 * 内置预览自动刷新
 *
 * 预览本地静态页面时，文件改了还得手动点一次刷新——AI 改完页面再让用户点刷新，
 * 说不过去。这里只为「正在被预览的目录」挂监听，命中前端资源改动就把对应标签页
 * 重载一次。
 *
 * 为什么不复用工作区的通用文件监听：
 * - 通用监听只覆盖工作区首个根目录，且默认忽略 dist / build；而预览目录完全可能
 *   在工作区之外，或者本身就是构建产物目录（预览 dist 时恰好收不到通知）。
 * - 预览目录数量少、生命周期与标签页一致，单独监听的开销和影响面都更小。
 *
 * 事件抖动（编辑器保存 + 构建工具批量写入）由固定节拍合并，一个节拍只推一次。
 */

import * as path from 'node:path'
import * as watcher from '@parcel/watcher'
import type { WebContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { PREVIEW_AUTO_RELOAD_CHANNEL } from '@shared/protocols/previewProtocol'

/** 会触发整页重载的扩展名：标记 / 样式 / 脚本与常见模板 */
const RELOAD_EXTENSIONS = new Set([
    '.html',
    '.htm',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.tsx',
    '.json',
    '.svg',
    '.vue',
    '.svelte',
    '.astro',
])

/** 不参与自动刷新的目录名：依赖与版本库，变动频繁且与预览内容无关 */
const IGNORED_DIRS = new Set(['node_modules', '.git'])

/** 合并节拍：一次构建会连续产生大量文件事件 */
const FLUSH_INTERVAL_MS = 180

/** 单个预览目标（某个窗口里的一个标签页） */
interface PreviewTarget {
    owner: WebContents
    url: string
}

interface WatchedRoot {
    dir: string
    subscription: watcher.AsyncSubscription | null
    /** 订阅启动过程，避免并发重复订阅；停止时也要等它落地 */
    starting: Promise<void> | null
    /** key = `${ownerId}::${url}` */
    targets: Map<string, PreviewTarget>
    /** 本拍待刷新的目标 key */
    pending: Set<string>
    timer: ReturnType<typeof setTimeout> | null
}

function targetKey(ownerId: number, url: string): string {
    return `${ownerId}::${url}`
}

/** 该文件路径是否值得触发重载 */
function shouldReload(filePath: string): boolean {
    const segments = filePath.split(/[\\/]/)
    if (segments.some((segment) => IGNORED_DIRS.has(segment))) return false
    return RELOAD_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

class PreviewAutoReload {
    private readonly roots = new Map<string, WatchedRoot>()
    /** 已挂过销毁监听的窗口，避免重复注册 */
    private readonly hookedOwners = new Set<number>()

    /**
     * 为一个预览目录登记自动刷新
     *
     * @param dir 预览根目录（预览静态服务注册的那个目录）
     * @param url 该目录下正在预览的页面地址
     * @param owner 承载 webview 的窗口 contents
     */
    watch(dir: string, url: string, owner: WebContents): void {
        const key = path.resolve(dir)
        let root = this.roots.get(key)

        if (!root) {
            root = {
                dir: key,
                subscription: null,
                starting: null,
                targets: new Map(),
                pending: new Set(),
                timer: null,
            }
            this.roots.set(key, root)
            void this.start(root)
        }

        root.targets.set(targetKey(owner.id, url), { owner, url })
        this.hookOwner(owner)
    }

    /**
     * 取消自动刷新
     *
     * 只给 url 时移除该地址在任意窗口下的登记；目录下再无目标则关闭监听。
     */
    unwatch(dir: string, url?: string, ownerId?: number): void {
        const key = path.resolve(dir)
        const root = this.roots.get(key)
        if (!root) return

        if (!url) {
            root.targets.clear()
        } else if (ownerId !== undefined) {
            root.targets.delete(targetKey(ownerId, url))
        } else {
            root.targets.forEach((target, entryKey) => {
                if (target.url === url) root.targets.delete(entryKey)
            })
        }

        if (root.targets.size === 0) {
            void this.stop(key)
        }
    }

    /** 应用退出时释放全部监听 */
    dispose(): void {
        for (const key of [...this.roots.keys()]) {
            void this.stop(key)
        }
        this.hookedOwners.clear()
    }

    /** 窗口销毁后清掉它名下的目标，避免向已销毁的 contents 推送 */
    private hookOwner(owner: WebContents): void {
        if (this.hookedOwners.has(owner.id)) return
        this.hookedOwners.add(owner.id)

        owner.once('destroyed', () => {
            this.hookedOwners.delete(owner.id)
            this.dropOwner(owner.id)
        })
    }

    private dropOwner(ownerId: number): void {
        for (const [key, root] of this.roots) {
            root.targets.forEach((target, entryKey) => {
                if (target.owner.id === ownerId) root.targets.delete(entryKey)
            })
            if (root.targets.size === 0) {
                void this.stop(key)
            }
        }
    }

    /** 启动目录监听（幂等） */
    private start(root: WatchedRoot): Promise<void> {
        if (root.subscription) return Promise.resolve()
        if (root.starting) return root.starting

        root.starting = watcher
            .subscribe(root.dir, (err, events) => {
                if (err) {
                    logger.system.warn('[PreviewAutoReload] Watch error:', err)
                    return
                }
                this.handleEvents(root, events)
            })
            .then((subscription) => {
                root.subscription = subscription
                root.starting = null
                logger.system.info(`[PreviewAutoReload] Watching ${root.dir}`)
            })
            .catch((err) => {
                root.starting = null
                logger.system.warn(`[PreviewAutoReload] Failed to watch ${root.dir}:`, err)
            })

        return root.starting
    }

    private async stop(dir: string): Promise<void> {
        const root = this.roots.get(dir)
        if (!root) return

        this.roots.delete(dir)
        if (root.timer) {
            clearTimeout(root.timer)
        }

        try {
            // 订阅可能仍在启动中，等它落地再释放，避免留下野订阅
            if (root.starting) await root.starting
            await root.subscription?.unsubscribe()
        } catch (err) {
            logger.system.warn('[PreviewAutoReload] Failed to stop watcher:', err)
        }
    }

    /** 收集值得重载的事件并安排节拍推送 */
    private handleEvents(root: WatchedRoot, events: watcher.Event[]): void {
        const worthReloading = events.some((event) => shouldReload(event.path))
        if (!worthReloading) return

        root.targets.forEach((_target, key) => root.pending.add(key))
        if (root.timer) return

        root.timer = setTimeout(() => {
            root.timer = null
            this.flush(root)
        }, FLUSH_INTERVAL_MS)
    }

    /** 节拍点：把待刷新目标按窗口合并成一次推送 */
    private flush(root: WatchedRoot): void {
        const pending = [...root.pending]
        root.pending.clear()
        if (pending.length === 0) return

        const byOwner = new Map<number, { owner: WebContents; urls: string[] }>()

        for (const key of pending) {
            const target = root.targets.get(key)
            if (!target || target.owner.isDestroyed()) continue

            const entry = byOwner.get(target.owner.id)
            if (entry) {
                entry.urls.push(target.url)
            } else {
                byOwner.set(target.owner.id, { owner: target.owner, urls: [target.url] })
            }
        }

        byOwner.forEach(({ owner, urls }) => {
            try {
                owner.send(PREVIEW_AUTO_RELOAD_CHANNEL, { urls })
            } catch (err) {
                logger.system.warn('[PreviewAutoReload] Failed to push reload:', err)
            }
        })
    }
}

export const previewAutoReload = new PreviewAutoReload()

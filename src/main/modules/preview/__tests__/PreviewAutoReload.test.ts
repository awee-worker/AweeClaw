/**
 * 内置预览自动刷新的事件过滤测试
 *
 * 覆盖一个真实踩过的坑：预览根目录就是工作区根目录时，应用自身的落盘文件
 * （.aweeclaw/workspace-state.json 这类）也落在被监听的目录里，一旦被当成
 * 「页面文件变了」，就会把标签页拉起来；而重新拉起的页面又会回写工作区状态，
 * 于是「重载 → 落盘 → 重载」自己转个不停，会话结束后也停不下来。
 *
 * 这里把「哪些变化才算页面变化」固定下来。
 */

import { describe, it, expect } from 'vitest'
import { shouldReload } from '../PreviewAutoReload'

const SITE_ROOT = '/workspace/site'

describe('PreviewAutoReload 事件过滤', () => {
    it('页面资源变化触发重载', () => {
        expect(shouldReload(SITE_ROOT, '/workspace/site/index.html')).toBe(true)
        expect(shouldReload(SITE_ROOT, '/workspace/site/about.html')).toBe(true)
        expect(shouldReload(SITE_ROOT, '/workspace/site/assets/style.css')).toBe(true)
        expect(shouldReload(SITE_ROOT, '/workspace/site/main.js')).toBe(true)
        expect(shouldReload(SITE_ROOT, '/workspace/site/data.json')).toBe(true)
    })

    it('预览根目录为工作区根目录时，应用自身的落盘文件不触发重载', () => {
        // 工作区状态：应用每次导航都会回写，正是回环的起点
        expect(shouldReload('/workspace', '/workspace/.aweeclaw/workspace-state.json')).toBe(false)
        expect(
            shouldReload(
                '/workspace',
                '/workspace/.aweeclaw/workspace-state.json.1234.1790777136328.aweeclaw-tmp',
            ),
        ).toBe(false)
        // 文件快照：AI 每改一次页面就写一份，与页面内容无关
        expect(
            shouldReload('/workspace', '/workspace/.history/site/index_20260930165419.html'),
        ).toBe(false)
        // 依赖与版本库
        expect(shouldReload('/workspace', '/workspace/node_modules/pkg/index.js')).toBe(false)
        expect(shouldReload('/workspace', '/workspace/.git/HEAD')).toBe(false)
    })

    it('不相干的扩展名不触发重载', () => {
        expect(shouldReload(SITE_ROOT, '/workspace/site/README.md')).toBe(false)
        expect(shouldReload(SITE_ROOT, '/workspace/site/run.log')).toBe(false)
    })

    it('工作区祖先目录名里的点不算页面内的点路径段', () => {
        expect(shouldReload('/Users/me/.projects/site', '/Users/me/.projects/site/index.html')).toBe(
            true,
        )
    })
})

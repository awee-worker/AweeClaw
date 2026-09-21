/**
 * 「用系统浏览器打开本地页面」命令识别测试
 *
 * 约定：
 * 1. 只识别页面类目标（.html/.htm 文件、file:// 本地页面、回环地址服务）
 * 2. 目录、文档、普通应用启动一律放行给原命令
 * 3. 复合命令不介入
 */

import { describe, it, expect } from 'vitest'
import { detectLocalPageOpenCommand } from '../localPageOpenGuard'

const WORKSPACE = '/Users/me/project'

describe('detectLocalPageOpenCommand', () => {
    it('识别 macOS open + 相对路径页面文件', () => {
        const hit = detectLocalPageOpenCommand('open index.html', WORKSPACE)
        expect(hit?.filePath).toBe(`${WORKSPACE}/index.html`)
        expect(hit?.url).toBeUndefined()
    })

    it('识别绝对路径页面文件', () => {
        const hit = detectLocalPageOpenCommand('open /tmp/site/index.html', null)
        expect(hit?.filePath).toBe('/tmp/site/index.html')
    })

    it('识别带开关与引号的写法', () => {
        expect(detectLocalPageOpenCommand('open -n "my site/page.html"', WORKSPACE)?.filePath)
            .toBe(`${WORKSPACE}/my site/page.html`)
        expect(detectLocalPageOpenCommand('open -a "Google Chrome" page.htm', WORKSPACE)?.filePath)
            .toBe(`${WORKSPACE}/page.htm`)
    })

    it('识别 Linux xdg-open 与 Windows start', () => {
        expect(detectLocalPageOpenCommand('xdg-open ./dist/page.html', WORKSPACE)?.filePath)
            .toBe(`${WORKSPACE}/dist/page.html`)
        expect(detectLocalPageOpenCommand('start "" page.html', WORKSPACE)?.filePath)
            .toBe(`${WORKSPACE}/page.html`)
    })

    it('识别 file:// 形式与回环地址', () => {
        expect(detectLocalPageOpenCommand('open file:///tmp/site/index.html', null)?.filePath)
            .toBe('/tmp/site/index.html')
        expect(detectLocalPageOpenCommand('open http://localhost:8712/index.html', null)?.url)
            .toBe('http://localhost:8712/index.html')
        expect(detectLocalPageOpenCommand('open http://127.0.0.1:5173', null)?.url)
            .toBe('http://127.0.0.1:5173')
    })

    it('不介入非页面目标', () => {
        expect(detectLocalPageOpenCommand('open .', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('open README.md', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('open -a TextEdit notes.txt', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('open https://example.com', WORKSPACE)).toBeNull()
    })

    it('不介入复合命令与其他命令', () => {
        expect(detectLocalPageOpenCommand('open index.html && echo done', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('open index.html | head', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('npm run dev', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('python3 -m http.server 8000', WORKSPACE)).toBeNull()
    })

    it('相对路径缺少基准目录时不介入', () => {
        expect(detectLocalPageOpenCommand('open index.html', null)).toBeNull()
    })

    it('页面文件带查询串时按文件判定', () => {
        expect(detectLocalPageOpenCommand('open page.html?debug=1', WORKSPACE)?.filePath)
            .toBe(`${WORKSPACE}/page.html`)
    })
})

/**
 * 「用系统浏览器打开页面」命令识别测试
 *
 * 约定：
 * 1. 识别页面类目标（.html/.htm 文件、file:// 本地页面、任意 http/https 地址），
 *    命中后由执行层改走内置浏览器，维持浏览器互斥（同一页面只在一处展示）
 * 2. 目录、文档、普通应用启动一律放行给原命令
 * 3. 复合命令不介入改写，但 hasSystemBrowserOpenCommand 仍可识别其中的打开器
 *    （供执行层在命令成功后同步关闭内置预览标签页）
 */

import { describe, it, expect } from 'vitest'
import { detectLocalPageOpenCommand, hasSystemBrowserOpenCommand } from '../localPageOpenGuard'

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

    it('识别 file:// 形式与任意 http/https 地址', () => {
        expect(detectLocalPageOpenCommand('open file:///tmp/site/index.html', null)?.filePath)
            .toBe('/tmp/site/index.html')
        expect(detectLocalPageOpenCommand('open http://localhost:8712/index.html', null)?.url)
            .toBe('http://localhost:8712/index.html')
        expect(detectLocalPageOpenCommand('open http://127.0.0.1:5173', null)?.url)
            .toBe('http://127.0.0.1:5173')
        // 外网页面同样改走内置浏览器：避免「内置已开、外部又开一份」
        expect(detectLocalPageOpenCommand('open https://example.com', WORKSPACE)?.url)
            .toBe('https://example.com')
        expect(detectLocalPageOpenCommand('start https://example.com/docs?tab=api', null)?.url)
            .toBe('https://example.com/docs?tab=api')
    })

    it('不介入非页面目标', () => {
        expect(detectLocalPageOpenCommand('open .', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('open README.md', WORKSPACE)).toBeNull()
        expect(detectLocalPageOpenCommand('open -a TextEdit notes.txt', WORKSPACE)).toBeNull()
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

describe('hasSystemBrowserOpenCommand', () => {
    it('识别独立的打开命令', () => {
        expect(hasSystemBrowserOpenCommand('open index.html')).toBe(true)
        expect(hasSystemBrowserOpenCommand('xdg-open ./dist/page.html')).toBe(true)
        expect(hasSystemBrowserOpenCommand('start "" page.html')).toBe(true)
        expect(hasSystemBrowserOpenCommand('cmd /c start https://example.com')).toBe(true)
    })

    it('识别复合命令中的打开器', () => {
        expect(hasSystemBrowserOpenCommand('python3 -m http.server 8000 & open http://localhost:8000')).toBe(true)
        expect(hasSystemBrowserOpenCommand('cd dist && open index.html')).toBe(true)
        expect(hasSystemBrowserOpenCommand('npm run dev; start http://localhost:5173')).toBe(true)
    })

    it('识别 dev server 的 --open 开关', () => {
        expect(hasSystemBrowserOpenCommand('vite --open')).toBe(true)
        expect(hasSystemBrowserOpenCommand('npm run dev -- --open')).toBe(true)
    })

    it('不误伤普通命令', () => {
        expect(hasSystemBrowserOpenCommand('npm run dev')).toBe(false)
        expect(hasSystemBrowserOpenCommand('python3 -m http.server 8000')).toBe(false)
        expect(hasSystemBrowserOpenCommand('node -e "console.log(1)"')).toBe(false)
    })
})
/**
 * 内置预览静态服务测试
 *
 * 覆盖预览本地页面依赖的几条硬约定：
 * 1. 目录下的 index.html 与相对资源（style.css / main.js）都能取到，且 Content-Type 正确
 * 2. 目录之外的文件不可被请求到
 * 3. 点开头的路径段（.env / .git 等）拒绝
 * 4. 敏感系统目录不允许注册为预览根目录
 * 5. 最近注册的根目录优先（同名 index.html 不会互相串台）
 */

import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { previewStaticServer } from '../PreviewStaticServer'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awee-preview-'))

function writeSite(name: string, indexBody: string): string {
    const dir = path.join(tmpRoot, name)
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), indexBody)
    fs.writeFileSync(path.join(dir, 'assets', 'style.css'), 'body{color:red}')
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1')
    return dir
}

const siteA = writeSite('site-a', '<html>A</html>')
const siteB = writeSite('site-b', '<html>B</html>')

afterAll(async () => {
    await previewStaticServer.dispose()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('PreviewStaticServer', () => {
    it('服务页面文件与相对资源，并给出正确的 Content-Type', async () => {
        const origin = await previewStaticServer.registerRoot(siteA)
        expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

        const page = await fetch(`${origin}/index.html`)
        expect(page.status).toBe(200)
        expect(page.headers.get('content-type')).toContain('text/html')
        expect(await page.text()).toBe('<html>A</html>')

        const css = await fetch(`${origin}/assets/style.css`)
        expect(css.status).toBe(200)
        expect(css.headers.get('content-type')).toContain('text/css')
        expect(await css.text()).toBe('body{color:red}')
    })

    it('根路径回落到最近注册根目录的 index.html', async () => {
        const origin = await previewStaticServer.registerRoot(siteB)
        const res = await fetch(`${origin}/`)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('<html>B</html>')
    })

    it('拒绝目录外的文件与目录穿越', async () => {
        const origin = await previewStaticServer.registerRoot(siteA)
        expect((await fetch(`${origin}/../${path.basename(tmpRoot)}/site-b/index.html`)).status).toBe(404)
        expect((await fetch(`${origin}/%2e%2e/etc/passwd`)).status).toBe(404)
    })

    it('拒绝点开头的路径段', async () => {
        const origin = await previewStaticServer.registerRoot(siteA)
        expect((await fetch(`${origin}/.env`)).status).toBe(404)
        expect((await fetch(`${origin}/.git/config`)).status).toBe(404)
    })

    it('敏感系统目录不能注册为预览根目录', async () => {
        expect(await previewStaticServer.registerRoot('/etc')).toBeNull()
    })

    it('不存在的目录不能注册', async () => {
        expect(await previewStaticServer.registerRoot(path.join(tmpRoot, 'missing'))).toBeNull()
    })
})

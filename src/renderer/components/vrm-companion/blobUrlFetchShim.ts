/**
 * `blob:file://` 贴图加载修复（VRM 桌面伴侣）
 *
 * ── 真实根因（2026-09 定位）────────────────────────────────────────────
 * 桌面伴侣窗口通过 `loadFile` 加载，页面 origin 是 `file://`（Chromium 视为 opaque origin）。
 * `.vrm` 是 GLB，贴图以 bufferView 内嵌在二进制里；three.js `GLTFLoader` 会为每张内嵌贴图
 * 调用 `URL.createObjectURL(blob)` 得到 `blob:file:///<uuid>`，再交给 `ImageBitmapLoader`
 * 加载 —— 而 `ImageBitmapLoader` 内部走的是 **`fetch(url)`**。
 *
 * Chromium 禁止对 opaque origin（`file://`）创建的 blob URL 执行 fetch：
 *   fetch('blob:file:///…') → TypeError: Failed to fetch
 * （同页的 `<img src="blob:…">` 与 `createImageBitmap(blob)` 都是允许的，只有 fetch 被挡。）
 *
 * 后果：所有内嵌贴图加载失败 → MToon 材质拿不到 `map` → 只剩 `litFactor`（多数部位为白色）
 * → 角色渲染成「白色、没有彩色」的剪影，同时控制台出现
 * `THREE.GLTFLoader: Couldn't load texture blob:file:///…`。
 * 开发态跑在 `http://localhost`（正常 origin），因此不复现 —— 这也是此前误判为
 * 「透明窗口 alpha 合成问题」的原因。
 *
 * ── 修复方式 ────────────────────────────────────────────────────────
 * 记录本页创建过的 blob URL → Blob 映射；`fetch` 命中这些 URL 时直接返回
 * `new Response(blob)`（语义等价于浏览器对普通 origin blob URL 的处理），其它请求一律透传。
 * 只在 `file://` 页面安装，避免影响 http(s) 等正常上下文。
 */

let installed = false

/** 安装修复（幂等）。作为副作用模块被 import 时自动调用。 */
export function installBlobUrlFetchShim(): void {
  if (installed) return
  installed = true

  // 仅在 file:// 页面存在该限制；其它协议不动 fetch，避免无谓副作用
  if (typeof window === 'undefined' || window.location?.protocol !== 'file:') return

  try {
    /** 本页创建的 blob URL → Blob（仅记录，不改写原有语义） */
    const blobRegistry = new Map<string, Blob>()

    const nativeCreateObjectURL = URL.createObjectURL.bind(URL)
    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL)

    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      const url = nativeCreateObjectURL(obj)
      if (obj instanceof Blob) blobRegistry.set(url, obj)
      return url
    }

    URL.revokeObjectURL = (url: string): void => {
      blobRegistry.delete(url)
      nativeRevokeObjectURL(url)
    }

    const nativeFetch = window.fetch.bind(window)

    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('blob:')) {
        const blob = blobRegistry.get(url)
        if (blob) return Promise.resolve(new Response(blob))
      }
      return nativeFetch(input, init)
    }
  } catch (err) {
    // 修复安装失败也不能影响窗口启动：贴图加载失败最多表现为无贴图，不应连带白屏
    console.warn('[VrmBlobUrlShim] install failed:', err)
  }
}

// 副作用：被 import 即生效（入口处在其它模块之前 import 本文件）
installBlobUrlFetchShim()

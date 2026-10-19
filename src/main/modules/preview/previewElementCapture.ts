/**
 * 预览元素截图
 *
 * 把一个元素在页面上的实际画面裁出来，供 AI 判断视觉问题（间距、配色、对齐）。
 * 这类判断看一张小图比读 computed style 准得多，成本也只有几十 KB。
 *
 * 两处消费同一份实现：渲染层的 AI 修改面板（IPC preview:capture-element）
 * 与 MCP 的 browser_element_context 的 include_screenshot 选项，
 * 避免两条路径裁出尺寸与位置不一致的图。
 */
import type { WebContents } from 'electron'
import { buildElementRectProbe, type ElementCapture, type ElementRect } from './previewDomProbe'

/** 截图最长边：超出等比缩小，足够看清样式，又不会把响应撑爆 */
const CAPTURE_MAX_EDGE = 1_200

/** 在页面里执行探测脚本并解析 JSON，失败返回 null */
async function runProbe<T>(guest: WebContents, expression: string): Promise<T | null> {
  try {
    const raw = await guest.executeJavaScript(expression, true)
    if (typeof raw !== 'string' || !raw) return null
    const parsed = JSON.parse(raw) as T & { ok?: boolean }
    if (parsed && parsed.ok === false) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 把元素滚动进视口
 *
 * 视口外的区域 capturePage 只会给空白，截图前必须先把元素挪到可见区。
 * 平滑滚动会让紧接着读到的 rect 停在滚动前的位置，这里临时压掉它。
 */
async function scrollIntoView(guest: WebContents, selector: string): Promise<void> {
  const probe = `(function () {
    try {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return '0';
      var root = document.documentElement;
      var prev = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      root.style.scrollBehavior = prev;
      return '1';
    } catch (e) { return '0'; }
  })()`

  try {
    await guest.executeJavaScript(probe, true)
  } catch {
    // 滚动失败不影响后续截图，按当前视口位置继续
  }
}

/**
 * 截取单个元素的画面
 *
 * @returns base64 PNG；元素不存在、不可见或截图失败时为 null
 */
export async function captureElementImage(
  guest: WebContents,
  selector: string,
): Promise<ElementCapture | null> {
  const target = selector.trim()
  if (!target) return null

  await scrollIntoView(guest, target)

  const rect = await runProbe<ElementRect>(guest, buildElementRectProbe(target))
  if (!rect || !rect.width || !rect.height) return null

  // CSS 像素 → DIP：页面缩放下两者不相等，直接拿 CSS 值裁剪会偏
  const zoom = guest.getZoomFactor() || 1
  const bounds = {
    x: Math.max(0, Math.round(rect.x * zoom)),
    y: Math.max(0, Math.round(rect.y * zoom)),
    width: Math.max(1, Math.round(rect.width * zoom)),
    height: Math.max(1, Math.round(rect.height * zoom)),
  }

  try {
    let image = await guest.capturePage(bounds)
    if (image.isEmpty()) return null

    const longest = Math.max(bounds.width, bounds.height)
    if (longest > CAPTURE_MAX_EDGE) {
      const scale = CAPTURE_MAX_EDGE / longest
      image = image.resize({
        width: Math.max(1, Math.round(bounds.width * scale)),
        height: Math.max(1, Math.round(bounds.height * scale)),
      })
    }

    const size = image.getSize()
    const dataUrl = image.toDataURL()
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)

    return { base64, mimeType: 'image/png', width: size.width, height: size.height }
  } catch {
    return null
  }
}

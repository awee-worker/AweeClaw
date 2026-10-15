/**
 * 预览页面 DOM 探测脚本
 *
 * 一组注入到 webview guest 页面执行的只读/轻交互脚本，供两处消费：
 * - BuiltinBrowserMcpServer：快照、点击定位、文本输入、等待文本
 * - PreviewHealthMonitor：白屏确认时的内容摘要采集
 *
 * 设计约定：
 * - 一律返回 JSON 字符串：与页面结构化解耦，解析失败也不影响主进程兜底
 * - 只依赖标准 DOM API，不注入依赖、不改页面全局状态
 * - 交互元素集合用同一段选择器 + 同样的遍历顺序采集，
 *   保证 browser_snapshot 的 index 与 browser_click 的 index 定位一致
 */

/** 交互元素选择器：按钮、链接、表单控件与常见的 ARIA 角色 */
export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label[for]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[onclick]',
  '[contenteditable="true"]',
].join(',')

/** 快照采集的元素条数上限：超出部分丢弃，避免长页面撑爆返回值 */
const MAX_SNAPSHOT_ELEMENTS = 300

/** 页面正文文本采样上限 */
export const PAGE_TEXT_SAMPLE_LIMIT = 3000

/**
 * 交互元素采集函数（页面侧）
 *
 * 按 querySelectorAll 顺序遍历，跳过不可见元素；index 保留原始遍历序号，
 * 点击按 index 定位时用同一份元素表复现，保证两步操作指向同一目标。
 */
const COLLECT_ELEMENTS_SOURCE = `
function __aweeCollect() {
  var selector = ${JSON.stringify(INTERACTIVE_SELECTOR)};
  var els = Array.prototype.slice.call(document.querySelectorAll(selector));
  var out = [];
  for (var i = 0; i < els.length; i++) {
    if (out.length >= ${MAX_SNAPSHOT_ELEMENTS}) break;
    var el = els[i];
    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      var rect = el.getBoundingClientRect();
      if (rect.width <= 1 && rect.height <= 1) continue;
      var label = (el.innerText || el.value || el.getAttribute('aria-label')
        || el.getAttribute('placeholder') || el.getAttribute('title') || '');
      out.push({
        index: i,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || undefined,
        text: String(label).replace(/\\s+/g, ' ').trim().slice(0, 120) || undefined,
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
        href: el.tagName === 'A' ? (el.getAttribute('href') || undefined) : undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      });
    } catch (e) { /* 单个元素异常不中断整表采集 */ }
  }
  return out;
}
`

/** 页面内文本归一化函数：折叠空白、转小写，供文本匹配用 */
const NORMALIZE_SOURCE = `
function __aweeNormalize(s) {
  return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().toLowerCase();
}
`

/**
 * 按条件定位元素（页面侧函数）
 *
 * filter 三选一：index（快照序号，最稳）/ selector（CSS 选择器）/ text（可见文本，
 * 两轮匹配：先全等后包含）。命中后滚动到视口中央，便于后续真实点击。
 */
const FIND_ELEMENT_SOURCE = `
function __aweeFind(filter) {
  var el = null;
  if (typeof filter.index === 'number') {
    var els = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)}));
    el = els[filter.index] || null;
  } else if (filter.selector) {
    try { el = document.querySelector(filter.selector); }
    catch (e) { return { error: 'Invalid selector: ' + e.message }; }
  } else if (filter.text) {
    ${NORMALIZE_SOURCE}
    var target = __aweeNormalize(filter.text);
    var candidates = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)}));
    for (var round = 0; round < 2 && !el; round++) {
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        var style = window.getComputedStyle(c);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        var rect = c.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        var label = __aweeNormalize(
          (c.innerText || '') + ' ' + (c.value || '') + ' ' + (c.getAttribute('aria-label') || '')
        );
        if (round === 0 ? label === target : label.indexOf(target) !== -1) { el = c; break; }
      }
    }
  }
  if (!el) {
    var hint = filter.selector ? (' for selector: ' + filter.selector)
      : (typeof filter.index === 'number' ? (' for index: ' + filter.index)
        : (filter.text ? (' for text: ' + filter.text) : ''));
    return { error: 'No matching element' + hint };
  }
  return { el: el };
}
`

/** 快照探测表达式：交互元素表 + 页面标题/地址 + 正文文本采样 */
export const SNAPSHOT_PROBE = `${COLLECT_ELEMENTS_SOURCE}
(function () {
  var els = __aweeCollect();
  var bodyText = '';
  try { bodyText = (document.body ? document.body.innerText : '').trim(); } catch (e) {}
  return JSON.stringify({
    title: document.title,
    url: location.href,
    interactiveCount: els.length,
    elements: els,
    textSample: bodyText.slice(0, ${PAGE_TEXT_SAMPLE_LIMIT})
  });
})()`

/** 定位探测返回的元素描述（主进程侧解析用） */
export interface ResolvedElement {
  ok: true
  tag: string
  text: string
  /** 元素中心点（视口 CSS 像素），供 sendInputEvent 使用 */
  x: number
  y: number
  /** 是否为可输入元素（input/textarea/contenteditable） */
  editable: boolean
}

/** 元素定位条件：三选一，index 优先 */
export interface ElementFilter {
  index?: number
  text?: string
  selector?: string
}

/** 定位探测表达式：命中后滚动进视口，返回中心坐标与元素描述 */
export function buildResolveProbe(filter: ElementFilter): string {
  return `${FIND_ELEMENT_SOURCE}
(function () {
  var found = __aweeFind(${JSON.stringify(filter)});
  if (found.error) return JSON.stringify({ ok: false, error: found.error });
  var el = found.el;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var rect = el.getBoundingClientRect();
  return JSON.stringify({
    ok: true,
    tag: el.tagName.toLowerCase(),
    text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
    editable: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
  });
})()`
}

/** 输入探测表达式：定位元素并写入文本（React 受控组件用原型 setter 触发） */
export function buildTypeProbe(filter: ElementFilter, text: string, clear: boolean): string {
  const payload = JSON.stringify({ filter, text, clear })
  return `${FIND_ELEMENT_SOURCE}
(function () {
  var payload = ${payload};
  var found = __aweeFind(payload.filter);
  if (found.error) return JSON.stringify({ ok: false, error: found.error });
  var el = found.el;
  el.focus();
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  if (el.isContentEditable === true) {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, payload.text);
    return JSON.stringify({ ok: true, tag: el.tagName.toLowerCase(), value: String(el.textContent || '').slice(0, 200) });
  }
  if (el.tagName === 'SELECT') {
    el.value = payload.text;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ ok: true, tag: 'select', value: String(el.value || '').slice(0, 200) });
  }
  var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, 'value');
  var next = payload.clear ? payload.text : (String(el.value || '') + payload.text);
  if (desc && desc.set) { desc.set.call(el, next); } else { el.value = next; }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ ok: true, tag: el.tagName.toLowerCase(), value: String(el.value || '').slice(0, 200) });
})()`
}

/** 内容摘要（白屏确认用）：文本长度、元素数、标题与可见标题采样 */
export interface PreviewContentSummary {
  title: string
  url: string
  /** 页面正文字符数 */
  textLength: number
  textSample: string
  elementCount: number
  headings: string[]
}

/** 内容摘要探测表达式：只读采集，不改动页面 */
export const CONTENT_SUMMARY_PROBE = `(function () {
  var bodyText = '';
  var elementCount = 0;
  var headings = [];
  try { bodyText = (document.body ? document.body.innerText : '').trim(); } catch (e) {}
  try { elementCount = document.body ? document.body.querySelectorAll('*').length : 0; } catch (e) {}
  try {
    Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3')).slice(0, 5).forEach(function (h) {
      var text = (h.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
      if (text) headings.push(text);
    });
  } catch (e) {}
  return JSON.stringify({
    title: document.title,
    url: location.href,
    textLength: bodyText.length,
    textSample: bodyText.slice(0, 500),
    elementCount: elementCount,
    headings: headings
  });
})()`

/** 文本存在性探测表达式（browser_wait_for 轮询用） */
export function buildTextPresentProbe(text: string): string {
  return `(function () {
    var scope = '';
    try { scope = (document.body ? document.body.innerText : '') + ' ' + location.href; } catch (e) {}
    return JSON.stringify({ present: scope.indexOf(${JSON.stringify(text)}) !== -1 });
  })()`
}

/** 快照探测返回结构（主进程侧解析用） */
export interface SnapshotResult {
  title: string
  url: string
  interactiveCount: number
  elements: Array<{
    index: number
    tag: string
    role?: string
    text?: string
    id?: string
    name?: string
    type?: string
    href?: string
    placeholder?: string
    rect: { x: number; y: number; w: number; h: number }
  }>
  textSample: string
}

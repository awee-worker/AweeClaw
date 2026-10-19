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
  // 页面若设置 scroll-behavior: smooth，scrollIntoView 会走平滑动画，
  // 紧接着读到的 rect 还停在滚动前的位置，点击就会落到元素外面。
  // 用内联样式临时压掉平滑滚动，让元素立刻归位后再取坐标。
  try {
    var root = document.documentElement;
    var prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    root.style.scrollBehavior = prevBehavior;
  } catch (e) {}
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

// ============ AI 修改：元素拾取、就地编辑与回滚 ============

/** 元素快照：拾取器与元素详情探测共用同一份结构 */
export interface ElementSnapshot {
  ok: true
  /**
   * 元素选择器
   *
   * 优先输出 CSS 结构路径；路径不唯一（深层嵌套、动态 class）时退化为
   * `[data-awee-pick="…"]` 标记。标记属性在拾取时写到元素上并保留，
   * 让后续编辑与回滚还能按同一个选择器找到它。
   */
  selector: string
  tag: string
  id?: string
  classes: string[]
  /** 文本内容（截断），用于判断元素语义 */
  text: string
  /** outerHTML（截断），给模型看结构 */
  html: string
  /** 视口内矩形（CSS 像素） */
  rect: { x: number; y: number; w: number; h: number }
  /** 计算样式白名单，键为 CSS 属性名 */
  styles: Record<string, string>
  /** 祖先链，由内向外 */
  ancestors: string[]
  /** 同父同标签同 class 的兄弟数量：决定「改这一个」还是「改这一类」 */
  sameSiblings: number
  viewport: { w: number; h: number }
  /** 命中的文本选区（用户先拖选文字再点击） */
  selectedText?: string
  /** 选中目标是 iframe/embed/object：其内部 DOM 不可达，只能改容器本身 */
  embeddedFrame: boolean
}

/** 拾取结果：在快照基础上补充拾取模式 */
export interface PickedElement extends ElementSnapshot {
  mode: 'element' | 'text'
}

/** 拾取器最长等待时长，超时自动退出，避免页面挂着一个永不 resolve 的 Promise */
const PICK_TIMEOUT_MS = 120_000
/** 元素文本截断长度 */
const PICK_TEXT_LIMIT = 200
/** 元素 outerHTML 截断长度 */
const PICK_HTML_LIMIT = 2000
/** 祖先链采集深度 */
const PICK_ANCESTOR_DEPTH = 4

/**
 * 计算样式白名单
 *
 * 只取决定「长相」的属性。全量 computed style 有 300+ 项，其中绝大多数是
 * 默认值，塞进上下文只会稀释信号、推高成本。
 */
const STYLE_WHITELIST = [
  'display',
  'position',
  'width',
  'height',
  'max-width',
  'min-height',
  'margin',
  'padding',
  'color',
  'background-color',
  'background-image',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'text-align',
  'border',
  'border-radius',
  'box-shadow',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'opacity',
  'overflow',
  'z-index',
]

/**
 * 元素侧公共函数
 *
 * 拾取器、元素详情、编辑、回滚四段脚本都依赖同一套选择器生成与快照逻辑，
 * 抽成共享前置片段，避免各写一份导致选择器口径不一致（拾取到的选择器
 * 后续编辑时定位不到，就是这个原因）。
 */
const ELEMENT_HELPERS_SOURCE = `
var __AWEE_STYLES = ${JSON.stringify(STYLE_WHITELIST)};
var __AWEE_TEXT_LIMIT = ${PICK_TEXT_LIMIT};
var __AWEE_HTML_LIMIT = ${PICK_HTML_LIMIT};
var __AWEE_ANCESTOR_DEPTH = ${PICK_ANCESTOR_DEPTH};

function __aweeNormalizeText(value) {
  return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
}

function __aweeEnsureStamp(el) {
  var stamp = '';
  try {
    stamp = el.getAttribute('data-awee-pick') || '';
    if (!stamp) {
      window.__aweePickSeq = (window.__aweePickSeq || 0) + 1;
      stamp = 'awee-' + window.__aweePickSeq;
      el.setAttribute('data-awee-pick', stamp);
    }
  } catch (e) { return ''; }
  return stamp;
}

function __aweeBuildSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  var stamp = __aweeEnsureStamp(el);
  if (!stamp) return '';
  var parts = [];
  var cur = el;
  var depth = 0;
  while (cur && cur.nodeType === 1 && depth < 6) {
    if (cur.id) {
      var idSel = null;
      try { idSel = '#' + CSS.escape(cur.id); } catch (e) { idSel = null; }
      if (idSel) {
        var idCount = 0;
        try { idCount = document.querySelectorAll(idSel).length; } catch (e) { idCount = 0; }
        if (idCount === 1) { parts.unshift(idSel); cur = null; break; }
      }
    }
    var tag = cur.tagName.toLowerCase();
    var parent = cur.parentElement;
    if (!parent || parent === document.documentElement) { parts.unshift(tag); cur = null; break; }
    var sameTag = [];
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === cur.tagName) sameTag.push(parent.children[i]);
    }
    if (sameTag.length > 1) {
      parts.unshift(tag + ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')');
    } else {
      parts.unshift(tag);
    }
    cur = parent;
    depth++;
  }
  var sel = parts.join(' > ');
  try {
    if (sel && document.querySelectorAll(sel).length === 1) return sel;
  } catch (e) {}
  return '[data-awee-pick="' + stamp + '"]';
}

function __aweeResolve(selector) {
  if (!selector) return null;
  try {
    var el = document.querySelector(selector);
    return el || null;
  } catch (e) {
    return null;
  }
}

function __aweeAncestorChain(el) {
  var chain = [];
  var cur = el.parentElement;
  var depth = 0;
  while (cur && depth < __AWEE_ANCESTOR_DEPTH) {
    if (cur === document.documentElement) { chain.push('html'); break; }
    if (cur === document.body) { chain.push('body'); break; }
    var label = cur.tagName.toLowerCase();
    if (cur.id) label += '#' + cur.id;
    var cls = (cur.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean);
    if (cls.length) label += '.' + cls.slice(0, 2).join('.');
    chain.push(label);
    cur = cur.parentElement;
    depth++;
  }
  return chain;
}

function __aweeCountSiblings(el) {
  var parent = el.parentElement;
  if (!parent) return 1;
  var cls = (el.getAttribute('class') || '').trim();
  var count = 0;
  for (var i = 0; i < parent.children.length; i++) {
    var sib = parent.children[i];
    if (sib.tagName !== el.tagName) continue;
    if ((sib.getAttribute('class') || '').trim() !== cls) continue;
    count++;
  }
  return count || 1;
}

function __aweeSnapshot(el) {
  var rect = el.getBoundingClientRect();
  var styles = {};
  try {
    var computed = window.getComputedStyle(el);
    for (var i = 0; i < __AWEE_STYLES.length; i++) {
      var key = __AWEE_STYLES[i];
      var value = computed.getPropertyValue(key);
      if (!value) continue;
      if (value === 'none' || value === 'normal' || value === 'auto') continue;
      styles[key] = value;
    }
  } catch (e) {}
  var html = '';
  try { html = String(el.outerHTML || '').slice(0, __AWEE_HTML_LIMIT); } catch (e) {}
  var tag = el.tagName.toLowerCase();
  return {
    ok: true,
    selector: __aweeBuildSelector(el),
    tag: tag,
    id: el.id || undefined,
    classes: __aweeNormalizeText(el.getAttribute('class') || '').split(' ').filter(Boolean).slice(0, 8),
    text: __aweeNormalizeText(el.innerText || el.textContent || '').slice(0, __AWEE_TEXT_LIMIT),
    html: html,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    },
    styles: styles,
    ancestors: __aweeAncestorChain(el),
    sameSiblings: __aweeCountSiblings(el),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    embeddedFrame: tag === 'iframe' || tag === 'embed' || tag === 'object' || tag === 'frame'
  };
}
`

/**
 * 元素拾取脚本
 *
 * 返回一个长挂起的 Promise，在用户点击元素时 resolve 成快照 JSON，
 * 按 Esc 或超时 resolve 成 { ok: false, reason }。
 *
 * 事件全部挂在 document 的 capture 阶段并阻断传播：不阻断的话，点到链接
 * 会跳转、点到按钮会提交请求、点到表单会让页面失焦，拾取就变成了一次误操作。
 *
 * 目标元素优先取 composedPath()[0] 而不是 event.target：Shadow DOM 会把
 * target 重定向到宿主节点，用 target 永远选不进组件内部。
 */
export const PICKER_PROBE = `${ELEMENT_HELPERS_SOURCE}
(function () {
  return new Promise(function (resolve) {
    var DONE = false;
    var baseEl = null;
    var upSteps = 0;
    var box = null;
    var tagLabel = null;
    var hint = null;
    var timer = null;

    function teardown() {
      if (timer) { clearTimeout(timer); timer = null; }
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
      var layers = [box, tagLabel, hint];
      for (var i = 0; i < layers.length; i++) {
        var node = layers[i];
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
      box = null; tagLabel = null; hint = null;
      try { delete window.__aweePicker; } catch (e) { window.__aweePicker = null; }
    }

    function finish(result) {
      if (DONE) return;
      DONE = true;
      teardown();
      resolve(JSON.stringify(result));
    }

    function ensureLayers() {
      if (box) return;
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;' +
        'border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:3px;' +
        'box-sizing:border-box;display:none';
      document.documentElement.appendChild(box);

      tagLabel = document.createElement('div');
      tagLabel.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
        'font:500 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;' +
        'background:#6366f1;padding:1px 6px;border-radius:3px;white-space:nowrap;' +
        'max-width:60vw;overflow:hidden;text-overflow:ellipsis;display:none;' +
        'box-shadow:0 1px 4px rgba(0,0,0,0.3)';
      document.documentElement.appendChild(tagLabel);

      hint = document.createElement('div');
      hint.textContent = '\u70b9\u51fb\u9009\u62e9\u5143\u7d20 \u00b7 \u2191 \u4e0a\u6eaf\u7236\u7ea7 \u00b7 \u2193 \u56de\u5230\u5b50\u7ea7 \u00b7 Esc \u53d6\u6d88';
      hint.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);' +
        'pointer-events:none;z-index:2147483647;font:500 12px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;' +
        'color:#fff;background:rgba(17,24,39,0.9);padding:5px 12px;border-radius:999px;white-space:nowrap';
      document.documentElement.appendChild(hint);
    }

    function eventTargetOf(event) {
      var path = null;
      try { path = event.composedPath ? event.composedPath() : null; } catch (e) { path = null; }
      if (path && path.length) {
        for (var i = 0; i < path.length; i++) {
          if (path[i] && path[i].nodeType === 1) return path[i];
        }
      }
      return event.target;
    }

    function resolveTarget(raw) {
      var el = raw;
      var steps = upSteps;
      while (steps > 0 && el && el.parentElement && el !== document.documentElement) {
        el = el.parentElement;
        steps--;
      }
      return el;
    }

    function paint(el) {
      if (!el || !box) return;
      var rect = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.width = Math.max(rect.width, 1) + 'px';
      box.style.height = Math.max(rect.height, 1) + 'px';

      var name = el.tagName.toLowerCase();
      if (el.id) name += '#' + el.id;
      var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean);
      if (cls.length) name += '.' + cls[0];
      name += '  ' + Math.round(rect.width) + '\u00d7' + Math.round(rect.height);
      if (upSteps > 0) name += '  \u2191' + upSteps;
      tagLabel.textContent = name;
      tagLabel.style.display = 'block';
      tagLabel.style.left = Math.max(rect.left, 0) + 'px';
      tagLabel.style.top = (rect.top > 24 ? rect.top - 21 : rect.bottom + 4) + 'px';
    }

    function repaint() {
      if (baseEl && !DONE) paint(resolveTarget(baseEl));
    }

    function onMove(event) {
      if (DONE) return;
      ensureLayers();
      baseEl = eventTargetOf(event);
      repaint();
    }

    function onScroll() {
      repaint();
    }

    function onMouseDown(event) {
      if (DONE) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }

    function onClick(event) {
      if (DONE) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      var target = resolveTarget(eventTargetOf(event));
      if (!target || target === document.documentElement) return;

      var selectedText = '';
      try {
        var selection = window.getSelection();
        selectedText = selection ? __aweeNormalizeText(String(selection.toString() || '')) : '';
      } catch (e) { selectedText = ''; }

      var snapshot;
      try {
        snapshot = __aweeSnapshot(target);
      } catch (e) {
        finish({ ok: false, error: 'Element snapshot failed: ' + (e && e.message ? e.message : 'unknown') });
        return;
      }

      if (selectedText) {
        snapshot.mode = 'text';
        snapshot.selectedText = selectedText.slice(0, 400);
      } else {
        snapshot.mode = 'element';
      }
      finish(snapshot);
    }

    function onKeyDown(event) {
      if (DONE) return;
      var key = event.key || '';
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        finish({ ok: false, reason: 'cancelled' });
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        if (key === 'ArrowUp') upSteps += 1;
        else upSteps = Math.max(0, upSteps - 1);
        repaint();
      }
    }

    function onWheel(event) {
      if (DONE) return;
      if (!event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (event.deltaY < 0) upSteps += 1;
      else upSteps = Math.max(0, upSteps - 1);
      repaint();
    }

    window.__aweePicker = {
      cancel: function () { finish({ ok: false, reason: 'cancelled' }); }
    };

    ensureLayers();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('wheel', onWheel, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);

    timer = setTimeout(function () {
      finish({ ok: false, reason: 'timeout' });
    }, ${PICK_TIMEOUT_MS});
  });
})()`

/** 主动结束一次正在等待的拾取（切换标签、页面导航、用户取消时调用） */
export const PICKER_CANCEL_PROBE = `(function () {
  try {
    if (window.__aweePicker && typeof window.__aweePicker.cancel === 'function') {
      window.__aweePicker.cancel();
      return JSON.stringify({ ok: true, cancelled: true });
    }
  } catch (e) {}
  return JSON.stringify({ ok: true, cancelled: false });
})()`

/** 按选择器读取元素快照（AI 侧 browser_element_context 用） */
export function buildElementContextProbe(selector: string): string {
  const target = JSON.stringify(selector)
  return `${ELEMENT_HELPERS_SOURCE}
(function () {
  var selector = ${target};
  var el = __aweeResolve(selector);
  if (!el) {
    return JSON.stringify({ ok: false, error: 'Element not found for selector: ' + selector });
  }
  return JSON.stringify(__aweeSnapshot(el));
})()`
}

/** 元素裁剪矩形探测结果（主进程按此截图） */
export interface ElementRect {
  x: number
  y: number
  width: number
  height: number
}

/** 读取元素在视口内的矩形，供 capturePage 裁剪元素截图 */
export function buildElementRectProbe(selector: string): string {
  const target = JSON.stringify(selector)
  return `${ELEMENT_HELPERS_SOURCE}
(function () {
  var selector = ${target};
  var el = __aweeResolve(selector);
  if (!el) {
    return JSON.stringify({ ok: false, error: 'Element not found for selector: ' + selector });
  }
  var rect = el.getBoundingClientRect();
  return JSON.stringify({
    ok: true,
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  });
})()`
}

/** 拾取开始的结果：ok=false 表示用户取消 / 超时，属于正常结束 */
export type PickStartResult =
  | PickedElement
  | { ok: false; reason?: 'cancelled' | 'timeout' | string; error?: string }

/** 就地编辑结果 */
export interface ElementEditResult {
  ok: true
  selector: string
  op: string
  /** 实际写入的内容摘要，供 UI 回显 */
  applied: string
  /** 实际被修改的元素数量（scope=similar 时大于 1） */
  affected: number
  /** 当前编辑账本中的累计条数 */
  editCount: number
}

/** 编辑作用范围：单个元素，或同父下的同类兄弟（卡片、列表项等重复结构） */
export type ElementEditScope = 'one' | 'similar'

/** 回滚结果 */
export interface UndoEditsResult {
  ok: true
  undone: number
  /** 元素已不存在（页面重渲染 / 节点被替换）而跳过的条数 */
  skipped: number
  remaining: number
}

/** 元素截图结果（base64 PNG） */
export interface ElementCapture {
  base64: string
  mimeType: string
  width: number
  height: number
}

/** 元素就地编辑操作（结构化，不接受任意脚本） */
export type ElementEditOp =
  | { op: 'text'; value: string }
  | { op: 'style'; prop: string; value: string }
  | { op: 'attr'; prop: string; value: string | null }
  | { op: 'html'; value: string }
  | { op: 'hide' }

/**
 * 元素就地编辑脚本
 *
 * 只支持固定几种操作，不接受模型写任意 JS：可预测、可回滚、不会把页面改死。
 * 每次修改前把原值压进 window.__aweeEditLog，回滚脚本按栈逆序还原。
 *
 * scope=similar 时按「同父 + 同标签 + 同 class」找出同类兄弟一起改：
 * 用户说「这个卡片圆角小一点」，本意通常是列表里的一整排卡片。
 *
 * 样式一律加 !important：页面常用高优先级的类样式覆盖内联样式，不加就看不到效果。
 */
export function buildElementEditProbe(
  selector: string,
  edit: ElementEditOp,
  scope: ElementEditScope = 'one',
): string {
  const target = JSON.stringify(selector)
  const payload = JSON.stringify(edit)
  const scopeValue = JSON.stringify(scope)
  return `${ELEMENT_HELPERS_SOURCE}
(function () {
  var selector = ${target};
  var edit = ${payload};
  var scope = ${scopeValue};
  var root = __aweeResolve(selector);
  if (!root) {
    return JSON.stringify({ ok: false, error: 'Element not found for selector: ' + selector });
  }

  function collectTargets(base) {
    if (scope !== 'similar') return [base];
    var parent = base.parentElement;
    if (!parent) return [base];
    var cls = (base.getAttribute('class') || '').trim();
    var list = [];
    for (var i = 0; i < parent.children.length; i++) {
      var sib = parent.children[i];
      if (sib.tagName !== base.tagName) continue;
      if ((sib.getAttribute('class') || '').trim() !== cls) continue;
      list.push(sib);
    }
    return list.length ? list : [base];
  }

  function applyOne(node, entry) {
    if (edit.op === 'text') {
      entry.prev.text = node.textContent;
      node.textContent = edit.value;
      return String(edit.value).slice(0, 200);
    }
    if (edit.op === 'style') {
      entry.prev.style = node.style.getPropertyValue(edit.prop);
      entry.prev.priority = node.style.getPropertyPriority(edit.prop);
      node.style.setProperty(edit.prop, edit.value, 'important');
      return edit.prop + ': ' + edit.value;
    }
    if (edit.op === 'attr') {
      entry.prev.attr = node.hasAttribute(edit.prop) ? node.getAttribute(edit.prop) : null;
      if (edit.value === null) node.removeAttribute(edit.prop);
      else node.setAttribute(edit.prop, edit.value);
      return edit.prop + '=' + (edit.value === null ? '(removed)' : edit.value);
    }
    if (edit.op === 'html') {
      entry.prev.html = node.innerHTML;
      node.innerHTML = edit.value;
      return String(edit.value).slice(0, 200);
    }
    if (edit.op === 'hide') {
      entry.prev.display = node.style.getPropertyValue('display');
      entry.prev.displayPriority = node.style.getPropertyPriority('display');
      node.style.setProperty('display', 'none', 'important');
      return 'display: none';
    }
    throw new Error('Unsupported op: ' + edit.op);
  }

  window.__aweeEditLog = window.__aweeEditLog || [];
  var targets = collectTargets(root);
  var applied = '';
  var affected = 0;
  var failure = '';

  for (var i = 0; i < targets.length; i++) {
    var node = targets[i];
    // 选择器按元素各自生成：批量改同类时每个元素都要有自己的账本条目，
    // 回滚才能逐个还原，而不是只还原第一个
    var entry = { selector: __aweeBuildSelector(node), op: edit.op, prop: edit.prop || null, prev: {} };
    try {
      applied = applyOne(node, entry);
      window.__aweeEditLog.push(entry);
      affected += 1;
    } catch (e) {
      if (!failure) failure = e && e.message ? e.message : 'unknown';
    }
  }

  if (!affected) {
    return JSON.stringify({ ok: false, error: 'Edit failed: ' + (failure || 'unknown') });
  }

  return JSON.stringify({
    ok: true,
    selector: selector,
    op: edit.op,
    applied: applied,
    affected: affected,
    editCount: window.__aweeEditLog.length
  });
})()`
}


/**
 * 回滚就地编辑
 *
 * mode=last 只还原最近一次，mode=all 全部还原。元素已不存在（页面重渲染
 * 或节点被替换）时跳过并计入 skipped，不中断整体回滚。
 */
export function buildUndoEditsProbe(mode: 'last' | 'all'): string {
  return `${ELEMENT_HELPERS_SOURCE}
(function () {
  var log = window.__aweeEditLog || [];
  if (!log.length) {
    return JSON.stringify({ ok: true, undone: 0, skipped: 0, remaining: 0 });
  }

  function restore(entry) {
    var el = __aweeResolve(entry.selector);
    if (!el) return false;
    try {
      if (entry.op === 'text') {
        el.textContent = entry.prev.text;
      } else if (entry.op === 'style') {
        if (entry.prev.style) el.style.setProperty(entry.prop, entry.prev.style, entry.prev.priority || '');
        else el.style.removeProperty(entry.prop);
      } else if (entry.op === 'attr') {
        if (entry.prev.attr === null) el.removeAttribute(entry.prop);
        else el.setAttribute(entry.prop, entry.prev.attr);
      } else if (entry.op === 'html') {
        el.innerHTML = entry.prev.html;
      } else if (entry.op === 'hide') {
        if (entry.prev.display) el.style.setProperty('display', entry.prev.display, entry.prev.displayPriority || '');
        else el.style.removeProperty('display');
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  var undone = 0;
  var skipped = 0;
  while (log.length) {
    var entry = log.pop();
    if (restore(entry)) undone += 1;
    else skipped += 1;
    if (${JSON.stringify(mode)} === 'last') break;
  }
  return JSON.stringify({ ok: true, undone: undone, skipped: skipped, remaining: log.length });
})()`
}


/**
 * macOS Accessibility API 辅助通道
 *
 * 利用 System Events 的 AppleScript 接口访问 AX 树，
 * 为原生 macOS 应用（Finder、Safari、System Settings 等）提供：
 * - AX 树遍历（获取 UI 元素层级）
 * - AX 路径点击（通过元素路径精准点击，无需 OCR）
 * - AX 属性查询（title/role/value 等）
 *
 * 适用场景：
 * - 原生 macOS 应用的菜单、按钮、文本框
 * - 需要精准点击但 OCR 识别困难的图标按钮（无文字标签）
 *
 * 限制：
 * - Electron 应用（微信、VSCode、Slack 等）不暴露内容元素，仅返回窗口装饰按钮
 * - 需要用户授权"辅助功能"权限给 TRAE CN
 * - AX 树深度遍历较慢（大型应用可能数秒）
 *
 * 调用方应在 OCR 失败时降级使用此通道，而非作为主要定位方式
 */

import { execFile } from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'

/** AX 元素结构 */
export interface AxElement {
  /** 元素角色（AXButton、AXTextField、AXMenuItem 等） */
  role: string
  /** 元素标题（按钮文字、菜单项文字等） */
  title?: string
  /** 元素值（文本框内容、复选框状态等） */
  value?: string
  /** 元素位置 [x, y, w, h]（逻辑坐标） */
  position?: { x: number; y: number; width: number; height: number }
  /** 是否可启用 */
  enabled?: boolean
  /** 子元素 */
  children?: AxElement[]
}

/** AX 树查询参数 */
export interface GetAxTreeParams {
  /** 目标应用名（如 "Finder", "Safari"） */
  appName: string
  /** 最大遍历深度（默认 3，避免大型应用遍历过深） */
  maxDepth?: number
  /** 只返回指定角色的元素（如 ['AXButton', 'AXMenuItem']），默认全部 */
  rolesFilter?: string[]
}

/** AX 点击参数 */
export interface ClickByAxParams {
  /** 目标应用名 */
  appName: string
  /**
   * 元素路径（从 window 开始的索引序列）
   * 例如 [0, 2, 1] 表示：第 0 个窗口 → 第 2 个子元素 → 第 1 个子元素
   */
  path: number[]
}

/** AX 查询结果项（简化版，用于 LLM 决策） */
export interface AxItemForLlm {
  /** 路径索引序列 */
  path: number[]
  /** 角色 */
  role: string
  /** 标题 */
  title?: string
  /** 中心点坐标（若可获取） */
  center?: { x: number; y: number }
}

/**
 * 通过 AppleScript 调用 System Events 访问 AX API
 */
export class MacAxApiHelper {
  /** AX 树查询超时（毫秒） */
  private readonly treeTimeoutMs = 15_000

  /** AX 点击超时（毫秒） */
  private readonly clickTimeoutMs = 5_000

  /**
   * 执行 AppleScript 访问目标应用的 AX 树
   *
   * 返回 JSON 字符串，包含目标应用前台窗口的元素树
   *
   * 实现要点：
   * - 使用 System Events 的 `entire contents` 遍历（受限深度）
   * - 对每个元素提取 role/title/value/position/enabled
   * - 大型应用可能元素过多，限制 maxDepth 和元素数量
   */
  async getAxTree(params: GetAxTreeParams): Promise<AxElement> {
    const { appName, maxDepth = 3, rolesFilter } = params
    const escApp = appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    // 使用递归 AppleScript 遍历 AX 树
    // 注意：`entire contents` 在大型应用上会超时，所以手动限制深度
    const script = `
tell application "System Events"
  set targetProc to first process whose name contains "${escApp}"
  set frontWin to missing value
  try
    set frontWin to front window of targetProc
  on error
    return "{\"error\":\"No front window for ${escApp}\",\"role\":\"AXError\"}"
  end try
  return my describeElement(frontWin, 0, ${maxDepth})
end tell

on describeElement(elem, depth, maxDepth)
  if depth > maxDepth then return "{\"role\":\"_TRUNCATED\"}"
  try
    set elemRole to role of elem
  on error
    set elemRole to "AXUnknown"
  end try
  set elemTitle to ""
  try
    set elemTitle to title of elem
  end try
  set elemValue to ""
  try
    set elemValue to value of elem
  end try
  set posStr to ""
  try
    set {posX, posY} to position of elem
    set {sizeW, sizeH} to size of elem
    set posStr to (posX as text) & "," & (posY as text) & "," & (sizeW as text) & "," & (sizeH as text)
  end try
  set enabledStr to "1"
  try
    set enabledStr to (enabled of elem) as text
  end try
  
  set childJson to "[]"
  if depth < maxDepth then
    set childList to UI elements of elem
    set childArray to {}
    repeat with i from 1 to (count of childList)
      set childDesc to my describeElement(item i of childList, depth + 1, maxDepth)
      set end of childArray to childDesc
    end repeat
    set AppleScript's text item delimiters to ","
    set childJson to "[" & (childArray as text) & "]"
    set AppleScript's text item delimiters to ""
  end if
  
  set escTitle to my escapeJson(elemTitle)
  set escValue to my escapeJson(elemValue)
  
  return "{\"role\":\"" & elemRole & "\",\"title\":\"" & escTitle & "\",\"value\":\"" & escValue & "\",\"position\":\"" & posStr & "\",\"enabled\":\"" & enabledStr & "\",\"children\":" & childJson & "}"
end on

on escapeJson(s)
  set s to my replaceText(s, "\\", "\\\\")
  set s to my replaceText(s, "\"", "\\\"")
  set s to my replaceText(s, return, "\\n")
  set s to my replaceText(s, linefeed, "\\n")
  return s
end on

on replaceText(s, fromStr, toStr)
  set AppleScript's text item delimiters to fromStr
  set parts to text items of s
  set AppleScript's text item delimiters to toStr
  return parts as text
end replaceText
`.trim()

    const start = Date.now()
    try {
      const stdout = await this.execOsascript(script, this.treeTimeoutMs)
      const tree = JSON.parse(stdout) as AxElement
      logger.desktop.info(
        `[MacAxApi] getAxTree("${appName}") depth=${maxDepth} took ${Date.now() - start}ms`,
      )

      // 角色过滤（可选）
      if (rolesFilter && rolesFilter.length > 0) {
        this.filterTree(tree, rolesFilter)
      }

      return tree
    } catch (err) {
      logger.desktop.warn(
        `[MacAxApi] getAxTree("${appName}") failed: ${(err as Error).message}`,
      )
      throw err
    }
  }

  /**
   * 通过 AX 路径点击元素
   *
   * @param params appName + path（索引序列）
   * @returns 点击结果
   */
  async clickByAx(params: ClickByAxParams): Promise<{
    success: boolean
    clickedRole?: string
    clickedTitle?: string
    message: string
  }> {
    const { appName, path } = params
    if (!path || path.length === 0) {
      return { success: false, message: 'Empty AX path' }
    }

    const escApp = appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    // 构建 AppleScript 索引表达式：item N of UI elements of item M of ...
    // path = [0, 2, 1] → "item 2 of UI elements of front window"
    //                   + ".item 3 of UI elements of ..."
    // AppleScript 索引从 1 开始，需要 +1
    const pathExpr = path
      .map((idx) => `item ${idx + 1} of UI elements of `)
      .join('')
      .replace(/ of $/, '')

    const script = `
tell application "System Events"
  set targetProc to first process whose name contains "${escApp}"
  set frontWin to missing value
  try
    set frontWin to front window of targetProc
  on error
    return "{\"success\":false,\"message\":\"No front window for ${escApp}\"}"
  end try
  
  try
    set targetElem to ${pathExpr} of frontWin
    set elemRole to role of targetElem
    set elemTitle to ""
    try
      set elemTitle to title of targetElem
    end try
    perform action "AXPress" of targetElem
    return "{\"success\":true,\"clickedRole\":\"" & elemRole & "\",\"clickedTitle\":\"" & elemTitle & "\"}"
  on error errMsg
    return "{\"success\":false,\"message\":\"" & errMsg & "\"}"
  end try
end tell
`.trim()

    try {
      const stdout = await this.execOsascript(script, this.clickTimeoutMs)
      const result = JSON.parse(stdout)
      logger.desktop.info(
        `[MacAxApi] clickByAx("${appName}", [${path.join(',')}]): ${JSON.stringify(result)}`,
      )
      return result
    } catch (err) {
      logger.desktop.warn(
        `[MacAxApi] clickByAx("${appName}", [${path.join(',')}]) failed: ${(err as Error).message}`,
      )
      return { success: false, message: (err as Error).message }
    }
  }

  /**
   * 将 AX 树扁平化为 LLM 可决策的列表
   *
   * 只保留可交互元素（按钮、菜单项、文本框等），
   * 附带路径索引和中心坐标，供 LLM 选择 click_by_ax 动作
   */
  flattenTreeForLlm(tree: AxElement): AxItemForLlm[] {
    const items: AxItemForLlm[] = []
    this.collectInteractive(tree, [], items)
    return items
  }

  /** 递归收集可交互元素 */
  private collectInteractive(elem: AxElement, path: number[], out: AxItemForLlm[]): void {
    const interactiveRoles = new Set([
      'AXButton',
      'AXMenuItem',
      'AXMenuItemCheckBox',
      'AXMenuItemRadio',
      'AXCheckBox',
      'AXRadioButton',
      'AXPopUpButton',
      'AXComboBox',
      'AXTextField',
      'AXTextArea',
      'AXLink',
      'AXImage',
      'AXToolbar',
      'AXTab',
    ])

    if (interactiveRoles.has(elem.role)) {
      const item: AxItemForLlm = {
        path: [...path],
        role: elem.role,
        title: elem.title,
      }
      if (elem.position) {
        item.center = {
          x: elem.position.x + elem.position.width / 2,
          y: elem.position.y + elem.position.height / 2,
        }
      }
      out.push(item)
    }

    if (elem.children) {
      for (let i = 0; i < elem.children.length; i++) {
        this.collectInteractive(elem.children[i], [...path, i], out)
      }
    }
  }

  /** 角色过滤：从树中移除非目标角色 */
  private filterTree(elem: AxElement, rolesFilter: string[]): void {
    if (elem.children) {
      elem.children = elem.children.filter((child) => {
        if (rolesFilter.includes(child.role)) {
          return true
        }
        // 递归检查子元素，保留包含目标角色的子树
        this.filterTree(child, rolesFilter)
        return child.children && child.children.length > 0
      })
    }
  }

  /** 执行 AppleScript 并返回 stdout */
  private execOsascript(script: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        '/usr/bin/osascript',
        ['-e', script],
        { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const stderrText = stderr ? stderr.toString().trim() : ''
            reject(new Error(stderrText || err.message))
          } else {
            resolve(stdout.toString().trim())
          }
        },
      )
    })
  }
}

/** 单例 */
export const macAxApiHelper = new MacAxApiHelper()

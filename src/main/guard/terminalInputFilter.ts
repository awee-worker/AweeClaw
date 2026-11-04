/**
 * 终端输入过滤器 — 规范化管道输入
 *
 * 职责：
 * - 剥除「按键级」控制字节（退格、Delete、方向键等）
 * - 规范化终端输入的换行符（\r\n / \r → \n）
 * - 保留 Ctrl+C（ASCII 3）等有语义的控制字符
 *
 * ── 为什么必须剥掉按键字节 ──
 *
 * 管道后端的 stdin 是「命令通道」，不是键盘：shell 以非交互模式读取，
 * 中间没有行编辑层（zsh 的 ZLE / bash 的 readline），任何按键级控制字节
 * 都会原样成为命令行内容。
 *
 * 实测把 DEL(0x7f) 写进 `zsh -l` 的 stdin，shell 会把这一行当成命令名：
 *
 *     zsh: command not found: ^?
 *
 * 方向键同理，会被当成命令参数报 `zsh: bad pattern: ^[[3~`。
 * 用户的退格 / 方向键 / 粘贴内容里夹带的控制字符，最终就表现为
 * 终端面板里凭空多出一条 `command not found`。
 *
 * 这些字节在管道里没有任何意义（没有光标可移、没有字符可删），
 * 剥掉它们不会影响任何真实命令。
 */

/** ESC 引入的 CSI 序列：ESC [ 参数 终止符（方向键、Delete、功能键等） */
const CSI_SEQUENCE = /\x1b\[[0-9;?]*[~A-Za-z]/g

/** SS3 序列：ESC O 字母（部分终端的应用模式方向键） */
const SS3_SEQUENCE = /\x1bO[A-Za-z]/g

/** OSC 序列：ESC ] ... BEL / ST（终端上报与设置，管道里无意义） */
const OSC_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/** 退格与 DEL */
const BACKSPACE_CHARS = /[\x08\x7f]/g

export function normalizePipeTerminalInput(data: string): string {
  // Ctrl+C 单独放行：PipeShellSession 靠它翻译成 SIGINT，
  // 若在这里被当作普通字符处理，中断语义就丢了。
  if (data === String.fromCharCode(3)) {
    return data
  }

  return data
    // 先剥完整的转义序列，避免先删 ESC 后留下 "[3~" 这类残片被当成命令
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(SS3_SEQUENCE, '')
    // 再剥退格 / DEL：普通字符级删除键
    .replace(BACKSPACE_CHARS, '')
    // 残留的裸 ESC（单按 Esc 键）同样没有语义
    .replace(/\x1b/g, '')
    // 最后统一换行：管道按 \n 分行，\r 不会被当作行结束
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}


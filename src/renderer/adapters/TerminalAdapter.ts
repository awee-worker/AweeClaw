/**
 * 终端管理服务
 *
 * 职责：
 * - 管理用户交互式终端的生命周期（创建、销毁）
 * - 管理 xterm 实例和 PTY 进程
 * - 提供统一 API 给 UI 层
 *
 * 注意：普通短命令使用 shell:executeBackground；Agent 长命令会通过此服务创建交互会话。
 */

import { api } from '@services/electronBridge';
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { getEditorConfig } from '@shared/configuration/preferenceSync';
import { logger } from '@toolkit/LogEngine';
import { toAppError } from '@shared/toolkit/errorCatalog';
import { isMac } from '@services/keybindingAdapter';
import { getInteractiveTerminalBackend } from '@intelligence/toolkit/commandExecutor';

// ===== 类型定义 =====

export interface TerminalInstance {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  createdAt: number;
  /** 是否为 Agent 专属终端 */
  isAgent?: boolean;
  /** 远程 SSH 连接信息 */
  remote?: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string };
  /** 远程主机地址（用于显示） */
  remoteHost?: string;
}

export interface RunningCommandInfo {
  terminalId: string;
  command: string;
  startedAt: number;
}

export type TerminalCommandStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted'
  | 'detached'
  | 'shell_exited';

export type TerminalCommandTerminationReason =
  | 'sentinel_matched'
  | 'sentinel_missing_prompt'
  | 'terminal_exit'
  | 'terminal_error'
  | 'timeout'
  | 'user_closed_terminal'
  | 'cleanup'
  | 'detached'
  | 'error_detected';

export interface TerminalCommandSession {
  commandSessionId: string;
  terminalId: string;
  command: string;
  cwd?: string;
  startedAt: number;
  endedAt?: number;
  status: TerminalCommandStatus;
  exitCode: number | null;
  signal?: number;
  timedOut: boolean;
  terminationReason?: TerminalCommandTerminationReason;
  captureStartSeq?: number;
  captureEndSeq?: number;
  output: string;
  partialOutput: string;
  sentinelMatched: boolean;
  isBackground: boolean;
  source: 'agent' | 'shell_ui' | 'user';
}

export interface TerminalCommandInfo {
  current: TerminalCommandSession | null;
  last: TerminalCommandSession | null;
}

export interface TerminalManagerState {
  terminals: TerminalInstance[];
  activeId: string | null;
  /** 兼容字段：由 command session 状态派生，不再作为事实来源 */
  runningCommand: RunningCommandInfo | null;
  commandInfoByTerminal: Record<string, TerminalCommandInfo>;
}

export interface CommandResult {
  success: boolean;
  finalStatus: TerminalCommandStatus;
  output: string;
  partialOutput: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  terminalId: string;
  commandSessionId: string;
  terminationReason: TerminalCommandTerminationReason;
  sentinelMatched: boolean;
  signal?: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
  seq: number;
  occurredAt: number;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
  signal?: number;
  seq: number;
  occurredAt: number;
  reason: 'process_exit' | 'killed_by_user' | 'remote_close';
}

export interface TerminalErrorEvent {
  id: string;
  error: string;
  seq: number;
  occurredAt: number;
  fatal?: boolean;
  reason: 'process_error' | 'spawn_error' | 'unknown';
}

export type TerminalBackend = 'pty' | 'pipe';

interface XTermInstance {
  terminal: XTerminal;
  fitAddon: FitAddon;
  webglAddon?: WebglAddon;
  container: HTMLDivElement | null;
}

interface ActiveCommandExecution {
  commandSessionId: string;
  finalize: (
    reason: TerminalCommandTerminationReason,
    override?: Partial<Pick<CommandResult, 'finalStatus' | 'exitCode' | 'signal' | 'timedOut' | 'output' | 'partialOutput' | 'sentinelMatched'>>,
  ) => void;
}

type StateListener = (state: TerminalManagerState) => void;

// ===== 终端管理器 =====

// 获取终端缓冲配置（从 editorConfig 读取）
function getOutputBufferConfig() {
  const config = getEditorConfig();
  const maxLines = config.performance.terminalBufferSize || 1000;
  return {
    maxLines,
    // 使用行数 * 平均行长度估算，避免频繁计算字节
    maxTotalChars: maxLines * 200,
  };
}

const MAX_COMMAND_OUTPUT_CHARS = 120_000
const MAX_RAW_SENTINEL_BUFFER_CHARS = 24_000

function trimRetainedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return value.slice(value.length - maxChars)
}

/**
 * 环形缓冲区 — O(1) 写入和裁剪
 * 替代原来的 array.splice O(n) 方案
 */
class RingBuffer {
  private buf: string[]
  private head = 0    // 最旧元素的索引
  private count = 0   // 当前元素数
  private capacity: number
  totalChars = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buf = new Array(capacity)
  }

  push(data: string): void {
    if (this.count < this.capacity) {
      this.buf[(this.head + this.count) % this.capacity] = data
      this.count++
    } else {
      // 满了，覆盖最旧的
      this.totalChars -= this.buf[this.head].length
      this.buf[this.head] = data
      this.head = (this.head + 1) % this.capacity
    }
    this.totalChars += data.length
  }

  /** 按写入顺序返回所有元素 */
  toArray(): string[] {
    const result: string[] = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity]
    }
    return result
  }

  get length(): number { return this.count }

  clear(): void {
    this.head = 0
    this.count = 0
    this.totalChars = 0
  }

  trimToMaxChars(maxChars: number): void {
    while (this.count > 0 && this.totalChars > maxChars) {
      this.totalChars -= this.buf[this.head].length
      this.head = (this.head + 1) % this.capacity
      this.count--
    }
  }
}

/** 剥离 ANSI 转义序列（用于 sentinel 输出提取） */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][AB012B]/g, '')
    .replace(/\x1b[=><]/g, '')
    .replace(/\r/g, '')
}

function looksLikeShellPrompt(str: string): boolean {
  const text = stripAnsi(str).replace(/\r/g, '').trimEnd()
  if (!text) return false

  const tail = text.split('\n').slice(-3).join('\n')
  // 支持 bash/zsh/fish 等常见提示符：
  // - PS xxx >                    PowerShell
  // - user@host:path $ / #        bash（普通用户 $ / root #）
  // - user@host path % / #        zsh 默认提示符（普通用户 % / root #）
  // - C:\path>                    cmd.exe
  // - 任意以 $ / # / % / > 结尾   通用兜底（含 fish ➜、自定义 PS1 等）
  return /(?:^|\n)(?:PS\s+[^\n>]*>\s*|(?:[^\n@\s]+@[^\n:\s]+:[^\n#$%]+[#$%]\s*)|(?:[A-Za-z]:\\[^\n>]*>\s*)|(?:[^\n]*[#$%>]\s*))$/.test(tail)
}

function cloneCommandSession(session: TerminalCommandSession | null): TerminalCommandSession | null {
  if (!session) return null
  return { ...session }
}

export class TerminalManagerClass {
  private static readonly MAX_IDLE_AGENT_TERMINALS = 2
  private state = {
    terminals: [] as TerminalInstance[],
    activeId: null as string | null,
  };

  /** Agent 专属终端 ID（跨 tool call 复用） */
  private agentTerminalId: string | null = null;
  private agentTerminalCreating: Promise<string> | null = null;

  // xterm 实例管理
  private xtermInstances = new Map<string, XTermInstance>();
  // 环形缓冲区：O(1) 写入和裁剪
  private outputBuffers = new Map<string, RingBuffer>();

  // 命令会话状态
  private currentCommandSessions = new Map<string, TerminalCommandSession>();
  private lastCommandSessions = new Map<string, TerminalCommandSession>();
  private activeExecutions = new Map<string, ActiveCommandExecution>();

  // PTY 状态
  private ptyReady = new Map<string, boolean>();
  private pendingPtyCreation = new Map<string, Promise<boolean>>();

  // 监听器
  private stateListeners = new Set<StateListener>();
  private dataListeners = new Set<(id: string, data: string) => void>();
  private rawDataListeners = new Set<(event: TerminalDataEvent) => void>();

  // 主题配置
  private currentTheme: Record<string, string> = {};

  // IPC 监听器清理函数
  private ipcCleanup: (() => void) | null = null;

  constructor() {
    this.setupIpcListeners();
  }

  private setupIpcListeners() {
    const onData = api.terminal.onData(
      (event: TerminalDataEvent) => {
        const { id, data } = event;
        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(data);
        }

        // UI 展示缓冲（ring buffer）
        this.appendToBuffer(id, data);

        // 命令级缓冲由 active command session 单独维护
        this.rawDataListeners.forEach(listener => listener(event));
        this.dataListeners.forEach(listener => listener(id, data));
      },
    );

    const onExit = api.terminal.onExit(
      (event: TerminalExitEvent) => {
        const { id, exitCode, signal } = event;
        logger.system.info(
          `[TerminalManager] Terminal ${id} exited with code ${exitCode}, signal ${signal}`,
        );

        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(
            `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
          );
        }

        const activeExecution = this.activeExecutions.get(id);
        if (activeExecution) {
          activeExecution.finalize('terminal_exit', {
            finalStatus: 'shell_exited',
            exitCode,
            signal,
          })
        } else {
          const current = this.currentCommandSessions.get(id)
          if (current) {
            this.finalizeCommandSession(id, {
              ...current,
              status: 'shell_exited',
              endedAt: Date.now(),
              exitCode,
              signal,
              timedOut: false,
              terminationReason: 'terminal_exit',
            })
          }
        }

        // 清理 PTY 状态
        this.ptyReady.delete(id);
      },
    );

    const onError = api.terminal.onError?.(
      (event: TerminalErrorEvent) => {
        const { id, error } = event;
        logger.system.error(`[TerminalManager] Terminal ${id} error:`, error);

        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(
            `\r\n\x1b[31m[Terminal Error: ${error}]\x1b[0m\r\n`,
          );
        }

        const activeExecution = this.activeExecutions.get(id)
        if (activeExecution) {
          activeExecution.finalize('terminal_error', {
            finalStatus: 'failed',
          })
        }
      },
    );

    this.ipcCleanup = () => {
      onData();
      onExit();
      onError?.();
    };
  }

  /**
   * 追加数据到输出缓冲区
   */
  private appendToBuffer(id: string, data: string): void {
    let buffer = this.outputBuffers.get(id);
    if (!buffer) {
      const config = getOutputBufferConfig();
      buffer = new RingBuffer(config.maxLines);
      this.outputBuffers.set(id, buffer);
    }

    // RingBuffer 自动处理容量溢出（O(1) 覆盖最旧数据）
    buffer.push(data);
    buffer.trimToMaxChars(getOutputBufferConfig().maxTotalChars);
  }

  private getDerivedRunningCommand(): RunningCommandInfo | null {
    const running = Array.from(this.currentCommandSessions.values())
      .filter(session => session.status === 'queued' || session.status === 'running')
      .sort((a, b) => b.startedAt - a.startedAt)

    if (running.length === 0) return null

    const session = running[0]
    return {
      terminalId: session.terminalId,
      command: session.command,
      startedAt: session.startedAt,
    }
  }

  private getCommandInfoSnapshot(): Record<string, TerminalCommandInfo> {
    const snapshot: Record<string, TerminalCommandInfo> = {}
    for (const terminal of this.state.terminals) {
      snapshot[terminal.id] = {
        current: cloneCommandSession(this.currentCommandSessions.get(terminal.id) || null),
        last: cloneCommandSession(this.lastCommandSessions.get(terminal.id) || null),
      }
    }
    return snapshot
  }

  private setCurrentCommandSession(terminalId: string, session: TerminalCommandSession | null): void {
    if (session) {
      this.currentCommandSessions.set(terminalId, session)
    } else {
      this.currentCommandSessions.delete(terminalId)
    }
    this.notify()
  }

  private updateCurrentCommandSession(
    terminalId: string,
    updater: (session: TerminalCommandSession) => TerminalCommandSession,
  ): void {
    const current = this.currentCommandSessions.get(terminalId)
    if (!current) return
    this.currentCommandSessions.set(terminalId, updater(current))
    this.notify()
  }

  private finalizeCommandSession(terminalId: string, session: TerminalCommandSession): void {
    this.currentCommandSessions.delete(terminalId)
    this.lastCommandSessions.set(terminalId, session)
    this.notify()
  }

  private clearCommandState(terminalId: string): void {
    this.activeExecutions.delete(terminalId)
    this.currentCommandSessions.delete(terminalId)
    this.lastCommandSessions.delete(terminalId)
  }

  /**
   * 获取缓冲区统计信息
   */
  getBufferStats(id: string): { lines: number; chars: number } | null {
    const buffer = this.outputBuffers.get(id);
    if (!buffer) return null;
    return { lines: buffer.length, chars: buffer.totalChars };
  }

  // ===== 状态订阅 =====

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  onData(listener: (id: string, data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  private onRawData(listener: (event: TerminalDataEvent) => void): () => void {
    this.rawDataListeners.add(listener)
    return () => this.rawDataListeners.delete(listener)
  }

  private notify() {
    const state = this.getState();
    this.stateListeners.forEach((listener) => listener(state));
  }

  getState(): TerminalManagerState {
    return {
      terminals: [...this.state.terminals],
      activeId: this.state.activeId,
      runningCommand: this.getDerivedRunningCommand(),
      commandInfoByTerminal: this.getCommandInfoSnapshot(),
    };
  }

  getTerminalCommandState(terminalId: string): TerminalCommandInfo {
    return {
      current: cloneCommandSession(this.currentCommandSessions.get(terminalId) || null),
      last: cloneCommandSession(this.lastCommandSessions.get(terminalId) || null),
    }
  }

  // ===== 主题管理 =====

  setTheme(theme: Record<string, string>) {
    this.currentTheme = theme;
    this.xtermInstances.forEach(({ terminal }) => {
      terminal.options.theme = theme;
    });
  }

  // ===== 终端生命周期 =====

  async createTerminal(options: {
    name?: string;
    cwd: string;
    shell?: string;
    backend?: TerminalBackend;
    isAgent?: boolean;
    remote?: TerminalInstance['remote'];
  }): Promise<string> {
    const id = crypto.randomUUID();
    const backend =
      options.backend ??
      (options.isAgent ? getInteractiveTerminalBackend() : 'pty');

    const instance: TerminalInstance = {
      id,
      name: options.name || "Terminal",
      cwd: options.cwd,
      shell: options.shell || "",
      createdAt: Date.now(),
      isAgent: options.isAgent,
      remote: options.remote,
      remoteHost: options.remote?.host,
    };

    this.state.terminals.push(instance);
    this.state.activeId = id;
    this.notify();

    // 创建 PTY
    const ptyPromise = this.createPty(id, options.cwd, options.shell, backend, options.remote);
    this.pendingPtyCreation.set(id, ptyPromise);

    try {
      const success = await ptyPromise;
      this.ptyReady.set(id, success);
    } catch {
      this.ptyReady.set(id, false);
    } finally {
      this.pendingPtyCreation.delete(id);
    }

    return id;
  }

  private async createPty(
    id: string,
    cwd: string,
    shell?: string,
    backend: TerminalBackend = 'pty',
    remote?: TerminalInstance['remote'],
  ): Promise<boolean> {
    try {
      const result = await api.terminal.create({ id, cwd, shell, backend, remote });
      if (!result?.success) {
        const errorMsg = result?.error || "Unknown error";
        logger.system.error(
          `[TerminalManager] Failed to create PTY for ${id}:`,
          errorMsg,
        );

        // 显示错误信息到终端
        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(`\r\n\x1b[31m[Error: ${errorMsg}]\x1b[0m\r\n`);
          if (errorMsg.includes("rebuild")) {
            xterm.terminal.write(
              `\x1b[33mPlease run: npm run rebuild\x1b[0m\r\n`,
            );
          }
        }
        return false;
      }
      return true;
    } catch (err) {
      const error = toAppError(err);
      logger.system.error(
        `[TerminalManager] Exception creating PTY for ${id}: ${error.code}`,
        error,
      );

      // 显示错误信息到终端
      const xterm = this.xtermInstances.get(id);
      if (xterm?.terminal) {
        xterm.terminal.write(
          `\r\n\x1b[31m[Error: ${error.message}]\x1b[0m\r\n`,
        );
      }
      return false;
    }
  }

  mountTerminal(id: string, container: HTMLDivElement): boolean {
    if (this.xtermInstances.has(id)) {
      const existing = this.xtermInstances.get(id)!;
      if (existing.container !== container) {
        existing.terminal.open(container);
        existing.container = container;
        try {
          // 如果之前被卸载了 WebGL，则重新挂载
          if (!existing.webglAddon) {
            const webglAddon = new WebglAddon();
            existing.terminal.loadAddon(webglAddon);
            existing.webglAddon = webglAddon;
            webglAddon.onContextLoss(() => {
              webglAddon.dispose();
              existing.webglAddon = undefined;
            });
          }
          existing.fitAddon.fit();
        } catch { }
      }
      return true;
    }

    const termConfig = getEditorConfig().terminal;
    const terminal = new XTerminal({
      cursorBlink: termConfig.cursorBlink,
      fontFamily: termConfig.fontFamily,
      fontSize: termConfig.fontSize,
      lineHeight: termConfig.lineHeight,
      scrollback: termConfig.scrollback,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 4.5,
      theme: this.currentTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);

    let webglAddon: WebglAddon | undefined;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = undefined;
        if (this.xtermInstances.has(id)) {
          this.xtermInstances.get(id)!.webglAddon = undefined;
        }
      });
    } catch { }

    // 处理终端输入
    terminal.onData((data) => {
      api.terminal.write(id, data);
    });
    // 处理粘贴文本
    const handlePasteText = (text: string) => {
      api.terminal.write(id, text);
    };

    const mod = (e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey;

    terminal.attachCustomKeyEventHandler((event) => {
      // Cmd/Ctrl+C 复制（有选中内容时）
      if (mod(event) && event.key === "c" && event.type === "keydown") {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          return false;
        }
        // macOS 上 Cmd+C 没有选中内容时不发送中断信号
        // 但 Ctrl+C（非 Cmd）应该发送中断信号
        if (isMac && event.metaKey) return false;
        return true;
      }

      if (event.type !== "keydown") return true;

      // Cmd/Ctrl+V for paste
      if (mod(event) && !event.shiftKey && event.key === "v") {
        event.preventDefault();
        navigator.clipboard.readText().then((text) => {
          handlePasteText(text);
        });
        return false;
      }

      // Ctrl+Shift+C 复制（备用，非 macOS）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "C" &&
        event.type === "keydown"
      ) {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        return false;
      }

      // Ctrl+Shift+V 粘贴（备用，非 macOS）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "V" &&
        event.type === "keydown"
      ) {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              api.terminal.write(id, text);
            }
          })
          .catch(() => { });
        return false;
      }

      return true; // 其他按键正常处理
    });

    this.xtermInstances.set(id, { terminal, fitAddon, webglAddon, container });

    // 回放已有 buffer —— 解决 xterm 挂载前 PTY 已产生输出导致终端显示为空的问题
    const existingBuffer = this.outputBuffers.get(id);
    if (existingBuffer && existingBuffer.length > 0) {
      for (const chunk of existingBuffer.toArray()) {
        terminal.write(chunk);
      }
    }

    try {
      fitAddon.fit();
    } catch { }

    const dims = fitAddon.proposeDimensions?.();
    if (dims && dims.cols > 0 && dims.rows > 0) {
      api.terminal.resize(id, dims.cols, dims.rows);
    }

    return true;
  }

  /**
   * 卸载 xterm UI 实例以释放 DOM/WebGL 内存，但 PTY 进程和 outputBuffer 完整保留。
   * 下次 mountTerminal 时会新建 xterm 并将 buffer 全量回放，用户看到完整历史。
   */
  unmountTerminal(id: string) {
    const existing = this.xtermInstances.get(id);
    if (!existing) return;

    if (existing.webglAddon) {
      try { existing.webglAddon.dispose(); } catch { }
      existing.webglAddon = undefined;
    }

    try { existing.terminal.dispose(); } catch { }

    // 从 map 中移除，确保下次 mountTerminal 走"新建实例 + buffer replay"分支
    // 而不是尝试在已销毁的 terminal 上调用 open()（会静默失败导致空白）
    this.xtermInstances.delete(id);
  }

  fitTerminal(id: string) {
    const instance = this.xtermInstances.get(id);
    if (!instance) return;

    try {
      instance.fitAddon.fit();
      const dims = instance.fitAddon.proposeDimensions?.();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        api.terminal.resize(id, dims.cols, dims.rows);
      }
    } catch { }
  }

  /**
   * 确保终端已 mount 并正确 fit，PTY 尺寸与 xterm 一致
   *
   * 核心问题：PTY 创建时 cols=80 rows=24（硬编码默认值），而 xterm 实际尺寸取决于容器。
   * 如果在 xterm mount + fit 之前写入命令，PTY 按 80 cols 处理回显和换行，
   * xterm 按实际 cols 渲染 → 排版错乱（递增缩进、行错位）。
   *
   * 时序：
   *   setTerminalVisible(true) → React 渲染 → useEffect(100ms) → mountTerminal → fitTerminal(100ms)
   *   共 ~200ms 延迟，此方法等待 mount 完成后 fit，确保 PTY resize 在写入命令前完成
   *
   * @param termId    终端 ID
   * @param maxWaitMs 最大等待时间（默认 1000ms，覆盖 React 渲染 + useEffect 延迟）
   */
  async ensureTerminalReady(termId: string, maxWaitMs = 1000): Promise<void> {
    // 如果 xterm 已 mount，直接 fit 并返回
    if (this.xtermInstances.has(termId)) {
      this.fitTerminal(termId)
      return
    }

    // 等待 xterm mount（React useEffect 中的 100ms 延迟 + DOM 布局）
    return new Promise<void>((resolve) => {
      const start = Date.now()
      const check = () => {
        if (this.xtermInstances.has(termId)) {
          // mount 完成，fit 并 resize PTY
          this.fitTerminal(termId)
          resolve()
        } else if (Date.now() - start > maxWaitMs) {
          // 超时：终端面板可能未显示，或 xterm mount 失败
          // 放弃等待继续执行（排版可能不完美，但命令能正常执行）
          logger.agent.warn(
            `[TerminalManager] ensureTerminalReady timed out for ${termId} ` +
            `(xterm not mounted after ${maxWaitMs}ms, proceeding with default cols)`,
          )
          resolve()
        } else {
          setTimeout(check, 30)
        }
      }
      check()
    })
  }

  closeTerminal(id: string) {
    const activeExecution = this.activeExecutions.get(id)
    if (activeExecution) {
      activeExecution.finalize('user_closed_terminal', {
        finalStatus: 'cancelled',
      })
    } else {
      const current = this.currentCommandSessions.get(id)
      if (current) {
        this.finalizeCommandSession(id, {
          ...current,
          status: 'cancelled',
          endedAt: Date.now(),
          terminationReason: 'user_closed_terminal',
        })
      }
    }

    const xterm = this.xtermInstances.get(id);
    if (xterm) {
      xterm.terminal.dispose();
      this.xtermInstances.delete(id);
    }

    if (this.agentTerminalId === id) {
      this.agentTerminalId = null
    }

    this.outputBuffers.delete(id);
    this.ptyReady.delete(id);
    this.clearCommandState(id)
    api.terminal.kill(id);

    const index = this.state.terminals.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.state.terminals.splice(index, 1);
    }

    if (this.state.activeId === id) {
      this.state.activeId = this.state.terminals[0]?.id || null;
    }

    this.notify();
  }

  /**
   * 中断所有正在执行的 Agent 终端命令
   *
   * 当用户点击"结束对话"时调用，确保正在运行的 shell 命令（如 npm install）
   * 被及时终止，而不是继续在后台执行。
   *
   * 实现步骤：
   * 1. 向每个有活跃命令的终端发送 Ctrl+C（\x03）中断信号
   * 2. 调用 finalize 结束命令执行 Promise，使 run_command 工具返回
   * 3. 更新命令会话状态为 'cancelled'
   */
  abortActiveAgentCommands(): void {
    for (const [termId, execution] of this.activeExecutions.entries()) {
      // 发送 Ctrl+C 中断信号到终端
      try {
        this.writeToTerminal(termId, '\x03')
      } catch {
        // 终端可能已关闭，忽略写入错误
      }
      // 结束命令执行 Promise，使等待的 run_command 返回
      execution.finalize('cleanup', {
        finalStatus: 'cancelled',
      })
    }
  }

  hasTerminal(id: string): boolean {
    return this.state.terminals.some(t => t.id === id);
  }

  /**
   * 检查指定终端是否有正在执行的 agent 命令
   *
   * 用于 terminalWatcher 判断是否需要主动结束出错的命令。
   * 仅 'queued' / 'running' 状态视为活动，已结束的命令返回 false。
   */
  hasActiveAgentCommand(terminalId: string): boolean {
    const session = this.currentCommandSessions.get(terminalId)
    if (!session) return false
    return session.status === 'queued' || session.status === 'running'
  }

  /**
   * 主动结束指定终端的活动命令执行（错误检测场景）
   *
   * 当 terminalWatcher 检测到命令输出中包含明确的错误关键字（npm ERR!、Error: 等）时，
   * 调用此方法立即结束命令执行，将已捕获的输出作为错误结果返回给 AI。
   *
   * 设计要点：
   * 1. 仅结束活动命令，不影响空闲终端
   * 2. 不发送 Ctrl+C（命令可能已自行出错，无需中断进程；避免破坏终端状态）
   * 3. finalStatus 设为 'failed'，让 run_command 正确返回错误给 AI
   * 4. 优先使用命令会话的 partialOutput（命令级输出），避免混入命令前的历史输出
   *    fallback 到 getOutputPreview（终端级）以防 partialOutput 为空
   *
   * @param terminalId 终端 ID
   * @returns 是否成功结束（false 表示无活动命令或已结束）
   */
  finalizeActiveCommandOnError(terminalId: string): boolean {
    const execution = this.activeExecutions.get(terminalId)
    if (!execution) return false

    // 优先使用命令会话的 partialOutput（命令级输出，不含命令前的历史）
    // fallback 到终端级 getOutputPreview，确保极端情况下也有输出可用
    const session = this.currentCommandSessions.get(terminalId)
    const sessionOutput = session?.partialOutput || session?.output || ''
    const partialOutput = sessionOutput || this.getOutputPreview(terminalId, 200, 16000) || ''

    execution.finalize('error_detected', {
      finalStatus: 'failed',
      exitCode: 1,
      output: partialOutput,
      partialOutput,
      sentinelMatched: false,
    })

    return true
  }


  setActiveTerminal(id: string | null) {
    // 验证终端是否存在，不存在则静默忽略（终端可能已被手动关闭）
    if (id !== null && !this.state.terminals.find(t => t.id === id)) {
      return;
    }
    if (this.state.activeId !== id) {
      this.state.activeId = id;
      this.notify();
    }
  }

  // ===== 工具方法 =====

  writeToTerminal(id: string, data: string) {
    api.terminal.write(id, data);
  }

  getOutputBuffer(id: string): string[] {
    return this.outputBuffers.get(id)?.toArray() || [];
  }

  getOutputPreview(id: string, lineCount = 12, maxChars = 4000): string {
    const entries = this.outputBuffers.get(id)?.toArray() || []
    if (entries.length === 0) {
      return ''
    }

    const chunks: string[] = []
    let chars = 0
    let lines = 0

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      chunks.push(entry)
      chars += entry.length

      for (let j = 0; j < entry.length; j++) {
        if (entry.charCodeAt(j) === 10) {
          lines++
        }
      }

      if (chars >= maxChars || lines >= lineCount + 1) {
        break
      }
    }

    return chunks.reverse().join('').trim().split('\n').slice(-lineCount).join('\n').trim()
  }

  getXterm(id: string): XTerminal | null {
    return this.xtermInstances.get(id)?.terminal || null;
  }

  focusTerminal(id: string) {
    const xterm = this.xtermInstances.get(id);
    if (xterm) {
      xterm.terminal.focus();
    }
  }

  // ===== Agent 专属终端 =====

  /**
   * 获取或创建 Agent 专属终端。
   * Agent 终端跨 tool call 复用，避免每次 run_command 产生孤立 tab。
   *
   * 复用策略（优先级从高到低）：
   * 1. 终端空闲（无活动命令）→ 直接复用
   * 2. 终端被卡住的命令占用（running 但非 detached）→ 发送 Ctrl+C 中断后复用
   * 3. 终端被长进程占用（detached）→ 创建新终端（长进程不应被打断）
   */
  async getOrCreateAgentTerminal(cwd: string, shell?: string): Promise<string> {
    // 检查现有 agent 终端是否仍然存活
    if (this.agentTerminalId) {
      const exists = this.state.terminals.find(t => t.id === this.agentTerminalId)
      if (exists) {
        const commandInfo = this.getTerminalCommandState(this.agentTerminalId)
        const occupiedByDetachedWork =
          commandInfo.current?.status === 'detached' ||
          commandInfo.last?.status === 'detached'
        const occupiedByActiveCommand =
          commandInfo.current?.status === 'queued' ||
          commandInfo.current?.status === 'running'

        // 空闲终端：直接复用
        if (!occupiedByDetachedWork && !occupiedByActiveCommand) {
          // 上次命令异常结束（超时/中断/被错误终止/shell 退出）时，终端里可能残留
          // 未被杀死的挂起进程（如无超时的 fetch/网络脚本）。此时直接复用会把新命令
          // 写入被占用 stdin 的 shell，导致新命令无人执行、再次超时（连锁超时）。
          // 因此复用前发送 Ctrl+C + 换行，把终端恢复到干净可用的状态。
          const lastStatus = commandInfo.last?.status
          const lastAbnormal =
            lastStatus === 'timed_out' ||
            lastStatus === 'interrupted' ||
            lastStatus === 'failed' ||
            lastStatus === 'shell_exited' ||
            lastStatus === 'cancelled'
          if (lastAbnormal) {
            this.interruptStaleAgentCommand(this.agentTerminalId)
          }
          return this.agentTerminalId
        }

        // 长进程（detached）正确占用终端：不能中断，创建新终端
        if (occupiedByDetachedWork) {
          this.agentTerminalId = null
        } else {
          // 命令卡在 running 状态（sentinel 失败等导致状态残留）
          // 发送 Ctrl+C 中断卡住的命令，清理状态后复用终端
          // 避免每次卡住都创建新标签
          this.interruptStaleAgentCommand(this.agentTerminalId)
          return this.agentTerminalId
        }
      }
      // 已被关闭，重置
      else {
        this.agentTerminalId = null
      }
    }

    // 并发锁：防止快速连续的 run_command 创建多个 Agent 终端
    if (this.agentTerminalCreating) {
      return this.agentTerminalCreating
    }

    this.agentTerminalCreating = this.createTerminal({
      name: this.getNextAgentTerminalName(),
      cwd,
      shell,
      isAgent: true,
    }).then(id => {
      this.agentTerminalId = id
      this.cleanupIdleAgentTerminals()
      this.agentTerminalCreating = null
      return id
    }).catch(err => {
      this.agentTerminalCreating = null
      throw err
    })

    return this.agentTerminalCreating
  }

  /**
   * 释放当前 Agent 终端绑定（不关闭终端）。
   * 长进程占用终端后调用，使下一次 getOrCreateAgentTerminal() 创建新终端。
   */
  releaseAgentTerminal() {
    this.agentTerminalId = null
  }

  /**
   * 中断卡住的 Agent 命令并清理状态，使终端可被复用
   *
   * 场景：上一条命令因 sentinel 失败等原因卡在 running 状态，
   * 下一次 run_command 调用 getOrCreateAgentTerminal 时，
   * 通过此方法中断卡住的命令（发送 Ctrl+C），清理命令会话状态，
   * 避免每次卡住都创建新标签。
   *
   * 操作：
   * 1. finalize 活动命令执行（让 executeCommandWithOutput 的 Promise 返回）
   * 2. 发送 Ctrl+C 中断终端中可能还在运行的进程
   * 3. 发送换行符让 shell 回到干净状态
   * 4. 清理 currentCommandSessions
   */
  private interruptStaleAgentCommand(terminalId: string): void {
    // 1. finalize 活动命令执行（如果有），让等待的 Promise 返回
    const execution = this.activeExecutions.get(terminalId)
    if (execution) {
      try {
        const partialOutput = this.getOutputPreview(terminalId, 200, 16000) || ''
        execution.finalize('cleanup', {
          finalStatus: 'interrupted',
          output: partialOutput,
          partialOutput,
          sentinelMatched: false,
        })
      } catch {
        // finalize 可能已执行，忽略
      }
    }

    // 2. 发送 Ctrl+C 中断可能还在运行的进程
    this.writeToTerminal(terminalId, '\x03')

    // 3. 发送换行符让 shell 回到干净状态（新 prompt）
    this.writeToTerminal(terminalId, '\r')

    // 4. 清理命令会话状态
    this.currentCommandSessions.delete(terminalId)

    logger.agent.info(
      `[TerminalManager] Interrupted stale agent command in terminal ${terminalId} for reuse`,
    )
  }

  private getNextAgentTerminalName(): string {
    const agentTerminals = this.state.terminals.filter(t => t.isAgent)
    if (agentTerminals.length === 0) return 'Agent'
    return `Agent ${agentTerminals.length + 1}`
  }

  private cleanupIdleAgentTerminals(): void {
    const idleAgentTerminals = this.state.terminals
      .filter(terminal => terminal.isAgent)
      .filter(terminal => terminal.id !== this.agentTerminalId)
      .filter(terminal => terminal.id !== this.state.activeId)
      .filter((terminal) => {
        const commandInfo = this.getTerminalCommandState(terminal.id)
        const currentStatus = commandInfo.current?.status
        const lastStatus = commandInfo.last?.status
        const isOccupied = currentStatus === 'queued'
          || currentStatus === 'running'
          || currentStatus === 'detached'
          || lastStatus === 'detached'
        return !isOccupied
      })
      .sort((a, b) => a.createdAt - b.createdAt)

    const terminalsToClose = Math.max(
      0,
      idleAgentTerminals.length - TerminalManagerClass.MAX_IDLE_AGENT_TERMINALS,
    )

    idleAgentTerminals.slice(0, terminalsToClose).forEach((terminal) => {
      this.closeTerminal(terminal.id)
    })
  }

  recordDetachedCommand(
    termId: string,
    command: string,
    cwd?: string,
    source: TerminalCommandSession['source'] = 'agent',
  ): TerminalCommandSession {
    const startedAt = Date.now()
    const session: TerminalCommandSession = {
      commandSessionId: crypto.randomUUID(),
      terminalId: termId,
      command,
      cwd,
      startedAt,
      endedAt: startedAt,
      status: 'detached',
      exitCode: null,
      timedOut: false,
      terminationReason: 'detached',
      output: '',
      partialOutput: '',
      sentinelMatched: false,
      isBackground: true,
      source,
    }

    this.lastCommandSessions.set(termId, session)
    this.notify()
    return cloneCommandSession(session)!
  }

  /**
   * 在指定终端执行命令，通过 sentinel 标记精确捕获本次命令的输出。
   * 命令过程对用户可见（在终端面板里显示），同时将 stdout 作为字符串返回给 AI。
   *
   * @param cwd 可选工作目录。若提供，用 Push-Location/popd（PS）或子 shell（Unix）临时切换目录。
   */
  executeCommandWithOutput(
    termId: string,
    command: string,
    timeoutMs: number,
    cwd?: string,
    onPartialOutput?: (partialOutput: string) => void,
  ): Promise<CommandResult> {
    const sentinelId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    // OSC 序列格式：ESC ] 9001 ; <payload> BEL
    // xterm.js 在序列解析阶段静默消耗未注册的 OSC 编号，完全不渲染任何文本。
    // 这与 VS Code Shell Integration（OSC 133）采用相同机制。
    const OSC = '\x1b]9001;'
    const BEL = '\x07'
    const START_PAYLOAD = `ADNIFY_CMD_START_${sentinelId}`
    const END_PAYLOAD_PREFIX = `ADNIFY_CMD_END_${sentinelId}_`
    // 用于在原始数据中检测 end sentinel
    const RAW_END_MARKER = `${OSC}${END_PAYLOAD_PREFIX}`

    const commandSessionId = crypto.randomUUID()
    const startedAt = Date.now()
    const initialSession: TerminalCommandSession = {
      commandSessionId,
      terminalId: termId,
      command,
      cwd,
      startedAt,
      status: 'queued',
      exitCode: null,
      timedOut: false,
      output: '',
      partialOutput: '',
      sentinelMatched: false,
      isBackground: false,
      source: 'agent',
    }

    this.setCurrentCommandSession(termId, initialSession)

    return new Promise<CommandResult>((resolve) => {
      let rawAccumulator = ''   // 原始 PTY 数据，用于检测 OSC sentinel
      let textAccumulator = ''  // stripAnsi 后的纯文本，用于返回给 AI
      let textAtStart = -1      // 检测到 START sentinel 时 textAccumulator 的长度
      let settled = false
      let sentinelMatched = false
      let idleTimer: ReturnType<typeof setTimeout> | null = null

      const getVisibleOutput = () => {
        const output = textAtStart !== -1
          ? textAccumulator.slice(textAtStart)
          : textAccumulator
        return output.trim()
      }

      const updatePartialOutput = (partialOutput: string, captureStartSeq?: number) => {
        this.updateCurrentCommandSession(termId, (session) => ({
          ...session,
          status: session.status === 'queued' ? 'running' : session.status,
          partialOutput,
          captureStartSeq: captureStartSeq ?? session.captureStartSeq,
        }))
        // 流式输出回调：通知外部（如 run_command 工具）实时推送输出到聊天界面
        if (onPartialOutput) {
          try {
            onPartialOutput(partialOutput)
          } catch {
            // 回调失败不影响命令执行
          }
        }
      }

      const clearIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
      }

      const settle = (
        reason: TerminalCommandTerminationReason,
        override?: Partial<Pick<CommandResult, 'finalStatus' | 'exitCode' | 'signal' | 'timedOut' | 'output' | 'partialOutput' | 'sentinelMatched'>>,
      ) => {
        if (settled) return
        settled = true
        unsubRaw()
        if (timer) clearTimeout(timer)
        clearIdleTimer()
        this.activeExecutions.delete(termId)

        const partialOutput = trimRetainedText(
          override?.partialOutput ?? getVisibleOutput(),
          MAX_COMMAND_OUTPUT_CHARS,
        )
        const output = trimRetainedText(
          override?.output ?? partialOutput,
          MAX_COMMAND_OUTPUT_CHARS,
        )
        const finalStatus = override?.finalStatus ?? 'failed'
        const exitCode = override?.exitCode ?? null
        const timedOut = override?.timedOut ?? finalStatus === 'timed_out'
        const result: CommandResult = {
          success: finalStatus === 'completed' && exitCode === 0,
          finalStatus,
          output,
          partialOutput,
          exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
          terminalId: termId,
          commandSessionId,
          terminationReason: reason,
          sentinelMatched: override?.sentinelMatched ?? sentinelMatched,
          signal: override?.signal,
        }

        this.finalizeCommandSession(termId, {
          ...(this.currentCommandSessions.get(termId) || initialSession),
          status: finalStatus,
          endedAt: Date.now(),
          exitCode,
          signal: result.signal,
          timedOut,
          terminationReason: reason,
          output,
          partialOutput,
          sentinelMatched: result.sentinelMatched,
          captureStartSeq: this.currentCommandSessions.get(termId)?.captureStartSeq,
          captureEndSeq: result.sentinelMatched ? this.currentCommandSessions.get(termId)?.captureEndSeq : this.currentCommandSessions.get(termId)?.captureEndSeq,
        })

        resolve(result)
      }

      const scheduleIdleFallback = () => {
        clearIdleTimer()
        // 已通过 sentinel 完成则不再调度；START sentinel 是否检测到不影响提示符兜底——
        // 即使 START 未检测到（极端时序/数据丢失），只要 shell 回到提示符就说明命令已结束，
        // 应立即结束等待，而不是干等到超时。
        if (sentinelMatched) return
        idleTimer = setTimeout(() => {
          if (settled) return
          const tail = rawAccumulator.slice(-400)
          if (looksLikeShellPrompt(tail)) {
            settle('sentinel_missing_prompt', {
              finalStatus: 'interrupted',
              output: getVisibleOutput(),
              partialOutput: getVisibleOutput(),
              sentinelMatched: false,
            })
          } else {
            // 未检测到 shell prompt，重新调度（周期性检查）
            // 覆盖 sentinel 失败 + 长命令无输出后恢复的场景（如 sleep 10 结束后 shell 回显 prompt）
            scheduleIdleFallback()
          }
        }, 1200)
      }

      // timeoutMs = 0 表示不限制超时（AI 执行命令时取消超时限制）
      // 仅在显式指定正数超时的情况下才设置定时器
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            // 超时兜底：先向终端发送 Ctrl+C 中断可能挂起的进程（如无超时的 fetch/网络脚本），
            // 确保挂起的进程被终止、shell 回到可接受新命令的状态。
            // 否则超时后终端被残留进程占用，下一次 run_command 复用终端会连锁超时。
            try {
              this.writeToTerminal(termId, '\x03')
            } catch {
              // 终端可能已关闭，忽略
            }
            settle('timeout', {
              finalStatus: 'timed_out',
              timedOut: true,
              partialOutput: getVisibleOutput(),
              output: getVisibleOutput(),
            })
          }, timeoutMs)
        : null

      const unsubRaw = this.onRawData((event) => {
        if (event.id !== termId || settled) return
        rawAccumulator = trimRetainedText(rawAccumulator + event.data, MAX_RAW_SENTINEL_BUFFER_CHARS)
        textAccumulator = trimRetainedText(textAccumulator + stripAnsi(event.data), MAX_COMMAND_OUTPUT_CHARS)

        if (textAtStart === -1 && rawAccumulator.includes(`${OSC}${START_PAYLOAD}${BEL}`)) {
          textAtStart = textAccumulator.length
          this.updateCurrentCommandSession(termId, (session) => ({
            ...session,
            status: 'running',
            captureStartSeq: event.seq,
          }))
        }

        const visibleOutput = trimRetainedText(getVisibleOutput(), MAX_COMMAND_OUTPUT_CHARS)
        updatePartialOutput(visibleOutput)

        // 在原始数据中检测 OSC end sentinel：ESC]9001;ADNIFY_CMD_END_..._N BEL
        const endIdx = rawAccumulator.indexOf(RAW_END_MARKER)
        if (endIdx !== -1) {
          const afterMarker = rawAccumulator.slice(endIdx + RAW_END_MARKER.length)
          const codeMatch = afterMarker.match(/^(\d+)\x07/)
          if (codeMatch) {
            sentinelMatched = true
            const exitCode = parseInt(codeMatch[1], 10)
            this.updateCurrentCommandSession(termId, (session) => ({
              ...session,
              captureEndSeq: event.seq,
              sentinelMatched: true,
            }))
            settle('sentinel_matched', {
              finalStatus: exitCode === 0 ? 'completed' : 'failed',
              exitCode,
              output: visibleOutput,
              partialOutput: visibleOutput,
              sentinelMatched: true,
            })
            return
          }
        }

        scheduleIdleFallback()
      })

      this.activeExecutions.set(termId, {
        commandSessionId,
        finalize: settle,
      })

      // 必须先订阅，再写命令（避免竞态）
      const isWindows = /windows/i.test(navigator.userAgent)

      // PowerShell 5.x 不支持 && 运算符；cmd.exe 的 cd /d 在 PS 里无效（/d 被当位置参数）
      const sanitizedCommand = isWindows
        ? command
          .replace(/\s*&&\s*/g, '; ')
          .replace(/\bcd\s+\/[dD]\s+(['"]?)([^;|&\n'"]+)\1/g, 'Push-Location "$2"')
        : command

      // cwd 参数：Agent 终端复用，需临时切换目录
      const cmdWithCwd = cwd
        ? (isWindows
          ? `Push-Location "${cwd}"; ${sanitizedCommand}; Pop-Location`
          : `(cd "${cwd}" && ${sanitizedCommand})`)
        : sanitizedCommand

      // OSC sentinel 命令（Windows/Unix/macOS 三平台）
      const sentinelStart = isWindows
        ? `Write-Host -NoNewline "$([char]27)]9001;${START_PAYLOAD}$([char]7)"`
        : `printf '\\033]9001;${START_PAYLOAD}\\007'`
      const sentinelEnd = isWindows
        ? `Write-Host -NoNewline "$([char]27)]9001;${END_PAYLOAD_PREFIX}$LASTEXITCODE$([char]7)"`
        : `printf '\\033]9001;${END_PAYLOAD_PREFIX}'"$?"'\\007'`

      const mainCommand = `${sentinelStart}; ${cmdWithCwd}; ${sentinelEnd}`

      // ── 回显清除策略 ──
      // PTY 行规程在内核层将发送的命令回显到终端（包装代码对用户可见），应用层无法阻止。
      // 解决方案：命令开始执行时立刻输出 ANSI "上移+清除行+回车" 序列，将回显抹掉。
      //   \033[1A = 光标上移1行（列位置保持）；\033[2K = 清除当前行（光标位置保持）；
      //   \r = 回车（光标回到行首）。
      // 关键：\033[1A 和 \033[2K 都不重置光标列位置。若回显因自动换行使光标停在非 0 列，
      //   清除后光标仍在该列，后续 printf 输出会从该列开始，前面出现大量"空格"。
      //   追加 \r 强制光标回到行首，确保后续输出从行首开始，避免对齐错乱。
      // 这与 VS Code/Cursor Shell Integration 使用 PROMPT_COMMAND 钩子的终态效果相同
      // （用户只看到命令输出，不看到包装代码），只是实现层级不同。
      //
      // N 的计算：ceil((提示符估算长度 + 完整命令长度) / 终端列数) + 冗余行
      const xtermInst = this.xtermInstances.get(termId)
      // 确保 cols 准确：先 fit 一次，避免终端尺寸变化后 proposeDimensions 返回过期值
      if (xtermInst?.fitAddon) {
        try { xtermInst.fitAddon.fit() } catch { /* 终端未挂载时忽略 */ }
      }
      const cols = xtermInst?.fitAddon?.proposeDimensions?.()?.cols ?? 80
      const promptLen = isWindows ? 60 : 35
      // 每个清除单元的字面长度（PS 使用 $([char]N) 表达式，Unix 使用 octal 转义）
      // 清除单元 = 上移1行 + 清除整行 + 回车（光标回行首）
      const clearUnit = isWindows
        ? '$([char]27)[1A$([char]27)[2K$([char]13)'
        : '\\033[1A\\033[2K\\r'
      const clearWrapLen = isWindows ? 22 : 10  // "Write-Host -NoNewline \"\"; " 或 "printf ''; "
      // 两次迭代逼近（消除循环依赖）
      const roughLines = Math.ceil((promptLen + mainCommand.length) / cols)
      const clearOverhead = clearWrapLen + clearUnit.length * roughLines
      // +2 冗余：多清除 1 行以覆盖 shell 自动换行、光标位置偏差等边界情况
      // 之前 +1 在某些终端宽度下会少清一行，导致残留回显和排版错乱
      const echoLines = Math.ceil((promptLen + mainCommand.length + clearOverhead) / cols) + 2

      const clearSeq = clearUnit.repeat(echoLines)

      // 清除回显后，补打一行"伪提示符 + 原始命令"，让终端看起来像用户手动输入
      // Windows PS double-quoted string 转义：` → ``，" → `"，$ → `$
      // Unix double-quoted string 转义：\ → \\，" → \"，$ → \$，` → \`
      const displayCmd = isWindows
        ? command.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$')
        : command.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')

      // 提示符路径：有 cwd 时直接嵌入，否则运行时动态获取当前目录
      // 伪提示符前的 \r 确保从行首开始输出（clearSeq 已含 \r，此处为双保险）
      const fakeEchoCmd = isWindows
        ? `Write-Host -NoNewline "${clearSeq}"; Write-Host "PS ${cwd ?? '$(Get-Location)'}> ${displayCmd}"`
        : `printf '${clearSeq}'; printf '%s\\n' "${cwd ? cwd.replace(/\\/g, '/') : '$(pwd)'}\\$ ${displayCmd}"`

      const wrapped = `${fakeEchoCmd}; ${mainCommand}\r`

      this.updateCurrentCommandSession(termId, (session) => ({
        ...session,
        status: 'running',
      }))
      this.writeToTerminal(termId, wrapped)
    })
  }

  cleanup() {
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    for (const terminal of [...this.state.terminals]) {
      const activeExecution = this.activeExecutions.get(terminal.id)
      if (activeExecution) {
        activeExecution.finalize('cleanup', {
          finalStatus: 'cancelled',
        })
      }
      this.closeTerminal(terminal.id);
    }

    this.agentTerminalId = null
    this.agentTerminalCreating = null
    this.currentCommandSessions.clear()
    this.lastCommandSessions.clear()
    this.activeExecutions.clear()
    this.state = {
      terminals: [],
      activeId: null,
    };
    this.notify();
  }
}

export const terminalManager = new TerminalManagerClass();

/**
 * 终端管理器统一入口
 *
 * 本文件为向后兼容入口，重新导出 TerminalAdapter 中的终端管理功能。
 * 新代码请直接从 '@adapters/TerminalAdapter' 导入。
 */
export {
  TerminalManagerClass as TerminalManager,
  terminalManager,
  type TerminalInstance,
  type TerminalCommandInfo,
  type CommandResult,
} from './TerminalAdapter'

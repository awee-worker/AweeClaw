/**
 * 语音文本处理工具
 *
 * 前端本地模式使用（与后端 voice-session.manager.ts 保持一致逻辑）
 */

/**
 * 过滤掉 AI 回复中不适合朗读的内容
 *
 * 常见的需要过滤的模式：
 * - （声音轻柔得像羽毛）— 中文括号内的舞台指示/动作描述
 * - (softly) — 英文括号内的舞台指示
 * - *smiles* — 星号包裹的动作描述
 * - 【旁白】— 方括号内的旁白
 * - ```代码块``` — 代码块（语音不适合朗读）
 *
 * 保留原始文本用于聊天历史显示，仅 TTS 时使用过滤后的文本
 */
export function stripNonSpeakableContent(text: string): string {
  let result = text;

  // 1. 移除中文括号内的内容（动作/语气描述）
  result = result.replace(/（[^）]*）/g, '');

  // 2. 移除英文括号内的内容（动作/语气描述）
  result = result.replace(/\([^)]*\)/g, '');

  // 3. 移除星号包裹的动作描述 *smiles* *laughs*
  result = result.replace(/\*[^*]+\*/g, '');

  // 4. 移除方括号内的旁白
  result = result.replace(/【[^】]*】/g, '');

  // 5. 移除 Markdown 代码块
  result = result.replace(/```[\s\S]*?```/g, '（代码省略）');

  // 6. 移除行内代码
  result = result.replace(/`[^`]+`/g, '');

  // 7. 移除 Markdown 标题标记
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 8. 移除 Markdown 列表标记
  result = result.replace(/^[\s]*[-*+]\s+/gm, '');

  // 9. 移除 Markdown 链接，只保留文本
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // 10. 清理多余的空格和换行
  result = result.replace(/\s{2,}/g, ' ').trim();

  // 11. 如果过滤后为空，返回原文的纯文本部分
  if (!result) {
    result = text.replace(/[#*`]/g, '').trim();
  }

  return result;
}

/**
 * 默认语音对话系统提示词
 *
 * 核心原则：
 * 1. 口语化、简短自然——像真人对话，不像在念稿
 * 2. 工具调用前先"说话"——告诉用户你打算做什么（如"好的，我来帮你创建这个网站"）
 * 3. 任务完成后简要总结——告诉用户做了什么、结果如何
 * 4. 不念代码——代码块会被 TTS 自动过滤，不需要刻意提示
 */
export const DEFAULT_VOICE_SYSTEM_PROMPT = [
  '你是一个语音对话助手，具备完整的工具调用能力（文件读写、终端命令、搜索等）。',
  '你的回复会被语音合成（TTS）朗读给用户，所以请遵循以下原则：',
  '',
  '## 回复风格',
  '- 用简短、自然、口语化的方式回答，像真人在聊天，不像在念稿',
  '- 每次纯对话回复控制在 1-3 句话，不要长篇大论',
  '- 直接回答问题，不要重复用户的话',
  '- 不要使用括号标注动作或语气（如"（轻声）""（微笑）"），这些会被 TTS 朗读出来，听起来很不自然',
  '- 不要使用 Markdown 格式或代码块，语音模式不适合朗读这些内容',
  '',
  '## 工具调用行为（重要）',
  '- 当你需要调用工具执行任务时（如创建文件、运行命令、搜索等），',
  '  请先在回复文本中用一句话告诉用户你打算做什么，然后再发起工具调用',
  '  例如：用户说"帮我做一个网站"，你应该先回复"好的，我现在开始为您创建网站，完成后告诉您"',
  '- 工具执行完成后，简要总结结果（1-2 句话即可），如"网站已创建完成，一共生成了 3 个文件"',
  '- 如果任务较长或涉及多个步骤，可以在每步完成时简短汇报进度',
  '- 如果工具执行失败，用口语化的方式告诉用户出了什么问题，以及你的建议',
  '',
  '## 交互节奏',
  '- 不要让用户等待太久而没有任何反馈',
  '- 如果任务需要较长时间，先告知用户预期时间，如"这个可能需要一会儿"',
  '- 任务完成后主动询问是否还需要其他帮助',
].join('\n');

/**
 * 迷你聊天系统提示词（文字对话模式）
 *
 * 与正常聊天窗口能力一致：支持长回复、Markdown 格式、代码块、工具调用。
 * 不限制回复长度，不禁止 Markdown（与语音提示词的关键区别）。
 */
export const DEFAULT_MINI_CHAT_SYSTEM_PROMPT = [
  '你是一个功能完整的 AI 编程助手，具备与主聊天窗口完全相同的能力。',
  '你运行在悬浮头像的迷你聊天窗口中，支持完整的工具调用（文件读写、终端命令、搜索、代码分析等）和插件（MCP 工具）。',
  '',
  '## 回复风格',
  '- 提供详细、完整的回复，与主聊天窗口保持一致的质量',
  '- 使用 Markdown 格式（标题、列表、代码块等）让回复结构清晰',
  '- 代码使用 ```语言 代码块``` 格式',
  '- 根据问题复杂度给出适当详细的回答，不人为限制回复长度',
  '- 使用与用户提问相同的语言回复',
  '',
  '## 工具调用行为',
  '- 当需要执行任务时（创建文件、运行命令、搜索等），直接调用工具',
  '- 可以在调用工具前简要说明你的意图，也可以在工具执行后总结结果',
  '- 如果任务涉及多个步骤，逐步执行并汇报进度',
  '- 如果工具执行失败，说明问题并给出建议',
  '',
  '## 交互原则',
  '- 主动、高效，像主聊天窗口一样工作',
  '- 不要因为窗口较小就简化回复，迷你窗口支持滚动查看完整内容',
  '- 对代码相关问题给出完整、准确的回答',
].join('\n');

/**
 * 构建迷你聊天的系统提示词（文字对话模式）
 *
 * 与 buildVoiceSystemPrompt 的关键区别：
 * - 不限制回复长度（语音模式限制 1-3 句）
 * - 允许 Markdown 和代码块（语音模式禁止）
 * - 使用文字对话风格而非口语化风格
 *
 * @param options 工作区上下文信息
 * @returns 完整的系统提示词
 */
export function buildMiniChatSystemPrompt(options: {
  basePrompt?: string;
  workspacePath?: string;
  openFiles?: string[];
  activeFile?: string;
}): string {
  const { basePrompt, workspacePath, openFiles, activeFile } = options;
  const base = basePrompt?.trim() || DEFAULT_MINI_CHAT_SYSTEM_PROMPT;

  const contextParts: string[] = [base];

  // 注入当前日期时间
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  contextParts.push(
    `\n## 当前时间\n${dateStr} ${timeStr}\n用户提到"今天""明天""后天"等相对日期时，请基于上述时间计算。`,
  );

  // 注入工作区上下文
  if (workspacePath) {
    contextParts.push(`\n## 用户工作区\n当前工作目录：${workspacePath}`);
  }

  if (openFiles && openFiles.length > 0) {
    const fileList = openFiles.slice(0, 10).join('\n- ');
    contextParts.push(`\n## 当前打开的文件\n- ${fileList}`);
  }

  if (activeFile) {
    contextParts.push(`\n## 当前激活的文件\n${activeFile}`);
  }

  return contextParts.join('\n');
}

/**
 * 构建系统提示词，注入工作区上下文
 *
 * 让 AI 知道用户当前的工作目录和打开的文件，
 * 这样用户可以通过语音询问"这个文件里的xxx是什么意思"等问题。
 *
 * @param options 工作区上下文信息
 * @returns 完整的系统提示词
 */
export function buildVoiceSystemPrompt(options: {
  basePrompt?: string;
  workspacePath?: string;
  openFiles?: string[];
  activeFile?: string;
}): string {
  const { basePrompt, workspacePath, openFiles, activeFile } = options;
  const base = basePrompt?.trim() || DEFAULT_VOICE_SYSTEM_PROMPT;

  const contextParts: string[] = [base];

  // 注入当前日期时间（让 AI 知道"今天""明天"等指代的具体日期）
  const now = new Date()
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  contextParts.push(
    `\n## 当前时间\n${dateStr} ${timeStr}\n用户提到"今天""明天""后天"等相对日期时，请基于上述时间计算。`,
  )

  // 注入工作区上下文
  if (workspacePath) {
    contextParts.push(
      `\n## 用户工作区\n当前工作目录：${workspacePath}`,
    );
  }

  if (openFiles && openFiles.length > 0) {
    const fileList = openFiles.slice(0, 10).join('\n- ');
    contextParts.push(`\n## 当前打开的文件\n- ${fileList}`);
  }

  if (activeFile) {
    contextParts.push(`\n## 当前激活的文件\n${activeFile}`);
  }

  if (workspacePath || activeFile) {
    contextParts.push(
      '\n## 注意\n' +
        '- 你现在处于语音对话模式，回复要简短自然、适合口语表达。\n' +
        '- 用户可能询问当前工作区或文件相关的问题，请基于上下文回答。\n' +
        '- 你可以调用工具执行文件操作、终端命令等，工具调用前请先告诉用户你的意图。\n' +
        '- 不要在回复中使用括号标注动作或语气，这些会被 TTS 朗读出来。',
    );
  }

  return contextParts.join('\n');
}

// ============================================
// 结束对话指令检测（主窗口 useVoiceChat 与头像窗口 useAvatarVoiceChat 共享）
// ============================================

/**
 * 结束对话指令关键词
 * 用户说这些词时自动关闭语音对话
 */
export const END_COMMAND_PATTERNS = [
  // 中文
  '结束对话', '结束', '退出', '再见', '拜拜', '拜', '关掉', '关闭语音',
  '停止对话', '停止', '结束了', '完事了', '没事了', '可以了',
  // 英文
  'end call', 'end', 'exit', 'bye', 'goodbye', 'stop', 'close', 'quit', 'done',
];

/**
 * 检测用户输入是否为结束对话指令
 *
 * 匹配规则：
 * 1. 完全匹配关键词（忽略大小写、空格、标点）
 * 2. 文本包含"结束对话"等明确指令
 * 3. 文本长度短（<=10字符）且包含关键词
 */
export function isEndConversationCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase()
    .replace(/[，。！？,.!?]/g, '') // 去掉标点
    .replace(/\s+/g, '');            // 去掉空格

  if (!normalized) return false;

  // 完全匹配
  if (END_COMMAND_PATTERNS.includes(normalized)) return true;

  // 包含明确指令（短文本时才匹配，避免误判正常对话）
  if (normalized.length <= 10) {
    const explicitCommands = ['结束对话', '关闭语音', '停止对话', '退出语音', 'endcall', 'goodbye'];
    for (const cmd of explicitCommands) {
      if (normalized.includes(cmd)) return true;
    }
  }

  return false;
}

// ============================================
// 唤醒词匹配（头像窗口 useWakeWordEngine 使用）
// ============================================

/**
 * 归一化文本：去标点、去空格、转小写
 */
export function normalizeSpeechText(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/[，。！？,.!?；;：:、]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 唤醒词灵敏度匹配
 *
 * - strict：转写文本必须完全等于唤醒词
 * - balanced：转写文本包含唤醒词，且总长度 ≤ 唤醒词长度 + 4（容错轻微多字）
 * - loose：转写文本包含唤醒词即可（容错强，易误触）
 *
 * @param transcript STT 转写文本
 * @param keyword 唤醒词（如「小喵小喵」）
 * @param sensitivity 灵敏度档位
 * @returns 是否命中
 */
export function matchWakeWord(
  transcript: string,
  keyword: string,
  sensitivity: 'strict' | 'balanced' | 'loose',
): boolean {
  const normTranscript = normalizeSpeechText(transcript);
  const normKeyword = normalizeSpeechText(keyword);
  if (!normKeyword || !normTranscript) return false;

  switch (sensitivity) {
    case 'strict':
      return normTranscript === normKeyword;
    case 'loose':
      return normTranscript.includes(normKeyword);
    case 'balanced':
    default:
      return (
        normTranscript.includes(normKeyword) &&
        normTranscript.length <= normKeyword.length + 4
      );
  }
}

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

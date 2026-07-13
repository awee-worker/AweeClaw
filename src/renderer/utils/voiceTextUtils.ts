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
 */
export const DEFAULT_VOICE_SYSTEM_PROMPT =
  '你是一个语音对话助手。请用简短、自然、口语化的方式回答用户，每次回复控制在 1-3 句话，避免使用 Markdown 格式或代码块。直接回答问题，不要重复用户的话。不要在回复中使用括号标注动作或语气（如"（轻声）""（微笑）"），这些会被 TTS 朗读出来，听起来很不自然。';

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
        '- 如果用户需要执行修改文件、运行命令等操作，建议用户切换到文字对话模式。\n' +
        '- 不要在回复中使用括号标注动作或语气，这些会被 TTS 朗读出来。',
    );
  }

  return contextParts.join('\n');
}

/**
 * 断言抽取器 — 从文本中提取因果断言
 *
 * 实现：
 * 1. 规则模板匹配（中英文双语）
 * 2. LLM 抽取接口（通过回调注入，由渲染层调用 LLM）
 * 3. 自动节点类型推断
 *
 * 与后端 AssertionExtractorService 算法保持一致
 *
 * @module causal-reasoning/AssertionExtractor
 */

import { logger } from '@shared/toolkit/LogEngine';
import type {
  ExtractedAssertion,
  CausalEdgeRelation,
  CausalNodeType,
  CausalEvent,
} from './CausalReasoningInterface';

// ============================================================
// LLM 抽取回调类型
// ============================================================

/**
 * LLM 抽取回调函数类型
 *
 * 由渲染层通过 IPC 注入，调用 IntelligenceCore 的 LLM 能力抽取因果断言。
 * 当回调未注入时，extractByLlm 返回空数组，仅使用规则抽取。
 */
export type LlmExtractCallback = (
  sourceText: string,
  minConfidence: number,
) => Promise<ExtractedAssertion[]>;

// ============================================================
// 规则模板定义
// ============================================================

interface RuleTemplate {
  /** 模板名称 */
  name: string;
  /** 正则表达式 */
  pattern: RegExp;
  /** 关系类型 */
  relation: CausalEdgeRelation;
  /** 默认强度 */
  strength: number;
}

/** 中文模板 */
const CN_TEMPLATES: RuleTemplate[] = [
  {
    name: 'cn_cause',
    pattern: /(.+?)\s*导致\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'cn_trigger',
    pattern: /(.+?)\s*引发\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'cn_cause_to',
    pattern: /(.+?)\s*造成\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'cn_because',
    pattern: /因为\s*(.+?)\s*所以\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'causes',
    strength: 0.8,
  },
  {
    name: 'cn_due_to',
    pattern: /由于\s*(.+?)\s*[，,]\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'cn_promote',
    pattern: /(.+?)\s*促进\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'enables',
    strength: 0.6,
  },
  {
    name: 'cn_help',
    pattern: /(.+?)\s*有助于\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'enables',
    strength: 0.6,
  },
  {
    name: 'cn_prevent',
    pattern: /(.+?)\s*阻止\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'prevents',
    strength: 0.7,
  },
  {
    name: 'cn_avoid',
    pattern: /(.+?)\s*防止\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'prevents',
    strength: 0.7,
  },
  {
    name: 'cn_inhibit',
    pattern: /(.+?)\s*抑制\s*(.+?)[。.，,；;！!？?]/g,
    relation: 'inhibits',
    strength: 0.6,
  },
];

/** 英文模板 */
const EN_TEMPLATES: RuleTemplate[] = [
  {
    name: 'en_causes',
    pattern: /(.+?)\s+causes?\s+(.+?)[.!?,;]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'en_leads_to',
    pattern: /(.+?)\s+leads?\s+to\s+(.+?)[.!?,;]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'en_because',
    pattern: /because\s+(.+?)\s*,?\s+(.+?)[.!?,;]/g,
    relation: 'causes',
    strength: 0.8,
  },
  {
    name: 'en_due_to',
    pattern: /due\s+to\s+(.+?),\s+(.+?)[.!?,;]/g,
    relation: 'causes',
    strength: 0.7,
  },
  {
    name: 'en_enables',
    pattern: /(.+?)\s+enables?\s+(.+?)[.!?,;]/g,
    relation: 'enables',
    strength: 0.6,
  },
  {
    name: 'en_promotes',
    pattern: /(.+?)\s+promotes?\s+(.+?)[.!?,;]/g,
    relation: 'enables',
    strength: 0.6,
  },
  {
    name: 'en_prevents',
    pattern: /(.+?)\s+prevents?\s+(.+?)[.!?,;]/g,
    relation: 'prevents',
    strength: 0.7,
  },
  {
    name: 'en_inhibits',
    pattern: /(.+?)\s+inhibits?\s+(.+?)[.!?,;]/g,
    relation: 'inhibits',
    strength: 0.6,
  },
  {
    name: 'en_blocks',
    pattern: /(.+?)\s+blocks?\s+(.+?)[.!?,;]/g,
    relation: 'prevents',
    strength: 0.7,
  },
];

const ALL_TEMPLATES = [...CN_TEMPLATES, ...EN_TEMPLATES];

/** 最大文本长度（防爆栈） */
const MAX_TEXT_LENGTH = 4096;

/** 最大抽取断言数 */
const MAX_ASSERTIONS = 50;

// ============================================================
// 节点类型推断关键词
// ============================================================

const ACTION_KEYWORDS_CN = ['启动', '运行', '执行', '打开', '关闭', '点击', '输入', '保存', '删除'];
const ACTION_KEYWORDS_EN = ['start', 'run', 'execute', 'open', 'close', 'click', 'input', 'save', 'delete'];
const METRIC_KEYWORDS_CN = ['使用率', '数量', '温度', '速度', '频率', '百分比', '大小'];
const METRIC_KEYWORDS_EN = ['usage', 'count', 'temperature', 'speed', 'frequency', 'percent', 'size'];
const STATE_KEYWORDS_CN = ['状态', '模式', '在线', '离线', '启用', '禁用'];
const STATE_KEYWORDS_EN = ['state', 'mode', 'online', 'offline', 'enabled', 'disabled'];

// ============================================================
// AssertionExtractor 实现
// ============================================================

/**
 * 断言抽取器
 *
 * 提供规则 + LLM 组合的因果断言抽取能力。
 * 规则优先级高于 LLM（同样的断言优先用规则结果）。
 */
export class AssertionExtractor {
  /** LLM 抽取回调（可选，由渲染层注入） */
  private llmCallback: LlmExtractCallback | null = null;

  /**
   * 设置 LLM 抽取回调
   *
   * @param callback 回调函数（传 null 清除）
   */
  setLlmCallback(callback: LlmExtractCallback | null): void {
    this.llmCallback = callback;
    if (callback) {
      logger.causal?.info('[AssertionExtractor] LLM 回调已注入，LLM 抽取已启用');
    } else {
      logger.causal?.warn('[AssertionExtractor] LLM 回调已清除，降级为仅规则抽取');
    }
  }

  /**
   * 从文本中抽取断言（规则 + LLM 组合）
   *
   * @param sourceText 原始文本
   * @param minConfidence 最小置信度（用于过滤 LLM 结果）
   */
  async extract(
    sourceText: string,
    minConfidence = 0.6,
  ): Promise<ExtractedAssertion[]> {
    if (!sourceText || sourceText.length === 0) return [];

    // 截断过长文本
    const text =
      sourceText.length > MAX_TEXT_LENGTH
        ? sourceText.slice(0, MAX_TEXT_LENGTH)
        : sourceText;

    // 1. 规则抽取
    const ruleAssertions = this.extractByRules(text);

    // 2. LLM 抽取（通过回调，未注入则返回空）
    const llmAssertions = await this.extractByLlm(text, minConfidence);

    // 3. 合并去重（规则优先级高于 LLM）
    const seen = new Set<string>();
    const merged: ExtractedAssertion[] = [];

    for (const a of ruleAssertions) {
      const key = `${a.causeName}|${a.effectName}|${a.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
    for (const a of llmAssertions) {
      const key = `${a.causeName}|${a.effectName}|${a.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }

    // 截断过多的断言
    return merged.slice(0, MAX_ASSERTIONS);
  }

  /**
   * 从事件流抽取断言
   *
   * 将事件列表合并成文本后调用 extract
   */
  async extractFromEvents(
    events: CausalEvent[],
    minConfidence = 0.6,
  ): Promise<ExtractedAssertion[]> {
    if (events.length === 0) return [];

    // 按时间排序
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    // 合并成文本
    const text = sorted
      .map((e) => {
        const time = new Date(e.timestamp).toISOString();
        const nodes = e.relatedNodes?.length
          ? ` [${e.relatedNodes.join(', ')}]`
          : '';
        return `${time} ${e.type}${nodes}: ${e.text}`;
      })
      .join('\n');

    return this.extract(text, minConfidence);
  }

  /** 规则抽取 */
  private extractByRules(sourceText: string): ExtractedAssertion[] {
    const assertions: ExtractedAssertion[] = [];

    for (const template of ALL_TEMPLATES) {
      // 重置正则状态
      template.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = template.pattern.exec(sourceText)) !== null) {
        const causeName = match[1]?.trim();
        const effectName = match[2]?.trim();
        if (!causeName || !effectName) continue;
        if (causeName.length > 128 || effectName.length > 128) continue;

        assertions.push({
          sourceText: match[0],
          causeName,
          effectName,
          relation: template.relation,
          strength: template.strength,
          extractor: 'rule',
          extractMeta: {
            confidence: template.strength,
            template: template.name,
            match: match[0],
          },
        });
      }
    }

    return assertions;
  }

  /**
   * LLM 抽取（通过回调注入）
   *
   * 回调由渲染层通过 IPC 设置，调用 IntelligenceCore 的 LLM 能力。
   * 当回调未注入或调用失败时返回空数组，不阻塞规则抽取。
   */
  private async extractByLlm(
    sourceText: string,
    minConfidence: number,
  ): Promise<ExtractedAssertion[]> {
    if (!this.llmCallback) {
      return [];
    }

    try {
      const result = await this.llmCallback(sourceText, minConfidence);
      if (!Array.isArray(result)) {
        return [];
      }
      // 过滤置信度
      return result.filter((a) => {
        const confidence =
          (a.extractMeta?.confidence as number | undefined) ?? 0.5;
        return confidence >= minConfidence;
      });
    } catch (err) {
      logger.causal?.warn(
        '[AssertionExtractor] LLM 抽取失败:',
        err instanceof Error ? err.message : String(err),
      );
      return [];
    }
  }

  /**
   * 节点类型推断
   *
   * 根据节点名关键词推断类型：
   * - action：包含动作动词（启动/运行/执行等）
   * - metric：包含度量词（使用率/数量/温度等）
   * - state：包含状态词（状态/模式/在线等）
   * - event：默认类型
   */
  inferNodeType(name: string): CausalNodeType {
    const lower = name.toLowerCase();

    if (ACTION_KEYWORDS_CN.some((kw) => name.includes(kw))) return 'action';
    if (ACTION_KEYWORDS_EN.some((kw) => lower.includes(kw))) return 'action';

    if (METRIC_KEYWORDS_CN.some((kw) => name.includes(kw))) return 'metric';
    if (METRIC_KEYWORDS_EN.some((kw) => lower.includes(kw))) return 'metric';

    if (STATE_KEYWORDS_CN.some((kw) => name.includes(kw))) return 'state';
    if (STATE_KEYWORDS_EN.some((kw) => lower.includes(kw))) return 'state';

    return 'event';
  }
}

// ============================================================
// AssertionCollector 事件流收集器
// ============================================================

/**
 * 断言收集器
 *
 * 职责：
 * - 收集系统中的因果事件（perception/monitoring/user_input 等）
 * - 定期从事件流抽取断言（基于配置的提取周期）
 * - 抽取的断言写入 CausalGraphStore 等待审核
 *
 * 单例模式，主进程启动时初始化。
 */
export class AssertionCollector {
  private static instance: AssertionCollector | null = null;

  /** 事件缓冲区 */
  private eventBuffer: CausalEvent[] = [];

  /** 缓冲区最大容量 */
  private readonly maxBufferSize = 200;

  /** 定时器 */
  private timer: NodeJS.Timeout | null = null;

  /** 抽取间隔（毫秒） */
  private extractIntervalMs = 5 * 60 * 1000; // 5 分钟

  /** 是否启用 */
  private enabled = false;

  /** 抽取器 */
  private readonly extractor = new AssertionExtractor();

  private constructor() {}

  static getInstance(): AssertionCollector {
    if (!AssertionCollector.instance) {
      AssertionCollector.instance = new AssertionCollector();
    }
    return AssertionCollector.instance;
  }

  /** 启动收集器 */
  start(extractIntervalMs?: number): void {
    if (this.enabled) return;
    this.enabled = true;
    if (extractIntervalMs) this.extractIntervalMs = extractIntervalMs;

    this.timer = setInterval(() => {
      this.flush().catch((e) => {
        logger.causal?.error('[AssertionCollector] 定时抽取失败:', e);
      });
    }, this.extractIntervalMs);

    logger.causal?.info(
      `[AssertionCollector] 已启动，抽取间隔 ${this.extractIntervalMs}ms`,
    );
  }

  /** 停止收集器 */
  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.causal?.info('[AssertionCollector] 已停止');
  }

  /** 是否运行中 */
  isRunning(): boolean {
    return this.enabled;
  }

  /**
   * 收集事件
   *
   * 由 perception/monitoring 等模块调用，将事件加入缓冲区
   */
  collectEvent(event: CausalEvent): void {
    if (!this.enabled) return;

    this.eventBuffer.push(event);

    // 缓冲区满时立即 flush
    if (this.eventBuffer.length >= this.maxBufferSize) {
      this.flush().catch((e) => {
        logger.causal?.error('[AssertionCollector] 缓冲区满触发抽取失败:', e);
      });
    }
  }

  /**
   * 立即抽取并清空缓冲区
   *
   * 从缓冲区中的事件抽取断言，写入 store
   */
  async flush(): Promise<{ extracted: number }> {
    if (this.eventBuffer.length === 0) return { extracted: 0 };

    // 取出缓冲区数据
    const events = this.eventBuffer.splice(0, this.eventBuffer.length);

    try {
      // 动态导入避免循环依赖
      const { CausalGraphStore } = await import('./CausalGraphStore');
      const store = CausalGraphStore.getInstance();
      const config = store.getConfig();

      // 抽取断言
      const assertions = await this.extractor.extractFromEvents(
        events,
        config.extractionMinConfidence,
      );

      if (assertions.length === 0) {
        return { extracted: 0 };
      }

      // 写入 store 等待审核
      store.addAssertions(
        assertions.map((a) => ({
          sourceText: a.sourceText,
          causeName: a.causeName,
          effectName: a.effectName,
          relation: a.relation,
          strength: a.strength,
          extractor: a.extractor,
          extractMeta: a.extractMeta,
        })),
      );

      logger.causal?.info(
        `[AssertionCollector] 从 ${events.length} 个事件抽取到 ${assertions.length} 条断言`,
      );

      return { extracted: assertions.length };
    } catch (e) {
      logger.causal?.error('[AssertionCollector] 抽取断言失败:', e);
      // 失败时将事件放回缓冲区（如果还有空间）
      if (this.eventBuffer.length + events.length <= this.maxBufferSize) {
        this.eventBuffer.unshift(...events);
      }
      return { extracted: 0 };
    }
  }
}

export const KNOWLEDGE_CATEGORIES = [
  'concept',
  'decision',
  'faq',
  'reference',
  'glossary',
  'best-practice',
  'error-solution',
  'api',
  'pattern',
  'document',
  'correction',
  'preference',
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const EXTRACTION_RULES = {
  minContentLength: 30,
  maxContentLength: 300,
  maxTagsPerEntry: 5,
  maxEntriesPerExtraction: 5,
  defaultConfidence: 0.7,
  minConfidence: 0.6,
  maxConfidence: 1.0,
  correctionConfidence: 0.9,
  preferenceConfidence: 0.85,
  explicitConfidence: 0.95,
  minConversationLength: 100,
  minTextLength: 80,
  maxConversationMessages: 30,
  minExtractionIntervalMs: 15_000,
  maxTruncationLength: 8000,
  maxMessageSlice: 800,
} as const;

export const CORRECTION_PATTERNS: Array<{ regex: RegExp; tag: string }> = [
  {
    regex:
      /(?:我之前说过|我早就说过|我已经告诉过你|我刚才说了|我不是说了|我前面说过)[：:，,]?\s*(.+)/i,
    tag: 'correction',
  },
  {
    regex:
      /(?:不对|错了|不是这样|你搞错了|你理解错了|说错了)[：:，,]?\s*(.+)/i,
    tag: 'correction',
  },
  {
    regex: /(?:记住|记住了吗|别忘了|记住这个|记住：)[：:，,]?\s*(.+)/i,
    tag: 'explicit',
  },
  {
    regex:
      /(?:记住|remember|note|keep in mind|don'?t forget|important)[:\s]+(.+)/i,
    tag: 'explicit',
  },
  {
    regex:
      /(?:I (?:already |previously )?told you|I said (?:before|earlier)|that'?s wrong|you'?re wrong|not like that|incorrect)[:\s,]+(.+)/i,
    tag: 'correction',
  },
];

export const PREFERENCE_PATTERNS: Array<{ regex: RegExp; tag: string }> = [
  {
    regex:
      /(?:我喜欢|我偏好|我习惯|我倾向于|我更喜欢|我一般|我通常|我喜欢用|我用的是)[：:，,]?\s*(.+)/i,
    tag: 'preference',
  },
  {
    regex:
      /(?:I prefer|I like|I usually|I always|I tend to|my preference|I'd rather)[:\s]+(.+)/i,
    tag: 'preference',
  },
  {
    regex:
      /(?:不要|别|千万别|绝对不要|永远不要|不要用)[：:，,]?\s*(.+)/i,
    tag: 'preference',
  },
  {
    regex: /(?:never|don'?t|avoid|always use|must not)[:\s]+(.+)/i,
    tag: 'preference',
  },
];

export const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction specialist. Analyze the provided content and extract valuable knowledge entries.

Rules:
1. Only extract factual, actionable, or reference-worthy information
2. Each entry should be self-contained and understandable without context
3. Use clear, concise titles
4. Assign appropriate categories: concept, decision, faq, reference, glossary, best-practice, error-solution, api, pattern, document, correction, preference
5. Add relevant tags (2-5 per entry)
6. Set confidence: 1.0 for explicit facts, 0.85 for preferences, 0.9 for corrections, 0.8 for inferred knowledge, 0.6 for uncertain
7. Skip greetings, small talk, and trivial exchanges
8. Merge related information into single entries when possible
9. Pay special attention to user corrections - if the user corrects the assistant, extract the corrected fact
10. Extract user preferences and habits
11. Maximum 5 entries per extraction`;

export const CONVERSATION_EXTRACTION_PROMPT = `${EXTRACTION_SYSTEM_PROMPT}

Focus on extracting:
- User preferences and habits
- User-defined rules and conventions
- Architectural decisions
- Error solutions discovered
- Project conventions
- Important technical facts
- User corrections and clarifications
- Personal reasoning patterns

Return a JSON array of extracted knowledge entries. If no valuable knowledge is found, return an empty array.

Format:
[{"title": "...", "content": "...", "category": "...", "tags": ["..."], "confidence": 0.9}]`;

export function validateCategory(category: unknown): KnowledgeCategory {
  if (
    typeof category === 'string' &&
    (KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)
  ) {
    return category as KnowledgeCategory;
  }
  return 'document';
}

export function normalizeConfidence(confidence: unknown): number {
  if (typeof confidence === 'number') {
    return Math.min(
      Math.max(confidence, EXTRACTION_RULES.minConfidence),
      EXTRACTION_RULES.maxConfidence,
    );
  }
  return EXTRACTION_RULES.defaultConfidence;
}

export const SEARCH_SCORING = {
  keyword: {
    titleExactMatch: 10,
    titleContains: 5,
    contentContains: 3,
    tagContains: 2,
    queryContainsTag: 1,
    wordInTitle: 2,
    wordInContent: 1,
    starredBoost: 1,
    confidenceWeight: 2,
    recencyDecayDays: 30,
    popularityDivisor: 10,
    popularityMaxBoost: 2,
    minWordLength: 2,
  },
  vector: {
    scoreMultiplier: 10,
    defaultThreshold: 0.5,
  },
  fusion: {
    keywordWeight: 0.4,
    semanticWeight: 0.6,
    rrfK: 60,
  },
} as const;

export function computeKeywordScore(params: {
  query: string;
  title: string;
  content: string;
  tags: string[];
  starred: boolean;
  confidence: number;
  updatedAtMs: number;
  accessCount?: number;
}): number {
  const { query, title, content, tags, starred, confidence, updatedAtMs, accessCount = 0 } = params;
  const cfg = SEARCH_SCORING.keyword;
  const queryLower = query.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  let score = 0;

  if (titleLower === queryLower) score += cfg.titleExactMatch;
  else if (titleLower.includes(queryLower)) score += cfg.titleContains;

  if (contentLower.includes(queryLower)) score += cfg.contentContains;

  for (const tag of tags) {
    if (tag.toLowerCase().includes(queryLower)) score += cfg.tagContains;
    if (queryLower.includes(tag.toLowerCase())) score += cfg.queryContainsTag;
  }

  for (const word of queryLower.split(/\s+/)) {
    if (word.length < cfg.minWordLength) continue;
    if (titleLower.includes(word)) score += cfg.wordInTitle;
    if (contentLower.includes(word)) score += cfg.wordInContent;
  }

  score += starred ? cfg.starredBoost : 0;
  score += confidence * cfg.confidenceWeight;

  const recencyBoost = Math.max(
    0,
    1 - (Date.now() - updatedAtMs) / (cfg.recencyDecayDays * 86_400_000),
  );
  score += recencyBoost;

  const popularityBoost = Math.min(accessCount / cfg.popularityDivisor, cfg.popularityMaxBoost);
  score += popularityBoost;

  return score;
}

export function computeWeightedFusion(
  keywordScore: number,
  semanticScore: number,
): number {
  const { keywordWeight, semanticWeight } = SEARCH_SCORING.fusion;
  return keywordScore * keywordWeight + semanticScore * semanticWeight;
}

export function rrfScore(rank: number, k: number = SEARCH_SCORING.fusion.rrfK): number {
  return 1 / (k + rank);
}

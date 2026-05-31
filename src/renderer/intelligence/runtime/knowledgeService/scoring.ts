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

const IMPORTANCE_WEIGHTS = {
  sourceReliability: 0.2,
  verificationStatus: 0.15,
  recallFrequency: 0.2,
  connectionDensity: 0.15,
  recencyRelevance: 0.15,
  uniqueness: 0.15,
} as const;

const SOURCE_RELIABILITY: Record<string, number> = {
  user: 1.0,
  self_correction: 0.95,
  self_reflection: 0.85,
  dreaming_rem: 0.8,
  dreaming_deep: 0.75,
  dreaming_light: 0.7,
  auto_extracted: 0.6,
};

const VERIFICATION_SCORES: Record<string, number> = {
  verified: 1.0,
  unverified: 0.4,
  contradicted: 0.1,
  superseded: 0.0,
};

export function computeImportance(params: {
  source: string;
  verificationStatus: string;
  recallCount: number;
  derivedFromCount: number;
  tagsCount: number;
  createdAtMs: number;
  lastRecalledAtMs: number;
  content: string;
  confidence: number;
}): number {
  const {
    source,
    verificationStatus,
    recallCount,
    derivedFromCount,
    tagsCount,
    createdAtMs,
    lastRecalledAtMs,
    content,
    confidence,
  } = params;

  const sourceScore = SOURCE_RELIABILITY[source] ?? 0.5;
  const verificationScore = VERIFICATION_SCORES[verificationStatus] ?? 0.3;
  const recallScore = Math.min(recallCount / 10, 1);
  const connectionScore = Math.min((derivedFromCount + tagsCount * 0.2) / 5, 1);

  const now = Date.now();
  const ageDays = (now - createdAtMs) / 86_400_000;
  const daysSinceRecall = (now - lastRecalledAtMs) / 86_400_000;
  const recencyScore = Math.max(0, 1 - daysSinceRecall / 30) * Math.max(0.3, 1 - ageDays / 365);

  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length
  const avgWordLength = wordCount > 0 ? content.length / wordCount : 0
  const uniquenessScore = Math.min(avgWordLength / 8, 1) * confidence;

  const importance =
    sourceScore * IMPORTANCE_WEIGHTS.sourceReliability +
    verificationScore * IMPORTANCE_WEIGHTS.verificationStatus +
    recallScore * IMPORTANCE_WEIGHTS.recallFrequency +
    connectionScore * IMPORTANCE_WEIGHTS.connectionDensity +
    recencyScore * IMPORTANCE_WEIGHTS.recencyRelevance +
    uniquenessScore * IMPORTANCE_WEIGHTS.uniqueness;

  return Math.max(0, Math.min(1, importance));
}

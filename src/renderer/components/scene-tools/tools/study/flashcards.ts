import { useFlashcardStore } from '../../stores'
import type { SceneToolDS, TrackKeyFn } from '../../factory'

export const DS: SceneToolDS = {
  id: 'study-flashcards',
  name: '闪卡复习',
  mode: 'study',
  description: '闪卡复习：间隔重复记忆（Leitner 盒子 1-5）',
  itemSchema: 'add: { front: string, back: string, deck?: string(默认"默认") }；update: { id: 卡片id, patch { front/back/deck } } 或 { id: 卡片id, patch { review: true, correct: boolean } } 记录复习结果',
  read: () => {
    const s = useFlashcardStore.getState()
    return {
      decks: s.decks,
      cards: s.cards.map((c) => ({
        id: c.id,
        front: c.front,
        back: c.back,
        deck: c.deck,
        box: c.box,
        nextReview: new Date(c.nextReview).toISOString().slice(0, 10),
        wrongCount: c.wrongCount,
        rightCount: c.rightCount,
      })),
    }
  },
  add: (item) => {
    const front = String(item.front ?? '').trim()
    const back = String(item.back ?? '').trim()
    if (!front || !back) return { ok: false, error: 'front 和 back 均必填' }
    const deck = String(item.deck ?? '默认').trim() || '默认'
    useFlashcardStore.getState().addCard(front, back, deck)
    return { ok: true }
  },
  update: (id, patch) => {
    const s = useFlashcardStore.getState()
    const card = s.cards.find((c) => c.id === id)
    if (!card) return { ok: false, error: `未找到卡片 ${id}` }
    if (patch.review !== undefined) {
      s.review(id, Boolean(patch.correct))
      return { ok: true }
    }
    const clean: Partial<{ front: string; back: string; deck: string }> = {}
    if (typeof patch.front === 'string') clean.front = patch.front
    if (typeof patch.back === 'string') clean.back = patch.back
    if (typeof patch.deck === 'string') clean.deck = patch.deck
    s.updateCard(id, clean)
    return { ok: true }
  },
  remove: (id) => {
    useFlashcardStore.getState().removeCard(id)
    return { ok: true }
  },
}

export const trackKey: TrackKeyFn = (i) => (i as any)?.front ?? (i as any)?.id ?? ''

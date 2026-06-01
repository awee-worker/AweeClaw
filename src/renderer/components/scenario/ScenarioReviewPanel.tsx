import { useState } from 'react'
import { Star, MessageSquare, Send, Loader2, User } from 'lucide-react'
import { useStore } from '@store'
import { backendApi, isAuthenticated } from '@services/backendApi'
import { toast } from '../foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

interface ReviewItem {
  id: string
  userId: string
  scenarioId: string
  rating: number
  comment: string
  createdAt: string
  user: {
    id: string
    username: string | null
    avatarUrl: string | null
  }
}

interface ReviewsResponse {
  reviews: ReviewItem[]
  total: number
  page: number
  limit: number
}

interface ScenarioReviewPanelProps {
  scenarioId: string
  scenarioName: string
  scenarioNameZh: string
  currentRating: number
  ratingCount: number
}

function StarRating({
  value,
  onChange,
  readonly = false,
  size = 'sm',
}: {
  value: number
  onChange?: (v: number) => void
  readonly?: boolean
  size?: 'sm' | 'md'
}) {
  const [hovered, setHovered] = useState(0)
  const sz = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          disabled={readonly}
          onClick={() => onChange?.(i)}
          onMouseEnter={() => !readonly && setHovered(i)}
          onMouseLeave={() => !readonly && setHovered(0)}
          className={`${readonly ? 'cursor-default' : 'cursor-pointer'} transition-transform ${!readonly ? 'hover:scale-110' : ''}`}
        >
          <Star
            className={`${sz} ${
              i <= (hovered || value)
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-[var(--color-border)]'
            }`}
          />
        </button>
      ))}
    </div>
  )
}

export function ScenarioReviewPanel({
  scenarioId,
  currentRating,
  ratingCount,
}: ScenarioReviewPanelProps) {
  const language = useStore(s => s.language)
  const isLoggedIn = useStore(s => s.isAuthenticated)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [total, setTotal] = useState(ratingCount)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [myRating, setMyRating] = useState(0)
  const [myComment, setMyComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function loadReviews(p = 1) {
    setLoading(true)
    try {
      const res = await backendApi.get<ReviewsResponse>(
        `/api/v1/marketplace/reviews/${scenarioId}?page=${p}&limit=10`,
      )
      setReviews(res.reviews || [])
      setTotal(res.total)
      setPage(p)
      setLoaded(true)
    } catch {
      setReviews([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitReview() {
    if (!isAuthenticated()) {
      toast.error(t('app.pleaseloginfirst', language as Language))
      return
    }
    if (myRating === 0) {
      toast.error(t('app.pleaseselectarating', language as Language))
      return
    }

    setSubmitting(true)
    try {
      await backendApi.post(`/api/v1/marketplace/rate/${scenarioId}`, {
        rating: myRating,
        comment: myComment,
      })
      toast.success(
        t('app.reviewsubmitted', language as Language),
      )
      setMyRating(0)
      setMyComment('')
      loadReviews(1)
    } catch (err) {
      toast.error(
        t('app.failedtosubmitreview', language as Language),
        err instanceof Error ? err.message : '',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-[var(--color-text)] opacity-60 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            {t('app.reviews', language as Language)}
          </h4>
          <button
            onClick={() => loadReviews(1)}
            className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
          >
            {t('app.loadreviews', language as Language)}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text)] opacity-50">
          <StarRating value={Math.round(currentRating)} readonly />
          <span>{currentRating.toFixed(1)}</span>
          <span>({ratingCount})</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-[var(--color-text)] opacity-60 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          {t('app.reviews2', language as Language)}
          <span className="text-[10px] opacity-50">({total})</span>
        </h4>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--color-text-bright)]">
            {currentRating.toFixed(1)}
          </p>
          <StarRating value={Math.round(currentRating)} readonly />
          <p className="text-[10px] text-[var(--color-text)] opacity-50 mt-0.5">
            {total} {t('app.reviews3', language as Language)}
          </p>
        </div>

        {isLoggedIn && (
          <div className="flex-1 pl-3 border-l border-[var(--color-border)]">
            <p className="text-[11px] text-[var(--color-text)] mb-1.5">
              {t('app.writeyourreview', language as Language)}
            </p>
            <StarRating value={myRating} onChange={setMyRating} size="sm" />
            <div className="flex items-center gap-1.5 mt-2">
              <input
                value={myComment}
                onChange={e => setMyComment(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-bright)] placeholder:text-[var(--color-text)] placeholder:opacity-40"
                placeholder={t('app.commentoptional', language as Language)}
                maxLength={500}
              />
              <button
                onClick={handleSubmitReview}
                disabled={submitting || myRating === 0}
                className="p-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-[var(--color-text)]">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-xs text-[var(--color-text)] opacity-40 text-center py-3">
          {t('app.noreviewsyet', language as Language)}
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {reviews.map(review => (
            <div
              key={review.id}
              className="px-3 py-2 bg-[var(--color-bg)] rounded-lg"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center">
                  {review.user.avatarUrl ? (
                    <img
                      src={review.user.avatarUrl}
                      alt=""
                      className="w-5 h-5 rounded-full"
                    />
                  ) : (
                    <User className="w-3 h-3 text-violet-400" />
                  )}
                </div>
                <span className="text-[11px] text-[var(--color-text-bright)] font-medium">
                  {review.user.username || 'User'}
                </span>
                <StarRating value={review.rating} readonly />
                <span className="text-[10px] text-[var(--color-text)] opacity-40 ml-auto">
                  {new Date(review.createdAt).toLocaleDateString(
                    t('scenario.enus', language as Language),
                  )}
                </span>
              </div>
              {review.comment && (
                <p className="text-[11px] text-[var(--color-text)] leading-relaxed pl-7">
                  {review.comment}
                </p>
              )}
            </div>
          ))}

          {total > reviews.length && (
            <button
              onClick={() => loadReviews(page + 1)}
              className="w-full py-1.5 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              {t('app.loadmore', language as Language)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

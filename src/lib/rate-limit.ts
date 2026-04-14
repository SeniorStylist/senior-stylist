import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

type Bucket =
  | 'signup'
  | 'portalBook'
  | 'ocr'
  | 'parsePdf'
  | 'sendPortalLink'
  | 'invites'

const LIMITS: Record<Bucket, { tokens: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }> = {
  signup: { tokens: 5, window: '1 h' },
  portalBook: { tokens: 10, window: '1 h' },
  ocr: { tokens: 20, window: '1 h' },
  parsePdf: { tokens: 20, window: '1 h' },
  sendPortalLink: { tokens: 10, window: '1 h' },
  invites: { tokens: 30, window: '1 h' },
}

let redis: Redis | null = null
const limiters = new Map<Bucket, Ratelimit>()

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !tok) return null
  redis = new Redis({ url, token: tok })
  return redis
}

function getLimiter(bucket: Bucket): Ratelimit | null {
  const cached = limiters.get(bucket)
  if (cached) return cached
  const r = getRedis()
  if (!r) return null
  const cfg = LIMITS[bucket]
  const lim = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(cfg.tokens, cfg.window),
    prefix: `rl:${bucket}`,
  })
  limiters.set(bucket, lim)
  return lim
}

export async function checkRateLimit(
  bucket: Bucket,
  identifier: string,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const lim = getLimiter(bucket)
  if (!lim) return { ok: true }
  const { success, reset } = await lim.limit(identifier)
  if (success) return { ok: true }
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
  return { ok: false, retryAfter }
}

export function rateLimitResponse(retryAfter: number): Response {
  return Response.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}

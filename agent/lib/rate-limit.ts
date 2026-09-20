/**
 * A small rate limit for a public demo.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The deployed agent calls a language model on every request and its URL is
 * published. That is a standing invitation to anyone who wants to drain the
 * quota, and the free tier's own cap is not a defence — it is the thing being
 * drained. The failure it prevents is narrow and specific: a judge opening the
 * link and finding the demo out of quota because a script found it first.
 *
 * WHAT IT IS NOT
 * --------------
 * Not security. It is per-instance memory on a serverless platform, so the
 * effective limit is the configured one multiplied by however many instances
 * happen to be warm, and it resets whenever one is recycled. A determined
 * attacker rotates IPs and wins. Anyone who needs a real limit uses a shared
 * store; this is a speed bump sized to the actual risk.
 *
 * The numbers are chosen so a person using the demo never meets it. Six
 * questions a minute is faster than anyone reads an answer about ATT&CK
 * coverage, and forty an hour is a long session.
 */

interface Bucket {
  /** Request timestamps within the longest window, oldest first. */
  hits: number[]
}

const buckets = new Map<string, Bucket>()

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const LIMITS = {
  perMinute: 6,
  perHour: 40,
} as const

/**
 * Keep the map from growing without bound.
 *
 * A serverless instance that stays warm for a day would otherwise accumulate an
 * entry per unique address forever. Cheap to do on write, and there is no
 * separate timer to leak.
 */
function sweep(now: number) {
  if (buckets.size < 5_000) return
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > HOUR) {
      buckets.delete(key)
    }
  }
}

export interface RateLimitResult {
  ok: boolean
  /** Seconds until the caller may retry. Only meaningful when ok is false. */
  retryAfter: number
  /** What to tell the person, in the interface's voice. */
  message?: string
}

/**
 * Identify the caller.
 *
 * `x-forwarded-for` is a client-supplied header and trivially spoofed, which is
 * fine here: this throttles casual abuse, and someone forging headers is
 * outside what an in-memory counter can address anyway. Vercel prepends the
 * real client address, so the first entry is the one to use — taking the last
 * would let a caller choose their own bucket by sending the header themselves.
 */
export function callerKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  sweep(now)

  const bucket = buckets.get(key) ?? {hits: []}
  // Drop anything outside the longest window.
  const hits = bucket.hits.filter((t) => now - t < HOUR)

  const inLastMinute = hits.filter((t) => now - t < MINUTE)

  if (inLastMinute.length >= LIMITS.perMinute) {
    const oldest = inLastMinute[0]
    const retryAfter = Math.max(1, Math.ceil((MINUTE - (now - oldest)) / 1000))
    buckets.set(key, {hits})
    return {
      ok: false,
      retryAfter,
      message:
        `That is ${LIMITS.perMinute} questions in a minute, which is faster than anyone ` +
        `reads the answers. This is a public demo on a free model quota, so it is ` +
        `throttled. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
    }
  }

  if (hits.length >= LIMITS.perHour) {
    const oldest = hits[0]
    const retryAfter = Math.max(1, Math.ceil((HOUR - (now - oldest)) / 1000))
    buckets.set(key, {hits})
    return {
      ok: false,
      retryAfter,
      message:
        `That is ${LIMITS.perHour} questions in an hour from this address, which is the ` +
        `cap on this public demo. Everything it does is in the repository, and it runs ` +
        `locally with your own API key. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
    }
  }

  hits.push(now)
  buckets.set(key, {hits})
  return {ok: true, retryAfter: 0}
}

/** Exposed for tests: forget everything. */
export function resetRateLimits() {
  buckets.clear()
}

/**
 * Tests for the demo's rate limit.
 *
 *   node --experimental-strip-types lib/rate-limit.test.ts
 *
 * The interesting assertions are not "does it block" — that part is arithmetic.
 * They are the ones about not blocking: a limiter that turns a judge away is a
 * worse outcome than the abuse it prevents, and it fails in exactly two ways.
 * It counts requests that should have expired, or it puts two callers in one
 * bucket.
 *
 * Time is injected rather than slept, so the hour-long window is testable.
 */

import {checkRateLimit, resetRateLimits, callerKey, LIMITS} from './rate-limit.ts'

let fail = 0

function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`ok   ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}`)
    console.log(`       got  ${JSON.stringify(got)}`)
    console.log(`       want ${JSON.stringify(want)}`)
  }
}

const T0 = 1_800_000_000_000
const SECOND = 1_000
const MINUTE = 60 * SECOND

/* --- The burst limit ---------------------------------------------- */

resetRateLimits()
for (let i = 1; i <= LIMITS.perMinute; i++) {
  check(`request ${i} of ${LIMITS.perMinute} is allowed`, checkRateLimit('a', T0).ok, true)
}
const blocked = checkRateLimit('a', T0)
check('one past the limit is refused', blocked.ok, false)
check('and it says how long to wait', blocked.retryAfter > 0, true)
check('with a message, not a status code', typeof blocked.message, 'string')
check(
  'that says why a public demo is throttled at all',
  blocked.message?.includes('public demo'),
  true,
)

/* --- The window really slides ------------------------------------- *
 * The failure mode here is counting requests that should have expired, which
 * turns a one-minute limit into a permanent one for anyone who hit it once.
 * ------------------------------------------------------------------ */

check('still refused at 59 seconds', checkRateLimit('a', T0 + 59 * SECOND).ok, false)
check('allowed again just past the minute', checkRateLimit('a', T0 + 61 * SECOND).ok, true)

/* --- Callers do not share a bucket -------------------------------- */

resetRateLimits()
for (let i = 0; i < LIMITS.perMinute; i++) checkRateLimit('first', T0)
check('the first caller is now blocked', checkRateLimit('first', T0).ok, false)
check('a different caller is unaffected', checkRateLimit('second', T0).ok, true)

/* --- The hourly cap ----------------------------------------------- *
 * The rate has to sit in a specific band for this limit to be the one that
 * fires: fast enough to reach forty inside an hour, slow enough that the
 * per-minute limit never triggers first.
 *
 * One request every fifteen seconds is four a minute — under the six-a-minute
 * burst limit — and reaches forty in ten minutes.
 *
 * Worth stating because the first version of this test used one request every
 * two minutes, which is thirty an hour: the sliding window expires the oldest
 * entries as fast as new ones arrive and the cap is never reached at all. That
 * is correct behaviour, and it means the hourly limit only binds between
 * roughly 0.7 and 6 requests a minute. Below that band nothing stops a patient
 * caller, which is a deliberate choice rather than an oversight — a request
 * every two minutes, indefinitely, is not the abuse this is sized for.
 * ------------------------------------------------------------------ */

resetRateLimits()
let allowed = 0
let firstRefusalAt = -1
for (let i = 0; i < LIMITS.perHour + 5; i++) {
  const at = T0 + i * 15 * SECOND
  if (checkRateLimit('steady', at).ok) allowed++
  else if (firstRefusalAt === -1) firstRefusalAt = i
}
check('the hourly cap is what stops a sustained stream', allowed, LIMITS.perHour)
check('and it stops exactly at the cap', firstRefusalAt, LIMITS.perHour)

// The band, asserted directly: slow enough and the hourly cap never engages.
resetRateLimits()
let refusedWhenSlow = 0
for (let i = 0; i < 60; i++) {
  if (!checkRateLimit('patient', T0 + i * 2 * MINUTE).ok) refusedWhenSlow++
}
check('a request every two minutes is never refused, by design', refusedWhenSlow, 0)

/* --- A realistic session is never touched ------------------------- *
 * The whole design goal. Someone reading the answers asks a question every
 * half minute at the very fastest, for twenty minutes.
 * ------------------------------------------------------------------ */

resetRateLimits()
let refusals = 0
for (let i = 0; i < 40; i++) {
  if (!checkRateLimit('reader', T0 + i * 30 * SECOND).ok) refusals++
}
check('forty questions over twenty minutes: nobody is turned away', refusals, 0)

/* --- Identifying the caller --------------------------------------- */

const withForwarded = new Request('https://x/', {
  headers: {'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178'},
})
check(
  'the FIRST x-forwarded-for entry is used',
  callerKey(withForwarded),
  '203.0.113.5',
)

// Taking the last entry would let a caller pick their own bucket by sending
// the header themselves, which defeats the limit entirely.
check(
  'not the last, which the caller controls',
  callerKey(withForwarded) === '150.172.238.178',
  false,
)

check(
  'x-real-ip is the fallback',
  callerKey(new Request('https://x/', {headers: {'x-real-ip': '198.51.100.7'}})),
  '198.51.100.7',
)
check('and everything unknown shares one bucket', callerKey(new Request('https://x/')), 'unknown')

console.log(`\n${fail === 0 ? 'todas las aserciones pasan' : `${fail} fallo(s)`}`)
process.exit(fail ? 1 : 0)

/**
 * Verify every demo query without a Sanity project.
 *
 *   node groq/verify.mjs
 *
 * Parses each query in queries.ts and evaluates it against fixture.mjs, a plain
 * array of documents. Queries were written and run here BEFORE any content was
 * imported: if a question cannot be expressed, the schema is wrong, and that is
 * much cheaper to learn now than after importing forty rules.
 */

import {parse, evaluate} from 'groq-js'
import {readFileSync} from 'node:fs'
import {dataset} from './fixture.mjs'

// The queries live under agent/lib/ so the Next.js app imports only downward
// into its own tree. This reads the file as text rather than importing it, so
// the path is the only thing that had to change.
const src = readFileSync(new URL('../agent/lib/queries.ts', import.meta.url), 'utf8')
const re = /export const (\w+) = \/\* groq \*\/ `([\s\S]*?)`\n/g
const Q = {}
let m
while ((m = re.exec(src))) Q[m[1]] = m[2]

const CS = ['validated', 'tuned']
const AT = new Date('2026-09-19T12:00:00Z')
const run = async (q, params = {}) =>
  (await evaluate(parse(q), {dataset, params, timestamp: AT})).get()
const show = (label, v) => console.log(`\n### ${label}\n` + JSON.stringify(v, null, 1))

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `\n      got [${actual}] want [${expected}]`}`)
  if (!ok) failures++
}

// --- every query must at least parse ---
let parseFails = 0
for (const [name, q] of Object.entries(Q)) {
  try {
    parse(q)
  } catch (e) {
    parseFails++
    console.log(`PARSE FAIL ${name}: ${e.message}`)
  }
}
console.log(`parsed ${Object.keys(Q).length} queries, ${parseFails} failures`)
failures += parseFails

console.log('\n--- assertions on the fixture ---')

const r1 = await run(Q.Q1_CONNECTOR_LOSS, {
  connectorSlug: 'defender-for-identity',
  coverageStatuses: CS,
})
check('Q1 tables lost', r1.tablesLost.map((t) => t.tableName), ['IdentityLogonEvents'])
check('Q1 rules lost', r1.rulesLost.map((r) => r.ruleId), ['DET-0001', 'DET-0003'])
// DET-0003 reads two tables and loses one, so it dies even though the other survives.
check('Q1 techniques going dark', r1.techniquesGoingDark.map((t) => t.attackId), ['T1110'])
// DET-0001 dies but DET-0002 still covers T1078.004 from SigninLogs.
check('Q1 techniques still covered', r1.techniquesStillCovered.map((t) => t.attackId), ['T1078.004'])

const r2 = await run(Q.Q2_UNCOVERED_TECHNIQUES, {tactic: 'TA0006', coverageStatuses: CS})
check('Q2 uncovered in TA0006', r2.uncovered.map((t) => t.attackId), ['T1556'])
check('Q2 counts', [r2.covered, r2.total], [1, 2])
check(
  'Q2 surfaces the draft that would cover the gap',
  r2.uncovered[0].draftRulesThatWouldCover.map((d) => d.ruleId),
  ['DET-0004'],
)

const r3 = await run(Q.Q3_DOWNGRADE_IMPACT, {tableName: 'SigninLogs'})
check('Q3 plan change available', [r3.planChangeAvailable], [true])
check(
  'Q3 rules reading SigninLogs',
  r3.rulesReadingThisTable.map((r) => r.ruleId),
  ['DET-0002', 'DET-0003', 'DET-0004'],
)

// Plan changed 2026-09-16, three days before the test date: refused.
const r3b = await run(Q.Q3_DOWNGRADE_IMPACT, {tableName: 'AADNonInteractiveUserSignInLogs'})
check('Q3 one-change-per-week cooldown blocks it', [r3b.planChangeAvailable], [false])

const r4 = await run(Q.Q4_SINGLE_POINT_OF_FAILURE, {coverageStatuses: CS})
check('Q4 single-table rules', r4.map((r) => r.ruleId), ['DET-0001', 'DET-0002', 'DET-0005'])
check(
  'Q4 sole coverage attribution',
  r4.flatMap((r) => (r.soleCoverageFor ?? []).map((t) => `${r.ruleId}:${t}`)),
  ['DET-0005:T1078'],
)

const r6 = await run(Q.Q6_CONTESTED_SETTINGS)
// Populated in both directions, so this must still be deduplicated to 2.
check('Q6 contested settings', r6.contestedSettings, [
  'breakglass-password-length',
  'admin-signin-frequency',
])

for (const s of ['breakglass-password-length', 'admin-signin-frequency']) {
  const r = await run(Q.Q6B_CLAIMS_FOR_SETTING, {setting: s})
  check(`Q6b ${s} returns exactly 2 claims`, [r.claims.length], [2])
  show(`Q6b ${s}`, {
    claims: r.claims.map(
      (c) => `${c.sourceAuthority} (${c.controlId}): ${c.recommendedValue}${c.enforced ? ' [enforced]' : ''}`,
    ),
    ourDecisions: r.ourDecisions.map((d) => `${d.decidedOn} ${d.title}`),
  })
}

/* ------------------------------------------------------------------------- *
 * End to end: the snapshot query, then the deterministic arithmetic.
 *
 * Everything above tests GROQ. This tests the seam — the exact query the agent
 * sends to Sanity, evaluated here against the fixture, piped into the exact
 * function the agent's coverage_delta tool calls. A schema change that breaks
 * the shape `coverage-delta.ts` expects fails here rather than in production,
 * where the symptom would be an agent cheerfully reporting that nothing is
 * affected.
 *
 * The final assertion is the one worth having: the two independent
 * implementations of the same set difference — GROQ running server-side, and
 * TypeScript running locally — are compared against each other. This is the
 * cross-check the tool performs at answer time, verified on known data.
 * ------------------------------------------------------------------------- */

console.log('\n--- snapshot query into the deterministic delta ---')

const {computeCoverageDelta, crossCheck} = await import('../agent/lib/coverage-delta.ts')
const {normalizeSnapshot} = await import('../agent/lib/normalize.ts')

const rawSnap = await run(Q.SNAPSHOT_FOR_DELTA, {coverageStatuses: CS})

// Through the normaliser, exactly as the running tool does it.
//
// This used to hand the groq-js result straight to computeCoverageDelta, and
// that is precisely why this test passed while production was wrong: groq-js
// returns `techniques[]->attackId` as strings and Sanity Context returns it as
// objects, so the assertions below were describing a shape the live endpoint
// never emits. Normalising here means both transports are exercised by the same
// path, and lib/normalize.test.ts pins the two shapes against each other.
const {snapshot: snap, problems: shapeProblems} = normalizeSnapshot(rawSnap)
check('the snapshot normalises with no unreadable fields', shapeProblems, [])

check('snapshot returns the five collections', Object.keys(rawSnap).sort(), [
  'connectors',
  'drafts',
  'rules',
  'tables',
  'techniques',
])
check(
  'snapshot flattens connector slugs onto each rule',
  snap.rules.find((r) => r.ruleId === 'DET-0003')?.connectors ?? [],
  ['defender-for-identity', 'entra-id'],
)
// After normalising, every dereferenced id is a string whichever transport
// produced it. Asserted here because using these as Map keys while they were
// objects is what made a real coverage loss vanish.
check(
  'technique ids on a rule are strings, not wrapped objects',
  [snap.rules.every((r) => r.techniques.every((t) => typeof t === 'string'))],
  [true],
)
check(
  'table names on a rule are strings too',
  [snap.rules.every((r) => r.tables.every((t) => typeof t === 'string'))],
  [true],
)

const d = computeCoverageDelta(snap, ['defender-for-identity'])

check('delta agrees with Q1 on tables lost', d.tablesLost.map((t) => t.tableName), [
  'IdentityLogonEvents',
])
check('delta agrees with Q1 on rules lost', d.rulesLost.map((r) => r.ruleId), [
  'DET-0001',
  'DET-0003',
])
check('delta agrees with Q1 on techniques going dark', d.techniquesGoingDark.map((t) => t.attackId), [
  'T1110',
])
check('delta agrees with Q1 on techniques still covered', d.techniquesStillCovered, ['T1078.004'])

// The cross-check the running agent performs, run here against the real Q1 output.
const disagreements = crossCheck(d, r1)
check('cross-check finds no disagreement between the two implementations', disagreements, [])
if (disagreements.length) disagreements.forEach((x) => console.log('      ' + x))

console.log(`\n${failures === 0 ? 'All assertions passed.' : `${failures} assertion(s) failed.`}`)
process.exit(failures ? 1 : 0)

/**
 * Tests for the shape normaliser.
 *
 *   node --experimental-strip-types lib/normalize.test.ts
 *
 * The bug this file exists to prevent was invisible to every test that came
 * before it, because those tests evaluate GROQ locally with groq-js and groq-js
 * returns dereferenced scalars unwrapped. Sanity Context returns them wrapped.
 * The unit tests were therefore correct about a shape that production never
 * emits.
 *
 * So the central fixture here is the same rule written twice — once as groq-js
 * gives it, once as Context gives it — asserted to normalise to the same thing.
 * Anything else is a test that agrees with itself.
 */

import {scalar, scalarList, normalizeSnapshot} from './normalize.ts'
import {computeCoverageDelta} from './coverage-delta.ts'

let fail = 0
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function check(name: string, got: unknown, want: unknown) {
  if (eq(got, want)) {
    console.log(`ok   ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}`)
    console.log(`       got  ${JSON.stringify(got)}`)
    console.log(`       want ${JSON.stringify(want)}`)
  }
}

/* --- scalar ------------------------------------------------------- */

let p: string[] = []

check('a string passes through', scalar('T1110', 'attackId', 'x', p), 'T1110')
check('a wrapped value is unwrapped', scalar({attackId: 'T1110'}, 'attackId', 'x', p), 'T1110')
check(
  'the _id Context injects is ignored',
  scalar({attackId: 'T1110', _id: 'technique.T1110'}, 'attackId', 'x', p),
  'T1110',
)
check('null stays null', scalar(null, 'attackId', 'x', p), null)
check('undefined stays null', scalar(undefined, 'attackId', 'x', p), null)
check('a number becomes a string', scalar(42, 'gbPerDay', 'x', p), '42')
check('no problems were raised for any of those', p, [])

// The fallback: a rename upstream should degrade to a right answer, not a null.
p = []
check(
  'a single unexpected key is still read',
  scalar({techniqueId: 'T1110', _id: 'x'}, 'attackId', 'x', p),
  'T1110',
)
check('and that is not treated as a problem', p, [])

// Genuinely unreadable input must be reported, not dropped silently.
p = []
check('two candidate keys is ambiguous, so it fails', scalar({a: 'x', b: 'y'}, 'attackId', 'here', p), null)
check('and it says where and why', p.length, 1)
check(
  'the message says an omission would understate the answer',
  p[0]?.includes('understate'),
  true,
)

/* --- scalarList --------------------------------------------------- */

p = []
check(
  'the groq-js shape',
  scalarList(['T1110', 'T1556'], 'attackId', 'x', p),
  ['T1110', 'T1556'],
)
check(
  'the Context shape',
  scalarList([{attackId: 'T1110'}, {attackId: 'T1556'}], 'attackId', 'x', p),
  ['T1110', 'T1556'],
)
check('a missing array is empty, not an error', scalarList(undefined, 'attackId', 'x', p), [])
check('no problems so far', p, [])

p = []
check('a non-array is reported', scalarList('T1110', 'attackId', 'here', p), [])
check('and named', p[0]?.includes('expected an array'), true)

/* ------------------------------------------------------------------ *
 * THE TEST THAT WAS MISSING.
 *
 * One rule, two transports, identical result.
 * ------------------------------------------------------------------ */

const asGroqJs = {
  rules: [
    {
      ruleId: 'DET-0021',
      title: 'Brute force followed by a mailbox rule change',
      status: 'tuned',
      ruleType: 'scheduled',
      fpRate: 0.12,
      ownerTeam: 'soc-t2',
      connectors: ['cef-syslog-ama'],
      tables: ['CommonSecurityLog'],
      techniques: ['T1110', 'T1556'],
    },
  ],
  drafts: [],
  techniques: [
    {attackId: 'T1110', name: 'Brute Force', tactics: ['TA0006'], parent: null},
    {attackId: 'T1556', name: 'Modify Authentication Process', tactics: ['TA0006'], parent: null},
  ],
  connectors: [{slug: 'cef-syslog-ama', name: 'CEF via AMA', licenseRequired: 'included', estimatedGbPerDay: 465}],
  tables: [{tableName: 'CommonSecurityLog', connector: 'cef-syslog-ama', gbPerDay: 465, ingestionTier: 'analytics'}],
}

// The same payload as Context actually delivered it: dereferenced scalars
// wrapped in single-key objects, and an _id nobody projected. Nested paths —
// `connector->slug.current` — arrive unwrapped, which is exactly the
// inconsistency that made the original bug hard to spot.
const asContext = {
  rules: [
    {
      _id: 'rule.DET-0021',
      ruleId: 'DET-0021',
      title: 'Brute force followed by a mailbox rule change',
      status: 'tuned',
      ruleType: 'scheduled',
      fpRate: 0.12,
      ownerTeam: 'soc-t2',
      connectors: ['cef-syslog-ama'],
      tables: [{tableName: 'CommonSecurityLog'}],
      techniques: [{attackId: 'T1110'}, {attackId: 'T1556'}],
    },
  ],
  drafts: [],
  techniques: [
    {_id: 'technique.T1110', attackId: 'T1110', name: 'Brute Force', tactics: ['TA0006'], parent: null},
    {
      _id: 'technique.T1556',
      attackId: 'T1556',
      name: 'Modify Authentication Process',
      tactics: ['TA0006'],
      parent: null,
    },
  ],
  connectors: [
    {
      _id: 'connector.cef-syslog-ama',
      slug: 'cef-syslog-ama',
      name: 'CEF via AMA',
      licenseRequired: 'included',
      estimatedGbPerDay: 465,
    },
  ],
  tables: [
    {
      _id: 'table.CommonSecurityLog',
      tableName: 'CommonSecurityLog',
      connector: 'cef-syslog-ama',
      gbPerDay: 465,
      ingestionTier: 'analytics',
    },
  ],
}

const a = normalizeSnapshot(asGroqJs)
const b = normalizeSnapshot(asContext)

check('the groq-js shape normalises without problems', a.problems, [])
check('the Context shape normalises without problems', b.problems, [])
check('both transports produce an identical snapshot', a.snapshot, b.snapshot)
check('and the technique ids are strings', a.snapshot.rules[0]?.techniques, ['T1110', 'T1556'])
check('and so are the table names', b.snapshot.rules[0]?.tables, ['CommonSecurityLog'])

// The consequence, spelled out: this is the answer that was wrong in production.
const fromGroqJs = computeCoverageDelta(a.snapshot, ['cef-syslog-ama'])
const fromContext = computeCoverageDelta(b.snapshot, ['cef-syslog-ama'])

check('the delta is the same either way', fromGroqJs, fromContext)
check(
  'and it finds the techniques that go dark',
  fromContext.techniquesGoingDark.map((t) => t.attackId),
  ['T1110', 'T1556'],
)

// What the old code did: feed it the raw Context payload and the wrapped values
// become Map keys, every lookup misses, and nothing is reported as lost.
const unnormalised = computeCoverageDelta(asContext as never, ['cef-syslog-ama'])
check(
  'without normalising, the loss silently disappears',
  unnormalised.techniquesGoingDark.length,
  0,
)
check(
  'which is the failure this file exists to prevent',
  unnormalised.rulesLost.length > 0 && unnormalised.techniquesGoingDark.length === 0,
  true,
)

/* --- A partially unreadable snapshot ------------------------------ */

const broken = normalizeSnapshot({
  ...asContext,
  rules: [{...asContext.rules[0], techniques: [{a: 'x', b: 'y'}]}],
})
check('an unreadable technique id is reported', broken.problems.length > 0, true)
check(
  'and the problem names the path',
  broken.problems[0]?.includes('rules[0].techniques[0]'),
  true,
)

const noCollections = normalizeSnapshot({rules: []})
check(
  'missing collections are each reported',
  noCollections.problems.filter((x) => x.includes('is missing its')).length,
  4,
)

console.log(`\n${fail === 0 ? 'todas las aserciones pasan' : `${fail} fallo(s)`}`)
process.exit(fail ? 1 : 0)

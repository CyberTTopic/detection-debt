/**
 * Tests for the coverage arithmetic.
 *
 * Run with:  node --experimental-strip-types lib/coverage-delta.test.ts
 *
 * The fixture is tiny and hand-built, because the point is to pin down the
 * cases that are easy to get wrong and impossible to eyeball in real data:
 *
 *   - a technique that survives losing EITHER connector alone but dies when
 *     both go. This is the whole reason the tool takes a list and not a single
 *     slug: running the single-connector query twice and unioning the answers
 *     gets this wrong, and gets it wrong in the safe-looking direction.
 *   - a technique that survives but drops to one remaining rule.
 *   - a parent whose every covered sub-technique dies, versus one where a
 *     sub-technique survives. Only the first is a structural loss.
 *   - a draft rule that would close the gap but reads a table being removed.
 *   - a connector slug that does not exist.
 *   - a rule pointing at a technique missing from the snapshot.
 */

import {computeCoverageDelta, crossCheck, summarise} from './coverage-delta.ts'
import type {GraphSnapshot} from './coverage-delta.ts'

const snapshot: GraphSnapshot = {
  connectors: [
    {slug: 'mde', name: 'Defender for Endpoint', licenseRequired: 'mde-p2', estimatedGbPerDay: 120},
    {slug: 'mdi', name: 'Defender for Identity', licenseRequired: 'mdi', estimatedGbPerDay: 30},
    {slug: 'entra', name: 'Entra ID', licenseRequired: 'entra-p1', estimatedGbPerDay: 5},
  ],
  tables: [
    {tableName: 'DeviceProcessEvents', connector: 'mde', gbPerDay: 100, ingestionTier: 'analytics'},
    {tableName: 'DeviceLogonEvents', connector: 'mde', gbPerDay: 20, ingestionTier: 'analytics'},
    {tableName: 'IdentityLogonEvents', connector: 'mdi', gbPerDay: 30, ingestionTier: 'analytics'},
    {tableName: 'SigninLogs', connector: 'entra', gbPerDay: 5, ingestionTier: 'analytics'},
  ],
  techniques: [
    {attackId: 'T1000', name: 'Parent A', tactics: ['TA0006'], parent: null},
    {attackId: 'T1000.001', name: 'Parent A: Sub One', tactics: ['TA0006'], parent: 'T1000'},
    {attackId: 'T1000.002', name: 'Parent A: Sub Two', tactics: ['TA0006'], parent: 'T1000'},
    {attackId: 'T2000', name: 'Shared Technique', tactics: ['TA0008'], parent: null},
    {attackId: 'T3000', name: 'Entra Only', tactics: ['TA0001'], parent: null},
    {attackId: 'T4000', name: 'Parent B', tactics: ['TA0003'], parent: null},
    {attackId: 'T4000.001', name: 'Parent B: Sub One', tactics: ['TA0003'], parent: 'T4000'},
    {attackId: 'T9999', name: 'Never Covered', tactics: ['TA0040'], parent: null},
  ],
  rules: [
    // T2000 is covered twice, once from each of mde and mdi. That is the trap.
    {ruleId: 'DET-0001', title: 'Endpoint rule', status: 'validated', connectors: ['mde'],
      tables: ['DeviceProcessEvents'], techniques: ['T2000', 'T1000.001']},
    {ruleId: 'DET-0002', title: 'Identity rule', status: 'tuned', connectors: ['mdi'],
      tables: ['IdentityLogonEvents'], techniques: ['T2000']},
    {ruleId: 'DET-0003', title: 'Entra rule', status: 'validated', connectors: ['entra'],
      tables: ['SigninLogs'], techniques: ['T3000']},
    // Reads two connectors, so it dies if either one goes.
    {ruleId: 'DET-0004', title: 'Correlation rule', status: 'validated', connectors: ['mde', 'mdi'],
      tables: ['DeviceLogonEvents', 'IdentityLogonEvents'], techniques: ['T1000.002']},
    {ruleId: 'DET-0005', title: 'Persistence via Entra', status: 'tuned', connectors: ['entra'],
      tables: ['SigninLogs'], techniques: ['T4000.001']},
    {ruleId: 'DET-0006', title: 'Persistence via endpoint', status: 'validated', connectors: ['mde'],
      tables: ['DeviceProcessEvents'], techniques: ['T4000.001']},
    // Excluded from coverage: a draft living in the rules array.
    {ruleId: 'DET-0009', title: 'Never run', status: 'draft', connectors: ['entra'],
      tables: ['SigninLogs'], techniques: ['T1000.001']},
  ],
  drafts: [
    {ruleId: 'DET-0100', title: 'Would cover Sub One', status: 'draft', connectors: ['entra'],
      tables: ['SigninLogs'], techniques: ['T1000.001', 'T2000']},
    {ruleId: 'DET-0101', title: 'Would cover Sub Two, but needs mde', status: 'draft',
      connectors: ['mde'], tables: ['DeviceProcessEvents'], techniques: ['T1000.002']},
    {ruleId: 'DET-0102', title: 'Covers nothing that goes dark', status: 'draft',
      connectors: ['entra'], tables: ['SigninLogs'], techniques: ['T9999']},
  ],
}

/* ------------------------------------------------------------------ */

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

/* --- Losing mde alone ------------------------------------------------ */

const mde = computeCoverageDelta(snapshot, ['mde'])

check('mde: tables lost, ordered by volume',
  mde.tablesLost.map((t) => t.tableName), ['DeviceProcessEvents', 'DeviceLogonEvents'])
check('mde: GB/day lost', mde.gbPerDayLost, 120)
check('mde: rules lost',
  mde.rulesLost.map((r) => r.ruleId), ['DET-0001', 'DET-0004', 'DET-0006'])
check('mde: surviving coverage rule count', mde.rulesSurviving, 3)
check('mde: techniques going dark',
  mde.techniquesGoingDark.map((t) => t.attackId), ['T1000.001', 'T1000.002'])
// Scoped to what mde was feeding. T3000 is still covered but mde never fed it,
// so listing it here would pad the survivors with coverage that was never at
// risk — which reads as reassurance and is not.
check('mde: survivors are scoped to what the lost connector was covering',
  mde.techniquesStillCovered, ['T2000', 'T4000.001'])
check('mde: T3000 is still covered but was never at risk, so it is not listed',
  mde.techniquesStillCovered.includes('T3000'), false)
check('mde: attribution of the loss is named',
  mde.techniquesGoingDark.find((t) => t.attackId === 'T1000.002')?.wasCoveredBy, ['DET-0004'])
check('mde: newly sole-sourced',
  mde.newlySoleSourced.map((t) => `${t.attackId}:${t.nowCoveredOnlyBy}`),
  ['T2000:DET-0002', 'T4000.001:DET-0005'])
check('mde: T1000 is structurally dark, T4000 is not',
  mde.parentTechniquesStructurallyDark.map((p) => p.parentAttackId), ['T1000'])
check('mde: structural loss names both lost subs',
  mde.parentTechniquesStructurallyDark[0]?.subTechniquesLost, ['T1000.001', 'T1000.002'])
check('mde: coverage count before/after', [mde.coverageBefore, mde.coverageAfter], [5, 3])
check('mde: the draft in the rules array was excluded and said so',
  mde.warnings.some((w) => w.includes('not validated or tuned')), true)

// Remediation: the surviving draft ranks above the one that needs the dead connector.
check('mde: remediation ranking',
  mde.remediationCandidates.map((r) => `${r.ruleId}:${r.survivesTheLoss}`),
  ['DET-0100:true', 'DET-0101:false'])
check('mde: a draft covering nothing dark is not offered',
  mde.remediationCandidates.some((r) => r.ruleId === 'DET-0102'), false)
check('mde: remediation lists only the dark techniques it closes',
  mde.remediationCandidates[0]?.wouldCover, ['T1000.001'])

/* --- Losing mdi alone ------------------------------------------------ */

const mdi = computeCoverageDelta(snapshot, ['mdi'])
check('mdi alone: T2000 still survives (on DET-0001)',
  mdi.techniquesGoingDark.map((t) => t.attackId), ['T1000.002'])

/* --- THE POINT: both together --------------------------------------- *
 * T2000 survives losing mde. It survives losing mdi. It dies when both go.
 * A per-connector query run twice and unioned reports it as safe.
 * ------------------------------------------------------------------- */

const both = computeCoverageDelta(snapshot, ['mde', 'mdi'])
check('both: T2000 goes dark although it survives either loss alone',
  both.techniquesGoingDark.map((t) => t.attackId), ['T1000.001', 'T1000.002', 'T2000'])
check('both: the union of the single answers would have missed it',
  [...mde.techniquesGoingDark, ...mdi.techniquesGoingDark].some((t) => t.attackId === 'T2000'),
  false)
check('both: T2000 loss is attributed to both rules',
  both.techniquesGoingDark.find((t) => t.attackId === 'T2000')?.wasCoveredBy,
  ['DET-0001', 'DET-0002'])
check('both: GB/day is the sum, counted once', both.gbPerDayLost, 150)
check('both: DET-0004 is counted once despite spanning both',
  both.rulesLost.filter((r) => r.ruleId === 'DET-0004').length, 1)
check('both: a technique already down to one rule is not "newly" sole-sourced',
  both.newlySoleSourced.map((t) => t.attackId), ['T4000.001'])

/* --- A slug that does not exist ------------------------------------- */

const typo = computeCoverageDelta(snapshot, ['defender-for-endpint'])
check('typo: nothing is reported as lost', typo.rulesLost.length, 0)
check('typo: but it is not reported as good news',
  typo.warnings.some((w) => w.includes('No connector has the slug')), true)
check('typo: the known slugs are offered',
  typo.warnings.some((w) => w.includes('entra, mde, mdi')), true)

/* --- A rule pointing at a technique the snapshot lacks -------------- */

const dangling = computeCoverageDelta(
  {
    ...snapshot,
    rules: [
      {ruleId: 'DET-0200', title: 'Points at nothing', status: 'validated', connectors: ['mde'],
        tables: ['DeviceProcessEvents'], techniques: ['T7777']},
    ],
    drafts: [],
  },
  ['mde'],
)
check('dangling: the technique is not silently dropped',
  dangling.warnings.some((w) => w.includes('T7777') && w.includes('understated')), true)
check('dangling: and it is not invented into the dark list',
  dangling.techniquesGoingDark.length, 0)

/* --- Cross-check against the server-side query ---------------------- */

check('crossCheck: agreement is silent',
  crossCheck(mde, {
    techniquesGoingDark: [{attackId: 'T1000.001'}, {attackId: 'T1000.002'}],
    techniquesStillCovered: [{attackId: 'T2000'}, {attackId: 'T4000.001'}],
    rulesLost: [{ruleId: 'DET-0001'}, {ruleId: 'DET-0004'}, {ruleId: 'DET-0006'}],
  }),
  [])

// The exact divergence the end-to-end test caught: the GROQ query scopes the
// survivor list to the lost connector, and an unscoped local implementation
// pads it. Compared now, so it cannot go quiet again.
check('crossCheck: an unscoped survivor list is now caught',
  crossCheck(mde, {
    techniquesStillCovered: [{attackId: 'T2000'}, {attackId: 'T3000'}, {attackId: 'T4000.001'}],
  }).length,
  1)

const divergence = crossCheck(mde, {
  techniquesGoingDark: [{attackId: 'T1000.001'}],
  rulesLost: [{ruleId: 'DET-0001'}, {ruleId: 'DET-0004'}, {ruleId: 'DET-0006'}],
})
check('crossCheck: disagreement is raised, not resolved', divergence.length, 1)
check('crossCheck: it says which side had what',
  divergence[0]?.includes('Only in the local result: [T1000.002]'), true)
check('crossCheck: and refuses to pick',
  divergence[0]?.includes('instead of choosing one side'), true)
check('crossCheck: no GROQ result means no complaint', crossCheck(mde, null), [])

/* --- The prose the model is given to quote -------------------------- */

const prose = summarise(both)
check('summarise: leads with the volume and the rule count',
  prose.includes('4 of 6 coverage rules stop firing'), true)
check('summarise: labels the hierarchy roll-up as an inference',
  prose.includes('Inference, not a direct loss: T1000'), true)

console.log('\n--- summarise(), losing both connectors ---\n')
console.log(prose)

console.log(`\n${fail === 0 ? 'todas las aserciones pasan' : `${fail} fallo(s)`}`)
process.exit(fail ? 1 : 0)

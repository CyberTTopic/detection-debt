/**
 * Is `groq_query` returning everything it matched?
 *
 *   cd agent
 *   $env:NODE_OPTIONS = "--use-system-ca"; npm run diagnose
 *
 * The smoke test found the deterministic delta and the server-side GROQ query
 * disagreeing about which techniques go dark. One of them is reading different
 * data from the other, and the envelope `groq_query` wraps its answer in says
 * which:
 *
 *     {"meta":{"resultCount":N,"returnedCount":M}, "result": ...}
 *
 * If M is less than N, the server matched N documents and handed back M. Any
 * arithmetic done on that answer is arithmetic on a subset, and it produces a
 * smaller loss than the truth — which is the direction that reads as good news.
 *
 * `unwrapGroqResult` currently discards `meta` to keep the model's context
 * small, so nothing downstream can tell a complete answer from a clipped one.
 * This prints the envelope for each part of the snapshot so the question is
 * settled with a number instead of a theory.
 */

import {ContextClient} from '../lib/mcp.ts'
import {config} from '../lib/env.ts'
import {SNAPSHOT_FOR_DELTA} from '../lib/queries.ts'
import {inlineParams} from '../lib/mcp.ts'

const cfg = config()
const graph = new ContextClient(cfg.groqUrl, cfg.organizationToken, 'graph')

/** Call groq_query and keep the envelope this time. */
async function raw(query: string): Promise<{meta: Record<string, unknown>; result: unknown; text: string}> {
  const {text} = await graph.callTool('groq_query', {query})
  try {
    const parsed = JSON.parse(text) as {meta?: Record<string, unknown>; result?: unknown}
    return {meta: parsed.meta ?? {}, result: parsed.result, text}
  } catch {
    return {meta: {}, result: null, text}
  }
}

function report(label: string, meta: Record<string, unknown>, actual: number | null) {
  const matched = meta.resultCount as number | undefined
  const returned = meta.returnedCount as number | undefined
  const clipped = typeof matched === 'number' && typeof returned === 'number' && returned < matched

  console.log(`\n  ${label}`)
  console.log(`    meta.resultCount    ${matched ?? '(absent)'}`)
  console.log(`    meta.returnedCount  ${returned ?? '(absent)'}`)
  if (actual !== null) console.log(`    items in the array  ${actual}`)
  if (clipped) {
    console.log(`    >>> CLIPPED: ${matched! - returned!} document(s) were matched and not returned.`)
  }
  for (const [k, v] of Object.entries(meta)) {
    if (['resultCount', 'returnedCount', 'executedQuery'].includes(k)) continue
    console.log(`    meta.${k}  ${JSON.stringify(v)}`)
  }
}

console.log('='.repeat(72))
console.log('Each collection on its own')
console.log('='.repeat(72))

for (const [label, q] of [
  ['techniques', '*[_type == "technique"]{attackId, name, tactics, "parent": parentTechnique->attackId}'],
  ['techniques, ids only', '*[_type == "technique"].attackId'],
  ['coverage rules', '*[_type == "detectionRule" && status in ["validated","tuned"]]{ruleId, "techniques": techniques[]->attackId}'],
  ['tables', '*[_type == "logTable"]{tableName}'],
] as const) {
  const r = await raw(q)
  report(label, r.meta, Array.isArray(r.result) ? r.result.length : null)
}

console.log('\n' + '='.repeat(72))
console.log('The snapshot query the delta tool actually sends')
console.log('='.repeat(72))

const snapQuery = inlineParams(SNAPSHOT_FOR_DELTA, {coverageStatuses: ['validated', 'tuned']})
const snap = await raw(snapQuery)
report('whole snapshot (one object, so resultCount is 1)', snap.meta, null)

const s = snap.result as Record<string, unknown[]> | null
if (s) {
  console.log('\n  Collections inside it:')
  for (const key of ['rules', 'drafts', 'techniques', 'connectors', 'tables']) {
    const arr = s[key]
    console.log(`    ${key.padEnd(12)} ${Array.isArray(arr) ? arr.length : 'MISSING'}`)
  }
}

/* ------------------------------------------------------------------ *
 * The specific techniques the two implementations disagreed about.
 * ------------------------------------------------------------------ */

const disputed = ['T1003', 'T1556', 'T1557', 'T1566']

console.log('\n' + '='.repeat(72))
console.log('The four techniques the smoke test flagged')
console.log('='.repeat(72))

const inSnapshot = new Set(
  ((s?.techniques ?? []) as {attackId: string}[]).map((t) => t.attackId),
)

for (const id of disputed) {
  const present = inSnapshot.has(id)
  const check = await raw(`*[_type == "technique" && attackId == "${id}"][0]{attackId, name}`)
  const exists = Boolean(check.result)
  console.log(
    `  ${id.padEnd(8)} exists in dataset: ${String(exists).padEnd(6)} present in snapshot: ${present}` +
      (exists && !present ? '   <<< dropped by the snapshot query' : ''),
  )
}

/* ------------------------------------------------------------------ *
 * Which rules reference them, and are those rules in the snapshot?
 * ------------------------------------------------------------------ */

console.log('\n' + '='.repeat(72))
console.log('Who covers them')
console.log('='.repeat(72))

const coverQ = `*[_type == "detectionRule" && count(techniques[@->attackId in ${JSON.stringify(disputed)}]) > 0]{
  ruleId, status,
  "connectors": array::unique(dataSources[]->connector->slug.current),
  "techniques": techniques[]->attackId
}`
const cover = await raw(coverQ)
const coverRules = (cover.result ?? []) as {
  ruleId: string
  status: string
  connectors: (string | null)[]
  techniques: string[]
}[]

const snapshotRuleIds = new Set(((s?.rules ?? []) as {ruleId: string}[]).map((r) => r.ruleId))

for (const r of coverRules) {
  console.log(
    `  ${r.ruleId}  ${r.status.padEnd(10)} connectors=[${r.connectors.join(', ')}]  ` +
      `techniques=[${r.techniques.join(', ')}]  in snapshot: ${snapshotRuleIds.has(r.ruleId)}`,
  )
}

/* ------------------------------------------------------------------ *
 * The actual shape of a dereferenced array projection.
 *
 * `connectors` came back as strings and `techniques` did not, from the same
 * query. The difference between them is that one is wrapped in array::unique().
 * Whatever `techniques[]->attackId` is returning, the delta tool is using it as
 * a Map key, so if it is an object every lookup misses and every technique falls
 * through the "not in the snapshot" branch. Print it verbatim.
 * ------------------------------------------------------------------ */

console.log('\n' + '='.repeat(72))
console.log('What a dereferenced array projection actually returns')
console.log('='.repeat(72))

const shapes = await raw(`*[_type == "detectionRule" && ruleId == "DET-0021"][0]{
  ruleId,
  "plain":  techniques[]->attackId,
  "unique": array::unique(techniques[]->attackId),
  "inner":  techniques[]{"id": @->attackId},
  "refs":   techniques[]._ref,
  "count":  count(techniques)
}`)

console.log('\n  Raw JSON:')
console.log('    ' + JSON.stringify(shapes.result, null, 2).split('\n').join('\n    '))

const shape = shapes.result as Record<string, unknown> | null
if (shape) {
  console.log('\n  Types:')
  for (const [k, v] of Object.entries(shape)) {
    const t = Array.isArray(v)
      ? `array of ${v.length}, first item is ${typeof v[0]}`
      : typeof v
    console.log(`    ${k.padEnd(8)} ${t}`)
  }
}

// And the same field as it arrives inside the snapshot the tool relies on.
const firstSnapRule = ((s?.rules ?? []) as Record<string, unknown>[])[0]
if (firstSnapRule) {
  console.log('\n  The first rule as the snapshot delivers it:')
  console.log('    ' + JSON.stringify(firstSnapRule, null, 2).split('\n').join('\n    '))
}

console.log('\n  Calls made:')
for (const c of graph.calls) {
  console.log(`    ${c.tool} ${String(c.ms).padStart(5)}ms ${String(c.bytes).padStart(7)} chars`)
}
console.log('')

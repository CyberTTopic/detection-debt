/**
 * Exercise every tool against the real dataset, with no model involved.
 *
 *   cd agent
 *   $env:NODE_OPTIONS = "--use-system-ca"; npm run smoke
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything the tools do has been tested against `groq/fixture.mjs`: eight
 * hand-written documents, chosen to make the edge cases visible. That proves the
 * logic. It proves nothing about the data.
 *
 * Production has forty imported rules whose tables were resolved by a script
 * from YAML, a hundred and forty-seven ATT&CK techniques imported from a STIX
 * bundle, and eighteen tables seeded by hand. Any of those could have a rule
 * whose `dataSources` resolves to a null connector slug, a technique whose
 * parent reference points at a document that was never created, or a field the
 * fixture never had a value for. Every one of those failures is silent: the
 * query returns, the arithmetic runs, and the answer is quietly short.
 *
 * So this calls each tool the way the agent would, prints what came back, and
 * asserts the shapes that the rest of the code assumes. It needs no API key,
 * which is the other reason it exists — the agent can be verified while a model
 * provider is unavailable.
 */

import {ContextClient} from '../lib/mcp.ts'
import {buildTools} from '../lib/tools.ts'
import {config} from '../lib/env.ts'

const cfg = config()
const graph = new ContextClient(cfg.groqUrl, cfg.organizationToken, 'graph')
const docs = new ContextClient(cfg.kbUrl, cfg.organizationToken, 'docs')
const tools = buildTools(graph, docs)

/** The AI SDK passes these; nothing here reads them. */
const callOptions = {toolCallId: 'smoke', messages: []} as never

let failures = 0
const problems: string[] = []

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    problems.push(label)
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`)
  }
}

function heading(text: string) {
  console.log(`\n${'='.repeat(70)}\n${text}\n${'='.repeat(70)}`)
}

/** Call a tool, reporting a thrown error as a failure rather than exploding. */
async function call<K extends keyof typeof tools>(
  name: K,
  input: unknown,
  /**
   * Set when the call is supposed to fail — the checks for bad input exist to
   * confirm a tool refuses clearly. Without this the helper counts the expected
   * refusal as a failure and the assertion beside it as a pass, reporting one
   * problem twice and neither accurately.
   */
  expectError = false,
): Promise<Record<string, unknown> | null> {
  try {
    // Through `unknown`: the SDK types `execute` as possibly returning an async
    // iterable for streaming tools, so it does not overlap with a plain promise.
    // None of these tools stream; awaiting the result is correct.
    const t = tools[name] as unknown as {execute: (i: unknown, o: never) => Promise<unknown>}
    const out = (await t.execute(input, callOptions)) as Record<string, unknown>
    if (out && typeof out === 'object' && 'error' in out && !expectError) {
      check(`${String(name)} returned an error`, false, String(out.error).slice(0, 300))
      return null
    }
    return out
  } catch (err) {
    check(
      `${String(name)} threw`,
      false,
      err instanceof Error ? err.message.slice(0, 400) : 'unknown error',
    )
    return null
  }
}

/* ------------------------------------------------------------------ *
 * What is actually in the dataset. Everything below depends on these.
 * ------------------------------------------------------------------ */

heading('Inventory')

const inv = await call('graph_query', {
  why: 'inventory',
  groq: `{
    "connectors": *[_type == "connector"]{"slug": slug.current, name},
    "ruleCount": count(*[_type == "detectionRule"]),
    "coverageRuleCount": count(*[_type == "detectionRule" && status in ["validated","tuned"]]),
    "techniqueCount": count(*[_type == "technique"]),
    "tableCount": count(*[_type == "logTable"]),
    "controlCount": count(*[_type == "baselineControl"])
  }`,
})

const inventory = (inv?.data ?? {}) as {
  connectors?: {slug: string | null; name: string}[]
  ruleCount?: number
  coverageRuleCount?: number
  techniqueCount?: number
  tableCount?: number
  controlCount?: number
}

console.log(`  rules ${inventory.ruleCount} (${inventory.coverageRuleCount} count as coverage)`)
console.log(`  techniques ${inventory.techniqueCount}, tables ${inventory.tableCount}, controls ${inventory.controlCount}`)
console.log(`  connectors: ${(inventory.connectors ?? []).map((c) => c.slug).join(', ')}`)

check('the dataset has rules', (inventory.ruleCount ?? 0) > 0)
check('some rules count as coverage', (inventory.coverageRuleCount ?? 0) > 0)
check(
  'every connector has a slug',
  (inventory.connectors ?? []).every((c) => typeof c.slug === 'string' && c.slug.length > 0),
  'A null slug means coverage_delta can never match that connector.',
)

const slugs = (inventory.connectors ?? []).map((c) => c.slug).filter(Boolean) as string[]

/* ------------------------------------------------------------------ *
 * Referential integrity.
 *
 * The failures this looks for are the ones that make an answer quietly wrong
 * rather than loudly broken.
 * ------------------------------------------------------------------ */

heading('Referential integrity')

const integrity = await call('graph_query', {
  why: 'integrity',
  groq: `{
    "rulesWithNoTables": *[_type == "detectionRule" && count(dataSources) == 0].ruleId,
    "rulesWithNoTechniques": *[_type == "detectionRule" && count(techniques) == 0].ruleId,
    "rulesWithUnresolvableConnector": *[
      _type == "detectionRule" &&
      count(dataSources[@->connector->slug.current == null]) > 0
    ].ruleId,
    "tablesWithNoConnector": *[_type == "logTable" && !defined(connector)].tableName,
    "subTechniquesWithMissingParent": *[
      _type == "technique" && defined(parentTechnique) && parentTechnique->attackId == null
    ].attackId,
    "duplicateRuleIds": *[_type == "detectionRule"]{ruleId}
  }`,
})

const ref = (integrity?.data ?? {}) as Record<string, string[]>

const showList = (label: string, list: string[] | undefined) => {
  const items = list ?? []
  check(
    label,
    items.length === 0,
    items.length ? `${items.length}: ${items.slice(0, 8).join(', ')}` : '',
  )
}

showList('no rule reads zero tables', ref.rulesWithNoTables)
showList('no rule covers zero techniques', ref.rulesWithNoTechniques)
showList(
  'every rule resolves to a real connector through its tables',
  ref.rulesWithUnresolvableConnector,
)
showList('every table belongs to a connector', ref.tablesWithNoConnector)
showList('every sub-technique parent resolves', ref.subTechniquesWithMissingParent)

const ids = ((ref.duplicateRuleIds ?? []) as unknown as {ruleId: string}[]).map((r) => r.ruleId)
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
check(
  'rule ids are unique',
  dupes.length === 0,
  dupes.length ? `repeated: ${[...new Set(dupes)].join(', ')}` : '',
)

/* ------------------------------------------------------------------ *
 * coverage_delta, against real data, including the cross-check.
 * ------------------------------------------------------------------ */

heading('coverage_delta')

for (const slug of slugs.slice(0, 3)) {
  const out = await call('coverage_delta', {connectorSlugs: [slug]})
  if (!out) continue

  const delta = out.delta as {
    tablesLost?: unknown[]
    rulesLost?: unknown[]
    techniquesGoingDark?: {attackId: string}[]
    warnings?: string[]
  }

  const verification = String(out.verification ?? '')
  console.log(`\n  ${slug}`)
  console.log(`    ${String(out.summary ?? '').split('\n')[0]}`)

  // The assertion that matters: two independent implementations of the same set
  // difference, compared on real data for the first time.
  check(
    `${slug}: GROQ and the local computation agree`,
    verification.startsWith('Cross-checked'),
    verification.startsWith('DISAGREEMENT') ? verification.slice(0, 500) : '',
  )

  check(
    `${slug}: the connector slug resolved`,
    !(delta.warnings ?? []).some((w) => w.includes('No connector has the slug')),
  )
}

// Two at once: the case a per-connector query cannot express.
if (slugs.length >= 2) {
  const pair = slugs.slice(0, 2)
  const out = await call('coverage_delta', {connectorSlugs: pair})
  if (out) {
    console.log(`\n  ${pair.join(' + ')}`)
    console.log(`    ${String(out.summary ?? '').split('\n')[0]}`)
    check(
      'a multi-connector call is not cross-checked, and says so',
      String(out.verification ?? '').startsWith('Not cross-checked'),
    )
  }
}

// A slug that does not exist must not read as good news.
const typo = await call('coverage_delta', {connectorSlugs: ['definitely-not-a-connector']})
check(
  'an unknown connector slug produces a warning, not a clean bill of health',
  Boolean(
    ((typo?.delta as {warnings?: string[]})?.warnings ?? []).some((w) =>
      w.includes('No connector has the slug'),
    ),
  ),
)

/* ------------------------------------------------------------------ *
 * The rest of the graph tools.
 * ------------------------------------------------------------------ */

heading('The other graph tools')

const gaps = await call('uncovered_techniques', {tactic: 'TA0006'})
const gapData = gaps?.data as {uncovered?: unknown[]; covered?: number; total?: number} | undefined
if (gapData) {
  console.log(`  TA0006: ${gapData.covered} of ${gapData.total} techniques covered`)
  check('uncovered_techniques returns counts', typeof gapData.total === 'number')
  check(
    'the counts are consistent',
    (gapData.uncovered?.length ?? 0) + (gapData.covered ?? 0) === (gapData.total ?? -1),
    `uncovered ${gapData.uncovered?.length} + covered ${gapData.covered} != total ${gapData.total}`,
  )
}

const spof = await call('single_points_of_failure', {})
const spofList = (spof?.data ?? []) as {ruleId: string; table: string; soleCoverageFor?: string[]}[]
console.log(`  ${spofList.length} coverage rules read exactly one table`)
check('single_points_of_failure returns a list', Array.isArray(spof?.data))
check(
  'each single-table rule names its table',
  spofList.every((r) => typeof r.table === 'string' && r.table.length > 0),
)

const contested = await call('contested_settings', {})
const settings = (contested?.data as {contestedSettings?: string[]})?.contestedSettings ?? []
console.log(`  contested settings: ${settings.join(', ') || 'none'}`)
check('contested_settings finds the seeded conflicts', settings.length >= 2)

for (const s of settings.slice(0, 2)) {
  const claims = await call('claims_for_setting', {setting: s})
  const list = (claims?.data as {claims?: {sourceAuthority: string; recommendedValue: string}[]})?.claims ?? []
  console.log(`  ${s}:`)
  for (const c of list) console.log(`    ${c.sourceAuthority}: ${c.recommendedValue}`)
  check(`${s} returns more than one claim`, list.length > 1)
  check(
    `${s} names an authority for every claim`,
    list.every((c) => Boolean(c.sourceAuthority)),
  )
}

// A downgrade question against the heaviest table, which is where it matters.
const heaviest = await call('graph_query', {
  why: 'heaviest table',
  groq: '*[_type == "logTable"] | order(gbPerDay desc)[0].tableName',
})
const heaviestTable = heaviest?.data as string | undefined
if (heaviestTable) {
  const down = await call('downgrade_check', {tableName: heaviestTable, targetTier: 'basic'})
  console.log(`  ${heaviestTable} -> basic: ${down?.rulesAffected} rule(s) break, ${down?.rulesUnaffected} survive`)
  check('downgrade_check resolves the table', Boolean((down?.table as {tableName?: string})?.tableName))
  check('downgrade_check counts affected rules', typeof down?.rulesAffected === 'number')
}

// A table name that does not exist must be reported, not silently empty.
const missingTable = await call(
  'downgrade_check',
  {tableName: 'NoSuchTable', targetTier: 'basic'},
  true,
)
check(
  'an unknown table name is reported as unknown',
  missingTable === null || String(missingTable?.error ?? '').includes('No table named'),
)

const schema = await call('graph_schema', {type: 'detectionRule'})
check(
  'graph_schema exposes kqlFeatures with its description',
  String(schema?.schema ?? '').includes('kqlFeatures') &&
    String(schema?.schema ?? '').includes('single-table'),
)

/* ------------------------------------------------------------------ *
 * The docs endpoint.
 * ------------------------------------------------------------------ */

heading('The docs endpoint')

const outline = await call('docs_outline', {})
const outlineText = String(outline?.outline ?? '')
check('docs_outline returns an outline', outlineText.length > 200)
check(
  'the knowledge base id is discoverable from it',
  /Knowledge base id:/.test(outlineText),
  'Without it, knowledge_base_read cannot be called.',
)

// Take a real path from the outline rather than guessing one.
const pathMatch = outlineText.match(/^\s*[-*]?\s*([a-z0-9_]+\/[a-z0-9_/-]+)\s*$/im)
const firstPath = pathMatch?.[1]
if (firstPath) {
  const entry = await call('docs_read', {paths: [firstPath]})
  console.log(`  read "${firstPath}": ${String(entry?.entries ?? '').length} characters`)
  check('docs_read returns content for a path from the outline', String(entry?.entries ?? '').length > 50)
} else {
  console.log('  could not pick a path out of the outline automatically; skipping docs_read')
}

/* ------------------------------------------------------------------ *
 * What the agent would have paid for.
 * ------------------------------------------------------------------ */

heading('Calls made')

for (const c of [...graph.calls, ...docs.calls]) {
  console.log(
    `  ${c.endpoint.padEnd(6)} ${c.tool.padEnd(22)} ${String(c.ms).padStart(5)}ms  ${String(c.bytes).padStart(7)} chars${c.ok ? '' : '  FAILED'}`,
  )
}

const total = [...graph.calls, ...docs.calls]
console.log(`\n  ${total.length} calls, ${total.filter((c) => !c.ok).length} failed`)

console.log(
  `\n${failures === 0 ? 'Every tool works against the real dataset.' : `${failures} check(s) failed:\n  - ${problems.join('\n  - ')}`}`,
)
process.exit(failures ? 1 : 0)

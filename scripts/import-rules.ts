/**
 * Import detection rules from Sentinel analytics rule YAML.
 *
 *   git clone --depth 1 https://github.com/Azure/Azure-Sentinel.git ../Azure-Sentinel
 *   npx tsx scripts/import-rules.ts ../Azure-Sentinel/Detections
 *
 * Writing forty rules by hand would take an afternoon and produce forty
 * plausible fictions. The public Sentinel content repository already holds real
 * rules with real queries, real ATT&CK mappings and real required connectors,
 * so this reads those and maps them onto our schema.
 *
 * What is taken from the YAML:
 *   name, description        -> title
 *   query                    -> kql, verbatim
 *   relevantTechniques       -> techniques[] references
 *   requiredDataConnectors   -> dataSources[] references, via dataTypes
 *   queryPeriod              -> lookbackDays
 *
 * What is NOT in the YAML and is therefore synthesised, clearly and on purpose:
 *   status, fpRate, lastValidated, ownerTeam
 *
 * Those four describe OUR operational history with a rule, which no public repo
 * can know. They are generated deterministically from a hash of the rule ID, so
 * re-running the import does not reshuffle the dataset under the demo. The
 * README says plainly which fields are synthetic — a submission that quietly
 * passes invented false-positive rates off as measured is worse than one that
 * admits the gap.
 */

import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, extname} from 'node:path'
import {parse as parseYaml} from 'yaml'
import {client, ids, ref, commitInChunks} from './client'
import {detectKqlFeatures, detectTables} from './kql-features'

const MAX_RULES = Number(process.env.MAX_RULES ?? 40)

type SentinelRule = {
  id?: string
  name?: string
  description?: string
  severity?: string
  queryPeriod?: string
  query?: string
  kind?: string
  tactics?: string[]
  relevantTechniques?: string[]
  requiredDataConnectors?: {connectorId?: string; dataTypes?: string[]}[]
}

/** ISO-8601-ish durations Sentinel uses: P14D, PT1H, P1D. */
function durationToDays(d?: string): number | undefined {
  if (!d) return undefined
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d.trim())
  if (!m) return undefined
  const [, days, hours, mins] = m
  const total = (Number(days) || 0) + (Number(hours) || 0) / 24 + (Number(mins) || 0) / 1440
  return total > 0 ? Math.max(1, Math.round(total)) : undefined
}

/** Sentinel `kind` maps onto our ruleType list. */
function ruleTypeOf(kind?: string): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'nrt':
      return 'nrt'
    case 'scheduled':
      return 'scheduled'
    default:
      return 'scheduled'
  }
}

/** Deterministic pseudo-random in [0,1) from a string. Stable across runs. */
function hashUnit(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

function walkYaml(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walkYaml(p, acc)
    else if (['.yaml', '.yml'].includes(extname(entry))) acc.push(p)
  }
  return acc
}

async function main() {
  const root = process.argv[2]
  if (!root) {
    console.error('Usage: npx tsx scripts/import-rules.ts <path to Sentinel Detections folder>')
    process.exit(1)
  }

  // The schema must already hold tables and techniques: a reference to a
  // document that does not exist yet is a broken reference.
  const [tables, techniques] = await Promise.all([
    client.fetch<{tableName: string}[]>('*[_type == "logTable"]{tableName}'),
    client.fetch<{attackId: string}[]>('*[_type == "technique"]{attackId}'),
  ])
  const knownTables = tables.map((t) => t.tableName)
  const knownTechniques = new Set(techniques.map((t) => t.attackId))

  if (!knownTables.length || !knownTechniques.size) {
    console.error(
      'Run seed-infrastructure.ts and import-attack.ts first — there are no tables or techniques to reference.',
    )
    process.exit(1)
  }
  console.log(`${knownTables.length} tables, ${knownTechniques.size} techniques already in the dataset.`)

  const files = walkYaml(root)
  console.log(`${files.length} YAML files found. Selecting rules we can fully resolve...`)

  const candidates: {doc: Record<string, unknown>; score: number}[] = []
  const skipped = {noQuery: 0, noTable: 0, noTechnique: 0, unparsed: 0}

  for (const file of files) {
    let y: SentinelRule
    try {
      y = parseYaml(readFileSync(file, 'utf8')) as SentinelRule
    } catch {
      skipped.unparsed++
      continue
    }
    if (!y?.query || !y?.name) {
      skipped.noQuery++
      continue
    }

    // Tables: prefer the declared dataTypes, fall back to reading the query.
    const declared = (y.requiredDataConnectors ?? [])
      .flatMap((c) => c.dataTypes ?? [])
      .map((d) => d.split('_')[0])
    const fromQuery = detectTables(y.query, knownTables)
    const resolvedTables = [...new Set([...declared, ...fromQuery])].filter((t) =>
      knownTables.includes(t),
    )
    if (!resolvedTables.length) {
      skipped.noTable++
      continue
    }

    const resolvedTechniques = (y.relevantTechniques ?? []).filter((t) => knownTechniques.has(t))
    if (!resolvedTechniques.length) {
      skipped.noTechnique++
      continue
    }

    const seed = y.id ?? y.name
    const r = hashUnit(seed)

    // Synthetic operational fields. See the header comment.
    const status = r < 0.12 ? 'draft' : r < 0.2 ? 'retired' : r < 0.55 ? 'tuned' : 'validated'
    const fpRate = Math.round((0.02 + hashUnit(seed + 'fp') * 0.45) * 100) / 100
    const daysAgo = Math.floor(hashUnit(seed + 'v') * 420)
    const lastValidated = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
    const teams = ['soc-t1', 'soc-t2', 'detection-eng', 'identity', 'cloud-platform', 'unowned']
    const ownerTeam = teams[Math.floor(hashUnit(seed + 'o') * teams.length)]

    candidates.push({
      score: resolvedTables.length + resolvedTechniques.length,
      doc: {
        _type: 'detectionRule',
        title: String(y.name).slice(0, 160),
        ruleType: ruleTypeOf(y.kind),
        status,
        kql: y.query,
        dataSources: resolvedTables.map((t) => ref(ids.logTable(t))),
        techniques: resolvedTechniques.map((t) => ref(ids.technique(t))),
        kqlFeatures: detectKqlFeatures(y.query),
        lookbackDays: durationToDays(y.queryPeriod) ?? 1,
        fpRate,
        lastValidated,
        ownerTeam,
      },
    })
  }

  // Prefer rules that touch more of the graph — they make better demo material
  // than a rule reading one table and covering one technique.
  candidates.sort((a, b) => b.score - a.score)
  const chosen = candidates.slice(0, MAX_RULES)

  // Rule IDs are assigned here, after selection, so they run DET-0001..DET-00NN
  // with no gaps. Sorting by title keeps the numbering stable between runs.
  chosen.sort((a, b) => String(a.doc.title).localeCompare(String(b.doc.title)))
  const docs = chosen.map(({doc}, i) => {
    const ruleId = `DET-${String(i + 1).padStart(4, '0')}`
    return {...doc, _id: ids.rule(ruleId), ruleId}
  })

  await commitInChunks(docs, 'detection rules')

  console.log(`\nImported ${docs.length} of ${candidates.length} resolvable rules.`)
  console.log('Skipped:', skipped)

  const featureCounts: Record<string, number> = {}
  for (const d of docs) for (const f of d.kqlFeatures as string[]) featureCounts[f] = (featureCounts[f] ?? 0) + 1
  console.log('\nKQL features detected across the imported set:')
  for (const [f, n] of Object.entries(featureCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f}: ${n}`)
  }

  const spof = docs.filter((d) => (d.dataSources as unknown[]).length === 1).length
  console.log(`\n${spof} of ${docs.length} rules read exactly one table (single point of failure).`)
  console.log('Synthetic fields: status, fpRate, lastValidated, ownerTeam. Everything else is from the YAML.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

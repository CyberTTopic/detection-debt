/**
 * Run the demo questions against the live dataset.
 *
 *   npx tsx scripts/demo.ts
 *   npx tsx scripts/demo.ts defender-for-endpoint
 *
 * This is the answer the whole project exists to produce, computed from the
 * graph rather than retrieved from any document. No language model involved:
 * the arithmetic is GROQ plus set subtraction, so the output is reproducible
 * and checkable by hand.
 */

import {client} from './client'
import {
  Q1_CONNECTOR_LOSS,
  Q2_UNCOVERED_TECHNIQUES,
  Q4_SINGLE_POINT_OF_FAILURE,
  Q6_CONTESTED_SETTINGS,
  Q6B_CLAIMS_FOR_SETTING,
  COVERAGE_STATUSES,
} from '../groq/queries'

const CS = [...COVERAGE_STATUSES]
const rule = (s: string) => '\n' + '='.repeat(74) + `\n${s}\n` + '='.repeat(74)

async function main() {
  const connectorSlug = process.argv[2] ?? 'defender-for-identity'

  // --- counts, so the scale of the dataset is on the record ---
  const counts = await client.fetch<Record<string, number>>(`{
    "connectors": count(*[_type == "connector"]),
    "tables": count(*[_type == "logTable"]),
    "techniques": count(*[_type == "technique"]),
    "rules": count(*[_type == "detectionRule"]),
    "coverageRules": count(*[_type == "detectionRule" && status in $cs]),
    "controls": count(*[_type == "baselineControl"])
  }`, {cs: CS})

  console.log(rule('DATASET'))
  console.log(
    `${counts.connectors} connectors · ${counts.tables} tables · ` +
      `${counts.techniques} techniques · ${counts.rules} rules ` +
      `(${counts.coverageRules} count as coverage) · ${counts.controls} controls`,
  )

  // --- Q1: the question that justifies the whole project ---
  const q1 = await client.fetch(Q1_CONNECTOR_LOSS, {connectorSlug, coverageStatuses: CS})
  console.log(rule(`Q1  "If we lose ${q1.connector?.name ?? connectorSlug}, what goes dark?"`))

  if (!q1.connector) {
    console.log(`No connector with slug "${connectorSlug}".`)
  } else {
    const gb = q1.tablesLost.reduce((a: number, t: {gbPerDay?: number}) => a + (t.gbPerDay ?? 0), 0)
    console.log(`License: ${q1.connector.licenseRequired}` +
      (q1.connector.licenseExpiresOn ? `, expires ${q1.connector.licenseExpiresOn}` : ''))
    console.log(`\nTables lost (${q1.tablesLost.length}, ${gb} GB/day):`)
    for (const t of q1.tablesLost) console.log(`  ${t.tableName}  [${t.ingestionTier}]`)

    console.log(`\nRules that stop (${q1.rulesLost.length}):`)
    for (const r of q1.rulesLost) {
      console.log(`  ${r.ruleId}  ${r.title.slice(0, 58)}`)
      console.log(`          reads ${r.tables.join(', ')}`)
    }

    console.log(`\nTechniques STILL COVERED by surviving rules (${q1.techniquesStillCovered.length}):`)
    for (const t of q1.techniquesStillCovered) console.log(`  ${t.attackId}  ${t.name}`)

    console.log(`\n>>> TECHNIQUES GOING DARK (${q1.techniquesGoingDark.length}) <<<`)
    if (q1.techniquesGoingDark.length === 0) {
      console.log('  None. Every technique this connector fed is covered elsewhere too.')
    } else {
      for (const t of q1.techniquesGoingDark) {
        console.log(`  ${t.attackId}  ${t.name}`)
        console.log(`          tactics: ${(t.tactics ?? []).join(', ')}`)
        if (t.dataComponents?.length) {
          console.log(`          needs: ${t.dataComponents.slice(0, 2).join('; ')}`)
        }
      }
      console.log(
        `\n  No document states this. It is the set of techniques the lost rules covered,`,
      )
      console.log(`  minus the set the surviving rules still cover.`)
    }
  }

  // --- Q2: absence, which retrieval cannot answer ---
  const q2 = await client.fetch(Q2_UNCOVERED_TECHNIQUES, {tactic: 'TA0006', coverageStatuses: CS})
  console.log(rule('Q2  "Which Credential Access techniques has nothing validated covering them?"'))
  console.log(`${q2.covered} of ${q2.total} covered. ${q2.uncovered.length} uncovered.`)
  for (const t of q2.uncovered.slice(0, 12)) {
    const drafts = t.draftRulesThatWouldCover?.map((d: {ruleId: string}) => d.ruleId) ?? []
    console.log(`  ${t.attackId}  ${t.name}${drafts.length ? `   (draft: ${drafts.join(', ')})` : ''}`)
  }
  if (q2.uncovered.length > 12) console.log(`  ... and ${q2.uncovered.length - 12} more`)

  // --- Q4: cardinality over a reference array ---
  const q4 = await client.fetch(Q4_SINGLE_POINT_OF_FAILURE, {coverageStatuses: CS})
  console.log(rule(`Q4  "Which rules are a single point of failure?" (${q4.length})`))
  for (const r of q4.slice(0, 10)) {
    const sole = r.soleCoverageFor?.length ? `  SOLE COVER: ${r.soleCoverageFor.join(', ')}` : ''
    console.log(`  ${r.ruleId}  ${r.table} via ${r.connector}${sole}`)
  }
  if (q4.length > 10) console.log(`  ... and ${q4.length - 10} more`)

  // --- Q6: the disagreement the Knowledge Base could not surface ---
  const q6 = await client.fetch(Q6_CONTESTED_SETTINGS, {})
  console.log(rule(`Q6  "Which settings do my sources disagree about?" (${q6.settingCount})`))
  for (const setting of q6.contestedSettings) {
    const d = await client.fetch(Q6B_CLAIMS_FOR_SETTING, {setting})
    console.log(`\n  ${setting}`)
    for (const c of d.claims) {
      console.log(`    ${c.sourceAuthority} (${c.controlId}): ${c.recommendedValue}`)
      console.log(`        ${c.sourceLocation}`)
    }
  }

  console.log(rule('DONE'))
  console.log('Every number above was computed by traversing references.')
  console.log('A keyword search over the same sources returns none of it.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

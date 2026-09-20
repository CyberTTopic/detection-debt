/**
 * Import MITRE ATT&CK Enterprise techniques from the official STIX bundle.
 *
 *   npx tsx scripts/import-attack.ts
 *
 * Imports only the tactics listed in TACTICS below. The full Enterprise matrix
 * is around 600 techniques and sub-techniques; importing all of it makes the
 * Studio unusable to browse and adds nothing to the demo. Three tactics give a
 * coverage map with real gaps in it, which is the point.
 *
 * Revoked and deprecated techniques are skipped. ATT&CK keeps them in the bundle
 * forever, and a coverage map that counts retired techniques as gaps is noise.
 */

import {client, ids, ref, commitInChunks} from './client'

const STIX_URL =
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json'

/** Keep this narrow. Credential Access is where the interesting gaps live. */
const TACTICS = new Set([
  'credential-access', // TA0006
  'initial-access', // TA0001
  'persistence', // TA0003
])

/** ATT&CK uses kebab-case shortnames in STIX; our schema stores TA identifiers. */
const TACTIC_IDS: Record<string, string> = {
  reconnaissance: 'TA0043',
  'resource-development': 'TA0042',
  'initial-access': 'TA0001',
  execution: 'TA0002',
  persistence: 'TA0003',
  'privilege-escalation': 'TA0004',
  'defense-evasion': 'TA0005',
  'credential-access': 'TA0006',
  discovery: 'TA0007',
  'lateral-movement': 'TA0008',
  collection: 'TA0009',
  'command-and-control': 'TA0011',
  exfiltration: 'TA0010',
  impact: 'TA0040',
}

type StixObject = {
  type: string
  id: string
  name?: string
  description?: string
  revoked?: boolean
  x_mitre_deprecated?: boolean
  x_mitre_is_subtechnique?: boolean
  x_mitre_data_sources?: string[]
  kill_chain_phases?: {kill_chain_name: string; phase_name: string}[]
  external_references?: {source_name: string; external_id?: string}[]
}

const attackIdOf = (o: StixObject) =>
  o.external_references?.find((r) => r.source_name === 'mitre-attack')?.external_id

async function main() {
  console.log('Fetching ATT&CK Enterprise STIX bundle (~35 MB, one moment)...')
  const res = await fetch(STIX_URL)
  if (!res.ok) throw new Error(`STIX fetch failed: ${res.status} ${res.statusText}`)
  const bundle = (await res.json()) as {objects: StixObject[]}
  console.log(`  ${bundle.objects.length} STIX objects`)

  const patterns = bundle.objects.filter(
    (o) =>
      o.type === 'attack-pattern' &&
      !o.revoked &&
      !o.x_mitre_deprecated &&
      o.kill_chain_phases?.some(
        (p) => p.kill_chain_name === 'mitre-attack' && TACTICS.has(p.phase_name),
      ),
  )

  const selected = patterns
    .map((o) => ({o, attackId: attackIdOf(o)}))
    .filter((x): x is {o: StixObject; attackId: string} => Boolean(x.attackId))

  console.log(`  ${selected.length} techniques across ${TACTICS.size} tactics`)

  /**
   * Sub-techniques are imported in a second pass.
   *
   * A sub-technique references its parent, and a reference to a document that
   * does not exist yet is a broken reference. ATT&CK encodes the relationship in
   * the ID itself — T1078.004 belongs to T1078 — so the parent is derivable
   * without walking STIX relationship objects.
   */
  const parents = selected.filter(({attackId}) => !attackId.includes('.'))
  const subs = selected.filter(({attackId}) => attackId.includes('.'))

  const toDoc = ({o, attackId}: {o: StixObject; attackId: string}) => {
    const tactics = [
      ...new Set(
        (o.kill_chain_phases ?? [])
          .filter((p) => p.kill_chain_name === 'mitre-attack')
          .map((p) => TACTIC_IDS[p.phase_name])
          .filter(Boolean),
      ),
    ]
    const parentId = attackId.includes('.') ? attackId.split('.')[0] : undefined
    return {
      _id: ids.technique(attackId),
      _type: 'technique',
      attackId,
      name: o.name ?? attackId,
      tactics,
      dataComponents: [...new Set(o.x_mitre_data_sources ?? [])],
      description: (o.description ?? '').slice(0, 2000),
      ...(parentId && parents.some((p) => p.attackId === parentId)
        ? {parentTechnique: ref(ids.technique(parentId))}
        : {}),
    }
  }

  await commitInChunks(parents.map(toDoc), 'techniques (parents)')
  await commitInChunks(subs.map(toDoc), 'techniques (sub-techniques)')

  const orphans = subs.filter(
    ({attackId}) => !parents.some((p) => p.attackId === attackId.split('.')[0]),
  )
  if (orphans.length) {
    console.log(
      `\n  Note: ${orphans.length} sub-technique(s) imported without a parent, because the` +
        ` parent sits in a tactic we did not import: ${orphans
          .map((o) => o.attackId)
          .join(', ')}`,
    )
    console.log('  Add its tactic to TACTICS if you want the hierarchy complete.')
  }

  const count = await client.fetch<number>('count(*[_type == "technique"])')
  console.log(`\nDone. ${count} technique documents in the dataset, all published.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

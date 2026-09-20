/**
 * Wire baseline controls to the techniques they mitigate and the rules that
 * compensate for them.
 *
 *   npx tsx scripts/link-controls.ts
 *
 * This runs last, on purpose. seed-baselines.ts creates the controls with their
 * conflicts but leaves mitigatesTechniques and compensatingRules empty, because
 * a reference to a document that does not exist yet is a broken reference and
 * the techniques and rules are imported after it.
 *
 * The mappings below are editorial judgements, not facts from a document, so
 * each one carries the reasoning. This is also the file to extend by hand as the
 * dataset grows — it is the one place where "this control substitutes for that
 * detection" is asserted.
 */

import {client, ids, ref} from './client'

type Link = {
  control: string
  mitigates?: string[]
  /** Matched against rule titles, case-insensitive, so it survives renumbering. */
  compensatingTitleMatches?: string[]
  why: string
}

const links: Link[] = [
  {
    control: ids.control('cis-m365-v7', '1.1.2'),
    mitigates: ['T1078.004', 'T1078'],
    compensatingTitleMatches: ['emergency', 'break glass', 'global admin', 'privileged role'],
    why:
      'A correctly configured break-glass account limits abuse of valid cloud accounts. Where the control is not enforced, detections on privileged account use are what is left.',
  },
  {
    control: ids.control('mcsb', 'PA-5'),
    mitigates: ['T1078.004', 'T1078'],
    why: 'Same setting as CIS 1.1.2, stricter value. Kept as a separate control so the conflict is visible.',
  },
  {
    control: ids.control('cis-m365-v7', '5.2.2.4'),
    mitigates: ['T1539', 'T1550.004', 'T1078.004'],
    compensatingTitleMatches: ['session', 'token', 'impossible travel', 'anomalous sign-in'],
    why:
      'Short sessions and non-persistent browsers reduce the value of a stolen session cookie. Not enforced here, so session-anomaly detections are the compensating control.',
  },
  {
    control: ids.control('microsoft-learn', 'session-lifetime'),
    mitigates: ['T1539'],
    why: 'The opposing claim on the same setting. Linked so both sides carry the same technique.',
  },
  {
    control: ids.control('cis-m365-v7', '5.2.2.3'),
    mitigates: ['T1110', 'T1110.003', 'T1078.004'],
    compensatingTitleMatches: ['legacy auth', 'password spray', 'brute force'],
    why:
      'Blocking legacy authentication removes the MFA bypass that most password spray relies on. Where it is not blocked, spray detections are the fallback.',
  },
  {
    control: ids.control('microsoft-learn', 'baseline-security-mode'),
    mitigates: ['T1110', 'T1078.004'],
    why: 'Same protection, different mechanism. Present so the staleness conflict has both sides.',
  },
  {
    control: ids.control('cis-m365-v7', '5.2.2.5'),
    mitigates: ['T1621', 'T1556.006', 'T1078.004'],
    compensatingTitleMatches: ['mfa fatigue', 'multifactor', 'authentication method'],
    why:
      'Phishing-resistant MFA defeats MFA-fatigue and AiTM flows outright. Nothing detects what it prevents, so the compensating rules are about MFA manipulation attempts.',
  },
  {
    control: ids.control('cis-m365-v7', '2.2.1'),
    mitigates: ['T1078.004'],
    compensatingTitleMatches: ['emergency', 'break glass'],
    why: 'This control IS a detection requirement, so its compensating rules are the monitoring itself.',
  },
]

async function main() {
  const [techniques, rules] = await Promise.all([
    client.fetch<{_id: string; attackId: string}[]>('*[_type == "technique"]{_id, attackId}'),
    client.fetch<{_id: string; ruleId: string; title: string}[]>(
      '*[_type == "detectionRule"]{_id, ruleId, title}',
    ),
  ])

  const byAttackId = new Map(techniques.map((t) => [t.attackId, t._id]))
  console.log(`${techniques.length} techniques, ${rules.length} rules available to link.\n`)

  const tx = client.transaction()
  let linked = 0
  const missingTechniques: string[] = []

  for (const link of links) {
    const techIds = (link.mitigates ?? [])
      .map((a) => {
        const id = byAttackId.get(a)
        if (!id) missingTechniques.push(a)
        return id
      })
      .filter((x): x is string => Boolean(x))

    const matchedRules = (link.compensatingTitleMatches ?? []).length
      ? rules.filter((r) =>
          link.compensatingTitleMatches!.some((m) => r.title.toLowerCase().includes(m.toLowerCase())),
        )
      : []

    tx.patch(link.control, (p) =>
      p.set({
        ...(techIds.length
          ? {mitigatesTechniques: techIds.map((id) => ({...ref(id), _key: id.slice(-12)}))}
          : {}),
        ...(matchedRules.length
          ? {
              compensatingRules: matchedRules.map((r) => ({
                ...ref(r._id),
                _key: r.ruleId.toLowerCase(),
              })),
            }
          : {}),
      }),
    )

    linked++
    console.log(`${link.control}`)
    console.log(`  techniques: ${techIds.length}  rules: ${matchedRules.length}`)
    if (matchedRules.length) {
      console.log(`  matched: ${matchedRules.map((r) => r.ruleId).join(', ')}`)
    }
  }

  await tx.commit({visibility: 'async'})
  console.log(`\nPatched ${linked} controls.`)

  if (missingTechniques.length) {
    const uniq = [...new Set(missingTechniques)]
    console.log(
      `\nNote: ${uniq.length} technique(s) referenced here are not in the dataset: ${uniq.join(', ')}`,
    )
    console.log('Their tactics were not imported. Widen TACTICS in import-attack.ts to include them.')
  }

  const contested = await client.fetch<number>(
    'count(*[_type == "baselineControl" && count(conflictsWith) > 0])',
  )
  console.log(`\n${contested} controls are marked as contested and ready for the Knowledge Base build.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

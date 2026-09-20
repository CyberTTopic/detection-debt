/**
 * Coverage arithmetic, done in code.
 *
 * WHY THIS IS NOT A PROMPT
 * ------------------------
 * "Which techniques stop being watched if we drop these two connectors" is a
 * set difference over a few hundred references. A language model asked to do it
 * from a JSON blob will produce a plausible list, and a plausible list is the
 * worst possible output here: it is wrong in a way nobody can see. So the model
 * never does the arithmetic. It decides *what* to compute and explains the
 * result; this module computes it, the same way every time.
 *
 * WHY IT IS NOT JUST THE GROQ QUERY EITHER
 * ----------------------------------------
 * groq/queries.ts Q1 already expresses single-connector loss server-side, and
 * it is the better tool for that one question. Three things it cannot do:
 *
 *   1. Several connectors at once. A license bundle lapsing takes four
 *      connectors with it, and the answer is not the union of four separate
 *      answers: a rule reading two of them dies once, and a technique covered
 *      only by rules spanning both bundles goes dark in the combined case while
 *      surviving in either case alone.
 *
 *   2. The parent/sub-technique roll-up. ATT&CK coverage of T1078.004 is not
 *      coverage of T1078. But if every covered sub-technique of T1078 dies and
 *      nothing covers T1078 directly, something real has been lost that no
 *      per-technique query reports. That inference needs the hierarchy walked,
 *      and it is reported as an inference, separately, never merged into the
 *      direct losses.
 *
 *   3. Second-order risk. The techniques that *survive* but drop to exactly one
 *      remaining rule. Nobody asks for this and it is the thing that bites next
 *      quarter, so it is computed whether or not it was asked for.
 *
 * DEFINITIONS, stated once and applied without exception
 * ------------------------------------------------------
 *   coverage       a rule with status `validated` or `tuned`. A draft rule is an
 *                  intention, not a control.
 *   a rule dies    if ANY connector it depends on is removed. Rules do not
 *                  degrade gracefully; a query against a table that stopped
 *                  ingesting returns nothing and fires never.
 *   goes dark      a technique that was covered before and is not after.
 *   sole-sourced   a technique covered by exactly one rule after the loss,
 *                  having been covered by more than one before.
 */

/* ------------------------------------------------------------------ *
 * The shape of the graph snapshot this operates on.
 *
 * Deliberately flat and deliberately strings. Every id here is a natural key
 * (`DET-0007`, `T1078.004`, `defender-for-identity`) rather than a Sanity `_id`,
 * because the output is read by a language model and then by a human, and
 * `drafts.a3f1-…` is meaningless to both.
 * ------------------------------------------------------------------ */

export interface RuleSnapshot {
  ruleId: string
  title: string
  status: string
  ruleType?: string
  fpRate?: number | null
  ownerTeam?: string | null
  /** Distinct connector slugs this rule depends on, via its tables. */
  connectors: string[]
  tables: string[]
  /** ATT&CK ids this rule claims to detect. */
  techniques: string[]
}

export interface TechniqueSnapshot {
  attackId: string
  name: string
  tactics?: string[]
  /** ATT&CK id of the parent, or null for a top-level technique. */
  parent?: string | null
}

export interface ConnectorSnapshot {
  slug: string
  name: string
  licenseRequired?: string
  estimatedGbPerDay?: number | null
}

export interface TableSnapshot {
  tableName: string
  connector: string
  gbPerDay?: number | null
  ingestionTier?: string
}

export interface GraphSnapshot {
  rules: RuleSnapshot[]
  drafts: RuleSnapshot[]
  techniques: TechniqueSnapshot[]
  connectors: ConnectorSnapshot[]
  tables: TableSnapshot[]
}

/* ------------------------------------------------------------------ *
 * The result.
 * ------------------------------------------------------------------ */

export interface TechniqueLoss {
  attackId: string
  name: string
  tactics: string[]
  parent: string | null
  /** The rules that were covering it and now die. Named so the claim is checkable. */
  wasCoveredBy: string[]
}

export interface SoleSourced {
  attackId: string
  name: string
  /** The one rule left standing. */
  nowCoveredOnlyBy: string
  coverageCountBefore: number
}

export interface StructuralLoss {
  parentAttackId: string
  parentName: string
  /** Sub-techniques that were covered and now are not. */
  subTechniquesLost: string[]
  /** Sub-techniques of the same parent that survive. Empty means total loss. */
  subTechniquesSurviving: string[]
}

export interface Remediation {
  ruleId: string
  title: string
  /** Techniques from the dark set this draft rule would cover. */
  wouldCover: string[]
  /** False if the draft itself depends on a connector being removed. */
  survivesTheLoss: boolean
}

export interface CoverageDelta {
  removedConnectors: {slug: string; name: string; licenseRequired?: string; found: boolean}[]
  tablesLost: {tableName: string; gbPerDay: number | null; ingestionTier?: string}[]
  gbPerDayLost: number
  rulesLost: {ruleId: string; title: string; status: string; connectors: string[]}[]
  rulesSurviving: number
  techniquesGoingDark: TechniqueLoss[]
  /**
   * Techniques the dying rules were covering that a surviving rule still covers.
   *
   * Scoped to what the removed connectors actually fed — NOT every technique
   * still covered by anything. See the note in the implementation: the unscoped
   * version is true and useless.
   */
  techniquesStillCovered: string[]
  newlySoleSourced: SoleSourced[]
  parentTechniquesStructurallyDark: StructuralLoss[]
  remediationCandidates: Remediation[]
  coverageBefore: number
  coverageAfter: number
  /** Populated when a cross-check was requested and disagreed. See crossCheck(). */
  warnings: string[]
}

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

const COVERAGE_STATUSES = new Set(['validated', 'tuned'])

/** Techniques covered by a set of rules, as a map technique -> covering ruleIds. */
function coverageMap(rules: RuleSnapshot[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of rules) {
    for (const t of r.techniques ?? []) {
      const list = m.get(t)
      if (list) list.push(r.ruleId)
      else m.set(t, [r.ruleId])
    }
  }
  return m
}

function sortIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b, 'en'))
}

/* ------------------------------------------------------------------ *
 * The computation.
 * ------------------------------------------------------------------ */

export function computeCoverageDelta(
  snapshot: GraphSnapshot,
  removedConnectorSlugs: string[],
): CoverageDelta {
  const removed = new Set(removedConnectorSlugs)
  const warnings: string[] = []

  // Resolve the slugs first, and say plainly which ones do not exist. A typo in
  // a connector slug would otherwise produce a confident "nothing is affected",
  // which reads exactly like good news.
  const removedConnectors = removedConnectorSlugs.map((slug) => {
    const c = snapshot.connectors.find((x) => x.slug === slug)
    return {
      slug,
      name: c?.name ?? slug,
      licenseRequired: c?.licenseRequired,
      found: Boolean(c),
    }
  })
  for (const c of removedConnectors) {
    if (!c.found) {
      warnings.push(
        `No connector has the slug "${c.slug}". It contributes nothing to this answer. ` +
          `Known slugs: ${sortIds(snapshot.connectors.map((x) => x.slug)).join(', ')}.`,
      )
    }
  }

  const tablesLost = snapshot.tables
    .filter((t) => removed.has(t.connector))
    .map((t) => ({
      tableName: t.tableName,
      gbPerDay: t.gbPerDay ?? null,
      ingestionTier: t.ingestionTier,
    }))
    .sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0))

  const gbPerDayLost = tablesLost.reduce((sum, t) => sum + (t.gbPerDay ?? 0), 0)

  // Only real coverage participates. Drafts are handled separately, as candidates.
  const coverageRules = snapshot.rules.filter((r) => COVERAGE_STATUSES.has(r.status))
  if (coverageRules.length !== snapshot.rules.length) {
    warnings.push(
      `${snapshot.rules.length - coverageRules.length} rule(s) in the snapshot were not ` +
        `validated or tuned and were excluded from coverage.`,
    )
  }

  // A rule dies if ANY connector it depends on is removed.
  const dying = coverageRules.filter((r) => (r.connectors ?? []).some((c) => removed.has(c)))
  const surviving = coverageRules.filter((r) => !(r.connectors ?? []).some((c) => removed.has(c)))

  const before = coverageMap(coverageRules)
  const after = coverageMap(surviving)

  const byId = new Map(snapshot.techniques.map((t) => [t.attackId, t]))

  // Techniques the dying rules were covering. Everything reported as lost or as
  // surviving-despite-the-loss is scoped to this set.
  //
  // This scoping is the whole definition of `techniquesStillCovered`, and it was
  // wrong here until an end-to-end test compared this function against the GROQ
  // query that expresses the same thing server-side. The unscoped version — every
  // technique still covered by anything — is a true statement and the wrong
  // answer: it pads the list with techniques the removed connector never fed,
  // which reads as reassurance that the loss was survivable when most of the
  // reassurance is unrelated coverage that was never at risk.
  const touchedByDying = new Set<string>()
  for (const r of dying) for (const t of r.techniques ?? []) touchedByDying.add(t)

  // --- Direct losses: covered before, not covered after. ---
  const techniquesGoingDark: TechniqueLoss[] = []
  const techniquesStillCovered: string[] = []

  for (const [attackId, coveringRules] of before) {
    const meta = byId.get(attackId)
    if (!meta) {
      // A rule references a technique the snapshot does not contain. That is a
      // broken reference or a truncated fetch, and quietly dropping it would
      // understate the loss.
      warnings.push(
        `Rule(s) ${sortIds(coveringRules).join(', ')} reference technique ${attackId}, ` +
          `which is not in the snapshot. It is excluded, so the loss may be understated.`,
      )
      continue
    }
    if (after.has(attackId)) {
      if (touchedByDying.has(attackId)) techniquesStillCovered.push(attackId)
    } else {
      techniquesGoingDark.push({
        attackId,
        name: meta.name,
        tactics: meta.tactics ?? [],
        parent: meta.parent ?? null,
        wasCoveredBy: sortIds(coveringRules),
      })
    }
  }

  techniquesGoingDark.sort((a, b) => a.attackId.localeCompare(b.attackId, 'en'))

  // --- Second-order: survived, but down to a single rule. ---
  const newlySoleSourced: SoleSourced[] = []
  for (const [attackId, remaining] of after) {
    const priorCount = before.get(attackId)?.length ?? 0
    if (remaining.length === 1 && priorCount > 1) {
      newlySoleSourced.push({
        attackId,
        name: byId.get(attackId)?.name ?? attackId,
        nowCoveredOnlyBy: remaining[0],
        coverageCountBefore: priorCount,
      })
    }
  }
  newlySoleSourced.sort((a, b) => a.attackId.localeCompare(b.attackId, 'en'))

  // --- The hierarchy roll-up, reported as an inference. ---
  //
  // Coverage of a sub-technique is not coverage of its parent, so a parent is
  // never listed as directly dark on account of its children. But when every
  // sub-technique that had coverage loses it, and the parent has no coverage of
  // its own either before or after, the whole branch has gone unwatched — and
  // that is worth saying out loud in different words.
  const darkSet = new Set(techniquesGoingDark.map((t) => t.attackId))
  const parentTechniquesStructurallyDark: StructuralLoss[] = []

  const subsByParent = new Map<string, string[]>()
  for (const t of snapshot.techniques) {
    if (!t.parent) continue
    const list = subsByParent.get(t.parent)
    if (list) list.push(t.attackId)
    else subsByParent.set(t.parent, [t.attackId])
  }

  for (const [parentId, subs] of subsByParent) {
    // Only parents with no direct coverage of their own, before or after.
    if (before.has(parentId)) continue

    const subsPreviouslyCovered = subs.filter((s) => before.has(s))
    if (subsPreviouslyCovered.length === 0) continue

    const lost = subsPreviouslyCovered.filter((s) => darkSet.has(s))
    if (lost.length !== subsPreviouslyCovered.length) continue

    parentTechniquesStructurallyDark.push({
      parentAttackId: parentId,
      parentName: byId.get(parentId)?.name ?? parentId,
      subTechniquesLost: sortIds(lost),
      subTechniquesSurviving: sortIds(subs.filter((s) => after.has(s))),
    })
  }
  parentTechniquesStructurallyDark.sort((a, b) =>
    a.parentAttackId.localeCompare(b.parentAttackId, 'en'),
  )

  // --- What would close the gap. ---
  //
  // Ranked by how much of the dark set each draft would cover, and honest about
  // drafts that read the very tables being taken away.
  const remediationCandidates: Remediation[] = (snapshot.drafts ?? [])
    .map((d) => {
      const wouldCover = sortIds((d.techniques ?? []).filter((t) => darkSet.has(t)))
      return {
        ruleId: d.ruleId,
        title: d.title,
        wouldCover,
        survivesTheLoss: !(d.connectors ?? []).some((c) => removed.has(c)),
      }
    })
    .filter((r) => r.wouldCover.length > 0)
    .sort(
      (a, b) =>
        Number(b.survivesTheLoss) - Number(a.survivesTheLoss) ||
        b.wouldCover.length - a.wouldCover.length ||
        a.ruleId.localeCompare(b.ruleId, 'en'),
    )

  return {
    removedConnectors,
    tablesLost,
    gbPerDayLost: Math.round(gbPerDayLost * 100) / 100,
    rulesLost: dying
      .map((r) => ({
        ruleId: r.ruleId,
        title: r.title,
        status: r.status,
        connectors: sortIds(r.connectors ?? []),
      }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId, 'en')),
    rulesSurviving: surviving.length,
    techniquesGoingDark,
    techniquesStillCovered: sortIds(techniquesStillCovered),
    newlySoleSourced,
    parentTechniquesStructurallyDark,
    remediationCandidates,
    coverageBefore: before.size,
    coverageAfter: after.size,
    warnings,
  }
}

/* ------------------------------------------------------------------ *
 * Cross-check against the server-side query.
 *
 * The same set difference is expressed twice: once as GROQ that runs inside
 * Sanity, once as the TypeScript above. They should agree. When they do, the
 * number is worth reporting; when they do not, something is wrong — a stale
 * reference, a truncated fetch, a query edited without updating the other side
 * — and the right behaviour is to say so rather than to pick a winner.
 *
 * This is cheap insurance against the failure mode that matters most here: an
 * answer that is confidently, invisibly wrong.
 * ------------------------------------------------------------------ */

export function crossCheck(
  computed: CoverageDelta,
  fromGroq: {
    techniquesGoingDark?: {attackId: string}[]
    techniquesStillCovered?: {attackId: string}[]
    rulesLost?: {ruleId: string}[]
  } | null,
): string[] {
  if (!fromGroq) return []
  const problems: string[] = []

  const compare = (label: string, mine: string[], theirs: string[]) => {
    const a = new Set(mine)
    const b = new Set(theirs)
    const onlyMine = mine.filter((x) => !b.has(x))
    const onlyTheirs = theirs.filter((x) => !a.has(x))
    if (onlyMine.length || onlyTheirs.length) {
      problems.push(
        `${label} disagree between the GROQ query and the local computation. ` +
          `Only in the local result: [${onlyMine.join(', ') || 'none'}]. ` +
          `Only in the GROQ result: [${onlyTheirs.join(', ') || 'none'}]. ` +
          `Report this discrepancy instead of choosing one side.`,
      )
    }
  }

  if (fromGroq.techniquesGoingDark) {
    compare(
      'Techniques going dark',
      computed.techniquesGoingDark.map((t) => t.attackId),
      fromGroq.techniquesGoingDark.map((t) => t.attackId),
    )
  }
  // Compared because it was the field the two implementations silently disagreed
  // on. It is checked now precisely because it was not checked before.
  if (fromGroq.techniquesStillCovered) {
    compare(
      'Techniques surviving the loss',
      computed.techniquesStillCovered,
      fromGroq.techniquesStillCovered.map((t) => t.attackId),
    )
  }
  if (fromGroq.rulesLost) {
    compare(
      'Rules lost',
      computed.rulesLost.map((r) => r.ruleId),
      fromGroq.rulesLost.map((r) => r.ruleId),
    )
  }

  return problems
}

/* ------------------------------------------------------------------ *
 * A compact prose rendering, for the model to quote rather than recompute.
 *
 * The model gets the structured object too. This exists because a summary the
 * model paraphrases is a summary it can paraphrase wrongly, and the headline
 * numbers are the ones that end up in a slide.
 * ------------------------------------------------------------------ */

export function summarise(d: CoverageDelta): string {
  const names = d.removedConnectors.map((c) => c.name).join(' + ')
  const lines = [
    `Removing ${names}: ${d.tablesLost.length} table(s) stop, ` +
      `${d.gbPerDayLost} GB/day of ingestion ends, ${d.rulesLost.length} of ` +
      `${d.rulesLost.length + d.rulesSurviving} coverage rules stop firing.`,
    `Technique coverage goes from ${d.coverageBefore} to ${d.coverageAfter}.`,
  ]

  if (d.techniquesGoingDark.length === 0) {
    lines.push('No technique loses its last remaining rule.')
  } else {
    lines.push(
      `${d.techniquesGoingDark.length} technique(s) lose their last rule: ` +
        d.techniquesGoingDark.map((t) => `${t.attackId} ${t.name}`).join('; ') +
        '.',
    )
  }

  if (d.newlySoleSourced.length) {
    lines.push(
      `${d.newlySoleSourced.length} surviving technique(s) drop to a single rule: ` +
        d.newlySoleSourced.map((t) => `${t.attackId} (only ${t.nowCoveredOnlyBy})`).join('; ') +
        '.',
    )
  }

  for (const p of d.parentTechniquesStructurallyDark) {
    lines.push(
      `Inference, not a direct loss: ${p.parentAttackId} ${p.parentName} had no coverage of ` +
        `its own and every covered sub-technique (${p.subTechniquesLost.join(', ')}) goes dark, ` +
        `so the branch is unwatched.`,
    )
  }

  for (const w of d.warnings) lines.push(`Warning: ${w}`)

  return lines.join('\n')
}

/**
 * Turn what Sanity Context actually returns into the shape the arithmetic wants.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * A GROQ projection like `techniques[]->attackId` evaluates locally, under
 * groq-js, to an array of strings:
 *
 *     ["T1110", "T1556"]
 *
 * The same projection sent through Context's `groq_query` tool comes back as an
 * array of objects:
 *
 *     [{"attackId": "T1110"}, {"attackId": "T1556"}]
 *
 * Context rewrites projections — a result carries an `_id` nobody asked for —
 * and a side effect of that rewriting is that dereferenced scalar fields arrive
 * wrapped. Nested paths are left alone, which is why
 * `dataSources[]->connector->slug.current` returns plain strings from the same
 * query while `techniques[]->attackId` does not.
 *
 * WHY IT MATTERED SO MUCH
 * -----------------------
 * The wrapped values were used as Map keys. Object keys are compared by
 * reference, so every lookup missed, every technique fell through the
 * "not in the snapshot" branch, and `coverage_delta` reported that losing a
 * connector took nine rules and left no technique uncovered. Silent, plausible,
 * and wrong in the direction that reads as good news.
 *
 * It survived the unit tests because they run against a local fixture through
 * groq-js, which returns the unwrapped shape. The tests were exercising a shape
 * production never produces. Only comparing the two implementations against the
 * live dataset exposed it.
 *
 * SO THIS LAYER IS DELIBERATELY TOLERANT AND DELIBERATELY LOUD
 * ------------------------------------------------------------
 * It accepts either shape, because depending on which one a hosted service
 * happens to emit today is what caused the bug. And anything it cannot resolve
 * becomes a reported problem rather than a dropped element, because a quietly
 * shorter list is the failure that cost a day here.
 */

import type {GraphSnapshot, RuleSnapshot} from './coverage-delta.ts'

/** Keys Sanity adds to a projection that are never the value being asked for. */
const META_KEYS = new Set(['_id', '_key', '_type', '_ref', '_weak', '_strengthenOnPublish'])

/**
 * Pull a scalar out of a value that may already be scalar, or may be wrapped.
 *
 * `key` is the field name the query projected. It is tried first; the
 * single-remaining-key fallback exists so that a rename upstream degrades into
 * a correct answer rather than a silent null.
 */
export function scalar(value: unknown, key: string, where: string, problems: string[]): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>

    const direct = obj[key]
    if (typeof direct === 'string') return direct
    if (typeof direct === 'number') return String(direct)

    const remaining = Object.keys(obj).filter((k) => !META_KEYS.has(k))
    if (remaining.length === 1) {
      const only = obj[remaining[0]]
      if (typeof only === 'string') return only
      if (typeof only === 'number') return String(only)
    }
  }

  problems.push(
    `${where}: could not read "${key}" from ${JSON.stringify(value).slice(0, 120)}. ` +
      `This value is used to match documents, so leaving it out would understate the answer.`,
  )
  return null
}

/** The same, for an array projection. */
export function scalarList(
  value: unknown,
  key: string,
  where: string,
  problems: string[],
): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push(`${where}: expected an array for "${key}", got ${typeof value}.`)
    return []
  }

  const out: string[] = []
  for (let i = 0; i < value.length; i++) {
    const item = scalar(value[i], key, `${where}[${i}]`, problems)
    if (item !== null) out.push(item)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The snapshot.
 * ------------------------------------------------------------------ */

function normalizeRule(raw: unknown, where: string, problems: string[]): RuleSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    problems.push(`${where}: not an object.`)
    return null
  }
  const r = raw as Record<string, unknown>

  const ruleId = scalar(r.ruleId, 'ruleId', `${where}.ruleId`, problems)
  if (!ruleId) return null

  return {
    ruleId,
    title: typeof r.title === 'string' ? r.title : '(untitled)',
    status: typeof r.status === 'string' ? r.status : 'draft',
    ruleType: typeof r.ruleType === 'string' ? r.ruleType : undefined,
    fpRate: typeof r.fpRate === 'number' ? r.fpRate : null,
    ownerTeam: typeof r.ownerTeam === 'string' ? r.ownerTeam : null,
    connectors: scalarList(r.connectors, 'current', `${where}.connectors`, problems),
    tables: scalarList(r.tables, 'tableName', `${where}.tables`, problems),
    techniques: scalarList(r.techniques, 'attackId', `${where}.techniques`, problems),
  }
}

/**
 * Convert a raw snapshot response into a GraphSnapshot.
 *
 * Returns the problems alongside rather than throwing, so a caller can decide
 * whether a partially readable snapshot is worth answering from. For this tool
 * the answer is no — see how `coverage_delta` uses it.
 */
export function normalizeSnapshot(raw: unknown): {snapshot: GraphSnapshot; problems: string[]} {
  const problems: string[] = []
  const empty: GraphSnapshot = {rules: [], drafts: [], techniques: [], connectors: [], tables: []}

  if (!raw || typeof raw !== 'object') {
    problems.push('The snapshot query returned no object at all.')
    return {snapshot: empty, problems}
  }
  const s = raw as Record<string, unknown>

  for (const key of ['rules', 'drafts', 'techniques', 'connectors', 'tables']) {
    if (!Array.isArray(s[key])) {
      problems.push(`The snapshot is missing its "${key}" collection.`)
    }
  }

  const rules = (Array.isArray(s.rules) ? s.rules : [])
    .map((r, i) => normalizeRule(r, `rules[${i}]`, problems))
    .filter((r): r is RuleSnapshot => r !== null)

  const drafts = (Array.isArray(s.drafts) ? s.drafts : [])
    .map((r, i) => normalizeRule(r, `drafts[${i}]`, problems))
    .filter((r): r is RuleSnapshot => r !== null)

  const techniques = (Array.isArray(s.techniques) ? s.techniques : []).flatMap((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>
    const attackId = scalar(o.attackId, 'attackId', `techniques[${i}].attackId`, problems)
    if (!attackId) return []
    return [
      {
        attackId,
        name: typeof o.name === 'string' ? o.name : attackId,
        tactics: scalarList(o.tactics, 'tactics', `techniques[${i}].tactics`, problems),
        // A single dereference, so it arrives wrapped in exactly the same way.
        parent: scalar(o.parent, 'attackId', `techniques[${i}].parent`, problems),
      },
    ]
  })

  const connectors = (Array.isArray(s.connectors) ? s.connectors : []).flatMap((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>
    const slug = scalar(o.slug, 'current', `connectors[${i}].slug`, problems)
    if (!slug) return []
    return [
      {
        slug,
        name: typeof o.name === 'string' ? o.name : slug,
        licenseRequired: typeof o.licenseRequired === 'string' ? o.licenseRequired : undefined,
        estimatedGbPerDay: typeof o.estimatedGbPerDay === 'number' ? o.estimatedGbPerDay : null,
      },
    ]
  })

  const tables = (Array.isArray(s.tables) ? s.tables : []).flatMap((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>
    const tableName = scalar(o.tableName, 'tableName', `tables[${i}].tableName`, problems)
    const connector = scalar(o.connector, 'current', `tables[${i}].connector`, problems)
    if (!tableName || !connector) return []
    return [
      {
        tableName,
        connector,
        gbPerDay: typeof o.gbPerDay === 'number' ? o.gbPerDay : null,
        ingestionTier: typeof o.ingestionTier === 'string' ? o.ingestionTier : undefined,
      },
    ]
  })

  return {snapshot: {rules, drafts, techniques, connectors, tables}, problems}
}

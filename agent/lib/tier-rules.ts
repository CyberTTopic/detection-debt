/**
 * Azure Monitor table-plan policy: what a table plan permits, and therefore what
 * a downgrade breaks.
 *
 * This is the single source of truth for that policy. `scripts/kql-features.ts`
 * re-exports from here rather than keeping its own copy, because the import
 * scripts and the agent have to agree: if the importer tags a rule with `join`
 * under one definition and the agent decides what `join` costs under another,
 * the answers stay confident and stop being true.
 *
 * The four blockers, and where each comes from:
 *
 *   1. PLAN. Sentinel scheduled and NRT analytics rules, and Defender XDR custom
 *      detections, require the Analytics plan. This is a hard requirement on the
 *      rule type, independent of how the query is written.
 *
 *   2. QUERY SHAPE. Basic and Auxiliary tables are single-table: `join`, `find`,
 *      `search`, `externaldata`, user-defined functions and cross-workspace or
 *      cross-resource queries are unsupported. `lookup` and `union` do work but
 *      reach at most five Analytics tables.
 *
 *   3. QUERY WINDOW. Basic tables can only be queried over the last 30 days, so
 *      a longer lookback breaks even a query whose shape is legal.
 *
 *   4. ALERTING. Auxiliary tables support no alerts at all, which ends the
 *      conversation before query shape matters.
 *
 * And one blocker that is about the change rather than the rules: a table's plan
 * can be switched at most once per week. That one lives in the graph, on
 * `logTable.planLastChangedOn`, because it is a fact about a specific table on a
 * specific date rather than a policy.
 */

export type KqlFeature =
  | 'join'
  | 'find'
  | 'search'
  | 'externaldata'
  | 'userDefinedFunction'
  | 'crossWorkspace'
  | 'lookup'
  | 'union'
  | 'aggregationOnly'

/** Features unsupported on Basic and Auxiliary table plans. */
export const BLOCKED_ON_LOW_TIERS: KqlFeature[] = [
  'join',
  'find',
  'search',
  'externaldata',
  'userDefinedFunction',
  'crossWorkspace',
]

/** Rule types that require the Analytics plan regardless of query shape. */
export const ANALYTICS_ONLY_RULE_TYPES = ['scheduled', 'nrt', 'customDetection']

/** Basic tables can only be queried over this window. */
export const BASIC_QUERY_WINDOW_DAYS = 30

export interface RuleForTierCheck {
  ruleType: string
  kqlFeatures?: KqlFeature[]
  lookbackDays?: number
}

/**
 * Why a rule would break if its table moved to a lower plan.
 *
 * Returns one human-readable reason per independent blocker, so a rule with
 * three separate problems reports three and a reviewer can see that fixing the
 * query alone would not be enough. An empty array means nothing here prevents
 * the downgrade — which is not the same as it being a good idea.
 */
export function downgradeBlockers(
  rule: RuleForTierCheck,
  targetTier: 'basic' | 'auxiliary',
): string[] {
  const reasons: string[] = []

  if (targetTier === 'auxiliary') {
    reasons.push('Alerts stop working entirely on an Auxiliary table.')
  }

  if (ANALYTICS_ONLY_RULE_TYPES.includes(rule.ruleType)) {
    reasons.push(
      `A ${rule.ruleType} rule can only query tables on the Analytics plan; rule creation will not proceed otherwise.`,
    )
  }

  const blocked = (rule.kqlFeatures ?? []).filter((f) => BLOCKED_ON_LOW_TIERS.includes(f))
  if (blocked.length) {
    reasons.push(
      `Query uses ${blocked.join(', ')}, which ${targetTier} tables do not support (single-table queries only).`,
    )
  }

  if (targetTier === 'basic' && (rule.lookbackDays ?? 0) > BASIC_QUERY_WINDOW_DAYS) {
    reasons.push(
      `Lookback is ${rule.lookbackDays} days; Basic tables can only be queried over the last ${BASIC_QUERY_WINDOW_DAYS} days.`,
    )
  }

  return reasons
}

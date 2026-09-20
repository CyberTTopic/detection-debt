/**
 * Derive a rule's KQL dependencies from its query text.
 *
 * Hand-tagging forty rules with the constructs they use is forty chances to get
 * it wrong, and the tags are what the downgrade question depends on. So they are
 * derived from the query instead.
 *
 * Two things this is careful about:
 *
 *   1. Strings and comments are stripped first. A rule whose filter looks for the
 *      literal text "join" in a command line must not be tagged as using the join
 *      operator, and `// join is not allowed here` must not count either.
 *
 *   2. Operators are matched only where KQL actually allows them — after a pipe,
 *      or at the start of the query for `find`/`search`/`externaldata`. Matching
 *      bare words tags every rule that happens to contain the substring.
 *
 * This is deliberately conservative: it under-tags rather than over-tags, and
 * `detectionRule.kqlFeatures` is editable in the Studio for the cases it misses.
 */

/**
 * The tier policy lives in `agent/lib/tier-rules.ts` and is re-exported here.
 *
 * It used to be defined in this file, which meant the import scripts and the
 * agent each carried their own copy of "what a Basic table cannot do". Two
 * copies of a rule that has to match is one copy too many: the importer decides
 * which rules get tagged `join`, the agent decides what being tagged `join`
 * costs, and if those drift the answers stay confident and stop being true.
 *
 * So there is one definition, and this is the alias.
 */
export type {KqlFeature, RuleForTierCheck} from '../agent/lib/tier-rules.ts'
export {
  BLOCKED_ON_LOW_TIERS,
  ANALYTICS_ONLY_RULE_TYPES,
  BASIC_QUERY_WINDOW_DAYS,
  downgradeBlockers,
} from '../agent/lib/tier-rules.ts'

import type {KqlFeature} from '../agent/lib/tier-rules.ts'

/** Remove line comments, block comments and string literals. */
export function stripNoise(kql: string): string {
  return kql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

export function detectKqlFeatures(kql: string): KqlFeature[] {
  const q = stripNoise(kql)
  const found = new Set<KqlFeature>()

  // Piped operators: `| join`, `| lookup`, `| union` (union also starts a query).
  if (/\|\s*join\b/i.test(q)) found.add('join')
  if (/\|\s*lookup\b/i.test(q)) found.add('lookup')
  if (/(^|\|)\s*union\b/im.test(q)) found.add('union')

  // Query-leading operators.
  if (/(^|\|)\s*find\b/im.test(q)) found.add('find')
  if (/(^|\|)\s*search\b/im.test(q)) found.add('search')
  if (/\bexternaldata\s*\(/i.test(q)) found.add('externaldata')

  // `let f = (x:type) { ... }` is a user-defined function. A `let` binding a
  // plain scalar or table is not, so the parameter list is what we look for.
  if (/\blet\s+\w+\s*=\s*\([^)]*:[^)]*\)\s*\{/i.test(q)) found.add('userDefinedFunction')

  // Cross-workspace and cross-resource references.
  if (/\b(workspace|app|cluster)\s*\(/i.test(q)) found.add('crossWorkspace')

  if (found.size === 0 && /\|\s*summarize\b/i.test(q)) found.add('aggregationOnly')

  return [...found]
}

/** Table names referenced by the query, limited to the ones we model. */
export function detectTables(kql: string, knownTables: string[]): string[] {
  const q = stripNoise(kql)
  return knownTables.filter((t) => new RegExp(`\\b${t}\\b`).test(q))
}


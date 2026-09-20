/**
 * Shared option lists.
 *
 * These live in one file because Sanity Context's `schema_explorer` tool surfaces
 * the allowed values of a string field to the agent. A field with a closed list is
 * a field the agent can filter on correctly without guessing at spelling; a free
 * text field is one it will get wrong.
 */

/** Microsoft Sentinel analytics rule types. NRT is a restricted subset of scheduled. */
export const RULE_TYPES = [
  {title: 'Scheduled', value: 'scheduled'},
  {title: 'Near-real-time (NRT)', value: 'nrt'},
  {title: 'Microsoft security (vendor-managed)', value: 'microsoftSecurity'},
  {title: 'Fusion (multistage attack detection)', value: 'fusion'},
  {title: 'Anomaly', value: 'anomaly'},
  {title: 'Threat intelligence match', value: 'threatIntel'},
  {title: 'Custom detection (Defender XDR)', value: 'customDetection'},
] as const

/** Where a rule is in its lifecycle. Drives the coverage-gap arithmetic. */
export const RULE_STATUSES = [
  {title: 'Draft — written, never run', value: 'draft'},
  {title: 'Validated — fired on known-true telemetry', value: 'validated'},
  {title: 'Tuned — validated, then adjusted for false positives', value: 'tuned'},
  {title: 'Retired — superseded or switched off', value: 'retired'},
] as const

/**
 * Azure Monitor table plans. The plan decides what can query the table at all,
 * so this field is load-bearing for the "what breaks if I downgrade" question.
 */
export const INGESTION_TIERS = [
  {title: 'Analytics — full KQL, alerts, analytics rules', value: 'analytics'},
  {title: 'Basic — single-table KQL, simple log alerts only, 30-day query window', value: 'basic'},
  {title: 'Auxiliary / Lake — no alerts at all, unoptimized queries', value: 'auxiliary'},
] as const

/**
 * KQL features a rule's query depends on.
 *
 * This is the field that makes the downgrade question answerable. Basic and
 * Auxiliary tables are limited to a single table: join, find, search and
 * externaldata are unsupported, user-defined functions are unsupported, and
 * cross-workspace and cross-resource queries are unsupported. lookup and union
 * work but reach at most five Analytics tables.
 *
 * A rule tagged `join` cannot run against a Basic table. That is a fact about
 * the query, not an opinion, and it belongs in the data rather than in prose an
 * agent has to interpret.
 */
export const KQL_FEATURES = [
  {title: 'join — blocked on basic/auxiliary', value: 'join'},
  {title: 'find — blocked on basic/auxiliary', value: 'find'},
  {title: 'search — blocked on basic/auxiliary', value: 'search'},
  {title: 'externaldata — blocked on basic/auxiliary', value: 'externaldata'},
  {title: 'user-defined function — blocked on basic/auxiliary', value: 'userDefinedFunction'},
  {title: 'cross-workspace / cross-resource — blocked on basic/auxiliary', value: 'crossWorkspace'},
  {title: 'lookup — allowed, max 5 Analytics tables', value: 'lookup'},
  {title: 'union — allowed, max 5 Analytics tables', value: 'union'},
  {title: 'summarize / aggregation only — safe on any tier', value: 'aggregationOnly'},
] as const

/** MITRE ATT&CK Enterprise tactics, by their real TA identifiers. */
export const ATTACK_TACTICS = [
  {title: 'Reconnaissance (TA0043)', value: 'TA0043'},
  {title: 'Resource Development (TA0042)', value: 'TA0042'},
  {title: 'Initial Access (TA0001)', value: 'TA0001'},
  {title: 'Execution (TA0002)', value: 'TA0002'},
  {title: 'Persistence (TA0003)', value: 'TA0003'},
  {title: 'Privilege Escalation (TA0004)', value: 'TA0004'},
  {title: 'Defense Evasion (TA0005)', value: 'TA0005'},
  {title: 'Credential Access (TA0006)', value: 'TA0006'},
  {title: 'Discovery (TA0007)', value: 'TA0007'},
  {title: 'Lateral Movement (TA0008)', value: 'TA0008'},
  {title: 'Collection (TA0009)', value: 'TA0009'},
  {title: 'Command and Control (TA0011)', value: 'TA0011'},
  {title: 'Exfiltration (TA0010)', value: 'TA0010'},
  {title: 'Impact (TA0040)', value: 'TA0040'},
] as const

/**
 * Who says so. The whole point of tracking this is that these authorities
 * disagree with each other, and one of them disagrees with itself.
 */
export const SOURCE_AUTHORITIES = [
  {title: 'CIS Microsoft 365 Foundations Benchmark v7.0.0', value: 'cis-m365-v7'},
  {title: 'CIS Microsoft Azure Foundations Benchmark v6.0.0', value: 'cis-azure-v6'},
  {title: 'Microsoft Cloud Security Benchmark (MCSB)', value: 'mcsb'},
  {title: 'Microsoft Learn product documentation', value: 'microsoft-learn'},
  {title: 'Internal runbook — our decision', value: 'internal-runbook'},
] as const

/** License or SKU a connector needs. Drives the "if we do not renew" question. */
export const LICENSE_REQUIREMENTS = [
  {title: 'Included — no extra license', value: 'included'},
  {title: 'Microsoft Entra ID P1', value: 'entra-p1'},
  {title: 'Microsoft Entra ID P2', value: 'entra-p2'},
  {title: 'Microsoft Defender for Endpoint P2', value: 'mde-p2'},
  {title: 'Microsoft Defender for Identity', value: 'mdi'},
  {title: 'Microsoft Defender for Cloud Apps', value: 'mdca'},
  {title: 'Microsoft 365 E5', value: 'm365-e5'},
  {title: 'Standalone add-on', value: 'addon'},
] as const

export const OWNER_TEAMS = [
  {title: 'SOC — tier 1 triage', value: 'soc-t1'},
  {title: 'SOC — tier 2 investigation', value: 'soc-t2'},
  {title: 'Detection engineering', value: 'detection-eng'},
  {title: 'Identity team', value: 'identity'},
  {title: 'Cloud platform', value: 'cloud-platform'},
  {title: 'Unowned', value: 'unowned'},
] as const

/**
 * The demo questions, as GROQ.
 *
 * This file is the single source of truth for them. It lives under `agent/lib/`
 * so the Next.js app only ever imports downward into its own tree, and
 * `groq/verify.mjs` reads it from here by path — it parses the file as text
 * rather than importing it, so its location is free.
 *
 * These exist to prove the schema supports the questions BEFORE any content is
 * seeded. If a query here cannot be written, the schema is wrong and it is far
 * cheaper to find that out now than after importing 40 rules.
 *
 * They also serve a second purpose: pasted into the Context MCP's Instructions
 * field, they show the agent the query shapes that work, which is the difference
 * between an agent that writes correct GROQ and one that guesses.
 *
 * Coverage convention, applied everywhere: only rules with status `validated` or
 * `tuned` count as coverage. A draft rule is an intention.
 */

export const COVERAGE_STATUSES = ['validated', 'tuned'] as const

/* ------------------------------------------------------------------------- *
 * Q1. If we lose a connector, what dies and what goes dark?
 *
 * The one that justifies the whole project. Walks connector -> logTable ->
 * detectionRule -> technique, then subtracts: a technique only "goes dark" if
 * NO surviving rule still covers it.
 *
 * Note the failure model: a rule dies if ANY of its tables disappears. A rule
 * reading three tables where one is lost does not degrade gracefully, it stops.
 * ------------------------------------------------------------------------- */
export const Q1_CONNECTOR_LOSS = /* groq */ `{
  "connector": *[_type == "connector" && slug.current == $connectorSlug][0]{
    name, licenseRequired, licenseExpiresOn, estimatedGbPerDay
  },

  "tablesLost": *[_type == "logTable" && connector->slug.current == $connectorSlug]
    | order(gbPerDay desc){ tableName, ingestionTier, gbPerDay, retentionDays },

  "rulesLost": *[
    _type == "detectionRule" &&
    status in $coverageStatuses &&
    $connectorSlug in dataSources[]->connector->slug.current
  ] | order(ruleId){
    ruleId, title, ruleType, status, fpRate, ownerTeam,
    "tables": dataSources[]->tableName,
    "techniques": techniques[]->attackId
  },

  "techniquesGoingDark": *[
    _type == "technique" &&
    _id in *[
      _type == "detectionRule" &&
      status in $coverageStatuses &&
      $connectorSlug in dataSources[]->connector->slug.current
    ].techniques[]._ref &&
    !(_id in *[
      _type == "detectionRule" &&
      status in $coverageStatuses &&
      !($connectorSlug in dataSources[]->connector->slug.current)
    ].techniques[]._ref)
  ] | order(attackId){
    attackId, name, tactics, dataComponents,
    "parent": parentTechnique->attackId
  },

  "techniquesStillCovered": *[
    _type == "technique" &&
    _id in *[
      _type == "detectionRule" &&
      status in $coverageStatuses &&
      $connectorSlug in dataSources[]->connector->slug.current
    ].techniques[]._ref &&
    _id in *[
      _type == "detectionRule" &&
      status in $coverageStatuses &&
      !($connectorSlug in dataSources[]->connector->slug.current)
    ].techniques[]._ref
  ] | order(attackId){ attackId, name },

  "compensatingControls": *[
    _type == "baselineControl" &&
    enforced == true &&
    count(mitigatesTechniques[@._ref in *[
      _type == "detectionRule" &&
      status in $coverageStatuses &&
      $connectorSlug in dataSources[]->connector->slug.current
    ].techniques[]._ref]) > 0
  ]{ controlId, title, sourceAuthority, recommendedValue }
}`

/* ------------------------------------------------------------------------- *
 * Q2. Which techniques in a tactic has nothing real covering them?
 *
 * The query a keyword search structurally cannot answer: it asks for absence.
 * Semantic retrieval returns the rules that exist; it never returns the gap.
 * ------------------------------------------------------------------------- */
export const Q2_UNCOVERED_TECHNIQUES = /* groq */ `{
  "tactic": $tactic,

  "uncovered": *[
    _type == "technique" &&
    $tactic in tactics &&
    !(_id in *[_type == "detectionRule" && status in $coverageStatuses].techniques[]._ref)
  ] | order(attackId){
    attackId, name, dataComponents,
    "parent": parentTechnique->attackId,
    "draftRulesThatWouldCover": *[
      _type == "detectionRule" && status == "draft" && references(^._id)
    ]{ ruleId, title, status },
    "preventedByControl": *[
      _type == "baselineControl" && enforced == true && references(^._id)
    ]{ controlId, title, sourceAuthority }
  },

  "covered": count(*[
    _type == "technique" &&
    $tactic in tactics &&
    _id in *[_type == "detectionRule" && status in $coverageStatuses].techniques[]._ref
  ]),

  "total": count(*[_type == "technique" && $tactic in tactics])
}`

/* ------------------------------------------------------------------------- *
 * Q3. Can I downgrade this table to Basic, and what breaks?
 *
 * Returns facts, not a verdict. The verdict is computed by the deterministic
 * coverageDelta tool, because "does a scheduled rule using join survive a move
 * to Basic" is a rule lookup, not a judgement call, and a model should not be
 * doing the lookup from memory.
 *
 * The three independent blockers this surfaces:
 *   1. Sentinel analytics rules and Defender custom detections require Analytics.
 *   2. Basic and Auxiliary are single-table: join / find / search / externaldata /
 *      user-defined functions / cross-workspace are unsupported.
 *   3. Basic can only be queried over the last 30 days.
 * Plus a fourth that has nothing to do with rules: one plan change per table per week.
 * ------------------------------------------------------------------------- */
export const Q3_DOWNGRADE_IMPACT = /* groq */ `*[_type == "logTable" && tableName == $tableName][0]{
  tableName, ingestionTier, supportsBasicPlan, planLastChangedOn, gbPerDay, retentionDays,
  "connector": connector->{name, licenseRequired, enabled},

  "planChangeAvailable": !defined(planLastChangedOn) ||
    dateTime(planLastChangedOn + "T00:00:00Z") < dateTime(now()) - 604800,

  "rulesReadingThisTable": *[_type == "detectionRule" && references(^._id)] | order(ruleId){
    ruleId, title, ruleType, status, lookbackDays, kqlFeatures, ownerTeam,
    "tableCount": count(dataSources),
    "isSinglePointOfFailure": count(dataSources) == 1,
    "techniques": techniques[]->attackId
  }
}`

/* ------------------------------------------------------------------------- *
 * Q4. Which rules are a single point of failure?
 *
 * Cardinality over an array of references. One line of GROQ, and no amount of
 * prose search substitutes for it.
 * ------------------------------------------------------------------------- */
export const Q4_SINGLE_POINT_OF_FAILURE = /* groq */ `*[
  _type == "detectionRule" &&
  status in $coverageStatuses &&
  count(dataSources) == 1
] | order(ruleId){
  ruleId, title, ruleType, fpRate, ownerTeam,
  "table": dataSources[0]->tableName,
  "tier": dataSources[0]->ingestionTier,
  "connector": dataSources[0]->connector->name,
  "connectorEnabled": dataSources[0]->connector->enabled,
  "licenseRequired": dataSources[0]->connector->licenseRequired,
  "techniques": techniques[]->attackId,
  "soleCoverageFor": techniques[@._ref in *[
    _type == "technique" &&
    count(*[_type == "detectionRule" && status in $coverageStatuses && references(^._id)]) == 1
  ]._id]->attackId
}`

/* ------------------------------------------------------------------------- *
 * Q5. I have several rules for one technique. Which do I deploy first?
 *
 * Both endpoints in one answer: the graph ranks the candidates on fpRate and
 * staleness, and the tuningDecision documents attached here are the same prose
 * the Knowledge Base indexes, so the agent can explain the ranking rather than
 * just assert it.
 * ------------------------------------------------------------------------- */
export const Q5_COMPETING_RULES = /* groq */ `*[
  _type == "detectionRule" &&
  $attackId in techniques[]->attackId &&
  status != "retired"
] | order(fpRate asc, lastValidated desc){
  ruleId, title, ruleType, status, fpRate, lastValidated, ownerTeam, lookbackDays,
  "tables": dataSources[]->{tableName, ingestionTier, "connector": connector->name},
  "decisions": *[_type == "tuningDecision" && rule._ref == ^._id]
    | order(decidedOn desc){
      title, decidedOn, decidedBy, contradictsGuidance,
      "controls": relatedControls[]->{controlId, sourceAuthority, recommendedValue}
    },
  "supersededBy": supersededBy->{ruleId, title, status}
}`

/* ------------------------------------------------------------------------- *
 * Q6. Which of our baseline controls have contested guidance?
 *
 * The conflictsWith self-reference, read back. This is the graph half of the
 * contradiction story: it lists which settings are disputed and by whom. The
 * Knowledge Base half explains which claim we accepted and why.
 *
 * Seeded truth: CIS Microsoft 365 v7.0.0 section 1.1.2 asks for a 16-character
 * break-glass password while MCSB PA-5 asks for 32, and CIS 5.2.2.4 caps admin
 * reauthentication at 4 hours where Microsoft's own example policy uses 1 hour
 * against a documented default of a 90-day rolling window.
 * ------------------------------------------------------------------------- */
export const Q6_CONTESTED_SETTINGS = /* groq */ `{
  "contestedSettings": array::unique(
    *[_type == "baselineControl" && count(conflictsWith) > 0].setting
  ),
  "settingCount": count(array::unique(
    *[_type == "baselineControl" && count(conflictsWith) > 0].setting
  ))
}`

/**
 * Q6b. The claims for one contested setting, side by side.
 *
 * Found by testing: because `conflictsWith` is populated in both directions —
 * which it has to be, so a control reads as contested no matter which side you
 * arrive from — querying controls directly returns every conflict twice, once
 * per side. An agent handed that duplicates the disagreement in its answer.
 *
 * So the pair is split into summary and detail: Q6 lists which settings are
 * contested, Q6b expands one. That is also the better shape for an agent, since
 * the first response stays small and the second is fetched only when needed.
 */
export const Q6B_CLAIMS_FOR_SETTING = /* groq */ `{
  "setting": $setting,
  "claims": *[_type == "baselineControl" && setting == $setting]
    | order(sourceAuthority){
      controlId, title, sourceAuthority, sourceLocation, recommendedValue, enforced, notes,
      "mitigates": mitigatesTechniques[]->attackId,
      "compensatedBy": compensatingRules[]->{ruleId, title, status, fpRate}
    },
  "ourDecisions": *[
    _type == "tuningDecision" &&
    count(relatedControls[@->setting == $setting]) > 0
  ] | order(decidedOn desc){
    title, decidedOn, decidedBy, contradictsGuidance,
    "rule": rule->{ruleId, title}
  }
}`

/* ------------------------------------------------------------------------- *
 * SNAPSHOT. One query, the whole graph, flattened for the deterministic tool.
 *
 * Everything above answers a question. This one answers none: it is raw input to
 * `coverage-delta.ts`, which does the arithmetic in TypeScript.
 *
 * Why fetch the lot rather than ask a narrower question? Because the questions
 * worth asking are about several connectors at once, and about absence. GROQ can
 * express "what does losing connector X cost" — Q1 does, and does it well — but
 * losing X *and* Y is not the union of losing X and losing Y: a technique held up
 * by one rule from each survives either loss alone and goes dark when both go.
 * Expressing that for an arbitrary set of connectors inside one query means
 * generating GROQ, and generated GROQ is untestable. Fetching a small graph once
 * and doing set algebra in code that has unit tests is the better trade.
 *
 * "Small" is load-bearing: roughly 40 rules, 147 techniques, 18 tables and 8
 * connectors, with no prose fields selected. Descriptions and KQL bodies are
 * deliberately left out — they are the bulk of the dataset and none of the
 * arithmetic. This does not scale to a real enterprise workspace, and at that
 * size the answer would be a projection per connector-set rather than a
 * whole-graph fetch. It is honest about being sized for this dataset.
 *
 * Note also what this buys in context: the model never sees any of it. The tool
 * returns only what changed, which for a typical connector is a dozen lines.
 * ------------------------------------------------------------------------- */
export const SNAPSHOT_FOR_DELTA = /* groq */ `{
  "rules": *[_type == "detectionRule" && status in $coverageStatuses]{
    ruleId, title, status, ruleType, fpRate, ownerTeam,
    "connectors": array::unique(dataSources[]->connector->slug.current),
    "tables": dataSources[]->tableName,
    "techniques": techniques[]->attackId
  },

  "drafts": *[_type == "detectionRule" && status == "draft"]{
    ruleId, title, status,
    "connectors": array::unique(dataSources[]->connector->slug.current),
    "tables": dataSources[]->tableName,
    "techniques": techniques[]->attackId
  },

  "techniques": *[_type == "technique"]{
    attackId, name, tactics,
    "parent": parentTechnique->attackId
  },

  "connectors": *[_type == "connector"]{
    "slug": slug.current, name, licenseRequired, enabled, estimatedGbPerDay
  },

  "tables": *[_type == "logTable"]{
    tableName, gbPerDay, ingestionTier, retentionDays,
    "connector": connector->slug.current
  }
}`

/* ------------------------------------------------------------------------- *
 * Parameter shapes, so the agent is not guessing at names.
 * ------------------------------------------------------------------------- */
export const QUERY_PARAMS = {
  Q1_CONNECTOR_LOSS: {connectorSlug: 'defender-for-identity', coverageStatuses: COVERAGE_STATUSES},
  Q2_UNCOVERED_TECHNIQUES: {tactic: 'TA0006', coverageStatuses: COVERAGE_STATUSES},
  Q3_DOWNGRADE_IMPACT: {tableName: 'SigninLogs'},
  Q4_SINGLE_POINT_OF_FAILURE: {coverageStatuses: COVERAGE_STATUSES},
  Q5_COMPETING_RULES: {attackId: 'T1078.004'},
  Q6_CONTESTED_SETTINGS: {},
  Q6B_CLAIMS_FOR_SETTING: {setting: 'breakglass-password-length'},
  SNAPSHOT_FOR_DELTA: {coverageStatuses: COVERAGE_STATUSES},
} as const

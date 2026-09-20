# Schema design notes

Raw material for the "How I Used Sanity" section of the submission. Every claim
here is something the schema does, not something it aspires to.

## The principle

One rule decided the whole model: **if a fact is an entity, it is a reference.**

The tempting version of this schema has `detectionRule.dataSources` as a comma-separated
string and `detectionRule.techniques` as an array of strings. It would look almost
identical in the Studio and it would be worthless, because the only interesting
questions are traversals. `"SigninLogs, IdentityLogonEvents"` cannot tell you which
connector provides which table, or what happens when one of them goes away.

So the graph is:

```
connector ──< logTable ──< detectionRule >── technique
                                │                │
                                │                │
              tuningDecision ───┘                │
                                                 │
              baselineControl >──────────────────┘
                     │
                     └──< conflictsWith (self)
```

## Field descriptions are agent-facing documentation

This is the thing I did not expect going in.

Sanity Context's `schema_explorer` tool and its `initial_context` both serve a
compressed view of the deployed schema to the agent. That view includes the
`description` on every field. So a field description is not a note for the next
developer — it is the instruction the agent reads before it writes GROQ.

Compare:

```ts
// Useless to the agent
defineField({name: 'ingestionTier', type: 'string'})

// The agent now knows why it matters
defineField({
  name: 'ingestionTier',
  type: 'string',
  description:
    'Analytics supports full KQL, alerts and Sentinel analytics rules. Basic is ' +
    'limited to a single table, supports only simple log alerts, and can be ' +
    'queried over the last 30 days. Auxiliary/Lake supports no alerts at all.',
})
```

Same field, same data. The second one produces an agent that stops asking me
whether a rule survives a downgrade, because the constraint is in the schema it
already read.

Same reasoning drove every option list into `constants.ts` with a closed `options.list`.
A closed list is a field the agent can filter on without guessing at spelling.
A free-text field is one it gets wrong.

## Three fields that carry more weight than they look like

### `detectionRule.kqlFeatures`

The non-obvious one, and the reason the downgrade question has a real answer.

Basic and Auxiliary tables are single-table: `join`, `find`, `search`,
`externaldata`, user-defined functions and cross-workspace queries are unsupported;
`lookup` and `union` work but reach at most five Analytics tables. So a scheduled
rule whose query joins **provably cannot run** against a downgraded table.

Tagging each rule with the constructs its query depends on turns
"will this break?" from a judgement call into a lookup. Combined with `ruleType`
(analytics rules require the Analytics plan) and `lookbackDays` (Basic only
answers over the last 30 days), one table can have three independent reasons a
downgrade is refused, and the agent can name all three.

### `logTable.planLastChangedOn`

Table plan updates are limited to one switch per table per week. If this date is
inside the last seven days, the change is refused — full stop, regardless of what
it would save. That is a complete answer, and it is the kind of answer that only
exists because a date is stored next to the plan.

The verification run proves it: `AADNonInteractiveUserSignInLogs`, changed three
days before the test date, returns `planChangeAvailable: false`.

### `baselineControl.conflictsWith`

A self-reference between two controls that govern the same `setting` with
different `recommendedValue`s. This models the disagreement **in the structured
data**, alongside the Knowledge Base's own conflict detection.

The split is deliberate. The graph answers *which settings are disputed and by
whom* — cheap, exact, complete. The Knowledge Base answers *which claim we
accepted and why* — prose, with citations. Two endpoints, two jobs, one answer.

Both conflicts seeded into the fixture are real and verified against the source
documents on 19 September 2026:

| Setting | CIS Microsoft 365 v7.0.0 | The other authority |
|---|---|---|
| `breakglass-password-length` | § 1.1.2 — at least 16 characters | MCSB PA-5 — at least 32 characters |
| `admin-signin-frequency` | § 5.2.2.4 — 4 hours or less, never persistent | Microsoft Learn — lean on SSO and managed devices; default is a 90-day rolling window |

CIS § 1.1.2 also contradicts itself: the remediation steps have you exclude a
break-glass account from all Conditional Access and rely on a long password, while
a Warning on the same page notes that MFA has been required for all users
including break-glass accounts since 10/15/2024. Nobody rewrote the steps.

## `technique.parentTechnique`, and why coverage lies without it

Coverage of `T1078.004` (Cloud Accounts) is not coverage of `T1078` (Valid Accounts).
An agent that flattens the ATT&CK hierarchy overstates coverage, which is the one
failure mode this project exists to prevent. The self-reference is filtered so only
top-level techniques are valid parents and a technique cannot be its own parent —
ATT&CK has no sub-sub-techniques.

## The failure model, stated once

A rule dies if **any** of its tables disappears. A rule reading three tables where
one is lost does not degrade gracefully, it stops. Every coverage query applies
this, and the verification run demonstrates it: `DET-0003` reads two tables, loses
one with Defender for Identity, and `T1110` goes dark as a result even though the
other table is untouched.

Second convention: **a draft rule is not coverage.** Every coverage query filters
to `validated` and `tuned`. A draft rule is an intention, and counting intentions
is how a coverage map starts lying.

## What testing changed

The queries were written and then run against a fixture with `groq-js` before any
real content was imported. Two findings:

1. **`conflictsWith` returned every conflict twice** — once from each side. It has
   to be bidirectional, so a control reads as contested no matter which side you
   arrive from. Handing that to an agent duplicates the disagreement in its answer.
   Fixed by splitting into a summary query (`Q6` lists contested settings) and a
   detail query (`Q6B` expands one). That is also the better shape for an agent:
   the first response stays small, the second is fetched only when needed.

2. **`soleCoverageFor` needed a case that actually returns something.** The first
   fixture had no technique covered by exactly one single-table rule, so the most
   subtle expression in the file was passing vacuously. Added `DET-0005` and
   confirmed it reports `T1078`.

Finding both of these cost twenty minutes before any content existed. Finding them
after importing forty rules would have cost a day.

## Run the verification

```bash
npm install groq-js
node groq/verify.mjs
```

Parses all seven queries and evaluates them against `groq/fixture.mjs`.
No Sanity project required — the fixture is a plain array of documents.

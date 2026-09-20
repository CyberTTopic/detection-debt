# Detection Debt

An agent that answers the question a SOC cannot look up: **if this connector goes
away, which detections die and which ATT&CK techniques stop being watched?**

There is no document with that answer in it. It only exists by walking
`connector → logTable → detectionRule → technique` and subtracting sets. That is
the whole argument for structured content, and it is why this is built on Sanity
rather than on a document search.

Submission for the [Sanity Challenge, Path One](https://dev.to/challenges/sanity-2026-09-16).

---

## Project

| | |
|---|---|
| Project ID | `6qz0b6rp` |
| Dataset | `production` |
| Studio | https://detection-debt.sanity.studio |
| Organization ID | `okh17tblt` |

The Studio is public and navigable: open a detection rule and its tables and
techniques are links you can follow. That is the content model, and it is more
convincing than a project ID.

## Status

| Piece | State |
|---|---|
| Schema — 6 document types | deployed |
| Content imported | 8 connectors, 18 tables, 186 techniques, 40 rules, 8 controls |
| GROQ — 8 queries | 25 assertions against a fixture |
| Knowledge Base | 26 entries, 2 conflicts resolved |
| Context MCP — GROQ mode | live |
| Context MCP — Knowledge Base mode | live |
| Agent — 11 tools, 2 endpoints, 1 router | live |
| Unit tests | 122 assertions, no credentials needed |
| Live tool checks | 27 against the real dataset |

## What it answers

Three questions, run against the live dataset. None of them can be retrieved;
each has to be computed.

### 1. What goes dark

> *If we do not renew Defender for Endpoint, which ATT&CK techniques stop being
> watched?*

4 tables stop. 120 GB/day of ingestion ends. 4 rules stop firing. Two techniques
lose their last remaining rule:

| | | |
|---|---|---|
| `T1003` | OS Credential Dumping | was held up by DET-0020 |
| `T1566` | Phishing | was held up by DET-0034 |

`T1078` and `T1136` survive on other rules — and `T1136` now rests on `DET-0006`
alone, which nobody asked about and which is the next thing to break.

The arithmetic is done in code, then **cross-checked against an independent GROQ
query running inside Sanity**. Two implementations of the same set difference,
compared at answer time. When they disagree the tool says so instead of picking
one.

### 2. What nothing is watching

> *Which Credential Access techniques have nothing validated covering them?*

**63 of 67.** This is a question about absence, and absence is what retrieval
structurally cannot return — a keyword search over detection rules returns the
rules that exist, never the gap.

Two more from the same shape of query:

- **16 of 31 coverage rules read exactly one table.** Over half the detection
  estate is a single point of failure. That is a fact about architecture, not
  about any individual rule.
- **23 GB/day of telemetry that no rule reads.** Defender for Identity and
  Defender for Cloud Apps feed four tables on the Analytics plan, and no rule —
  validated, tuned, draft or retired — queries any of them. Nobody designed that
  and nobody would find it by reading rules one at a time.

### 3. Where the sources disagree

> *How long should the break-glass account password be?*

Both answers, with page citations, and the disagreement stated rather than
resolved:

| Authority | Location | Claim |
|---|---|---|
| CIS Microsoft 365 Foundations v7.0.0 | § 1.1.2, pp. 24–26 | at least 16 characters |
| Microsoft Cloud Security Benchmark | Privileged Access, PA-5 | at least 32 characters |

This question uses **both** Context endpoints in one turn: the graph for the
competing claims, the knowledge base for the reasoning around them. And it is the
clearest result in the project, because the knowledge base entry on emergency
access **does not mention the conflict at all**. The graph returns it in a single
query, from one self-reference on `baselineControl.conflictsWith`.

Same corpus, two mechanisms, opposite outcomes. Modelling a disagreement as a
reference between documents makes it queryable; leaving it in prose leaves it at
the mercy of how the text was split across entries.

## Architecture

A Context MCP endpoint serves one retrieval mode, and the mode decides which
tools it exposes. Two modes are needed, so there are two endpoints and a router
in the system prompt.

```
                      ┌──────────────────────────────┐
  the graph  ────────▶│  Context MCP — GROQ mode     │  what depends on what,
  (live dataset)      │  groq_query, schema_explorer │  how many, what is absent
                      └──────────────────────────────┘
                                    ▲
    question ──▶ router ────────────┤
                                    ▼
                      ┌──────────────────────────────┐
  the docs   ────────▶│  Context MCP — KB mode       │  what a source says,
  (CIS, MS Learn)     │  knowledge_base_read         │  why we decided it
                      └──────────────────────────────┘
```

The router is in the prompt, not in code, and the agent has to name the endpoint
it used. A wrong route does not fail — it produces a confident answer from the
wrong kind of source, which is worse.

**11 tools.** Seven wrap the GROQ queries that have assertions behind them, so the
model picks a question rather than rewriting a tested set difference and getting
it subtly wrong. `graph_query` remains as an escape hatch for everything
unanticipated — that is the point of a queryable graph rather than a fixed
report. Two more read the knowledge base, one reads the schema.

**`coverage_delta` is deterministic.** It fetches the graph once, does the set
algebra in TypeScript, and returns only what changed — the 186 techniques never
enter the model's context. It takes a *list* of connectors, because losing two at
once is not the union of losing each alone: a technique held up by one rule from
each survives either loss and goes dark when both go. It also reports what nobody
asks for: techniques that survive but drop to a single rule, and parent techniques
whose every covered sub-technique dies, labelled as an inference rather than a
direct loss.

**The interface shows every call.** Which tool, which endpoint, which arguments.
An answer about what is missing from a security estate is worth exactly as much
as the reader's ability to check it.

## Running it

```bash
# The Studio and the import scripts
npm install
cp .env.example .env.local   # then fill it in

# The agent
cd agent && npm install
npm run dev                  # http://localhost:3000
```

The agent reads `.env.local` from the repository root rather than keeping its own
copy, so the live tokens exist in exactly one place.

### Two tokens, and they are not interchangeable

- **Organization-level token, Context Viewer role** — what the agent reads
  through. A *project* token returns `403 contextGrantRequired`, which looks like
  a permissions problem and is a wrong-token problem.
- **Project-level token, Editor role** — used only by the import scripts.

### One model provider, whichever you have

Set any one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or
`GOOGLE_GENERATIVE_AI_API_KEY`. `AGENT_PROVIDER` forces a choice when several are
present. The prompt and the tools are identical either way — models differ in how
well they follow the same instructions, and the honest way to find that out is to
send them the same text.

Google's key needs no billing account and the default model is free of charge,
which makes it the shortest path for anyone who wants to try this.

## Verifying it

Nothing here needs credentials:

```bash
node groq/verify.mjs                                   # 25 — the GROQ queries, against a fixture
node --experimental-strip-types scripts/kql-features.test.ts   # 10 — KQL feature detection
cd agent && npm test                                   # 112 — delta, shape, provider, transport
```

And against the live dataset, with no model involved:

```bash
cd agent && npm run smoke     # 27 checks: referential integrity, every tool, the cross-check
```

`npm run smoke` exists because unit tests are not enough here. It checks the
things that fail silently: a rule whose tables resolve to no connector, a
sub-technique whose parent was never created, a technique id the arithmetic
cannot match. Every one of those returns a clean-looking answer that is short.

## What is real and what is not

A dataset that quietly mixes measured figures with invented ones is worth less
than one that says which is which.

**Real, verified against the source:**

- Connector and log table names, and the licence each connector requires.
- ATT&CK techniques, tactics, data components and the parent/sub-technique
  hierarchy, from the official STIX bundle.
- Rule titles, KQL, ATT&CK mappings and required connectors, from the public
  Microsoft Sentinel content repository.
- Every `baselineControl`, cited to its page or section.
- Table plan constraints: which rule types require the Analytics plan, which KQL
  operators Basic and Auxiliary forbid, the 30-day Basic query window, and the
  one-plan-change-per-table-per-week limit.
- `supportsBasicPlan` is `true` on exactly two tables, both documented. Elsewhere
  it is `false` with a note saying it was not verified, rather than guessed.

**Synthetic, generated deterministically from a hash of the rule ID so the demo
does not reshuffle between runs:**

- `status`, `fpRate`, `lastValidated` and `ownerTeam` on detection rules.

Those four describe operational history with a rule. No public repository can know
them, and inventing them is the only way to have a dataset at all — so they are
invented openly, and **the agent is instructed to say so whenever one of them
drives an answer**. Ranking rules by a fabricated false-positive rate without
mentioning that it is fabricated is the single most dishonest thing this
application could do.

## The contradictions

The knowledge base half of this project rests on the corpus genuinely disagreeing
with itself. It does.

| Setting | One claim | The other |
|---|---|---|
| Break-glass password length | CIS M365 v7.0.0 § 1.1.2 — at least 16 characters | MCSB PA-5 — at least 32 characters |
| Admin sign-in frequency | CIS M365 v7.0.0 § 5.2.2.4 — 4 hours or less, never persistent | Microsoft Learn — lean on SSO and managed devices; the default is a 90-day rolling window |
| Blocking legacy authentication | CIS § 5.2.2.3 — one Conditional Access policy | Microsoft Learn — four mechanisms, and any source predating Baseline Security Mode is incomplete |

Two more that are not table rows:

**CIS § 1.1.2 contradicts itself.** Its remediation steps have you exclude a
break-glass account from all Conditional Access and rely on a 16-character
password. A Warning at the foot of the same recommendation states that MFA has
been required for all users including break-glass accounts since 10/15/2024, and
advises passkey or certificate-based authentication. The steps were never
rewritten. This is the best artefact in the corpus: the account that exists for
the day everything else fails, documented two incompatible ways on one page.

**Sign-in frequency has three numbers, not two.** CIS says 4 hours, Microsoft's
own example policy for non-compliant devices says 1 hour, and the documented
default is 90 days. The disagreement is substantive rather than numeric:
Microsoft's session-lifetime page warns that frequent reauthentication prompts
hurt productivity and *can make users more vulnerable to attacks*. CIS argues the
opposite direction from the same premise.

## Three things that cost a day each

Written down because they are the parts that were not obvious, and because the
next person to build on Sanity Context will hit at least one of them.

### The same query returns different shapes locally and through Context

`techniques[]->attackId` evaluates under `groq-js` to `["T1110", "T1556"]`. The
same projection through Context's `groq_query` returns
`[{"attackId": "T1110"}, {"attackId": "T1556"}]`. Context rewrites projections —
results carry an `_id` nobody asked for — and dereferenced scalar fields arrive
wrapped. Nested paths are left alone, so `connector->slug.current` comes back as
a plain string from the *same query*.

Those wrapped values were being used as `Map` keys. Object keys compare by
reference, so every lookup missed and `coverage_delta` reported that losing a
connector took nine rules and left no technique uncovered. Silent, plausible, and
wrong in the direction that reads as good news.

Every unit test passed throughout, because they run against a local fixture
through `groq-js` — they were exercising a shape production never emits. What
found it was running the two implementations against the live dataset and
comparing them. `agent/lib/normalize.ts` now accepts both shapes and reports
anything it cannot read; `agent/lib/normalize.test.ts` pins one rule written both
ways and asserts they normalise identically.

### `sanity schema deploy` is not enough for GROQ mode

The Context documentation presents `sanity schema deploy` and `sanity deploy` as
alternatives. They are not. A GROQ-mode endpoint returned HTTP 400 until a Studio
was deployed, and the actual reason was only in the response body:

```
-32004  Only datasets with deployed Studio applications are supported.
        Please deploy a Studio (v5.1.0+) for this project/dataset.
```

Windows PowerShell 5.1 does not surface that body, which is why the status code
was the only thing visible for an hour. `CONTEXT-SETUP.md` has the full account.

### `groq_query` has no parameters

It takes a single `query` string. Every value the agent asks about — a connector
slug, a tactic id, a setting name — has to be written into the query text before
it is sent, which turns a convenience function into the application's security
boundary. Those values are chosen by a language model from text a user typed.
`agent/lib/mcp.ts` serialises them with `JSON.stringify` rather than hand-rolled
quoting, in one pass so that `$setting` cannot be clipped by `$settings`, and
`agent/lib/mcp.test.ts` asserts that seven escape attempts each stay inside their
string literal and leave the query's syntax unchanged.

## Also here

- `SCHEMA-NOTES.md` — why each reference exists and what question it enables,
  including two bugs that testing the queries caught before any content existed.
- `CONTEXT-SETUP.md` — setting up both endpoints, and every wrong turn taken.
- `evidence/` — knowledge base build artefacts, the conflicts it raised and the
  ones it did not, and live runs of the agent and the tools.

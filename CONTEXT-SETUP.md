# Context setup — copy/paste values

State as of 19 Sep 2026: Context enabled for organization `okh17tblt`.
Both MCP Endpoints and Knowledge Bases are available. No separate toggle was
needed — enabling Context in Labs granted both.

---

## Order of operations

Endpoint A (GROQ mode) **cannot be created usefully yet**: a dataset source will
not serve until a schema is deployed, and there is no Studio yet. So:

1. Organisation API token — needed by everything below.
2. Knowledge Base + Endpoint B — can be built **now**, from the two CIS PDFs and
   Microsoft Learn. Builds run asynchronously and conflicts need reviewing, so
   starting this early buys time.
3. Studio scaffold → `sanity schema deploy` → then Endpoint A.

---

## 1. Token

Organisation → **API → Tokens** → new token, permission **Context Viewer**.

Must be created at the **organisation** level. A project-level token returns
`403 contextGrantRequired`, and the error does not say why.

Paste it into `.env.local` as `SANITY_ORGANIZATION_TOKEN`. Nowhere else.

---

## 2. Knowledge Base

**New knowledge base** → name it:

```
Identity hardening and detection guidance
```

### Purpose

Paste this verbatim. The purpose steers the whole build: it shapes the outline,
decides which entries come out tagged `[core]` versus `[peripheral]`, and is read
by the agent at the start of every conversation. The last sentence is doing real
work — it biases the build toward raising conflicts rather than quietly picking a
winner.

```
Serves detection engineers and SOC analysts deciding how to configure, monitor and
detect against Microsoft Entra ID and Microsoft Sentinel. It should explain what
each hardening control actually requires, always name the authority behind a
recommendation, and surface both claims side by side wherever CIS, the Microsoft
Cloud Security Benchmark and Microsoft Learn disagree with each other.
```

### File sources

Upload both PDFs already in this folder's parent (download them again from
cisecurity.org if missing):

- `CIS_Microsoft_365_Foundations_Benchmark_v7.0.0.pdf` — 4 MB, limit is 500 MB
- `CIS_Microsoft_Azure_Foundations_Benchmark_v6.0.0.pdf` — 4.4 MB

Uploaded files never re-sync. To update one you delete the import and upload
again, and deleting an import removes every source it produced.

### Website sources

**Corrected 19 Sep 2026.** The first attempt used directory URLs and blew the plan
limit: `entra/identity/authentication/` alone indexed 157 documents and
`conditional-access/` another 70, against an organisation limit of 150 indexed
documents. A crawl starts from the URL you give it, so a directory means the whole
section.

Individual pages index as 1 document each — `security-emergency-access` proved it.
So every URL below is a leaf page, and each one is a **separate** source. Add them
one at a time; pasting several into one field joins them with `%20` and yields a
single broken source with 0 documents.

**Must have** — these carry the verified contradictions. Without the matching page
the conflict has only one side and the build has nothing to raise:

```
https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access
https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-v2-privileged-access
https://learn.microsoft.com/en-us/entra/identity/authentication/concepts-azure-multi-factor-authentication-prompts-session-lifetime
https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mandatory-multifactor-authentication
https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-session-lifetime
https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-persistent-browser
https://learn.microsoft.com/en-us/microsoft-365/baseline-security-mode/baseline-security-mode-settings
https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-block-legacy-authentication
```

The MCSB page is the one that is easy to miss and most costly to skip: PA-5's
32-character requirement lives there, and it is the other half of CIS 1.1.2's
16 characters.

**Worth adding** — supporting detail, still one document each:

```
https://learn.microsoft.com/en-us/entra/identity/conditional-access/managed-policies
https://learn.microsoft.com/en-us/entra/fundamentals/security-defaults
https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-platform-logs
https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-table-plans
https://learn.microsoft.com/en-us/azure/azure-monitor/logs/basic-logs-query
https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-session-lifetime
```

Budget: 2 PDFs plus 14 leaf pages is roughly 16 of the 150 documents allowed.
Verify each source reports a small document count before building; anything
reporting dozens means a directory slipped through and should be removed.

### Dataset source — add LATER

Skip this on the first build. It needs `tuningDecision` documents, which do not
exist until the import scripts have run. When you add it, the query must select
documents, not just filter — a bare `_type == "tuningDecision"` is rejected:

```groq
*[_type == "tuningDecision"]{
  title, decidedOn, decidedBy, contradictsGuidance, rationale,
  "rule": rule->{ruleId, title, status, fpRate},
  "controls": relatedControls[]->{controlId, sourceAuthority, recommendedValue}
}
```

A Knowledge Base binds **one** dataset. Website and file sources can be added
repeatedly; the dataset cannot be swapped without removing the source first.
It also reads **published documents only**, and matches at most 5,000 documents.

---

## 3. What to expect from the first build

The build reads the sources, builds a topic tree, writes each entry with
citations, and raises **issues** where sources contradict each other.

These five should surface. If none of them do, something is wrong with the
configuration rather than with the corpus — all five were verified by hand
against the sources on 19 Sep 2026:

| Expected issue | The disagreement |
|---|---|
| Break-glass password length | CIS M365 § 1.1.2 says 16 characters; MCSB PA-5 says 32 |
| Break-glass and MFA | CIS § 1.1.2's own remediation steps contradict the Warning on the same page |
| Admin sign-in frequency | CIS § 5.2.2.4 says 4 hours or less; Microsoft Learn says lean on SSO, default 90 days |
| Blocking legacy authentication | CIS § 5.2.2.3 names one mechanism; Microsoft now documents four |
| Log retention | CIS Azure asks 90/180 days; the Analytics default is 30, or 90 for Sentinel |

Resolving an issue produces an **instruction**, which persists across future
builds. Screenshot each conflict as it is presented — with both claims and their
sources visible — before resolving it. Those screenshots are the strongest
material in the submission and they cannot be recreated after the fact.

---

## 4. Endpoint B (Knowledge Base mode)

**New endpoint**, attach the Knowledge Base above. Name it:

```
detection-debt-kb
```

Resulting URL, for `.env.local` as `SANITY_CONTEXT_KB_URL`:

```
https://api.sanity.io/v1/context/organizations/okh17tblt/mcp/detection-debt-kb
```

Tools served in this mode: `initial_context` and `knowledge_base_read`
(up to 20 entry paths per call).

### Instructions field

Optional, but it is where routing behaviour is set without redeploying the agent:

```
Every answer must name the authority behind each claim and cite the entry it came
from. When the knowledge base holds conflicting claims for one setting, present
both with their sources and state which was accepted as ground truth and why —
never silently pick one. Questions about which detections depend on which
telemetry, or about coverage gaps, are not answerable from this knowledge base:
say so and defer to the GROQ endpoint.
```

---

## 5. Endpoint A (GROQ mode) — blocked

Requires a deployed schema from Studio v5.1.0 or later. Create it after
`sanity schema deploy` succeeds. Name it `detection-debt-graph`; the URL goes into
`.env.local` as `SANITY_CONTEXT_GROQ_URL`.

Verify either endpoint with:

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
Invoke-RestMethod -Method Post -Uri $env:SANITY_CONTEXT_KB_URL `
  -Headers @{Authorization="Bearer $env:SANITY_ORGANIZATION_TOKEN"; Accept="application/json, text/event-stream"} `
  -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```

A non-empty `result.tools` means it works. `401` means the token is missing or
malformed; `403 contextGrantRequired` means it is a project token, not an
organisation one.

---

# Endpoint A (GROQ mode) — unblocked 19 Sep 2026

`npm run schema:deploy` succeeded, so the schema is now readable server-side and
this endpoint can be created.

In the Context app: **MCP ENDPOINTS → + New endpoint**

- **Title / Name:** `detection-debt-graph`
- **Content source:** **Dataset** — project Detection Debt, dataset `production`
- Attach **no** Knowledge Base. The mode decides which tools are served, and this
  endpoint exists for the graph.

Resulting URL, for `.env.local` as `SANITY_CONTEXT_GROQ_URL`:

```
https://api.sanity.io/v1/context/organizations/okh17tblt/mcp/detection-debt-graph
```

## Instructions field

This is where the agent learns the query shapes that work. Without it a model
guesses at field names and writes GROQ that parses but answers the wrong question.

```
Only rules with status "validated" or "tuned" count as coverage. A draft rule is an
intention, not a control; never include drafts in a coverage answer unless asked.

A rule dies if ANY table it reads disappears. A rule reading three tables where one
is lost does not degrade, it stops. Model connector loss that way.

A technique only goes dark if NO surviving rule covers it. Compute coverage loss as
a set difference, never as a count of dead rules.

Coverage of a sub-technique does not imply coverage of its parent or its siblings.
T1078.004 and T1078 are different techniques; do not roll one into the other.

detectionRule.kqlFeatures lists the query constructs a rule depends on. Basic and
Auxiliary tables are single-table: join, find, search, externaldata, user-defined
functions and cross-workspace queries are unsupported there. A rule tagged with any
of those cannot run against a downgraded table. Sentinel analytics rules and
Defender custom detections require the Analytics plan regardless of query shape.

logTable.planLastChangedOn matters: plan updates are limited to one per table per
week. If it falls inside the last seven days, a further change is refused outright.

baselineControl.conflictsWith links controls that govern the same setting with
different recommended values. When a question touches a contested setting, return
every claim with its sourceAuthority and sourceLocation. Never pick one silently.

Verify the endpoint with:
  .\test-context-endpoint.ps1
after pointing SANITY_CONTEXT_KB_URL at this endpoint, or add a GROQ variant.
Expect initial_context, schema_explorer, groq_query and array_field_reader.
```

## After creating it

The `groq/queries.ts` file holds the seven queries with comments explaining what
each traversal is for. Pasting a couple of those shapes into the Instructions field
is the difference between an agent that writes correct GROQ and one that guesses —
the field descriptions in the schema carry the rest.

---

# `sanity schema deploy` is not enough for GROQ mode

Worth writing down, because the documentation and the runtime disagree.

The Sanity Context requirements say GROQ mode needs:

> **A deployed schema.** Run `sanity schema deploy`, or open your hosted Studio
> once if you deploy with `sanity deploy`.

Read as two alternatives. It is not. `sanity schema deploy` reported
`Deployed 1/1 schemas`, and the endpoint still answered every request with:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32004,
    "message": "Only datasets with deployed Studio applications are supported. Please deploy a Studio (v5.1.0+) for this project/dataset."
  },
  "id": null
}
```

What it actually requires is a deployed **Studio application** — `sanity deploy`,
which builds and hosts the Studio itself. The schema deploy is necessary but not
sufficient.

Diagnosing this took a change to the test script. `Invoke-RestMethod` in Windows
PowerShell 5.1 surfaces the status code and hides the response body, so the first
run reported only `HTTP 400 - Bad Request`. The reason was sitting in the body the
whole time. Reading the error stream by hand turned a guess into a fix in one run.

## Prerequisites for GROQ mode, in order

1. `npm run schema:deploy` — publishes the schema so Context can read it server-side.
2. `npm run studio:deploy` — deploys the Studio application. **Also required.**
3. Create the MCP endpoint with a dataset source.

## Two smaller traps in `sanity deploy`

**The hostname prompt validates on every keystroke** and rejects the first
character before you can finish typing, then exits with `CLIError: Error creating
user application`. Set `studioHost` in `sanity.cli.ts` instead and it never asks.

**It prints an `appId` afterwards** and asks you to add it to a `deployment`
section. Do it, or every future deploy prompts again.

## The side benefit

The Studio is live at **https://detection-debt.sanity.studio** — a public,
navigable view of the content model: 40 rules with their references, 186
techniques with the parent/sub-technique hierarchy, controls with their
`conflictsWith` links.

The challenge asks for a project ID so the Sanity team can see how the content was
modelled. A browsable Studio answers that better than an identifier does.

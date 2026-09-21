---
title: The same corpus told me two different things, and only one of them was checkable
published: false
description: I built an agent over a Sanity content graph and a Sanity Context knowledge base, gave both the same documents, and asked them the same question. The graph found a contradiction the knowledge base missed — and the reason why changed how I think about modelling content.
tags: sanitychallenge, sanity, ai, cybersecurity
---

I fed two CIS benchmark PDFs and a pile of Microsoft documentation into a Sanity
Context knowledge base. Separately, I modelled the same claims as documents in a
Sanity dataset, with references between them.

Then I asked both the same question: **how long should a break-glass account
password be?**

The knowledge base gave me a careful, well-sourced answer about emergency access
accounts. It told me something I had missed after two manual readings of the
source. It did not mention that its own corpus contains two incompatible answers.

The graph returned both, in one query:

| Authority | Location | Claim |
|---|---|---|
| CIS Microsoft 365 Foundations v7.0.0 | § 1.1.2, pp. 24–26 | at least 16 characters |
| Microsoft Cloud Security Benchmark | Privileged Access, PA-5 | at least 32 characters |

Same documents. Same question. One mechanism surfaced the disagreement; the other
smoothed over it. That is the most interesting thing I learned building this, and
it is not a story about one of them being worse.

---

## What I built

A SOC has a question nobody can look up: **if this telemetry source goes away,
which detections die and which MITRE ATT&CK techniques stop being watched?**

There is no document with that answer in it. It exists only by walking

```
connector → logTable → detectionRule → technique
```

and subtracting sets. Ask it of the real dataset — 8 connectors, 18 log tables,
40 detection rules imported from the public Microsoft Sentinel repository, 186
ATT&CK techniques from the official STIX bundle — and you get things like this:

> **Defender for Endpoint, not renewed.** 4 tables stop. 120 GB/day of ingestion
> ends. 4 rules stop firing. `T1003` OS Credential Dumping and `T1566` Phishing
> lose their last remaining rule. `T1136` Create Account survives — on exactly
> one rule now, which nobody asked about and which is the next thing to break.

Or, asking about absence rather than presence:

> **63 of 67 Credential Access techniques have no validated rule covering them.**

Or the one I did not design for and which the agent found on its own:

> **23 GB/day of telemetry that no rule reads.** Defender for Identity and
> Defender for Cloud Apps feed four tables on the Analytics plan. No rule —
> validated, tuned, draft or retired — queries any of them.

Try it: **[detection-debt.vercel.app](https://detection-debt.vercel.app)**
· Sanity project **`6qz0b6rp`**
· [repository](https://github.com/CyberTTopic/detection-debt)
· [browse the content model](https://detection-debt.sanity.studio)

---

## Why the knowledge base missed the contradiction

Not because it is bad at finding contradictions. It found two others in the same
build, and raised them as issues I had to resolve before the index would finish.

Watching those three cases together is what taught me something. The knowledge
base behaved differently in each, and the difference was not about how important
the conflict was:

**Raised.** An entry stated there were ten CIS Azure activity log alert controls.
Its own table, and both cited sources, listed eleven. The entry contradicted the
documents it was built from, in one place, and the build caught it.

**Preserved but not flagged.** CIS § 1.1.2 contradicts *itself*. Its remediation
steps have you exclude a break-glass account from Conditional Access and rely on
a 16-character password. A Warning at the foot of the same page states MFA has
been required for all users including break-glass accounts since 15 October 2024,
and recommends passkeys instead. Both claims landed in the same entry, verbatim,
side by side — and nothing marked them as incompatible.

**Not raised at all.** The 16-versus-32 disagreement. The MCSB source *is* in the
corpus; PA-8.1 is cited elsewhere. The `privileged_access` entry explicitly routes
PA-5 to the `emergency_access` entry. But `emergency_access` cites no MCSB source.
The fact fell between two entries, and a conflict that spans two entries is not a
conflict either of them can see.

That last one is the whole lesson. **A prose index can only notice a disagreement
that lands inside one of its chunks.** Which chunk a fact lands in is decided by
an outlining pass, and nobody — including me, who wrote the `purpose` field that
steered it — can predict that reliably.

The graph has the opposite property. I modelled the disagreement as a
self-reference:

```ts
defineField({
  name: 'conflictsWith',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'baselineControl'}]}],
  description:
    'Controls that govern the same setting with a different recommended value. ' +
    'When a question touches a contested setting, return every claim with its ' +
    'sourceAuthority and sourceLocation. Never pick one silently.',
})
```

Once "these two disagree" is a reference rather than a sentence, it survives
chunking, because there is no chunking. It is retrieved by the same mechanism
that retrieves everything else:

```groq
{
  "contestedSettings": array::unique(
    *[_type == "baselineControl" && count(conflictsWith) > 0].setting
  )
}
```

One line, and it cannot miss — not because GROQ is clever, but because the fact
was made structural instead of textual.

### And the other direction

The knowledge base also told me this, which I had read past twice:

> If the Conditional Access exclusion is managed by a security group, that group
> must be role-assignable or enrolled in PIM for Groups. A regular security group
> allows Group Administrators to bypass Conditional Access entirely.

That is a conditional, three documents deep, and I had no field for it. I would
have had to already know it was important to model it. Prose keeps facts you did
not anticipate; a schema keeps facts you did.

So the agent uses both endpoints, and the router is in the prompt:

| The question is about | Endpoint |
|---|---|
| what breaks, what is uncovered, how many, which depends on which | the graph (GROQ mode) |
| what a source recommends, why a decision was taken | the docs (Knowledge Base mode) |
| a hardening value that might be disputed | **both** |

The agent has to name which one it used. A wrong route does not fail loudly — it
produces a confident answer from the wrong kind of source.

---

## The model does not do the arithmetic

`coverage_delta` fetches the graph, does the set algebra in TypeScript, and
returns only what changed. The 186 techniques never enter the context window.

It takes a *list* of connectors, and that matters more than it looks:

> A technique held up by one rule from Defender for Identity and one rule from
> Defender for Cloud Apps survives losing either one. It goes dark when both go.

Run the single-connector query twice and union the answers, and that technique
reports as safe. The unit test for this is the one I care about most:

```ts
check('the union of the single answers would have missed it',
  [...mde.techniquesGoingDark, ...mdi.techniquesGoingDark]
    .some((t) => t.attackId === 'T2000'),
  false)
```

And when asked about one connector, the tool runs **both** implementations — the
TypeScript and an equivalent GROQ query inside Sanity — and compares them. Two
independent expressions of the same set difference, checked against each other at
answer time. When they disagree it says so instead of picking one.

That cross-check earned its keep on the first run against production data, in a
way I did not expect.

---

## The bug that every test passed

`techniques[]->attackId` evaluates under `groq-js` to:

```json
["T1110", "T1556"]
```

The same projection through Sanity Context's `groq_query` returns:

```json
[{"attackId": "T1110"}, {"attackId": "T1556"}]
```

Context rewrites projections — results carry an `_id` nobody asked for — and
dereferenced scalar fields arrive wrapped. Nested paths are left alone, so
`connector->slug.current` comes back as a plain string *from the same query*.
That inconsistency is why it took a while to see.

Those wrapped values were being used as `Map` keys. Object keys compare by
reference, so every lookup missed, every technique fell through the
"not in the snapshot" branch, and the tool reported that losing a connector
killed nine rules and left **no** technique uncovered.

Silent. Plausible. Wrong in the direction that reads as good news.

Every unit test passed the whole time, because they run against a local fixture
through `groq-js`. They were exercising a shape production never emits. What found
it was the cross-check: GROQ said four techniques go dark, the TypeScript said
none, and the tool refused to pick a side.

The fix is a normalisation layer that accepts both shapes and reports anything it
cannot read, plus a test that pins one rule written both ways and asserts they
normalise identically — including an assertion that reproduces the original bug,
so removing the layer fails in those words:

```ts
check('without normalising, the loss silently disappears',
  unnormalised.techniquesGoingDark.length, 0)
```

**A fixture is not a substitute for running against the real thing.** I knew that
and still had to learn it.

---

## Two more things worth knowing

**`sanity schema deploy` is not enough for GROQ mode.** The docs present it and
`sanity deploy` as alternatives. A GROQ-mode endpoint returned HTTP 400 until a
Studio was actually deployed, and the real reason was only in the response body —
`-32004 Only datasets with deployed Studio applications are supported`. Windows
PowerShell 5.1 does not surface response bodies, so for an hour the status code
was all I had.

**`groq_query` has no parameters.** It takes one `query` string, so every value —
a connector slug, a tactic id, a setting name — is written into the query text
before sending. That turns a convenience function into the application's security
boundary, since those values are chosen by a language model from text a user
typed. `JSON.stringify` rather than hand-rolled quoting, in one pass so `$setting`
cannot be clipped by `$settings`, with tests asserting that seven escape attempts
each stay inside their string literal.

---

## What is invented, and why I say so

The connectors, tables, rule logic, ATT&CK techniques and every cited benchmark
control are real, imported from public sources and cited to the page.

Four fields on each detection rule are not. `status`, `fpRate`, `lastValidated`
and `ownerTeam` are generated from a hash of the rule ID — deterministic so the
demo does not reshuffle, but invented. They describe operational history with a
rule, and no public repository can know that.

So the agent is instructed to say so whenever one of them drives an answer.
Ranking rules by a fabricated false-positive rate without mentioning that it is
fabricated is the most dishonest thing this application could do, and it would
look exactly like competence.

---

## What I would tell myself at the start

Model the disagreement, not just the claim. `conflictsWith` is one array of
references and it is the reason the hardest question in this dataset has an
answer. Everything else in the schema stores what a source says; that one field
stores that two sources differ, and it is the only field that made a contradiction
queryable.

Keep the arithmetic out of the model. Not because models are bad at it, but
because when they get it wrong the answer is fluent and nobody can see the error.
Set differences are cheap in code and free to test.

And run two implementations of the thing you care about most. It found a bug that
36 unit tests did not.

---

**Live demo:** [detection-debt.vercel.app](https://detection-debt.vercel.app)
**Sanity project ID:** `6qz0b6rp`
**Repository:** [github.com/CyberTTopic/detection-debt](https://github.com/CyberTTopic/detection-debt)
**Content model:** [detection-debt.sanity.studio](https://detection-debt.sanity.studio)

The demo runs on a free model quota of twenty requests a minute, and one question
costs a model call per agent step — so it is throttled, and if it tells you to
wait a minute, that is the quota rather than a bug. The repository runs locally
with your own key from Anthropic, OpenAI or Google, and needs one environment
variable to do it.

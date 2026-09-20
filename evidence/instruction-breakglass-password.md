# Instruction: break-glass password length

Written by hand on 19 Sep 2026, after the first build failed to raise a conflict
we had verified existed. Anchor it to the CIS Microsoft 365 PDF source and the
MCSB privileged-access page.

## Text to paste into the Instructions view

```
MCSB PA-5 and CIS Microsoft 365 Foundations Benchmark v7.0.0 section 1.1.2 both
specify a minimum password length for emergency access (break-glass) accounts,
and they disagree: CIS requires at least 16 characters, MCSB PA-5 requires at
least 32. The emergency_access entry must state both requirements, name the
authority for each, and must not present either number as the single answer.
MCSB PA-5 also differs on posture: it excludes one account from all Conditional
Access and MFA while keeping the second subject to phishing-resistant MFA. Record
that alongside CIS's recommendation to exclude at least one of the two.
```

## Why this instruction was needed

Not because the source was missing. MCSB is demonstrably in the corpus — the
`privileged_access` entry cites **MCSB PA-8.1** for Customer Lockbox, with its
own source reference.

What happened is more specific. `privileged_access` ends with:

> Emergency/break-glass accounts (MCSB PA-5) are out of scope here — see
> `emergency_access`.

So the build knew PA-5 existed, decided it did not belong in `privileged_access`,
and wrote a pointer to the entry where it does belong. But `emergency_access`
cites only four sources, and none of them is MCSB:

    1. Manage emergency access admin accounts | Microsoft Learn — Web
    2. Manage emergency access admin accounts … Store account credentials safely — Web
    3. CIS_Microsoft_365_Foundations_Benchmark_v7.0.0.pdf — File
    4. Manage emergency access admin accounts … Create an alert rule — Web

The 32-character requirement fell into the gap between the two entries: pushed
out of one by an explicit `excludes` boundary, never pulled into the other. The
routing note was written; the content did not follow it.

That is why no issue was raised. There was never a moment where both numbers sat
in the same place to be compared.

## The general lesson

"Every fact has one home" is the right design for an outline an agent has to
navigate — it is what keeps the index small enough to hold in context. But the
boundary that gives each fact one home is also the boundary that stops two
competing claims from meeting.

Conflict detection appears to operate within an entry. Three behaviours observed
in one build:

| Situation | Behaviour |
|---|---|
| Entry contradicts its own cited sources | Raised as an issue (ten versus eleven activity log alert controls) |
| Two claims from the same source disagree, both in one entry | Preserved verbatim, not flagged (CIS 1.1.2's steps versus its own Warning) |
| Two sources disagree, claims routed to different entries | Not raised, and one claim may not land anywhere |

The third case is the one that needs a human. An Instruction is how you tell the
build that a particular disagreement matters enough to override its own topic
boundaries.

## Verify after the next build

```powershell
.\read-kb-entry.ps1 emergency_access -Grep "32"
.\read-kb-entry.ps1 emergency_access -Grep "PA-5"
```

Success is both numbers in the entry, each attributed, with neither presented as
the answer. A raised issue would be a bonus, not the requirement — the point is
that an agent reading the entry sees both claims.

# Outline — build 1, 19 Sep 2026

Knowledge base id: `kbtescebD5nQ` · 26 entries
Sources: CIS M365 Foundations v7.0.0 (PDF), CIS Azure Foundations v6.0.0 (PDF),
and individual Microsoft Learn pages. No dataset source yet.

## Where the verified conflicts should have landed

`emergency_access [core]`
  topics include: Authentication method requirements, Credential and device
  storage, Conditional Access exclusions
  excludes: General privileged role governance; **Conditional Access policy design**

`mfa/session_lifetime [core]`
  topics include: 90-day rolling window default, Conditional Access session controls
  excludes: MFA method enrollment and enforcement phases; **Conditional Access
  policy authoring unrelated to session controls**

`conditional_access/session_controls [core]`
  topics include: Sign-in Frequency (SIF), Persistent Browser Session
  excludes: Blocking legacy auth protocols and Security Defaults migration

`conditional_access/policy_deployment [core]`
  topics include: **CIS Idle Session Timeout CA Policy (CIS M365 v7.0.0)**,
  Emergency Access (Break-Glass) Exclusions

## Diagnosis

Neither verified numeric conflict was raised, and the `excludes` lines explain why.

**Sign-in frequency.** The material is split across at least three sibling
entries. CIS's 4-hour cap sits under `conditional_access/policy_deployment`
("CIS Idle Session Timeout CA Policy"), while the 90-day rolling default sits
under `mfa/session_lifetime`. Each entry's `excludes` line deliberately pushes
the other half away. The build gave each fact one home, exactly as documented —
and that is what prevented the comparison.

**Break-glass password length — resolved by reading the entry.** It is a missing
source, not a detection failure. `emergency_access` cites four sources, and MCSB
PA-5 is not among them:

    1. Manage emergency access admin accounts | Microsoft Learn - Web
    2. Manage emergency access admin accounts ... Store account credentials safely - Web
    3. CIS_Microsoft_365_Foundations_Benchmark_v7.0.0.pdf - File
    4. Manage emergency access admin accounts ... Create an alert rule - Web

The 16-character requirement is present and correctly attributed to CIS. The
32-character requirement never entered the corpus, so there was nothing to
compare it against. `learn.microsoft.com/security/benchmark/azure/mcsb-v2-privileged-access`
was on the must-have list and did not get added.

**What the entry did instead, and it is better than a raised issue.** CIS 1.1.2's
self-contradiction survived into the entry intact, with both halves adjacent and
both cited to the CIS PDF:

> If a password is used instead, CIS requires it to be **at least 16 characters,
> randomly generated**, and MAY be split into multiple pieces to be joined only
> in an emergency [2].
>
> > **Warning (CIS):** As of 10/15/2024, MFA is required for all users including
> > break-glass accounts. Passkey (FIDO2) or CBA are the recommended methods to
> > satisfy this requirement [2].

No issue was raised, and on reflection that is defensible: this is not two
sources disagreeing, it is one document whose remediation steps and whose warning
point different ways. The entry carried both, labelled the warning as a warning,
and left the reader to see the tension. An agent reading this entry gets the whole
picture without anyone having resolved anything.

So the honest version for the writeup is three distinct behaviours, not one:
within-entry consistency checking that fires (ten versus eleven), cross-entry
contradictions that do not (sign-in frequency), and same-source tensions that get
preserved verbatim rather than flagged (break-glass).

## What this says about the feature

The build's own consistency check works — it caught an entry miscounting its
cited sources (the ten-versus-eleven issue). Cross-entry contradictions are a
different matter: once a fact has one home, a claim in a sibling entry is not
compared against it. Getting those raised takes an Instruction that names the
setting and forces both claims into one place.

That is the difference between accepting the first build and directing it, and
it is worth writing up plainly rather than pretending the first build found
everything.

## Also worth noting

26 entries, and much of the outline is a long way from the stated purpose:
`network_security/application_gateway`, `email_security/spam_auth_filtering`,
`dlp_information_protection`, `defender_for_cloud/workload_plans`. Several came
out tagged `[core]`.

The cause is source volume. The two CIS PDFs run to roughly a thousand pages
each and cover WAF TLS versions, DMARC records and Cosmos DB in the same
document as identity hardening. The purpose shaped how topics were named and
grouped, but it did not stop a thousand pages of unrelated benchmark material
from earning its own entries.

Options, in increasing cost: leave it, since the agent reads the outline and
picks what it needs; add an Instruction narrowing what deserves an entry; or
replace the whole-PDF sources with extracted sections. The first is probably
right for a demo, and the tradeoff is worth stating out loud.


## Bonus finding from the entry text

The entry surfaced a CIS warning that neither of us had spotted while reading the
PDF by hand, and it is sharper than most of what we went looking for:

> **Warning (CIS):** If the CA exclusion is managed by a security group, that
> group must be role-assignable or enrolled in PIM for Groups. A regular security
> group allows Group Administrators to bypass CA entirely.

That is a privilege-escalation path hiding inside the standard advice to "use a
group for the exclusion". Worth a line in the post: the Knowledge Base found a
detail in a thousand-page PDF that two careful readings had missed.

There is also a latent conflict the entry states without flagging: Microsoft Learn
says exclude emergency access accounts from **all** Conditional Access policies,
while CIS recommends excluding **at least one** of the two. Both appear, cited
[1][2], one line apart. Another candidate for an Instruction if a raised issue is
wanted.

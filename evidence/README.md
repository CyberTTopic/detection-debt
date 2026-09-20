# Evidence

Screenshots and transcripts for the submission. Some of this cannot be recreated
after the fact, so it gets saved as it happens.

## Needed

- [ ] `issue-1-baseline-security-mode.png` — the conflict detail view for the RPS
      deprecation, both claims side by side. **Resolved 19 Sep 2026**, so this view
      no longer exists in the app; use the screenshot taken at the time.
- [ ] `issue-2-activity-log-alert-rules.png` — the ten-versus-eleven conflict, with
      both candidate claims visible. Also already resolved.
- [ ] Outline after the first build.
- [ ] Outline after the dataset source is added, for comparison.
- [ ] The agent answering the connector-loss question, with citations visible.

## Why these two matter

Both were verified by hand against the primary sources on 19 Sep 2026:

**Issue 1.** The Baseline Security Mode page states, in the RPS row: *"Legacy browser
authentication was deprecated for enterprise tenants as of October 2025. This setting
is longer available to set to true. The RPS protocol no longer functions."* The build
was right, and the rejected claim conflated two distinct settings — RPS (browser,
deprecated) and IDCRL (client, still configurable).

**Issue 2.** CIS Microsoft Azure Foundations Benchmark v6.0.0 contains eleven activity
log alert controls, 6.1.2.1 through 6.1.2.11, all marked (Automated). Confirmed by
extracting the PDF text and counting the headings. The rejected claim said ten and
also invented an attribution: it cited "Application Insights" as a Level 2 exception,
but Application Insights is section 6.1.3.1, a different subsection entirely, and is
marked (Automated).

So the build caught its own entry miscounting its cited sources, and the wrong answer
it offered contained a fabricated detail. Both checkable against a public PDF in under
a minute. That is the strongest evidence in the submission that the verification step
in a Knowledge Base build does real work.

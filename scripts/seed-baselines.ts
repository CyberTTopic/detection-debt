/**
 * Seed the baseline controls, including the verified contradictions.
 *
 *   npx tsx scripts/seed-baselines.ts
 *
 * Every control here was read in the source document on 19 September 2026 and
 * carries the page or section it came from. Nothing is paraphrased from memory.
 *
 * The three contested settings are the demo's evidence that the corpus really
 * disagrees with itself, and they are why the Knowledge Base build has something
 * to raise. `conflictsWith` is populated in BOTH directions on purpose, so a
 * control reads as contested no matter which side you arrive from.
 */

import {ids, ref, commitInChunks} from './client'

const C = {
  cisBreakglass: ids.control('cis-m365-v7', '1.1.2'),
  mcsbBreakglass: ids.control('mcsb', 'PA-5'),
  cisSession: ids.control('cis-m365-v7', '5.2.2.4'),
  msSession: ids.control('microsoft-learn', 'session-lifetime'),
  cisLegacyAuth: ids.control('cis-m365-v7', '5.2.2.3'),
  msBaselineMode: ids.control('microsoft-learn', 'baseline-security-mode'),
  cisPhishResist: ids.control('cis-m365-v7', '5.2.2.5'),
  cisEmergencyMonitor: ids.control('cis-m365-v7', '2.2.1'),
}

const controls = [
  /* ------------------------------------------------------------------ *
   * Contested setting 1: break-glass password length. 16 against 32.
   *
   * CIS 1.1.2 also contradicts its own remediation steps, which is the
   * single best artefact in the whole corpus.
   * ------------------------------------------------------------------ */
  {
    _id: C.cisBreakglass,
    _type: 'baselineControl',
    controlId: '1.1.2',
    title: 'Ensure two emergency access accounts have been defined',
    sourceAuthority: 'cis-m365-v7',
    sourceLocation: 'CIS Microsoft 365 Foundations Benchmark v7.0.0, section 1.1.2, pp. 24-26',
    setting: 'breakglass-password-length',
    recommendedValue: 'at least 16 characters, randomly generated',
    enforced: true,
    conflictsWith: [ref(C.mcsbBreakglass)],
    notes:
      'This recommendation contradicts itself. The Impact and Remediation steps have you exclude one emergency account from all Conditional Access rules and rely on a 16-character random password as the protection. A Warning at the foot of the same recommendation states that as of 10/15/2024 MFA is required for all users including break-glass accounts, and advises passkey (FIDO2) or certificate-based authentication. The remediation steps were never rewritten to match. Verified 2026-09-19.',
  },
  {
    _id: C.mcsbBreakglass,
    _type: 'baselineControl',
    controlId: 'PA-5',
    title: 'Set up emergency access',
    sourceAuthority: 'mcsb',
    sourceLocation: 'Microsoft Cloud Security Benchmark v2, Privileged Access, PA-5',
    setting: 'breakglass-password-length',
    recommendedValue: 'at least 32 characters, never expiring, split under dual control',
    enforced: false,
    conflictsWith: [ref(C.cisBreakglass)],
    notes:
      'Also differs on posture, not only on length: PA-5 excludes ONE account from all Conditional Access and MFA, and its worked example leaves the second account subject to phishing-resistant MFA. Verified 2026-09-19.',
  },

  /* ------------------------------------------------------------------ *
   * Contested setting 2: admin sign-in frequency. 4 hours against
   * "lean on SSO", with a documented default of 90 days.
   * ------------------------------------------------------------------ */
  {
    _id: C.cisSession,
    _type: 'baselineControl',
    controlId: '5.2.2.4',
    title:
      'Ensure Sign-in frequency is enabled and browser sessions are not persistent for Administrative users',
    sourceAuthority: 'cis-m365-v7',
    sourceLocation: 'CIS Microsoft 365 Foundations Benchmark v7.0.0, section 5.2.2.4, pp. 294-297',
    setting: 'admin-signin-frequency',
    recommendedValue: 'Periodic reauthentication, 4 hours or less; Persistent browser session: Never persistent',
    enforced: false,
    conflictsWith: [ref(C.msSession)],
    notes:
      'Level 1 for both E3 and E5, so this is baseline rather than hardening. Rationale given is that forcing a timeout stops sessions living indefinitely and prevents session cookies being stolen. Verified 2026-09-19.',
  },
  {
    _id: C.msSession,
    _type: 'baselineControl',
    controlId: 'session-lifetime',
    title: 'Reauthentication prompts and session lifetime for Microsoft Entra multifactor authentication',
    sourceAuthority: 'microsoft-learn',
    sourceLocation:
      'learn.microsoft.com/entra/identity/authentication/concepts-azure-multi-factor-authentication-prompts-session-lifetime, Recommended settings',
    setting: 'admin-signin-frequency',
    recommendedValue:
      'Rely on SSO and managed devices; use sign-in frequency only where sessions must be restricted. Default is a 90-day rolling window.',
    enforced: true,
    conflictsWith: [ref(C.cisSession)],
    notes:
      'The substantive disagreement, not a numbers quibble: this page states that regular reauthentication prompts are bad for productivity and CAN MAKE USERS MORE VULNERABLE TO ATTACKS. CIS argues the opposite direction from the same premise of reducing risk. Separately, Microsoft’s own example policy for non-compliant devices uses 1 hour, so the corpus contains three different numbers for one setting: 1 hour, 4 hours, 90 days. Verified 2026-09-19.',
  },

  /* ------------------------------------------------------------------ *
   * Contested setting 3: how to block legacy authentication.
   * Not a factual conflict — a staleness conflict. Four mechanisms now
   * exist and any source predating Baseline Security Mode is incomplete.
   * ------------------------------------------------------------------ */
  {
    _id: C.cisLegacyAuth,
    _type: 'baselineControl',
    controlId: '5.2.2.3',
    title: 'Enable Conditional Access policies to block legacy authentication',
    sourceAuthority: 'cis-m365-v7',
    sourceLocation: 'CIS Microsoft 365 Foundations Benchmark v7.0.0, section 5.2.2.3, p. 290',
    setting: 'block-legacy-authentication',
    recommendedValue: 'A Conditional Access policy blocking Exchange ActiveSync clients and Other clients',
    enforced: true,
    conflictsWith: [ref(C.msBaselineMode)],
    notes:
      'Prescribes one mechanism. Verified 2026-09-19.',
  },
  {
    _id: C.msBaselineMode,
    _type: 'baselineControl',
    controlId: 'baseline-security-mode',
    title: 'Baseline security mode settings',
    sourceAuthority: 'microsoft-learn',
    sourceLocation: 'learn.microsoft.com/microsoft-365/baseline-security-mode/baseline-security-mode-settings',
    setting: 'block-legacy-authentication',
    recommendedValue:
      'Any of four mechanisms: Security Defaults, a Microsoft-managed policy, Baseline Security Mode in the Microsoft 365 admin center, or a manual Conditional Access policy',
    enforced: false,
    conflictsWith: [ref(C.cisLegacyAuth)],
    notes:
      'A staleness conflict rather than a factual one: no source is wrong, but any source predating Baseline Security Mode gives an incomplete answer, and the four mechanisms differ in licensing, ownership and what an admin may edit. Carries a documented defect worth citing: customers who opened Baseline Security Mode between November 2025 and early February 2026 may find two disabled draft Conditional Access policies created in their tenant without administrator action. That detail appears only in an Important callout mid-page. Verified 2026-09-19.',
  },

  /* ------------------------------------------------------------------ *
   * Uncontested controls, so the contested ones stand out rather than
   * being the only thing in the type.
   * ------------------------------------------------------------------ */
  {
    _id: C.cisPhishResist,
    _type: 'baselineControl',
    controlId: '5.2.2.5',
    title: "Ensure 'Phishing-resistant MFA strength' is required for Administrators",
    sourceAuthority: 'cis-m365-v7',
    sourceLocation: 'CIS Microsoft 365 Foundations Benchmark v7.0.0, section 5.2.2.5',
    setting: 'admin-phishing-resistant-mfa',
    recommendedValue: 'Require authentication strength: phishing-resistant MFA for admin roles',
    enforced: false,
    notes:
      'Also shipped as a Baseline Security Mode policy and as a Microsoft-managed policy, and the three agree. Verified 2026-09-19.',
  },
  {
    _id: C.cisEmergencyMonitor,
    _type: 'baselineControl',
    controlId: '2.2.1',
    title: 'Ensure emergency access account activity is monitored',
    sourceAuthority: 'cis-m365-v7',
    sourceLocation: 'CIS Microsoft 365 Foundations Benchmark v7.0.0, section 2.2.1, p. 142',
    setting: 'breakglass-monitoring',
    recommendedValue: 'Alert on Activity type "Log on" for every emergency access account',
    enforced: true,
    notes:
      'MCSB PA-5 asks for the same thing with a concrete implementation, querying SigninLogs by object ID on a five-minute evaluation. The two agree, which is worth having in the dataset so "contested" means something. Verified 2026-09-19.',
  },
]

async function main() {
  await commitInChunks(controls, 'baseline controls')

  const contested = new Set(
    controls.filter((c) => 'conflictsWith' in c).map((c) => c.setting),
  )
  console.log(`\nDone. ${controls.length} controls, ${contested.size} contested settings:`)
  for (const s of contested) console.log(`  - ${s}`)
  console.log(
    '\nNote: mitigatesTechniques and compensatingRules are left empty here.\n' +
      'They are wired up by link-controls.ts once techniques and rules exist,\n' +
      'because a reference to a document that does not exist yet is a broken reference.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Seed connectors and log tables.
 *
 *   npx tsx scripts/seed-infrastructure.ts
 *
 * Connector and table names are real. Volumes and dates are plausible figures
 * for a mid-size tenant and are marked as such — they are the only invented
 * numbers in the dataset, and the README says so.
 *
 * `supportsBasicPlan` is the one field to be careful with. Which plans a table
 * offers is decided per table by Microsoft and changes over time; the live
 * matrix is at:
 *
 *   https://learn.microsoft.com/azure/azure-monitor/reference/tables-features
 *
 * Only two entries below claim Basic or Auxiliary support, and both are
 * documented: CloudAppEvents appears in that matrix with Basic support, and
 * Microsoft's own summary-rules guidance describes `CommonSecurityLog_CL` as
 * "the CommonSecurityLog with the Auxiliary plan". Everything else is left at
 * false with a note, because an unverified claim in the dataset is exactly the
 * kind of thing this project exists to catch.
 */

import {ids, ref, commitInChunks} from './client'

const UNVERIFIED =
  'Plan availability not verified against the per-table matrix at ' +
  'learn.microsoft.com/azure/azure-monitor/reference/tables-features. ' +
  'Left at false deliberately rather than guessed.'

type ConnectorSeed = {
  slug: string
  name: string
  licenseRequired: string
  licenseExpiresOn?: string
  enabled?: boolean
  estimatedGbPerDay: number
  notes?: string
}

const connectors: ConnectorSeed[] = [
  {
    slug: 'entra-id',
    name: 'Microsoft Entra ID',
    licenseRequired: 'entra-p2',
    estimatedGbPerDay: 46,
    notes:
      'Sign-in and audit log export to a Log Analytics workspace requires Entra ID P1 or P2. Losing the premium SKU does not merely stop new detections, it stops the export.',
  },
  {
    slug: 'defender-for-identity',
    name: 'Microsoft Defender for Identity',
    licenseRequired: 'mdi',
    licenseExpiresOn: '2026-12-31',
    estimatedGbPerDay: 14,
    notes:
      'Term license with a real expiry date, which is what makes the coverage-loss question a date rather than a hypothetical.',
  },
  {
    slug: 'defender-for-endpoint',
    name: 'Microsoft Defender for Endpoint',
    licenseRequired: 'mde-p2',
    estimatedGbPerDay: 120,
    notes: 'Device* tables. The largest single source of endpoint telemetry here.',
  },
  {
    slug: 'defender-for-cloud-apps',
    name: 'Microsoft Defender for Cloud Apps',
    licenseRequired: 'mdca',
    estimatedGbPerDay: 9,
  },
  {
    slug: 'defender-for-office-365',
    name: 'Microsoft Defender for Office 365',
    licenseRequired: 'm365-e5',
    estimatedGbPerDay: 22,
  },
  {
    slug: 'cef-syslog-ama',
    name: 'Common Event Format (CEF) via AMA',
    licenseRequired: 'included',
    estimatedGbPerDay: 410,
    notes:
      'Firewall and network appliance logs. No license cost, enormous ingestion cost — the usual first candidate for a plan downgrade, and the reason the downgrade question matters.',
  },
  {
    slug: 'windows-security-events-ama',
    name: 'Windows Security Events via AMA',
    licenseRequired: 'included',
    estimatedGbPerDay: 190,
  },
  {
    slug: 'azure-activity',
    name: 'Azure Activity',
    licenseRequired: 'included',
    estimatedGbPerDay: 6,
  },
]

type TableSeed = {
  tableName: string
  connector: string
  ingestionTier: 'analytics' | 'basic' | 'auxiliary'
  supportsBasicPlan: boolean
  planLastChangedOn?: string
  gbPerDay: number
  retentionDays: number
  notes?: string
}

const tables: TableSeed[] = [
  // ---- Entra ID ----
  {tableName: 'SigninLogs', connector: 'entra-id', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 28, retentionDays: 180, notes: UNVERIFIED},
  {tableName: 'AuditLogs', connector: 'entra-id', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 6, retentionDays: 180, notes: UNVERIFIED},
  {tableName: 'AADNonInteractiveUserSignInLogs', connector: 'entra-id', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 9, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'AADServicePrincipalSignInLogs', connector: 'entra-id', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 3, retentionDays: 90, notes: UNVERIFIED},

  // ---- Defender for Identity ----
  {tableName: 'IdentityLogonEvents', connector: 'defender-for-identity', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 7, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'IdentityDirectoryEvents', connector: 'defender-for-identity', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 4, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'IdentityQueryEvents', connector: 'defender-for-identity', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 3, retentionDays: 90, notes: UNVERIFIED},

  // ---- Defender for Endpoint ----
  {tableName: 'DeviceProcessEvents', connector: 'defender-for-endpoint', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 64, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'DeviceLogonEvents', connector: 'defender-for-endpoint', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 18, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'DeviceNetworkEvents', connector: 'defender-for-endpoint', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 31, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'DeviceFileEvents', connector: 'defender-for-endpoint', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 7, retentionDays: 90, notes: UNVERIFIED},

  // ---- Defender for Cloud Apps ----
  // Basic support is documented in the per-table feature matrix.
  {
    tableName: 'CloudAppEvents',
    connector: 'defender-for-cloud-apps',
    ingestionTier: 'analytics',
    supportsBasicPlan: true,
    planLastChangedOn: '2026-09-16',
    gbPerDay: 9,
    retentionDays: 90,
    notes:
      'Basic plan support confirmed in the Azure Monitor per-table feature matrix. Plan was changed on 2026-09-16, so a further change is refused until 2026-09-23 under the one-switch-per-table-per-week limit — a deliberate fixture for that question.',
  },

  // ---- Defender for Office 365 ----
  {tableName: 'EmailEvents', connector: 'defender-for-office-365', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 14, retentionDays: 90, notes: UNVERIFIED},
  {tableName: 'UrlClickEvents', connector: 'defender-for-office-365', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 4, retentionDays: 90, notes: UNVERIFIED},

  // ---- CEF / Syslog: the cost problem ----
  // Auxiliary support is documented: Microsoft's summary-rules guidance refers to
  // "the CommonSecurityLog_CL table, which is the CommonSecurityLog with the Auxiliary plan".
  {
    tableName: 'CommonSecurityLog',
    connector: 'cef-syslog-ama',
    ingestionTier: 'analytics',
    supportsBasicPlan: true,
    gbPerDay: 410,
    retentionDays: 90,
    notes:
      'The headline cost line at 410 GB/day, and the table anyone would downgrade first. Auxiliary plan support is documented in Microsoft summary-rules guidance. Moving it to Auxiliary stops alerts on the table entirely; moving it to Basic limits queries to a single table and the last 30 days.',
  },
  {tableName: 'Syslog', connector: 'cef-syslog-ama', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 55, retentionDays: 90, notes: UNVERIFIED},

  // ---- Windows Security Events ----
  {tableName: 'SecurityEvent', connector: 'windows-security-events-ama', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 190, retentionDays: 90, notes: UNVERIFIED},

  // ---- Azure Activity ----
  {tableName: 'AzureActivity', connector: 'azure-activity', ingestionTier: 'analytics', supportsBasicPlan: false, gbPerDay: 6, retentionDays: 365, notes: UNVERIFIED},
]

async function main() {
  const connectorDocs = connectors.map((c) => ({
    _id: ids.connector(c.slug),
    _type: 'connector',
    name: c.name,
    slug: {_type: 'slug', current: c.slug},
    licenseRequired: c.licenseRequired,
    ...(c.licenseExpiresOn ? {licenseExpiresOn: c.licenseExpiresOn} : {}),
    enabled: c.enabled ?? true,
    estimatedGbPerDay: c.estimatedGbPerDay,
    ...(c.notes ? {notes: c.notes} : {}),
  }))

  const tableDocs = tables.map((t) => ({
    _id: ids.logTable(t.tableName),
    _type: 'logTable',
    tableName: t.tableName,
    connector: ref(ids.connector(t.connector)),
    ingestionTier: t.ingestionTier,
    supportsBasicPlan: t.supportsBasicPlan,
    ...(t.planLastChangedOn ? {planLastChangedOn: t.planLastChangedOn} : {}),
    gbPerDay: t.gbPerDay,
    retentionDays: t.retentionDays,
    ...(t.notes ? {notes: t.notes} : {}),
  }))

  await commitInChunks(connectorDocs, 'connectors')
  await commitInChunks(tableDocs, 'log tables')

  const totalGb = tables.reduce((a, t) => a + t.gbPerDay, 0)
  console.log(
    `\nDone. ${connectors.length} connectors, ${tables.length} tables, ${totalGb} GB/day modelled.`,
  )
  console.log(
    `${tables.filter((t) => t.supportsBasicPlan).length} table(s) marked downgradable, both verified against docs.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

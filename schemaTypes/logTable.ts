import {defineType, defineField} from 'sanity'
import {INGESTION_TIERS} from './constants'

/**
 * A table in the Log Analytics workspace.
 *
 * The middle of the dependency chain, and where the cost/coverage tradeoff
 * actually lives. `ingestionTier` decides what can query the table;
 * `supportsBasicPlan` records whether a downgrade is even offered, because not
 * every table can change plan.
 */
export const logTable = defineType({
  name: 'logTable',
  title: 'Log table',
  type: 'document',
  description:
    'One table in the Log Analytics workspace. Belongs to one connector and is read by zero or more detection rules. The ingestionTier field constrains which rule types can query it.',
  fields: [
    defineField({
      name: 'tableName',
      title: 'Table name',
      type: 'string',
      description:
        'Exact KQL table name, case-sensitive, e.g. SigninLogs, DeviceProcessEvents, IdentityLogonEvents. Match on this when a question names a table.',
      validation: (Rule) =>
        Rule.required()
          .regex(/^[A-Za-z][A-Za-z0-9_]*(_CL)?$/, {name: 'KQL table name'})
          .error('Must be a valid KQL table identifier, optionally ending in _CL for a custom log.'),
    }),
    defineField({
      name: 'connector',
      title: 'Provided by connector',
      type: 'reference',
      to: [{type: 'connector'}],
      description:
        'The connector that populates this table. Follow this reference to find out what a license change does to the table.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'ingestionTier',
      title: 'Current table plan',
      type: 'string',
      description:
        'Analytics supports full KQL, alerts and Sentinel analytics rules. Basic is limited to a single table, supports only simple log alerts, and can be queried over the last 30 days. Auxiliary/Lake supports no alerts at all. Sentinel analytics rules and Defender custom detections require Analytics.',
      options: {list: [...INGESTION_TIERS], layout: 'radio'},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'supportsBasicPlan',
      title: 'Can be moved to Basic',
      type: 'boolean',
      description:
        'Not every table offers every plan. False means a downgrade is not available regardless of what it would save, so the agent should say so rather than compute a saving.',
      initialValue: false,
    }),
    defineField({
      name: 'planLastChangedOn',
      title: 'Plan last changed on',
      type: 'date',
      description:
        'Table plan updates are limited to one switch per table per week. If this is within the last seven days, a further change is refused — which is a complete answer to a downgrade question on its own.',
      options: {dateFormat: 'YYYY-MM-DD'},
    }),
    defineField({
      name: 'gbPerDay',
      title: 'GB per day',
      type: 'number',
      description: 'Ingestion volume for this table alone. The numerator of any saving estimate.',
      validation: (Rule) => Rule.min(0),
    }),
    defineField({
      name: 'retentionDays',
      title: 'Total retention (days)',
      type: 'number',
      description:
        'Total retention, not the interactive analytics window. CIS Azure Foundations asks for 90 days or more on flow logs and 180 on resource logs; the Analytics default is 30 days, or 90 for Sentinel.',
      validation: (Rule) => Rule.min(0).max(4383),
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 3,
      description:
        'Caveats worth stating, including whether plan availability was actually verified against the per-table feature matrix or merely assumed.',
    }),
  ],
  preview: {
    select: {title: 'tableName', tier: 'ingestionTier', conn: 'connector.name', gb: 'gbPerDay'},
    prepare({title, tier, conn, gb}) {
      const vol = typeof gb === 'number' ? ` · ${gb} GB/day` : ''
      return {title, subtitle: `${tier ?? '?'} · ${conn ?? 'no connector'}${vol}`}
    },
  },
})

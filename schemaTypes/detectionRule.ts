import {defineType, defineField} from 'sanity'
import {RULE_TYPES, RULE_STATUSES, KQL_FEATURES, OWNER_TEAMS} from './constants'

/**
 * A detection rule. The centre of the graph.
 *
 * Three reference sets make the interesting questions answerable:
 *   dataSources[] -> logTable -> connector   (what kills this rule)
 *   techniques[]  -> technique               (what this rule buys us)
 *   kqlFeatures[]                            (what tier this rule can survive)
 *
 * The last one is the non-obvious member. Without it, "can I move this table to
 * Basic" is a guess. With it, a scheduled rule whose query joins is provably
 * incompatible, because Basic and Auxiliary tables do not support join.
 */
export const detectionRule = defineType({
  name: 'detectionRule',
  title: 'Detection rule',
  type: 'document',
  description:
    'One analytics rule or custom detection. Reads one or more logTables and covers one or more ATT&CK techniques. Only rules with status validated or tuned should be counted as real coverage.',
  groups: [
    {name: 'identity', title: 'Identity', default: true},
    {name: 'graph', title: 'Dependencies & coverage'},
    {name: 'quality', title: 'Quality'},
  ],
  fields: [
    defineField({
      name: 'ruleId',
      title: 'Rule ID',
      type: 'string',
      group: 'identity',
      description: 'Stable internal identifier, e.g. DET-0042. Unique across the dataset.',
      validation: (Rule) =>
        Rule.required()
          .regex(/^DET-\d{4}$/, {name: 'rule ID'})
          .error('Must look like DET-0042.'),
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      group: 'identity',
      description: 'What the rule detects, in the words an analyst would use.',
      validation: (Rule) => Rule.required().min(8).max(160),
    }),
    defineField({
      name: 'ruleType',
      title: 'Rule type',
      type: 'string',
      group: 'identity',
      description:
        'Scheduled and NRT rules, and Defender custom detections, can only query tables on the Analytics plan. NRT rules are additionally capped at 50 enabled rules per workspace against 512 for scheduled.',
      options: {list: [...RULE_TYPES], layout: 'dropdown'},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'quality',
      description:
        'A draft rule is not coverage. When a question asks what is covered, filter to validated and tuned unless told otherwise.',
      options: {list: [...RULE_STATUSES], layout: 'radio'},
      initialValue: 'draft',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'kql',
      title: 'KQL query',
      type: 'text',
      rows: 12,
      group: 'identity',
      description: 'The rule logic as deployed. Stored verbatim so it can be quoted, not paraphrased.',
    }),
    defineField({
      name: 'dataSources',
      title: 'Tables read',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'logTable'}]}],
      group: 'graph',
      description:
        'Every table this rule queries. A rule with exactly one entry here is a single point of failure: if that table stops, the rule does not degrade, it stops.',
      validation: (Rule) => Rule.required().min(1).unique(),
    }),
    defineField({
      name: 'techniques',
      title: 'Techniques covered',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'technique'}]}],
      group: 'graph',
      description:
        'The ATT&CK techniques this rule actually detects — not the ones it is thematically near. Over-claiming here is what produces a coverage map that lies.',
      validation: (Rule) => Rule.required().min(1).unique(),
    }),
    defineField({
      name: 'kqlFeatures',
      title: 'KQL features used',
      type: 'array',
      of: [{type: 'string'}],
      group: 'graph',
      description:
        'Which query constructs the rule depends on. Basic and Auxiliary tables are single-table: join, find, search, externaldata, user-defined functions and cross-workspace queries are unsupported there, and lookup and union reach at most five Analytics tables. A rule using a blocked feature cannot run against a downgraded table.',
      options: {list: [...KQL_FEATURES]},
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'lookbackDays',
      title: 'Lookback (days)',
      type: 'number',
      group: 'graph',
      description:
        'How far back the query reaches. Basic tables can only be queried over the last 30 days, so a longer lookback is another way a downgrade breaks a rule.',
      validation: (Rule) => Rule.min(0).max(4383),
    }),
    defineField({
      name: 'fpRate',
      title: 'False positive rate',
      type: 'number',
      group: 'quality',
      description:
        'Observed share of alerts closed as benign, as a decimal between 0 and 1. Sort ascending to rank competing rules for the same technique.',
      validation: (Rule) => Rule.min(0).max(1),
    }),
    defineField({
      name: 'lastValidated',
      title: 'Last validated',
      type: 'date',
      group: 'quality',
      description:
        'When someone last confirmed the rule fires on known-true telemetry. A rule validated two years ago is a claim, not a control.',
      options: {dateFormat: 'YYYY-MM-DD'},
    }),
    defineField({
      name: 'ownerTeam',
      title: 'Owner team',
      type: 'string',
      group: 'quality',
      description: 'Who maintains it. "Unowned" is a real and common answer worth being able to query.',
      options: {list: [...OWNER_TEAMS], layout: 'dropdown'},
      initialValue: 'unowned',
    }),
    defineField({
      name: 'supersededBy',
      title: 'Superseded by',
      type: 'reference',
      to: [{type: 'detectionRule'}],
      group: 'quality',
      description:
        'Set on a retired rule to point at its replacement, so retiring something does not silently drop coverage.',
      options: {
        filter: ({document}) =>
          document?._id
            ? {
                filter: '!(_id in [$self, $draftSelf])',
                params: {
                  self: document._id.replace(/^drafts\./, ''),
                  draftSelf: `drafts.${document._id.replace(/^drafts\./, '')}`,
                },
              }
            : {},
      },
    }),
  ],
  orderings: [
    {title: 'False positive rate, best first', name: 'fpAsc', by: [{field: 'fpRate', direction: 'asc'}]},
    {title: 'Least recently validated', name: 'staleFirst', by: [{field: 'lastValidated', direction: 'asc'}]},
  ],
  preview: {
    select: {ruleId: 'ruleId', title: 'title', status: 'status', type: 'ruleType', fp: 'fpRate'},
    prepare({ruleId, title, status, type, fp}) {
      const fpLabel = typeof fp === 'number' ? ` · FP ${Math.round(fp * 100)}%` : ''
      return {title: `${ruleId} — ${title}`, subtitle: `${status} · ${type}${fpLabel}`}
    },
  },
})

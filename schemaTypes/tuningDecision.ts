import {defineType, defineField} from 'sanity'

/**
 * A decision someone made about a rule, and why.
 *
 * This is the only type written primarily for the Knowledge Base rather than for
 * GROQ. It is prose with provenance: the dataset source for the Knowledge Base
 * selects these documents, so the reasoning becomes retrievable alongside the
 * vendor documentation it sometimes contradicts.
 *
 * When our decision disagrees with a benchmark, we are the ground truth for our
 * own tenant — and this document is the evidence for that.
 */
export const tuningDecision = defineType({
  name: 'tuningDecision',
  title: 'Tuning decision',
  type: 'document',
  description:
    'A recorded decision about a detection rule: what changed, why, and who decided. Read by the Knowledge Base so the agent can explain the reasoning behind a rule as it stands, including where that reasoning departs from vendor guidance.',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'One line stating the decision, e.g. "Dropped DET-0042 severity to medium".',
      validation: (Rule) => Rule.required().min(8).max(160),
    }),
    defineField({
      name: 'rule',
      title: 'Rule',
      type: 'reference',
      to: [{type: 'detectionRule'}],
      description: 'The rule this decision is about.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'decidedOn',
      title: 'Decided on',
      type: 'date',
      description:
        'When the decision was taken. Later decisions about the same rule take precedence, so this is how the agent knows which reasoning is current.',
      options: {dateFormat: 'YYYY-MM-DD'},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'decidedBy',
      title: 'Decided by',
      type: 'string',
      description: 'Role or team, not a personal name. Keeps the dataset shareable.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'contradictsGuidance',
      title: 'Contradicts external guidance',
      type: 'boolean',
      description:
        'True when this decision knowingly departs from a benchmark or vendor recommendation. These are the documents worth surfacing first when a question has a documented "official" answer we chose not to follow.',
      initialValue: false,
    }),
    defineField({
      name: 'relatedControls',
      title: 'Related baseline controls',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'baselineControl'}]}],
      description:
        'The controls this decision agrees or disagrees with. Populate this whenever contradictsGuidance is true, so the disagreement has both sides attached.',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'rationale',
      title: 'Rationale',
      type: 'array',
      of: [{type: 'block'}],
      description:
        'The reasoning, in full. This is the prose the Knowledge Base indexes, so write it for a colleague who joins in a year and asks why the rule looks like this. Include the numbers that drove the call.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'supersedes',
      title: 'Supersedes',
      type: 'reference',
      to: [{type: 'tuningDecision'}],
      description:
        'The earlier decision this one replaces. A chain here is a rule’s history, and it keeps a reversed decision from reading as current.',
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
    {title: 'Most recent first', name: 'recentFirst', by: [{field: 'decidedOn', direction: 'desc'}]},
  ],
  preview: {
    select: {title: 'title', rule: 'rule.ruleId', on: 'decidedOn', contra: 'contradictsGuidance'},
    prepare({title, rule, on, contra}) {
      return {
        title,
        subtitle: `${rule ?? 'no rule'} · ${on ?? 'undated'}${contra ? ' · departs from guidance' : ''}`,
      }
    },
  },
})

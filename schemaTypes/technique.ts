import {defineType, defineField} from 'sanity'
import {ATTACK_TACTICS} from './constants'

/**
 * A MITRE ATT&CK technique or sub-technique.
 *
 * The self-reference on `parentTechnique` is what makes coverage questions honest.
 * A rule that covers T1078.004 (Cloud Accounts) does not cover T1078 (Valid Accounts)
 * in general, and an agent that flattens the hierarchy will overstate coverage.
 */
export const technique = defineType({
  name: 'technique',
  title: 'ATT&CK technique',
  type: 'document',
  description:
    'One MITRE ATT&CK Enterprise technique or sub-technique. Sub-techniques point at their parent through parentTechnique. Coverage of a sub-technique does not imply coverage of its parent or of its siblings.',
  fields: [
    defineField({
      name: 'attackId',
      title: 'ATT&CK ID',
      type: 'string',
      description:
        'Canonical identifier, e.g. T1078 for a technique or T1078.004 for a sub-technique. Match on this when a question names a technique.',
      validation: (Rule) =>
        Rule.required()
          .regex(/^T\d{4}(\.\d{3})?$/, {name: 'ATT&CK technique ID'})
          .error('Must look like T1078 or T1078.004.'),
    }),
    defineField({
      name: 'name',
      title: 'Technique name',
      type: 'string',
      description: 'Official ATT&CK name, e.g. "Valid Accounts: Cloud Accounts".',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tactics',
      title: 'Tactics',
      type: 'array',
      of: [{type: 'string'}],
      description:
        'Every tactic this technique belongs to, by TA identifier. A technique can sit under several, so treat this as a set and not a single value.',
      options: {list: [...ATTACK_TACTICS]},
      validation: (Rule) => Rule.required().min(1).unique(),
    }),
    defineField({
      name: 'parentTechnique',
      title: 'Parent technique',
      type: 'reference',
      to: [{type: 'technique'}],
      description:
        'Set only on sub-techniques. Empty means this is a top-level technique. Use this to roll coverage up or down the hierarchy deliberately rather than by accident.',
      options: {
        // A technique cannot be its own parent, and only top-level techniques
        // are valid parents — ATT&CK has no sub-sub-techniques.
        filter: ({document}) =>
          document?._id
            ? {
                filter: '!defined(parentTechnique) && !(_id in [$self, $draftSelf])',
                params: {
                  self: document._id.replace(/^drafts\./, ''),
                  draftSelf: `drafts.${document._id.replace(/^drafts\./, '')}`,
                },
              }
            : {filter: '!defined(parentTechnique)'},
      },
    }),
    defineField({
      name: 'dataComponents',
      title: 'Data components',
      type: 'array',
      of: [{type: 'string'}],
      description:
        'ATT&CK data components that can detect this technique, e.g. "User Account Authentication". Useful for arguing that a gap is unclosable with current telemetry rather than merely unaddressed.',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 4,
      description: 'Short summary from ATT&CK. Kept for the agent to quote back with a citation.',
    }),
  ],
  orderings: [
    {
      title: 'ATT&CK ID',
      name: 'attackIdAsc',
      by: [{field: 'attackId', direction: 'asc'}],
    },
  ],
  preview: {
    select: {id: 'attackId', name: 'name', parent: 'parentTechnique.attackId'},
    prepare({id, name, parent}) {
      return {
        title: `${id} — ${name}`,
        subtitle: parent ? `sub-technique of ${parent}` : 'top-level technique',
      }
    },
  },
})

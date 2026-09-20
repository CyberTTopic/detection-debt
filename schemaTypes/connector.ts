import {defineType, defineField} from 'sanity'
import {LICENSE_REQUIREMENTS} from './constants'

/**
 * A data connector: the thing that puts telemetry into the workspace.
 *
 * This is the root of the dependency chain the agent walks backwards from.
 * "If we do not renew Defender for Identity" starts here, follows logTable,
 * reaches detectionRule, and ends at technique.
 */
export const connector = defineType({
  name: 'connector',
  title: 'Data connector',
  type: 'document',
  description:
    'A telemetry source feeding the workspace. Every logTable belongs to exactly one connector, so removing a connector removes every table it provides and every rule that reads them.',
  fields: [
    defineField({
      name: 'name',
      title: 'Connector name',
      type: 'string',
      description: 'As it appears in the Sentinel or Defender connector gallery.',
      validation: (Rule) => Rule.required().min(3).max(120),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Stable identifier for imports and cross-references.',
      options: {source: 'name', maxLength: 60},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'licenseRequired',
      title: 'License required',
      type: 'string',
      description:
        'The SKU that entitles this connector. Filter on this to answer questions about what a license change costs in coverage.',
      options: {list: [...LICENSE_REQUIREMENTS], layout: 'dropdown'},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'licenseExpiresOn',
      title: 'License expires on',
      type: 'date',
      description:
        'Leave empty for perpetual or included entitlements. Set it for trials and term licenses so coverage loss can be asked about as a date rather than a hypothetical.',
      options: {dateFormat: 'YYYY-MM-DD'},
    }),
    defineField({
      name: 'enabled',
      title: 'Currently enabled',
      type: 'boolean',
      description:
        'False means the connector exists in the catalogue but is not ingesting. Rules reading its tables are dead right now, not hypothetically.',
      initialValue: true,
    }),
    defineField({
      name: 'estimatedGbPerDay',
      title: 'Estimated GB per day',
      type: 'number',
      description: 'Total across every table this connector provides. Used for cost questions.',
      validation: (Rule) => Rule.min(0),
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 3,
      description: 'Anything an on-call engineer would want to know. Read by the agent as prose.',
    }),
  ],
  preview: {
    select: {title: 'name', license: 'licenseRequired', enabled: 'enabled'},
    prepare({title, license, enabled}) {
      return {
        title,
        subtitle: `${license ?? 'no license set'}${enabled === false ? ' · DISABLED' : ''}`,
      }
    },
  },
})

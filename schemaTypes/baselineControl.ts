import {defineType, defineField} from 'sanity'
import {SOURCE_AUTHORITIES} from './constants'

/**
 * A hardening control from a benchmark, and the bridge between posture and detection.
 *
 * Two fields carry the weight:
 *
 *   compensatingRules[] — what detects the thing this control would have prevented.
 *                         Lets the agent answer "we cannot enforce this yet, what
 *                         watches for it meanwhile".
 *
 *   conflictsWith[]     — a self-reference between two controls that claim the same
 *                         setting with different values. This models the disagreement
 *                         in the structured data, so the graph can list contested
 *                         controls while the Knowledge Base explains the resolution.
 *                         CIS M365 v7.0.0 asks for a 16-character break-glass password;
 *                         MCSB PA-5 asks for 32. Both documents are in the corpus.
 */
export const baselineControl = defineType({
  name: 'baselineControl',
  title: 'Baseline control',
  type: 'document',
  description:
    'One hardening recommendation from a named authority. Controls that address the same setting with different values reference each other through conflictsWith, so contested guidance is queryable rather than buried in prose.',
  fields: [
    defineField({
      name: 'controlId',
      title: 'Control ID',
      type: 'string',
      description:
        'Identifier as the source numbers it, e.g. "5.2.2.4" for CIS or "PA-5" for MCSB. Not globally unique on its own — always pair it with sourceAuthority.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'The recommendation, as the source words it.',
      validation: (Rule) => Rule.required().min(8),
    }),
    defineField({
      name: 'sourceAuthority',
      title: 'Source authority',
      type: 'string',
      description:
        'Who publishes this recommendation. When two controls conflict, this is the field that decides which one you are quoting.',
      options: {list: [...SOURCE_AUTHORITIES], layout: 'dropdown'},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sourceLocation',
      title: 'Source location',
      type: 'string',
      description:
        'Page number, section or URL, precise enough that a reader can check the claim. Required, because an unverifiable control is an opinion.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'setting',
      title: 'Setting governed',
      type: 'string',
      description:
        'A short, normalized name for what is being configured, e.g. "admin-signin-frequency" or "breakglass-password-length". Two controls sharing a setting value are candidates for conflictsWith.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'recommendedValue',
      title: 'Recommended value',
      type: 'string',
      description:
        'The value the source asks for, verbatim, units included — "4 hours or less", "16 characters", "Never persistent". Do not normalize away the difference between sources; the difference is the point.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'enforced',
      title: 'Enforced in our tenant',
      type: 'boolean',
      description:
        'False means this control is not in place, which is what makes compensatingRules relevant rather than academic.',
      initialValue: false,
    }),
    defineField({
      name: 'conflictsWith',
      title: 'Conflicts with',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'baselineControl'}]}],
      description:
        'Other controls that govern the same setting with a different recommended value. Populate this in both directions. A control listed here is one the agent must present with both claims and their sources rather than picking silently.',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'mitigatesTechniques',
      title: 'Mitigates techniques',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'technique'}]}],
      description:
        'Techniques this control prevents or makes harder. Prevention, not detection — that is what separates this from a detection rule.',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'compensatingRules',
      title: 'Compensating detection rules',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'detectionRule'}]}],
      description:
        'Rules that watch for the thing this control would have blocked. Relevant when enforced is false: the question "what covers us until we can turn this on" is answered here.',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 4,
      description:
        'Why the control is or is not enforced here, and any known caveat in the source itself — including a source that contradicts its own remediation steps.',
    }),
  ],
  preview: {
    select: {
      controlId: 'controlId',
      title: 'title',
      authority: 'sourceAuthority',
      value: 'recommendedValue',
      enforced: 'enforced',
    },
    prepare({controlId, title, authority, value, enforced}) {
      return {
        title: `${controlId} — ${title}`,
        subtitle: `${authority} · ${value ?? '?'} · ${enforced ? 'enforced' : 'NOT enforced'}`,
      }
    },
  },
})

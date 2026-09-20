/**
 * Tests for GROQ parameter inlining.
 *
 * Run with:  node --experimental-strip-types lib/mcp.test.ts
 *
 * This is here because of what the probe found: Sanity Context's `groq_query`
 * tool takes a single `query` string and no `params` object. So every value the
 * agent asks about — a connector slug, a tactic id, a setting name — has to be
 * written into the query text before it is sent.
 *
 * That turns a convenience function into the security boundary of the whole
 * application. The values are chosen by a language model, from text a user
 * typed; if `"` inside one of them can end the string literal it sits in, the
 * rest of that value is GROQ that runs against the dataset. The token this runs
 * under is read-only, so the worst case is disclosure rather than destruction —
 * but the dataset is the answer, and an attacker-controlled query is an
 * attacker-controlled answer.
 *
 * Hence JSON.stringify rather than hand-rolled quoting, and hence these cases.
 */

import {inlineParams, unwrapGroqResult} from './mcp.ts'

let fail = 0

function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`ok   ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}`)
    console.log(`       got  ${JSON.stringify(got)}`)
    console.log(`       want ${JSON.stringify(want)}`)
  }
}

/* --- The ordinary cases -------------------------------------------- */

check('a plain string is quoted',
  inlineParams('*[slug.current == $slug]', {slug: 'defender-for-identity'}),
  '*[slug.current == "defender-for-identity"]')

check('an array of strings becomes a GROQ array literal',
  inlineParams('*[status in $statuses]', {statuses: ['validated', 'tuned']}),
  '*[status in ["validated","tuned"]]')

check('numbers and booleans are not quoted',
  inlineParams('*[gbPerDay > $min && enabled == $on]', {min: 30, on: true}),
  '*[gbPerDay > 30 && enabled == true]')

check('the same parameter is substituted everywhere it appears',
  inlineParams('{"a": *[x == $s], "b": *[y == $s]}', {s: 'T1078'}),
  '{"a": *[x == "T1078"], "b": *[y == "T1078"]}')

check('null is a literal, not the string "null"',
  inlineParams('*[parent == $p]', {p: null}),
  '*[parent == null]')

/* --- The prefix trap ---------------------------------------------- *
 * Naive sequential replacement of $setting before $settings rewrites the first
 * eight characters of $settings and leaves a dangling "s". One pass over the
 * query with a single regex cannot do that, which is why it is one pass.
 * ------------------------------------------------------------------ */

check('a parameter name that prefixes another is not partially replaced',
  inlineParams('{"one": $setting, "many": $settings}', {
    setting: 'breakglass-password-length',
    settings: ['a', 'b'],
  }),
  '{"one": "breakglass-password-length", "many": ["a","b"]}')

check('an unknown $name is left alone for GROQ to reject',
  inlineParams('*[a == $known && b == $unknown]', {known: 1}),
  '*[a == 1 && b == $unknown]')

/* --- Injection ---------------------------------------------------- *
 * Each of these is a value that, concatenated naively, would break out of its
 * string literal and change what the query returns. After escaping, every one
 * of them stays a single harmless string.
 * ------------------------------------------------------------------ */

const escapes: {name: string; value: string}[] = [
  {name: 'closing quote then a new filter', value: 'x"] || *[_type == "connector'},
  {name: 'closing quote then a projection', value: 'x"]{...}//'},
  {name: 'an always-true disjunction', value: 'x" || true || "'},
  {name: 'a backslash before the quote', value: 'x\\"'},
  {name: 'a newline', value: 'a\nb'},
  {name: 'a GROQ comment', value: 'x // rest of the query'},
  {name: 'a dollar sign, so the output is not re-substituted', value: '$slug'},
]

const TEMPLATE = '*[slug.current == $slug]'

/**
 * Remove every complete JSON string literal.
 *
 * What is left is the query's syntax — the part GROQ parses as structure. If
 * that skeleton is unchanged, nothing the value contained escaped its quotes,
 * however alarming the value looks when read as text.
 */
const skeleton = (q: string) => q.replace(/"(?:[^"\\]|\\.)*"/g, '')

for (const {name, value} of escapes) {
  const query = inlineParams(TEMPLATE, {slug: value})

  // 1. The substituted slot must be exactly one JSON string that parses back to
  //    the original value, byte for byte.
  const m = /^\*\[slug\.current == (.*)\]$/.exec(query)
  let roundTripped: unknown
  try {
    roundTripped = JSON.parse(m?.[1] ?? '')
  } catch {
    roundTripped = '<not a valid JSON string>'
  }
  check(`escaped: ${name}`, roundTripped, value)

  // 2. And the surrounding syntax must be untouched.
  //
  //    Counting occurrences of `*[` would be the obvious check and is the wrong
  //    one: the first value below legitimately CONTAINS the text `*[`, safely
  //    inside the string literal, so a substring count reports two filters where
  //    there is one. What matters is not whether the characters appear but
  //    whether they appear where GROQ would read them as structure.
  check(
    `escaped: ${name} — the query's syntax is unchanged`,
    skeleton(query),
    skeleton(TEMPLATE.replace('$slug', '""')),
  )
}

// One pass means a substituted value containing `$slug` is not substituted again.
check('substitution is not recursive',
  inlineParams('*[a == $x]', {x: '$x', y: 'should never appear'}),
  '*[a == "$x"]')

/* --- Unwrapping the tool's envelope -------------------------------- */

check('the meta wrapper is stripped',
  unwrapGroqResult('{"meta":{"resultCount":1},"result":40}'), 40)

check('an object without result is returned whole',
  unwrapGroqResult('{"a":1}'), {a: 1})

check('non-JSON returns null so the caller can fall back',
  unwrapGroqResult('Error: dataset not found'), null)

check('an empty GROQ result is null, not an error',
  unwrapGroqResult('{"meta":{},"result":null}'), null)

console.log(`\n${fail === 0 ? 'todas las aserciones pasan' : `${fail} fallo(s)`}`)
process.exit(fail ? 1 : 0)

/**
 * Tests for provider selection.
 *
 *   node --experimental-strip-types lib/model.test.ts
 *
 * No network: constructing a client from a key is offline, so every branch of
 * the choice can be checked. Worth testing because this is the code path that
 * decides whether the demo runs at all, and its failure mode is a configuration
 * error at the worst possible moment.
 *
 * The error messages are asserted as carefully as the return values. A person
 * hitting these has one key and needs to know which variable to put it in;
 * "no provider configured" would be true and useless.
 */

import {resolveModel, providerKeyNames} from './model.ts'

let fail = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) {
    console.log(`ok   ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}`)
    console.log(`       got  ${JSON.stringify(got)}`)
    console.log(`       want ${JSON.stringify(want)}`)
  }
}

/** A fake environment. */
const env = (vars: Record<string, string>) => (key: string) => vars[key]

/* --- One key each ------------------------------------------------- */

for (const [envKey, provider, model] of [
  ['ANTHROPIC_API_KEY', 'anthropic', 'claude-sonnet-5'],
  ['OPENAI_API_KEY', 'openai', 'gpt-5'],
  ['GOOGLE_GENERATIVE_AI_API_KEY', 'google', 'gemini-3.5-flash'],
] as const) {
  const r = resolveModel(env({[envKey]: 'test-key'}))
  check(`${envKey} selects ${provider}`, [r.provider, r.modelId], [provider, model])
  check(`${provider} reports a readable label`, r.label.length > 3, true)
}

/* --- Several keys ------------------------------------------------- */

const many = env({
  ANTHROPIC_API_KEY: 'a',
  OPENAI_API_KEY: 'o',
  GOOGLE_GENERATIVE_AI_API_KEY: 'g',
})
check('with all three set, the preference order decides', resolveModel(many).provider, 'anthropic')

check(
  'AGENT_PROVIDER overrides the preference',
  resolveModel(env({
    ANTHROPIC_API_KEY: 'a',
    OPENAI_API_KEY: 'o',
    AGENT_PROVIDER: 'openai',
  })).provider,
  'openai',
)

check(
  'AGENT_PROVIDER is case-insensitive and trimmed',
  resolveModel(env({GOOGLE_GENERATIVE_AI_API_KEY: 'g', AGENT_PROVIDER: '  Google '})).provider,
  'google',
)

check(
  'AGENT_MODEL overrides the default model',
  resolveModel(env({OPENAI_API_KEY: 'o', AGENT_MODEL: 'gpt-5-mini'})).modelId,
  'gpt-5-mini',
)

/* --- Whitespace-only keys do not count ---------------------------- *
 * A variable left as `OPENAI_API_KEY= ` in a .env file is not a key, and
 * treating it as one produces a 401 rather than a configuration message.
 * ------------------------------------------------------------------ */

check(
  'a blank key is not a configured provider',
  resolveModel(env({OPENAI_API_KEY: '   ', GOOGLE_GENERATIVE_AI_API_KEY: 'g'})).provider,
  'google',
)

/* --- The failures ------------------------------------------------- */

function errorFrom(read: (k: string) => string | undefined): string {
  try {
    resolveModel(read)
    return '(no error)'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const noKeys = errorFrom(env({}))
check('no keys at all is an error', noKeys !== '(no error)', true)
for (const name of providerKeyNames()) {
  check(`and it names ${name}`, noKeys.includes(name), true)
}
check(
  'and it says one is enough, so nobody hunts for the other two',
  noKeys.includes('Any one of them is enough'),
  true,
)

const badProvider = errorFrom(env({ANTHROPIC_API_KEY: 'a', AGENT_PROVIDER: 'ollama'}))
check('an unknown AGENT_PROVIDER is rejected', badProvider.includes('not one of'), true)
check('and the valid values are listed', badProvider.includes('anthropic, openai, google'), true)

const mismatch = errorFrom(env({ANTHROPIC_API_KEY: 'a', AGENT_PROVIDER: 'openai'}))
check(
  'forcing a provider whose key is missing names the missing variable',
  mismatch.includes('OPENAI_API_KEY'),
  true,
)
check(
  'and says which providers are actually configured',
  mismatch.includes('anthropic'),
  true,
)

console.log(`\n${fail === 0 ? 'todas las aserciones pasan' : `${fail} fallo(s)`}`)
process.exit(fail ? 1 : 0)

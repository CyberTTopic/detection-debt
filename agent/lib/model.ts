/**
 * Which model answers, and from which provider.
 *
 * WHY THIS IS NOT A ONE-LINE IMPORT
 * ---------------------------------
 * It was, until the account holding the only API key was revoked mid-build.
 * Nothing about this project needs a particular vendor: the interesting work is
 * the content model and the two Sanity Context endpoints, and the model is the
 * part that reads them. Hard-coding one provider made a submission deadline
 * depend on one account staying in good standing, which is a risk that has
 * nothing to do with whether the software is any good.
 *
 * So the provider is configuration. Set one API key and the rest follows:
 *
 *     ANTHROPIC_API_KEY=sk-ant-...     -> claude-sonnet-5
 *     OPENAI_API_KEY=sk-...            -> gpt-5
 *     GOOGLE_GENERATIVE_AI_API_KEY=... -> gemini-2.5-pro
 *
 * `AGENT_MODEL` overrides the default model, and `AGENT_PROVIDER` forces a
 * choice when several keys are present.
 *
 * This also matters for anyone else running it. A reader who wants to try the
 * agent should not have to open an account with a specific vendor first; they
 * use whichever key they already have. Google's is the one obtainable in a
 * couple of minutes with no payment method, which is worth knowing when a
 * deadline is close.
 *
 * WHAT IS NOT ABSTRACTED
 * ----------------------
 * The prompt. Tool descriptions, the routing table, the instruction to flag
 * synthetic fields — those are written once and every provider gets the same
 * text. Models differ in how well they follow it, and the honest way to find
 * that out is to run the same instructions against each rather than to tune a
 * separate prompt per vendor and then claim they all work.
 */

import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import {createGoogleGenerativeAI} from '@ai-sdk/google'
import type {LanguageModel} from 'ai'

export type ProviderName = 'anthropic' | 'openai' | 'google'

/** Where each provider's key comes from, and what to use when none is named. */
const PROVIDERS: Record<
  ProviderName,
  {envKey: string; defaultModel: string; label: string; keysAt: string}
> = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-5',
    label: 'Anthropic',
    keysAt: 'console.anthropic.com/settings/keys',
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5',
    label: 'OpenAI',
    keysAt: 'platform.openai.com/api-keys',
  },
  google: {
    envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    // Free of charge on the Gemini API's Free tier, which needs no billing
    // account. That makes it the one default anybody can run without spending
    // anything — including a reader who wants to try this.
    //
    // Deliberately NOT the newest Flash. The first choice here was the model
    // released that week, and it answered with "currently experiencing high
    // demand" on the free tier, after three automatic retries. A newly launched
    // model is where free-tier contention concentrates, so the default is a
    // settled one and AGENT_MODEL moves to a newer model when it has capacity.
    //
    // It is still a Flash model, so it is the weakest of the three defaults at
    // following a long prompt. The routing table and the instruction to report
    // both sides of a contested setting are exactly the kind of thing a smaller
    // model drops. The Pro models are not on the free tier.
    defaultModel: 'gemini-3.5-flash',
    label: 'Google',
    keysAt: 'aistudio.google.com/apikey',
  },
}

/**
 * Order of preference when more than one key is configured.
 *
 * Arbitrary, and deliberately so — it only decides the default. Anyone who
 * cares sets AGENT_PROVIDER, and the resolved choice is reported in the UI so
 * nobody has to guess which one answered.
 */
const PREFERENCE: ProviderName[] = ['anthropic', 'openai', 'google']

export interface ResolvedModel {
  model: LanguageModel
  provider: ProviderName
  modelId: string
  /** For the interface: which provider and model produced an answer. */
  label: string
}

/**
 * Pick a provider from whatever is configured.
 *
 * `read` is passed in rather than reading process.env directly, so this works
 * with the .env.local loader in env.ts and stays testable.
 */
export function resolveModel(read: (key: string) => string | undefined): ResolvedModel {
  const forced = read('AGENT_PROVIDER')?.trim().toLowerCase()

  if (forced && !(forced in PROVIDERS)) {
    throw new Error(
      `AGENT_PROVIDER is "${forced}", which is not one of: ${Object.keys(PROVIDERS).join(', ')}.`,
    )
  }

  const available = PREFERENCE.filter((p) => {
    const key = read(PROVIDERS[p].envKey)
    return Boolean(key && key.trim())
  })

  if (available.length === 0) {
    throw new Error(
      'No model provider is configured. Set ONE of these in .env.local:\n' +
        Object.entries(PROVIDERS)
          .map(([name, p]) => `  ${p.envKey.padEnd(30)} ${p.label} — keys at ${p.keysAt}`)
          .join('\n') +
        '\n\nAny one of them is enough; the agent uses the same prompt and tools either way.',
    )
  }

  const chosen = (forced as ProviderName | undefined) ?? available[0]

  if (forced && !available.includes(chosen)) {
    throw new Error(
      `AGENT_PROVIDER is "${forced}" but ${PROVIDERS[chosen].envKey} is not set. ` +
        `Configured providers: ${available.join(', ') || 'none'}.`,
    )
  }

  const spec = PROVIDERS[chosen]
  const apiKey = (read(spec.envKey) as string).trim()
  const modelId = read('AGENT_MODEL')?.trim() || spec.defaultModel

  // Each factory takes the key explicitly. The key comes from the .env.local
  // loader as often as from the real environment, and letting the SDK read
  // process.env itself would silently work in one case and not the other.
  let model: LanguageModel
  switch (chosen) {
    case 'anthropic':
      model = createAnthropic({apiKey})(modelId)
      break
    case 'openai':
      model = createOpenAI({apiKey})(modelId)
      break
    case 'google':
      model = createGoogleGenerativeAI({apiKey})(modelId)
      break
  }

  return {model, provider: chosen, modelId, label: `${spec.label} ${modelId}`}
}

/** Names of every provider key, for the configuration error in env.ts. */
export function providerKeyNames(): string[] {
  return Object.values(PROVIDERS).map((p) => p.envKey)
}

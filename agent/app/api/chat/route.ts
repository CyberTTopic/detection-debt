/**
 * The agent turn.
 *
 * Runs on the Node runtime, not Edge, for two reasons: the configuration loader
 * reads `.env.local` from disk with `node:fs`, and under a TLS-inspecting
 * corporate proxy the outbound call to Context needs Node's system-CA support.
 *
 * The organization token is read here and handed to the clients here. It is
 * never imported into a module that anything under `components/` can reach, so
 * there is no path by which it could be bundled toward the browser.
 */

import {convertToModelMessages, stepCountIs, streamText, type UIMessage} from 'ai'

import {config} from '@/lib/env.ts'
import {ContextClient} from '@/lib/mcp.ts'
import {resolveModel} from '@/lib/model.ts'
import {callerKey, checkRateLimit} from '@/lib/rate-limit.ts'
import {buildTools} from '@/lib/tools.ts'
import {systemPrompt} from '@/lib/prompt.ts'

/** Some questions walk the graph several times; the default 10s is not enough. */
export const maxDuration = 60

/**
 * Is this the provider saying "you have used your allowance"?
 *
 * Matched on the text because the three providers raise it as different error
 * types with different shapes, and the only thing they reliably share is saying
 * so in the message. Deliberately broad: a false positive shows a friendlier
 * message than the truth, which is a much smaller cost than showing a reader
 * `generate_content_free_tier_requests, limit: 20` and letting them conclude
 * the application is broken.
 */
function isQuotaError(error: Error): boolean {
  const text = `${error.name} ${error.message}`.toLowerCase()
  return (
    text.includes('quota') ||
    text.includes('rate limit') ||
    text.includes('rate_limit') ||
    text.includes('429') ||
    text.includes('resource_exhausted') ||
    text.includes('resource has been exhausted') ||
    text.includes('insufficient_quota') ||
    text.includes('high demand')
  )
}

/**
 * Clients live at module scope so the two caches survive between requests: the
 * tool list, and `initial_context`. The latter is the dataset's own instructions
 * plus its schema overview — static, several kilobytes, and needed on every
 * single turn. Re-fetching it per request would add a round trip to Sanity
 * before the model has read a word of the question.
 */
let clients: {graph: ContextClient; docs: ContextClient} | null = null
let cachedSystem: string | null = null

function getClients() {
  if (clients) return clients
  const cfg = config()
  clients = {
    graph: new ContextClient(cfg.groqUrl, cfg.organizationToken, 'graph'),
    docs: new ContextClient(cfg.kbUrl, cfg.organizationToken, 'docs'),
  }
  return clients
}

/**
 * Which model is answering, and is the rest of the configuration present?
 *
 * The interface asks for this on load and shows it beside the tool trace. Naming
 * the model matters here for the same reason the trace does: an answer about
 * what a security estate is missing should carry its provenance, and "which
 * model wrote this" is part of that. It also turns a misconfiguration into a
 * visible message before anyone types a question, rather than a failed turn.
 */
export async function GET() {
  try {
    const cfg = config()
    const chosen = resolveModel(cfg.read)
    return Response.json({
      ok: true,
      model: chosen.label,
      provider: chosen.provider,
      projectId: cfg.projectId ?? null,
      dataset: cfg.dataset ?? null,
    })
  } catch (err) {
    return Response.json(
      {ok: false, error: err instanceof Error ? err.message : 'Configuration error.'},
      {status: 500},
    )
  }
}

export async function POST(req: Request) {
  // Before anything that costs money. The deployed URL is published, so this is
  // the one thing standing between a script and the demo's quota.
  const limit = checkRateLimit(callerKey(req))
  if (!limit.ok) {
    return Response.json(
      {error: limit.message},
      {status: 429, headers: {'retry-after': String(limit.retryAfter)}},
    )
  }

  let messages: UIMessage[]
  try {
    const body = (await req.json()) as {messages?: UIMessage[]}
    messages = body.messages ?? []
  } catch {
    return Response.json({error: 'Malformed request body.'}, {status: 400})
  }

  if (messages.length === 0) {
    return Response.json({error: 'No messages.'}, {status: 400})
  }

  let cfg: ReturnType<typeof config>
  try {
    cfg = config()
  } catch (err) {
    // config() throws with the names of the missing variables and where each one
    // comes from. That text is the whole value of the error, so it is passed
    // through rather than replaced with "internal error".
    return Response.json(
      {error: err instanceof Error ? err.message : 'Configuration error.'},
      {status: 500},
    )
  }

  const {graph, docs} = getClients()

  // The dataset's Instructions field, written in the Context app, is where the
  // coverage conventions are defined for anything reading this dataset. Pulling
  // it into the system prompt means those conventions are stated once, in Sanity,
  // and the agent inherits them rather than restating them in code that drifts.
  if (cachedSystem === null) {
    try {
      cachedSystem = systemPrompt(await graph.initialContext())
    } catch (err) {
      return Response.json(
        {
          error:
            `Could not reach the graph endpoint.\n\n` +
            (err instanceof Error ? err.message : 'Unknown error.'),
        },
        {status: 502},
      )
    }
  }

  // Whichever provider has a key. Its own error names all three options, so it
  // is surfaced to the user rather than replaced.
  let chosen: ReturnType<typeof resolveModel>
  try {
    chosen = resolveModel(cfg.read)
  } catch (err) {
    return Response.json(
      {error: err instanceof Error ? err.message : 'No model provider configured.'},
      {status: 500},
    )
  }

  const result = streamText({
    model: chosen.model,
    system: cachedSystem,
    // Async in ai v7. It was synchronous in v5, and the type error it produces
    // when you forget the await is about arrays rather than promises.
    messages: await convertToModelMessages(messages),
    tools: buildTools(graph, docs),

    // Enough for: read the schema, query the graph, read two knowledge base
    // entries, and answer. A loop that keeps querying is a loop that keeps
    // spending, and a question needing more than this is one the agent should be
    // answering in words instead.
    //
    // Lowered from twelve after the deployed demo exhausted its upstream quota.
    // Each step is one model request, so this number and the per-caller limit in
    // lib/rate-limit.ts multiply together against a budget of twenty requests a
    // minute. Eight covers every question the demo is built around — the longest
    // observed run used six — while keeping the worst case affordable.
    stopWhen: stepCountIs(8),

    temperature: 0,

    onError({error}) {
      // Logged without the error object: under a TLS-inspecting proxy a fetch
      // failure's cause chain holds the request, and the request holds the
      // Authorization header. This project has already leaked a token that way
      // once, from a stack trace pasted into a chat window.
      console.error(
        '[agent] turn failed:',
        error instanceof Error ? error.message : 'unknown error',
      )
    },
  })

  return result.toUIMessageStreamResponse({
    // Which model produced the answer, for anyone inspecting the response.
    headers: {'x-agent-model': chosen.label},

    // Surfaced to the user in the UI. Same discipline: a sentence, not an object.
    onError(error) {
      if (!(error instanceof Error)) return 'The turn failed. Check the server console.'

      // The provider's own quota message is accurate and unreadable: it names a
      // metric, a numeric limit and a retry delay to three decimal places. A
      // reader seeing it concludes the demo is broken. It is not broken — it is
      // a shared free quota and somebody got there first, which is worth saying
      // in those words, along with the way out.
      if (isQuotaError(error)) {
        return (
          'The shared free quota for this demo is exhausted for the moment — the model ' +
          'provider allows twenty requests a minute across the whole project, and one ' +
          'question costs several. This is a quota limit, not a failure: wait about a ' +
          'minute and ask again. To skip the queue entirely, the repository runs locally ' +
          'with your own API key from any of three providers, and needs one environment ' +
          'variable to do it.'
        )
      }

      return error.message
    },
  })
}

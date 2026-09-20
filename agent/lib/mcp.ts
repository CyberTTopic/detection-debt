/**
 * A minimal MCP client for Sanity Context's hosted endpoints.
 *
 * WHY NOT A LIBRARY
 * -----------------
 * Sanity Context serves MCP as plain JSON-RPC 2.0 over an HTTPS POST with a
 * bearer token. That is about sixty lines of fetch. Against that, an MCP client
 * package would add a dependency whose API moved twice in the last two majors,
 * for a transport this project already proved by hand from PowerShell before any
 * TypeScript existed. The trade is deliberate: a little code I can read for a
 * dependency I would have to track.
 *
 * It also buys two things a generic client would not give:
 *   - every call is recorded, so the UI can show what the agent actually asked
 *     rather than a spinner;
 *   - errors are rewritten before they escape.
 *
 * THAT SECOND POINT IS NOT COSMETIC
 * ---------------------------------
 * Earlier in this project a raw client error was rethrown from an import script
 * and its stack trace carried the request headers, which meant it carried a live
 * `Authorization: Bearer <project token>` into a chat window. The token had to
 * be revoked and reissued. So nothing here ever puts a caught error object into
 * a message, a log line, or a `cause`. Failures are re-described from the status
 * code and the response body, and the body is checked for the token before it is
 * quoted. The discipline costs a few lines and removes a whole class of leak.
 */

export interface McpToolSpec {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

export interface McpCallResult {
  /** All text content blocks, joined. */
  text: string
  /** True when the server reported the tool itself failed. */
  isError: boolean
}

/** One entry in the visible trace of what the agent did. */
export interface McpCallRecord {
  endpoint: string
  tool: string
  args: Record<string, unknown>
  ms: number
  ok: boolean
  /** Characters returned. Useful for spotting a query that pulled far too much. */
  bytes: number
}

/**
 * Raised instead of the underlying fetch/HTTP error.
 *
 * Carries no `cause` on purpose: a cause chain is exactly how request headers
 * travelled into a stack trace the first time.
 */
export class McpError extends Error {
  readonly endpoint: string
  readonly status?: number

  constructor(message: string, endpoint: string, status?: number) {
    super(message)
    this.name = 'McpError'
    this.endpoint = endpoint
    this.status = status
  }
}

/* ------------------------------------------------------------------ *
 * Response parsing.
 *
 * The endpoint is asked for `application/json, text/event-stream` because that
 * is what the Streamable HTTP transport expects, and the server may answer with
 * either. A single JSON-RPC response arriving as one SSE `data:` frame is the
 * common case; both shapes are handled rather than assumed.
 * ------------------------------------------------------------------ */

function parseSse(body: string): unknown {
  const frames: unknown[] = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      frames.push(JSON.parse(payload))
    } catch {
      // A frame that is not JSON is not a JSON-RPC response; skip it.
    }
  }
  if (frames.length === 0) throw new Error('no JSON-RPC frame in the event stream')
  // The last frame carrying a `result` or `error` is the answer.
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i] as Record<string, unknown>
    if (f && (('result' in f) || ('error' in f))) return f
  }
  return frames[frames.length - 1]
}

/** Translate a status code into something a human can act on. */
function explainStatus(status: number, body: string): string {
  switch (status) {
    case 401:
      return 'HTTP 401: the token is missing or malformed.'
    case 403:
      return (
        'HTTP 403: Context rejected this token. A PROJECT token returns exactly this ' +
        '(contextGrantRequired); Context needs an ORGANIZATION token with the Context Viewer role.'
      )
    case 404:
      return 'HTTP 404: no endpoint with that name exists on this organization.'
    case 429:
      return 'HTTP 429: rate limited by Context.'
    default:
      return `HTTP ${status}.` + (body ? ' The server put the reason in the body.' : '')
  }
}

/* ------------------------------------------------------------------ *
 * The client.
 * ------------------------------------------------------------------ */

export class ContextClient {
  private id = 0
  private toolCache: McpToolSpec[] | null = null
  private initialContextCache: string | null = null
  private sessionId: string | null = null
  readonly calls: McpCallRecord[] = []

  /** The endpoint URL from the Context app. */
  private readonly url: string
  /** Organization-level token with Context Viewer. */
  private readonly token: string
  /** A short name used in errors and in the trace: 'graph' or 'docs'. */
  readonly label: string

  // Written out longhand rather than as constructor parameter properties: those
  // need a real TypeScript transform, and the test files here run under Node's
  // strip-only mode, which erases types but rewrites nothing.
  constructor(url: string, token: string, label: string) {
    if (!url) throw new McpError(`No endpoint URL configured for "${label}".`, label)
    if (!token) throw new McpError(`No organization token configured for "${label}".`, label)
    this.url = url
    this.token = token
    this.label = label
  }

  /** Redact anything that looks like the token before quoting a server body. */
  private redact(text: string): string {
    if (!text) return text
    let out = text.split(this.token).join('<token redacted>')
    // Belt and braces: any bearer-looking string, whether or not it is ours.
    out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, 'Bearer <redacted>')
    out = out.replace(/\bsk[a-zA-Z0-9]{20,}\b/g, '<redacted>')
    return out
  }

  private async rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    let res: Response
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({jsonrpc: '2.0', id: ++this.id, method, ...(params ? {params} : {})}),
      })
    } catch {
      // Deliberately not forwarding the caught error: under a TLS-inspecting
      // corporate proxy its message is a certificate chain, and its cause is a
      // request object holding the Authorization header.
      throw new McpError(
        `Could not reach the ${this.label} endpoint. If this machine inspects TLS, Node needs ` +
          `to trust the local CA: run with NODE_OPTIONS=--use-system-ca. Never disable ` +
          `verification with NODE_TLS_REJECT_UNAUTHORIZED=0.`,
        this.label,
      )
    }

    const returnedSession = res.headers.get('mcp-session-id')
    if (returnedSession) this.sessionId = returnedSession

    const raw = await res.text()

    if (!res.ok) {
      throw new McpError(
        `${explainStatus(res.status, raw)}\n${this.redact(raw).slice(0, 1200)}`,
        this.label,
        res.status,
      )
    }

    let parsed: unknown
    const ct = res.headers.get('content-type') ?? ''
    try {
      parsed = ct.includes('text/event-stream') ? parseSse(raw) : JSON.parse(raw)
    } catch {
      throw new McpError(
        `The ${this.label} endpoint returned something that is not JSON-RPC:\n` +
          this.redact(raw).slice(0, 600),
        this.label,
        res.status,
      )
    }

    const env = parsed as {result?: unknown; error?: {code?: number; message?: string}}
    if (env.error) {
      // The real reason usually lives here rather than in the status code. The
      // -32004 "deploy a Studio first" error was invisible until this was read.
      throw new McpError(
        `The ${this.label} endpoint refused the request` +
          (env.error.code !== undefined ? ` (JSON-RPC ${env.error.code})` : '') +
          `: ${this.redact(env.error.message ?? 'no message given')}`,
        this.label,
      )
    }
    return env.result
  }

  /** The tools this endpoint serves. Cached; the set is fixed per endpoint mode. */
  async listTools(): Promise<McpToolSpec[]> {
    if (this.toolCache) return this.toolCache
    const result = (await this.rpc('tools/list')) as {tools?: McpToolSpec[]}
    this.toolCache = result?.tools ?? []
    return this.toolCache
  }

  /** True when the named tool declares the named argument. */
  async toolAccepts(tool: string, argument: string): Promise<boolean> {
    const spec = (await this.listTools()).find((t) => t.name === tool)
    return Boolean(spec?.inputSchema?.properties && argument in spec.inputSchema.properties)
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    const started = Date.now()
    let record: McpCallRecord = {
      endpoint: this.label,
      tool: name,
      args,
      ms: 0,
      ok: false,
      bytes: 0,
    }

    try {
      const result = (await this.rpc('tools/call', {name, arguments: args})) as {
        content?: {type: string; text?: string}[]
        isError?: boolean
      }

      const text = (result?.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n')

      record = {...record, ms: Date.now() - started, ok: !result?.isError, bytes: text.length}
      this.calls.push(record)

      return {text, isError: Boolean(result?.isError)}
    } catch (err) {
      this.calls.push({...record, ms: Date.now() - started})
      // McpError is already safe to surface. Anything else is reduced to a
      // sentence rather than forwarded, for the reason in the file header.
      if (err instanceof McpError) throw err
      throw new McpError(
        `Calling ${name} on the ${this.label} endpoint failed.`,
        this.label,
      )
    }
  }

  /**
   * The endpoint's own briefing: its Instructions, and for GROQ mode a schema
   * summary. Cached because it is static, sizeable, and needed on every turn.
   */
  async initialContext(): Promise<string> {
    if (this.initialContextCache !== null) return this.initialContextCache
    const {text} = await this.callTool('initial_context', {})
    this.initialContextCache = text
    return text
  }
}

/* ------------------------------------------------------------------ *
 * GROQ parameters.
 *
 * `groq_query` may or may not accept a `params` object depending on the server
 * version. Rather than depend on which, the shape is read from the tool's own
 * schema at call time, and when it is absent the values are inlined.
 *
 * Inlining is done with JSON.stringify because GROQ literal syntax for strings,
 * numbers, booleans and arrays of those is JSON-compatible — and because
 * hand-rolling string quoting is how injection bugs get written. Substitution
 * happens in one pass over the query so that `$setting` cannot be matched by a
 * prefix of `$settings`.
 * ------------------------------------------------------------------ */

export function inlineParams(query: string, params: Record<string, unknown>): string {
  return query.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => {
    if (!(name in params)) return whole // leave unknown $names for GROQ to complain about
    return JSON.stringify(params[name])
  })
}

/**
 * Run a parameterised GROQ query through Context, whichever calling convention
 * the endpoint supports.
 */
export async function runGroq(
  client: ContextClient,
  query: string,
  params: Record<string, unknown> = {},
): Promise<{text: string; isError: boolean; sentInline: boolean}> {
  const hasParams = Object.keys(params).length > 0
  if (!hasParams) {
    const r = await client.callTool('groq_query', {query})
    return {...r, sentInline: false}
  }

  if (await client.toolAccepts('groq_query', 'params')) {
    const r = await client.callTool('groq_query', {query, params})
    return {...r, sentInline: false}
  }

  const r = await client.callTool('groq_query', {query: inlineParams(query, params)})
  return {...r, sentInline: true}
}

/**
 * Pull the `result` field out of what `groq_query` returns.
 *
 * The tool answers with a JSON envelope — `{meta: {...}, result: ...}` — and the
 * meta is worth keeping out of the model's context window when only the data is
 * wanted. Returns null rather than throwing when the shape is unexpected, so a
 * caller can fall back to handing the model the raw text.
 */
export function unwrapGroqResult(text: string): unknown | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return 'result' in parsed ? parsed.result : parsed
  } catch {
    return null
  }
}

/**
 * Did the server hand back everything it matched?
 *
 * The envelope carries `meta.resultCount` and `meta.returnedCount`. When they
 * differ, the query matched more documents than were returned, and any set
 * arithmetic performed on the answer is arithmetic on a subset — which yields a
 * smaller loss than the truth, in the direction that reads as good news.
 *
 * This was written after chasing a wrong coverage answer that turned out to have
 * a different cause. It was not the cause that time, and the reason it took a
 * while to rule out is that `unwrapGroqResult` threw the envelope away, so
 * nothing downstream could tell a complete answer from a clipped one. Keeping
 * the check is cheap; not having it cost an hour.
 *
 * Returns null when the answer is complete or the counts are absent.
 */
export function truncationWarning(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as {meta?: {resultCount?: unknown; returnedCount?: unknown}}
    const matched = parsed.meta?.resultCount
    const returned = parsed.meta?.returnedCount
    if (typeof matched !== 'number' || typeof returned !== 'number') return null
    if (returned >= matched) return null
    return (
      `The dataset matched ${matched} documents and returned only ${returned}. ` +
      `Any count or set difference computed from this is short by at least ` +
      `${matched - returned} documents. Say so instead of reporting the number.`
    )
  } catch {
    return null
  }
}

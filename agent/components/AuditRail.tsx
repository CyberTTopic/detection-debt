'use client'

import {useEffect, useState} from 'react'
import {getToolName, isToolUIPart, type UIMessage} from 'ai'

/**
 * The audit rail: every tool call the agent made, and which endpoint served it.
 *
 * This is the part of the interface worth building. The agent's answers are
 * about what is missing from a security estate, and a claim about absence is
 * only as good as the reader's ability to check it. So the reader gets to see
 * that a coverage question went to the graph and a guidance question went to the
 * docs — and, when it matters, that the answer was cross-checked.
 *
 * It is also the honest failure surface. A call that came back empty appears
 * here as an empty call rather than being smoothed over by the prose.
 */

/** Which endpoint a tool talks to. Derived from the tool name, not reported by it. */
function endpointOf(tool: string): 'graph' | 'docs' | 'local' {
  if (tool.startsWith('docs_')) return 'docs'
  return 'graph'
}

/** The one argument worth showing, so the rail stays scannable. */
function summariseArgs(tool: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const a = input as Record<string, unknown>

  if (Array.isArray(a.connectorSlugs)) return a.connectorSlugs.join(', ')
  if (Array.isArray(a.paths)) {
    const paths = a.paths as string[]
    return paths.length > 2 ? `${paths.slice(0, 2).join(', ')} +${paths.length - 2}` : paths.join(', ')
  }
  if (typeof a.tableName === 'string') {
    return typeof a.targetTier === 'string' ? `${a.tableName} → ${a.targetTier}` : a.tableName
  }
  if (typeof a.why === 'string') return a.why
  if (typeof a.tactic === 'string') return a.tactic
  if (typeof a.attackId === 'string') return a.attackId
  if (typeof a.setting === 'string') return a.setting
  if (typeof a.type === 'string') return a.type
  return null
}

interface Call {
  key: string
  tool: string
  endpoint: 'graph' | 'docs' | 'local'
  args: string | null
  state: string
  errorText?: string
}

/**
 * Which model is configured, asked once on load.
 *
 * Named on the page for the same reason the calls are: provenance. And it turns
 * a missing or rejected API key into a sentence before anyone types a question,
 * instead of a turn that fails halfway.
 */
function useModel() {
  const [state, setState] = useState<{model?: string; error?: string}>({})

  useEffect(() => {
    let live = true
    fetch('/api/chat')
      .then((r) => r.json())
      .then((d: {ok?: boolean; model?: string; error?: string}) => {
        if (!live) return
        setState(d.ok ? {model: d.model} : {error: d.error ?? 'not configured'})
      })
      .catch(() => {
        if (live) setState({error: 'the server did not answer'})
      })
    return () => {
      live = false
    }
  }, [])

  return state
}

export function AuditRail({messages}: {messages: UIMessage[]}) {
  const model = useModel()
  const calls: Call[] = []

  for (const m of messages) {
    for (const part of m.parts) {
      if (!isToolUIPart(part)) continue
      const tool = getToolName(part)
      calls.push({
        key: part.toolCallId,
        tool,
        endpoint: endpointOf(tool),
        args: summariseArgs(tool, part.input),
        state: part.state,
        errorText: 'errorText' in part ? (part.errorText as string | undefined) : undefined,
      })
    }
  }

  return (
    <aside className="rail" aria-label="What the agent queried">
      <h2>What it queried</h2>
      <p className="rail-note">
        Every call, and which of the two Context endpoints served it. An answer about absence is
        only worth as much as your ability to check it.
      </p>

      {model.error ? (
        <p className="rail-config bad">Not ready: {model.error.split('\n')[0]}</p>
      ) : model.model ? (
        <p className="rail-config">
          Answered by <b>{model.model}</b>
        </p>
      ) : null}

      {calls.length === 0 ? (
        <p className="rail-empty">Nothing yet. Ask something and the queries appear here.</p>
      ) : (
        <ol>
          {calls.map((c) => (
            <li className="call" key={c.key}>
              <span className={`endpoint ${c.endpoint}`}>{c.endpoint}</span>
              <span>
                <span className="call-name">{c.tool}</span>
                {c.args ? <span className="call-args">{c.args}</span> : null}
                {c.state === 'output-error' ? (
                  <span className="call-state failed">
                    failed{c.errorText ? `: ${c.errorText.slice(0, 120)}` : ''}
                  </span>
                ) : c.state !== 'output-available' ? (
                  <span className="call-state">
                    {c.state === 'input-streaming' ? 'composing the query' : 'running'}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

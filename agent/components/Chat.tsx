'use client'

import {useState} from 'react'
import {useChat} from '@ai-sdk/react'
import {DefaultChatTransport, getToolName, isToolUIPart, type UIMessage} from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {AuditRail} from './AuditRail.tsx'
import {ImpactReport, type CoverageDeltaOutput} from './ImpactReport.tsx'

/**
 * The openers.
 *
 * Not a feature list. Each one is a question whose answer cannot be retrieved,
 * only computed — which is the claim the whole project rests on — and the second
 * line says what makes it hard rather than what it does.
 */
const OPENERS = [
  {
    ask: 'If we do not renew Defender for Endpoint, which ATT&CK techniques stop being watched?',
    why: 'A set difference across four tables and every rule that reads them.',
  },
  {
    ask: 'We are dropping Defender for Identity and Defender for Cloud Apps together. What goes dark?',
    why: 'Not the union of two separate answers — techniques held up by one rule from each die only when both go.',
  },
  {
    ask: 'Which Credential Access techniques have nothing validated covering them?',
    why: 'Absence. A search returns the rules that exist and never the gap.',
  },
  {
    ask: 'Can we move CommonSecurityLog to the Basic plan to cut cost, and what breaks?',
    why: 'Rule type, query shape, lookback window and a one-change-per-week cooldown, all at once.',
  },
  {
    ask: 'How long should the break-glass account password be?',
    why: 'CIS and the Microsoft Cloud Security Benchmark give different numbers. Both should come back.',
  },
]

function Answer({message}: {message: UIMessage}) {
  return (
    <div className="answer">
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <Markdown key={i} remarkPlugins={[remarkGfm]}>
              {part.text}
            </Markdown>
          )
        }

        // The one tool whose result is worth rendering as structure rather than
        // leaving to the prose. Everything else shows up in the audit rail.
        if (isToolUIPart(part) && getToolName(part) === 'coverage_delta') {
          if (part.state !== 'output-available') return null
          return <ImpactReport key={i} output={part.output as CoverageDeltaOutput} />
        }

        return null
      })}
    </div>
  )
}

export function Chat() {
  const [draft, setDraft] = useState('')

  const {messages, sendMessage, status, stop, error, clearError} = useChat({
    transport: new DefaultChatTransport({api: '/api/chat'}),
  })

  const busy = status === 'submitted' || status === 'streaming'

  function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    if (error) clearError()
    setDraft('')
    void sendMessage({text: trimmed})
  }

  return (
    <div className="columns">
      <div>
        {messages.map((m) => (
          <article className="turn" key={m.id}>
            {m.role === 'user' ? (
              <p className="asked">
                {m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
              </p>
            ) : (
              <Answer message={m} />
            )}
          </article>
        ))}

        {status === 'submitted' ? <p className="working">Reading the graph</p> : null}

        {error ? (
          <div className="notice" role="alert">
            <h3>The turn did not complete</h3>
            <p>{error.message}</p>
            <p>
              This needs an organization-level Sanity token with the Context Viewer role, both
              Context endpoint URLs, and a key for one model provider. When more than one provider
              key is set, the first configured one is used unless <code>AGENT_PROVIDER</code> names
              another — so a stale key left in place will be preferred over the one you just added.
            </p>
          </div>
        ) : null}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            ask(draft)
          }}
        >
          <label className="sr-only" htmlFor="ask" style={{position: 'absolute', left: '-9999px'}}>
            Your question
          </label>
          <textarea
            id="ask"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask(draft)
              }
            }}
            placeholder="Ask what breaks if a connector, licence or table goes away."
            rows={2}
          />
          <div className="composer-foot">
            <span className="hint">Enter to send, Shift+Enter for a new line</span>
            {busy ? (
              <button className="stop" type="button" onClick={() => stop()}>
                Stop
              </button>
            ) : (
              <button className="send" type="submit" disabled={!draft.trim()}>
                Ask
              </button>
            )}
          </div>
        </form>

        {messages.length === 0 ? (
          <ul className="openers">
            {OPENERS.map((o) => (
              <li key={o.ask}>
                <button type="button" onClick={() => ask(o.ask)}>
                  {o.ask}
                  <span className="why">{o.why}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <AuditRail messages={messages} />
    </div>
  )
}

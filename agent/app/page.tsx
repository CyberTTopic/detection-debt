import {Chat} from '@/components/Chat.tsx'

/**
 * The masthead states the question the project exists for, and the chain states
 * why it needs a graph. Both are the subject's own words rather than a pitch:
 * a reader who knows this domain should recognise the problem in one line.
 */
export default function Page() {
  return (
    <main className="shell">
      <header className="masthead">
        <h1>Detection Debt</h1>
        <p className="standfirst">
          What stops being detected when a telemetry source goes away? No document holds that
          answer. It exists only by walking the dependency chain and subtracting what is left.
        </p>
        <p className="chain" aria-label="The dependency chain this agent traverses">
          <b>connector</b>
          <span aria-hidden="true">&rarr;</span>
          <b>log table</b>
          <span aria-hidden="true">&rarr;</span>
          <b>detection rule</b>
          <span aria-hidden="true">&rarr;</span>
          <b>ATT&amp;CK technique</b>
          <span aria-hidden="true">&nbsp;&minus;&nbsp;</span>
          <b>what survives</b>
        </p>
      </header>

      <Chat />

      <footer className="colophon">
        <p>
          The agent reads a Sanity dataset through two{' '}
          <a href="https://www.sanity.io/docs/context" rel="noreferrer">
            Sanity Context
          </a>{' '}
          endpoints: one in GROQ mode over the live content graph, one in Knowledge Base mode over
          an index built from the CIS Microsoft 365 and Azure Foundations Benchmarks and Microsoft
          Learn. Sanity project <code>6qz0b6rp</code>, dataset <code>production</code>. The content
          model is browsable at{' '}
          <a href="https://detection-debt.sanity.studio" rel="noreferrer">
            detection-debt.sanity.studio
          </a>
          .
        </p>
        <p>
          Connectors, log tables, rule logic, ATT&amp;CK techniques and baseline controls come from
          real sources — the Microsoft Sentinel community repository, the MITRE ATT&amp;CK STIX
          bundle, and the benchmark PDFs. Four fields on each rule do not:{' '}
          <code>status</code>, <code>fpRate</code>, <code>lastValidated</code> and{' '}
          <code>ownerTeam</code> are generated from a hash of the rule id, so the demo is stable
          between runs. The agent is instructed to say so whenever one of them drives an answer.
        </p>
      </footer>
    </main>
  )
}

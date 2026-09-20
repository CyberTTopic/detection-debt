'use client'

/**
 * The coverage_delta result, rendered rather than paraphrased.
 *
 * The model also receives this object and writes prose about it, and the prose
 * is where the judgement lives. But the numbers themselves are shown directly
 * from the tool output, so a reader can see the tally without trusting the
 * paraphrase. If the prose and this table ever disagree, the table is right.
 *
 * Techniques going dark are given their own treatment for the same reason they
 * exist: they are the answer. The list carries which rules were covering each
 * one, because "T1003 goes dark" is an assertion and "T1003 goes dark, it was
 * held up by DET-0012 alone" is a checkable one.
 */

interface Delta {
  removedConnectors?: {slug: string; name: string; found: boolean}[]
  tablesLost?: {tableName: string; gbPerDay: number | null}[]
  gbPerDayLost?: number
  rulesLost?: {ruleId: string; title: string}[]
  rulesSurviving?: number
  techniquesGoingDark?: {attackId: string; name: string; wasCoveredBy: string[]}[]
  techniquesStillCovered?: string[]
  newlySoleSourced?: {attackId: string; name: string; nowCoveredOnlyBy: string}[]
  parentTechniquesStructurallyDark?: {
    parentAttackId: string
    parentName: string
    subTechniquesLost: string[]
  }[]
  remediationCandidates?: {ruleId: string; title: string; wouldCover: string[]; survivesTheLoss: boolean}[]
  warnings?: string[]
}

export interface CoverageDeltaOutput {
  source?: string
  verification?: string
  summary?: string
  delta?: Delta | {truncated: true; note: string}
  error?: string
}

export function ImpactReport({output}: {output: CoverageDeltaOutput}) {
  if (output.error) {
    return (
      <div className="notice">
        <h3>The query did not run</h3>
        <pre>{output.error}</pre>
      </div>
    )
  }

  const delta = output.delta
  // A truncated result has no tally to show; the prose above it still does.
  if (!delta || 'truncated' in delta) return null

  const dark = delta.techniquesGoingDark ?? []
  const disagreed = Boolean(output.verification?.startsWith('DISAGREEMENT'))
  const connectors = (delta.removedConnectors ?? []).map((c) => c.name).join(' + ')

  return (
    <section className="report" aria-label={`Impact of removing ${connectors}`}>
      <div className="report-head">
        <strong>Removing {connectors || 'the named connectors'}</strong>
        <span className={`report-verified${disagreed ? ' disagree' : ''}`}>
          {disagreed
            ? 'the two implementations disagree — see the answer'
            : output.verification?.startsWith('Cross-checked')
              ? 'cross-checked against an independent query in Sanity'
              : 'computed in code from the graph'}
        </span>
      </div>

      <dl className="tally">
        <div>
          <dt>Tables stop</dt>
          <dd className="loss">{delta.tablesLost?.length ?? 0}</dd>
        </div>
        <div>
          <dt>GB/day ends</dt>
          <dd>{delta.gbPerDayLost ?? 0}</dd>
        </div>
        <div>
          <dt>Rules stop firing</dt>
          <dd className="loss">{delta.rulesLost?.length ?? 0}</dd>
        </div>
        <div>
          <dt>Techniques go dark</dt>
          <dd className="loss">{dark.length}</dd>
        </div>
      </dl>

      {dark.length > 0 ? (
        <div className="report-section">
          <h4>No surviving rule covers these</h4>
          <ul className="techlist">
            {dark.map((t) => (
              <li className="dark-tech" key={t.attackId}>
                <code>{t.attackId}</code>
                <span>{t.name}</span>
                <span className="attrib">was held up by {t.wasCoveredBy.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="report-section">
          <h4>No technique loses its last rule</h4>
          <p style={{margin: 0, fontSize: 'var(--t-sm)'}}>
            Every technique these connectors fed is still covered by something that survives.
          </p>
        </div>
      )}

      {delta.newlySoleSourced?.length ? (
        <div className="report-section">
          <h4>Survives, but now on a single rule</h4>
          <ul className="techlist">
            {delta.newlySoleSourced.map((t) => (
              <li className="survives" key={t.attackId}>
                <code>{t.attackId}</code>
                <span>{t.name}</span>
                <span className="attrib">only {t.nowCoveredOnlyBy} left</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {delta.parentTechniquesStructurallyDark?.length ? (
        <div className="report-section">
          <h4>Whole branches unwatched — an inference, not a direct loss</h4>
          <ul className="techlist">
            {delta.parentTechniquesStructurallyDark.map((p) => (
              <li key={p.parentAttackId}>
                <code>{p.parentAttackId}</code>
                <span>{p.parentName}</span>
                <span className="attrib">
                  had no coverage of its own; {p.subTechniquesLost.join(', ')} all go dark
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {delta.remediationCandidates?.length ? (
        <div className="report-section">
          <h4>Draft rules that would close part of the gap</h4>
          <ul className="techlist">
            {delta.remediationCandidates.slice(0, 6).map((r) => (
              <li key={r.ruleId}>
                <code>{r.ruleId}</code>
                <span>{r.title}</span>
                <span className="attrib">
                  covers {r.wouldCover.join(', ')}
                  {r.survivesTheLoss ? '' : ' — but it reads a table being removed'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {delta.warnings?.length ? (
        <div className="report-section">
          <h4>Caveats on this calculation</h4>
          <ul className="techlist">
            {delta.warnings.map((w, i) => (
              <li key={i}>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

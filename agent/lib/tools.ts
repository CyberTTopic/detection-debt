/**
 * The agent's tools.
 *
 * TWO ENDPOINTS, ONE AGENT
 * ------------------------
 * Sanity Context serves one mode per endpoint: GROQ mode queries the live
 * dataset, Knowledge Base mode reads a pre-built index of prose. This project
 * needs both, for questions that are genuinely different in kind:
 *
 *   the graph  answers "what depends on what" — structure, cardinality,
 *              absence. Which rules read this table. Which techniques no rule
 *              covers. Set differences.
 *   the docs   answer "what did the sources say and what did we decide" —
 *              justification, disagreement, the reasoning behind a number.
 *
 * So there are two endpoints and two clients, and the model is told which kind
 * of question each one settles. That routing decision is the interesting part of
 * the design and the prompt makes the model state it out loud, because a wrong
 * route produces a confident answer from the wrong kind of source.
 *
 * WHY MOST TOOLS ARE NOT `graph_query`
 * ------------------------------------
 * The seven queries in `groq/queries.ts` were written before any content
 * existed, to prove the schema could answer the questions, and each is covered
 * by assertions in `groq/verify.mjs`. Exposing them as named tools means the
 * model picks a question rather than rewriting a tested query from scratch and
 * getting the set difference subtly wrong.
 *
 * `graph_query` still exists as an escape hatch for everything unanticipated —
 * that is the whole point of having a queryable graph rather than a fixed
 * report. But the common questions run known-good SQL, so to speak.
 *
 * WHAT THE MODEL NEVER SEES
 * -------------------------
 * `coverage_delta` fetches the whole graph — every rule, all 147 techniques,
 * every table — and returns only what changed. The 147 techniques never enter
 * the context window. That is partly cost and mostly accuracy: a model handed a
 * large array and asked which elements are missing from another large array will
 * answer, fluently, and be wrong.
 */

import {tool} from 'ai'
import {z} from 'zod'

import {ContextClient, runGroq, truncationWarning, unwrapGroqResult} from './mcp.ts'
import {computeCoverageDelta, crossCheck, summarise} from './coverage-delta.ts'
import {normalizeSnapshot, scalarList} from './normalize.ts'
import {downgradeBlockers} from './tier-rules.ts'
import {
  COVERAGE_STATUSES,
  Q1_CONNECTOR_LOSS,
  Q2_UNCOVERED_TECHNIQUES,
  Q3_DOWNGRADE_IMPACT,
  Q4_SINGLE_POINT_OF_FAILURE,
  Q5_COMPETING_RULES,
  Q6_CONTESTED_SETTINGS,
  Q6B_CLAIMS_FOR_SETTING,
  SNAPSHOT_FOR_DELTA,
} from './queries.ts'

/* ------------------------------------------------------------------ *
 * Shared helpers.
 * ------------------------------------------------------------------ */

const statuses = [...COVERAGE_STATUSES]

/** Run a query and hand back parsed JSON, or a description of what went wrong. */
async function query(
  client: ContextClient,
  groq: string,
  params: Record<string, unknown> = {},
): Promise<{ok: true; data: unknown; truncated: string | null} | {ok: false; error: string}> {
  const {text, isError} = await runGroq(client, groq, params)
  if (isError) {
    return {
      ok: false,
      error:
        `The dataset rejected the query: ${text}\n` +
        `Do not retry the same query. Either fix it or say that this question ` +
        `cannot be answered from the graph as it stands.`,
    }
  }
  const data = unwrapGroqResult(text)
  if (data === null && text.trim() !== '' && !text.startsWith('{')) {
    return {ok: false, error: `Unexpected response from the dataset: ${text.slice(0, 400)}`}
  }
  return {ok: true, data, truncated: truncationWarning(text)}
}

/** Keep a single tool result from swallowing the context window. */
function cap(value: unknown, maxChars = 20_000): unknown {
  const json = JSON.stringify(value)
  if (json.length <= maxChars) return value
  return {
    truncated: true,
    note:
      `The result was ${json.length} characters and has been cut off at ${maxChars}. ` +
      `Narrow the question — filter by tactic, connector or status — rather than ` +
      `reasoning from a partial list.`,
    head: json.slice(0, maxChars),
  }
}

/* ------------------------------------------------------------------ *
 * The Knowledge Base id.
 *
 * `knowledge_base_read` requires the id, and the id is printed inside the
 * endpoint's own `initial_context` output rather than being configuration. So it
 * is read from there once. Hard-coding it would work today and break silently
 * the day the knowledge base is rebuilt under a new id.
 * ------------------------------------------------------------------ */

let cachedKbId: string | null = null

async function knowledgeBaseId(docs: ContextClient): Promise<string> {
  if (cachedKbId) return cachedKbId
  const ctx = await docs.initialContext()
  const m = /Knowledge base id:\s*(`?)(kb[A-Za-z0-9]+)\1/.exec(ctx)
  if (!m) {
    throw new Error(
      'Could not find a "Knowledge base id:" line in the docs endpoint\'s initial_context. ' +
        'The endpoint may be in GROQ mode, or serving no knowledge base.',
    )
  }
  cachedKbId = m[2]
  return cachedKbId
}

/* ------------------------------------------------------------------ *
 * The tools.
 * ------------------------------------------------------------------ */

export function buildTools(graph: ContextClient, docs: ContextClient) {
  return {
    /* -------------------------------------------------------------- *
     * The one this project exists for.
     * -------------------------------------------------------------- */
    coverage_delta: tool({
      description:
        'THE PRIMARY TOOL for any question about losing telemetry: a connector being ' +
        'switched off, a licence not renewed, a bundle lapsing, a trial expiring. ' +
        'Takes one or more connector slugs and returns exactly what changes: tables ' +
        'that stop, GB/day lost, rules that stop firing, ATT&CK techniques that lose ' +
        'their last remaining rule, techniques that survive but drop to a single rule, ' +
        'and draft rules that would close the gap. ' +
        'Pass ALL the connectors in question in one call. Calling it once per connector ' +
        'and combining the answers yourself gives a wrong result: a technique covered ' +
        'by one rule from each of two connectors survives losing either alone and goes ' +
        'dark when both go. The set arithmetic is done in code, not estimated.',
      inputSchema: z.object({
        connectorSlugs: z
          .array(z.string())
          .min(1)
          .describe(
            'Connector slugs, e.g. ["defender-for-endpoint"] or ' +
              '["defender-for-identity","defender-for-cloud-apps"]. Use graph_query on ' +
              '*[_type=="connector"]{name,"slug":slug.current} if you need the exact slugs.',
          ),
      }),
      execute: async ({connectorSlugs}) => {
        const snap = await query(graph, SNAPSHOT_FOR_DELTA, {coverageStatuses: statuses})
        if (!snap.ok) return snap

        // Context returns dereferenced scalars wrapped in objects, unlike a
        // local groq-js evaluation. See lib/normalize.ts — this layer exists
        // because using the wrapped values directly made every lookup miss and
        // produced a confident "nothing goes dark".
        const {snapshot, problems} = normalizeSnapshot(snap.data)

        // Refusing is the right behaviour. A snapshot that could not be fully
        // read yields a SMALLER loss than the truth, which is the direction that
        // reads as reassurance, so there is no safe partial answer to give.
        if (problems.length > 0 || snap.truncated) {
          return {
            error:
              `The graph came back in a shape this tool could not fully read, so no ` +
              `coverage answer can be trusted. Report this to the user rather than ` +
              `estimating. Problems:\n- ` +
              [...(snap.truncated ? [snap.truncated] : []), ...problems.slice(0, 8)].join('\n- ') +
              (problems.length > 8 ? `\n- (${problems.length - 8} more)` : ''),
          }
        }

        const delta = computeCoverageDelta(snapshot, connectorSlugs)

        // With a single connector the same set difference can also be expressed
        // server-side in GROQ. Both are run and compared. Agreement is not
        // reported; disagreement is, because it means one of them is wrong and
        // guessing which would be worse than saying so.
        let verification = 'Not cross-checked: the GROQ form of this query covers one connector at a time.'
        if (connectorSlugs.length === 1) {
          const q1 = await query(graph, Q1_CONNECTOR_LOSS, {
            connectorSlug: connectorSlugs[0],
            coverageStatuses: statuses,
          })
          if (q1.ok) {
            const problems = crossCheck(delta, q1.data as never)
            verification = problems.length
              ? `DISAGREEMENT between the server-side GROQ query and the local computation. ` +
                `Report this to the user verbatim and do not present either number as the answer.\n` +
                problems.join('\n')
              : 'Cross-checked: an independent GROQ query run inside Sanity produced the same ' +
                'set of dead rules and dark techniques.'
          }
        }

        return {
          source: 'graph endpoint (GROQ mode), plus set arithmetic computed in code',
          verification,
          summary: summarise(delta),
          delta: cap(delta),
        }
      },
    }),

    /* -------------------------------------------------------------- *
     * Absence. The question retrieval cannot answer.
     * -------------------------------------------------------------- */
    uncovered_techniques: tool({
      description:
        'Which ATT&CK techniques in a tactic have NO validated or tuned rule covering ' +
        'them. Use for "where are our gaps", "what is not monitored", coverage-map ' +
        'questions. Also returns, per gap, any draft rule that would cover it and any ' +
        'enforced baseline control that prevents the technique instead of detecting it — ' +
        'a gap that is prevented is a different kind of gap from one that is simply open.',
      inputSchema: z.object({
        tactic: z
          .enum([
            'TA0043', 'TA0042', 'TA0001', 'TA0002', 'TA0003', 'TA0004', 'TA0005',
            'TA0006', 'TA0007', 'TA0008', 'TA0009', 'TA0011', 'TA0010', 'TA0040',
          ])
          .describe(
            'ATT&CK tactic id. TA0006 Credential Access, TA0008 Lateral Movement, ' +
              'TA0003 Persistence, TA0001 Initial Access, TA0005 Defense Evasion.',
          ),
      }),
      execute: async ({tactic}) => {
        const r = await query(graph, Q2_UNCOVERED_TECHNIQUES, {tactic, coverageStatuses: statuses})
        return r.ok ? {source: 'graph endpoint (GROQ mode)', data: cap(r.data)} : r
      },
    }),

    /* -------------------------------------------------------------- *
     * Cost versus coverage.
     * -------------------------------------------------------------- */
    downgrade_check: tool({
      description:
        'Whether a log table can be moved to a cheaper Azure Monitor plan, and exactly ' +
        'what breaks. Use for cost questions: "can we put this table on Basic", "what ' +
        'happens if we move X to the data lake", "where can we cut ingestion spend". ' +
        'Returns the table, its current plan, whether a plan change is even available ' +
        'this week (one switch per table per week), and for every rule reading it, the ' +
        'specific blockers — rule type requiring Analytics, query constructs that ' +
        'single-table plans do not support, a lookback longer than the Basic query ' +
        'window. The blockers are derived from policy in code, not recalled.',
      inputSchema: z.object({
        tableName: z
          .string()
          .describe('Exact KQL table name, case-sensitive, e.g. SigninLogs or CommonSecurityLog.'),
        targetTier: z
          .enum(['basic', 'auxiliary'])
          .describe('The cheaper plan being considered. auxiliary supports no alerting at all.'),
      }),
      execute: async ({tableName, targetTier}) => {
        const r = await query(graph, Q3_DOWNGRADE_IMPACT, {tableName})
        if (!r.ok) return r

        const table = r.data as {
          tableName?: string
          gbPerDay?: number
          planChangeAvailable?: boolean
          planLastChangedOn?: string
          supportsBasicPlan?: boolean
          rulesReadingThisTable?: {
            ruleId: string
            ruleType: string
            status: string
            kqlFeatures?: string[]
            lookbackDays?: number
            techniques?: string[]
          }[]
        } | null

        if (!table?.tableName) {
          return {
            source: 'graph endpoint (GROQ mode)',
            error: `No table named "${tableName}" exists in the graph. Table names are ` +
              `case-sensitive. List them with graph_query on *[_type=="logTable"].tableName.`,
          }
        }

        const rules = table.rulesReadingThisTable ?? []
        const shapeProblems: string[] = []

        const assessed = rules.map((rule, i) => {
          const blockers = downgradeBlockers(
            {
              ruleType: rule.ruleType,
              // kqlFeatures is a plain string array on the document, not a
              // dereference, so it arrives unwrapped.
              kqlFeatures: rule.kqlFeatures as never,
              lookbackDays: rule.lookbackDays,
            },
            targetTier,
          )
          return {
            ...rule,
            // Dereferenced, so wrapped. Normalised here for the same reason as
            // in coverage_delta: these ids are aggregated below, and an
            // unreadable one silently shrinks the list of techniques at risk.
            techniques: scalarList(
              rule.techniques,
              'attackId',
              `rulesReadingThisTable[${i}].techniques`,
              shapeProblems,
            ),
            blockers,
            verdict: blockers.length === 0 ? 'survives the downgrade' : 'stops working',
          }
        })

        const broken = assessed.filter((a) => a.blockers.length > 0)

        return {
          source: 'graph endpoint (GROQ mode), plus plan policy applied in code',
          table: {
            tableName: table.tableName,
            gbPerDay: table.gbPerDay,
            currentPlan: (table as {ingestionTier?: string}).ingestionTier,
            supportsBasicPlan: table.supportsBasicPlan,
            planLastChangedOn: table.planLastChangedOn ?? null,
          },
          planChangeAvailableThisWeek: table.planChangeAvailable,
          planChangeNote:
            table.planChangeAvailable === false
              ? `The plan was last changed on ${table.planLastChangedOn}. Table plan updates ` +
                `are limited to one per table per week, so a further change would be refused ` +
                `outright regardless of what it would save. Say this first.`
              : null,
          basicPlanNote:
            table.supportsBasicPlan === false
              ? `supportsBasicPlan is false for this table. Check its notes field: this project ` +
                `only verified plan availability for a couple of tables and recorded the rest as ` +
                `unverified. Do not present an unverified false as a confirmed impossibility.`
              : null,
          rulesAffected: broken.length,
          rulesUnaffected: assessed.length - broken.length,
          techniquesAtRisk: [...new Set(broken.flatMap((b) => b.techniques))].sort(),
          shapeProblems: shapeProblems.length
            ? `Some technique ids could not be read, so the list above may be short: ` +
              shapeProblems.slice(0, 4).join('; ')
            : null,
          rules: cap(assessed),
        }
      },
    }),

    /* -------------------------------------------------------------- *
     * Fragility.
     * -------------------------------------------------------------- */
    single_points_of_failure: tool({
      description:
        'Coverage rules that read exactly one table, so one connector or one licence ' +
        'ends them. Use for "how fragile is our coverage", "what is our biggest single ' +
        'risk", resilience and concentration questions. Flags which of them are the ' +
        'ONLY rule covering some technique — a single-table rule that duplicates other ' +
        'coverage is a different problem from one that is holding a technique up alone.',
      inputSchema: z.object({}),
      execute: async () => {
        const r = await query(graph, Q4_SINGLE_POINT_OF_FAILURE, {coverageStatuses: statuses})
        return r.ok ? {source: 'graph endpoint (GROQ mode)', data: cap(r.data)} : r
      },
    }),

    /* -------------------------------------------------------------- *
     * Which of several rules to deploy. Spans both endpoints.
     * -------------------------------------------------------------- */
    competing_rules: tool({
      description:
        'All rules touching one ATT&CK technique, ranked by false-positive rate and then ' +
        'by how recently they were validated, with any recorded tuning decisions attached. ' +
        'Use for "which rule should we deploy for X", "do we have duplicate coverage", ' +
        '"why did we choose this rule". The attached decisions are the same prose the docs ' +
        'endpoint indexes, so a ranking can be explained rather than merely asserted.',
      inputSchema: z.object({
        attackId: z
          .string()
          .regex(/^T\d{4}(\.\d{3})?$/, 'Must look like T1078 or T1078.004.')
          .describe(
            'ATT&CK technique id. Note that T1078 and T1078.004 are different techniques ' +
              'and coverage of one is not coverage of the other.',
          ),
      }),
      execute: async ({attackId}) => {
        const r = await query(graph, Q5_COMPETING_RULES, {attackId})
        if (!r.ok) return r
        const rules = (r.data ?? []) as unknown[]
        if (rules.length === 0) {
          return {
            source: 'graph endpoint (GROQ mode)',
            note:
              `No rule in the graph references ${attackId}. If the technique exists, it is ` +
              `uncovered — check uncovered_techniques for its tactic. If you expected a ` +
              `sub-technique to count, remember that coverage of T1078.004 is not coverage ` +
              `of T1078.`,
          }
        }
        return {source: 'graph endpoint (GROQ mode)', data: cap(rules)}
      },
    }),

    /* -------------------------------------------------------------- *
     * Where the authorities disagree.
     * -------------------------------------------------------------- */
    contested_settings: tool({
      description:
        'Which baseline settings have conflicting guidance from different authorities ' +
        '(CIS benchmarks, the Microsoft Cloud Security Benchmark, Microsoft Learn). ' +
        'Returns setting names only — call claims_for_setting to see the competing claims. ' +
        'Use when asked what guidance is disputed, or before answering any hardening ' +
        'question where a single number might be quoted as settled fact.',
      inputSchema: z.object({}),
      execute: async () => {
        const r = await query(graph, Q6_CONTESTED_SETTINGS, {})
        return r.ok ? {source: 'graph endpoint (GROQ mode)', data: r.data} : r
      },
    }),

    claims_for_setting: tool({
      description:
        'Every competing claim about one contested setting, side by side, each with its ' +
        'source authority and the exact section it comes from, plus any internal decision ' +
        'recorded about it. Use whenever a hardening question touches a setting that ' +
        'contested_settings listed. NEVER pick one claim silently: present all of them ' +
        'with their sources and say that the sources disagree.',
      inputSchema: z.object({
        setting: z
          .string()
          .describe('A setting name exactly as contested_settings returned it.'),
      }),
      execute: async ({setting}) => {
        const r = await query(graph, Q6B_CLAIMS_FOR_SETTING, {setting})
        if (!r.ok) return r
        const data = r.data as {claims?: unknown[]} | null
        if (!data?.claims?.length) {
          return {
            source: 'graph endpoint (GROQ mode)',
            note:
              `No control in the graph records the setting "${setting}". Call ` +
              `contested_settings to get the exact names.`,
          }
        }
        return {
          source: 'graph endpoint (GROQ mode)',
          instruction:
            'These claims disagree with each other. Report every one with its ' +
            'sourceAuthority and sourceLocation. State the disagreement plainly.',
          data: cap(data),
        }
      },
    }),

    /* -------------------------------------------------------------- *
     * The escape hatch, and the schema that makes it usable.
     * -------------------------------------------------------------- */
    graph_schema: tool({
      description:
        "Inspect a document type's fields, their meanings and their allowed values. " +
        'Call this BEFORE writing a graph_query against a type you have not queried yet — ' +
        'the field descriptions explain the conventions this dataset uses, which is the ' +
        'difference between a correct query and a plausible one. Types: connector, ' +
        'logTable, detectionRule, technique, baselineControl, tuningDecision.',
      inputSchema: z.object({
        type: z.string().describe('Schema type name, e.g. detectionRule.'),
        path: z.string().optional().describe('Optional field path to drill into.'),
      }),
      execute: async ({type, path}) => {
        const {text, isError} = await graph.callTool('schema_explorer', {
          type,
          ...(path ? {path} : {}),
        })
        return isError
          ? {error: text}
          : {source: 'graph endpoint (GROQ mode), schema_explorer', schema: cap(text, 12_000)}
      },
    }),

    graph_query: tool({
      description:
        'Run an arbitrary read-only GROQ query against the dataset. This is the escape ' +
        'hatch for questions the named tools do not cover — prefer a named tool when one ' +
        'fits, because those queries are tested. Write literal values directly into the ' +
        'query text; there is no parameter binding. Conventions that apply: only status ' +
        '"validated" or "tuned" counts as coverage, and follow references with ->.',
      inputSchema: z.object({
        groq: z.string().describe('The GROQ query. Literals inline; no $parameters.'),
        why: z
          .string()
          .describe('One line on what this is for. Shown to the user in the tool trace.'),
      }),
      execute: async ({groq}) => {
        const r = await query(graph, groq, {})
        return r.ok ? {source: 'graph endpoint (GROQ mode), ad-hoc query', data: cap(r.data)} : r
      },
    }),

    /* -------------------------------------------------------------- *
     * The docs endpoint.
     * -------------------------------------------------------------- */
    docs_outline: tool({
      description:
        'The outline of the knowledge base built from the CIS benchmarks, Microsoft Learn ' +
        'pages and internal notes: every entry path, with what it covers. Call this before ' +
        'docs_read so the paths are taken from the outline rather than guessed. Use the ' +
        'docs for WHY and WHAT-THE-SOURCE-SAYS questions; use the graph for structure.',
      inputSchema: z.object({}),
      execute: async () => {
        const outline = await docs.initialContext()
        return {source: 'docs endpoint (Knowledge Base mode)', outline: cap(outline, 24_000)}
      },
    }),

    docs_read: tool({
      description:
        'Read whole entries from the knowledge base by their outline paths. Pass 2 to 5 ' +
        'candidate paths in ONE call rather than reading them one at a time — a round trip ' +
        'costs more than a little extra text. Use for guidance, justification, and the ' +
        'reasoning behind a recommendation. If an entry and the graph disagree, say so ' +
        'rather than reconciling them.',
      inputSchema: z.object({
        paths: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('Entry paths copied verbatim from the outline.'),
      }),
      execute: async ({paths}) => {
        const kb = await knowledgeBaseId(docs)
        const {text, isError} = await docs.callTool('knowledge_base_read', {
          knowledgeBase: kb,
          paths,
        })
        return isError
          ? {error: text}
          : {
              source: 'docs endpoint (Knowledge Base mode)',
              citationNote:
                'Cite the entry path for anything quoted from here, and name the underlying ' +
                'authority (CIS section, Microsoft Learn page) when the entry gives one.',
              entries: cap(text, 30_000),
            }
      },
    }),
  }
}

export type AgentTools = ReturnType<typeof buildTools>

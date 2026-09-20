/**
 * Server-side configuration.
 *
 * ONE COPY OF THE SECRETS
 * -----------------------
 * The Studio and the import scripts already read `.env.local` at the repository
 * root. Next.js only loads `.env.local` from its own directory, so the obvious
 * move is a second copy inside `agent/` — which means two files holding the same
 * live tokens, one of which will eventually be forgotten by `.gitignore` or
 * copied somewhere careless. So instead this walks up and reads the one that
 * already exists.
 *
 * On Vercel no such file is present and the values come from the project's
 * environment variables, which is why the file read is a fallback rather than
 * the source: anything already in `process.env` wins.
 *
 * Nothing here is exported as a value. `config()` is called at request time and
 * the token is handed straight to the client, so a token never lands in a module
 * that could be bundled toward the browser.
 */

import {existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'

const KEYS = [
  'SANITY_ORGANIZATION_TOKEN',
  'SANITY_CONTEXT_GROQ_URL',
  'SANITY_CONTEXT_KB_URL',
  'SANITY_PROJECT_ID',
  'SANITY_DATASET',
  // Any one of these three is enough. See lib/model.ts.
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'AGENT_PROVIDER',
  'AGENT_MODEL',
] as const

type Key = (typeof KEYS)[number]

let loaded: Partial<Record<Key, string>> | null = null

/** Find `.env.local` in this directory or any ancestor, and parse it. */
function loadFromDisk(): Partial<Record<Key, string>> {
  const found: Partial<Record<Key, string>> = {}

  let dir = process.cwd()
  let file: string | null = null
  for (let depth = 0; depth < 6; depth++) {
    const candidate = resolve(dir, '.env.local')
    if (existsSync(candidate)) {
      file = candidate
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (!file) return found

  let contents: string
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    return found
  }

  for (const line of contents.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1] as Key
    if (!KEYS.includes(key)) continue
    let value = m[2].trim()
    // Strip one layer of matching quotes, and anything after an unquoted #.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    if (value) found[key] = value
  }

  return found
}

export interface AgentConfig {
  organizationToken: string
  groqUrl: string
  kbUrl: string
  projectId?: string
  dataset?: string
  /**
   * Reads a single configuration value. Passed to `resolveModel` so provider
   * selection sees the same merged view of process.env and .env.local, without
   * this module having to know which providers exist.
   */
  read: (key: string) => string | undefined
}

/**
 * Read the configuration, or explain precisely what is missing.
 *
 * The error text names the variable and where it comes from, because the two
 * tokens in this project are easy to confuse and the failure they produce — a
 * 403 from Context — looks like a permissions problem rather than a wrong-token
 * problem.
 */
export function config(): AgentConfig {
  if (!loaded) loaded = loadFromDisk()

  // Takes a plain string, not the Key union: this is handed to resolveModel,
  // which knows its own provider variables and should not have to import a list
  // from here to ask for them.
  const get = (key: string): string | undefined =>
    process.env[key] ?? loaded?.[key as Key]

  const missing: string[] = []
  const require_ = (key: Key, hint: string): string => {
    const v = get(key)
    if (!v) missing.push(`${key} — ${hint}`)
    return v ?? ''
  }

  const cfg: AgentConfig = {
    organizationToken: require_(
      'SANITY_ORGANIZATION_TOKEN',
      'an ORGANIZATION-level token with the Context Viewer role. A project token gives 403.',
    ),
    groqUrl: require_(
      'SANITY_CONTEXT_GROQ_URL',
      'the GROQ-mode endpoint URL from the Context app.',
    ),
    kbUrl: require_(
      'SANITY_CONTEXT_KB_URL',
      'the Knowledge Base-mode endpoint URL from the Context app.',
    ),
    projectId: get('SANITY_PROJECT_ID'),
    dataset: get('SANITY_DATASET'),
    read: get,
  }

  // The model key is not listed as a single required variable, because any one
  // of three will do. resolveModel() raises its own error naming all of them.

  if (missing.length) {
    throw new Error(
      `Configuration incomplete. Add these to .env.local at the repository root ` +
        `(or to the Vercel project's environment variables):\n  ` +
        missing.join('\n  '),
    )
  }

  return cfg
}

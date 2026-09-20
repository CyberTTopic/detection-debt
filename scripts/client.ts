import {createClient} from '@sanity/client'
import {readFileSync, existsSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * Load .env.local into process.env.
 *
 * Done here, by hand, rather than through a --env-file flag or a dotenv
 * dependency: every import script goes through this module, so loading it once
 * here means no script can be run in a way that forgets the credentials. A CLI
 * flag is exactly the kind of thing that gets left off.
 *
 * Existing environment variables win, so a value exported in the shell can
 * override the file without editing it.
 */
function loadEnvLocal() {
  const here = dirname(fileURLToPath(import.meta.url))
  // scripts/ sits one level below the project root.
  for (const candidate of [join(here, '..', '.env.local'), join(process.cwd(), '.env.local')]) {
    if (!existsSync(candidate)) continue
    for (const raw of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 1) continue
      const key = line.slice(0, eq).trim()
      // Strip one layer of surrounding quotes, which editors sometimes add.
      const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
      if (!(key in process.env)) process.env[key] = value
    }
    return candidate
  }
  return null
}

const envFile = loadEnvLocal()

/**
 * One client for every import script.
 *
 * `perspective: 'raw'` and explicit document IDs without a `drafts.` prefix are
 * deliberate: a Knowledge Base dataset source reads PUBLISHED documents only.
 * An import that leaves everything in draft produces a Knowledge Base build that
 * finds nothing, with no error to tell you why.
 */

const projectId = process.env.SANITY_PROJECT_ID
const dataset = process.env.SANITY_DATASET ?? 'production'
const token = process.env.SANITY_WRITE_TOKEN

const where = envFile ? `in ${envFile}` : 'in .env.local (which was not found)'
if (!projectId) throw new Error(`Set SANITY_PROJECT_ID ${where}`)
if (!token) {
  throw new Error(
    `Set SANITY_WRITE_TOKEN ${where}. It must be a PROJECT token with Editor ` +
      `permissions, created at sanity.io/manage/project/${projectId}/api - not the ` +
      `organization token used by Sanity Context.`,
  )
}

export const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: '2026-09-01',
  useCdn: false,
})

/**
 * Turn a Sanity client error into something safe and useful to print.
 *
 * The client attaches the whole ClientRequest to its errors, and that object
 * carries the Authorization header in `_header`. Rethrowing it verbatim prints
 * a live bearer token into the terminal, which then ends up in scrollback,
 * screenshots and pasted logs. Learned the hard way.
 *
 * So: keep the message and the useful diagnostics, drop everything else, and
 * translate the errors that actually happen into an explanation and a fix.
 */
export function describeSanityError(err: unknown): Error {
  const e = err as {message?: string; code?: string; statusCode?: number; responseBody?: unknown}
  const code = e?.code
  const status = e?.statusCode
  let message = e?.message ?? String(err)

  if (code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    message =
      `TLS certificate not trusted (${code}).\n\n` +
      `Node ships its own list of trusted certificate authorities and ignores the\n` +
      `Windows certificate store. On a network that inspects TLS, the certificate\n` +
      `presented is re-signed by a corporate CA that Windows trusts and Node does not.\n\n` +
      `Fix, in this PowerShell window:\n` +
      `  $env:NODE_OPTIONS = "--use-system-ca"\n\n` +
      `To make it permanent:\n` +
      `  [Environment]::SetEnvironmentVariable("NODE_OPTIONS", "--use-system-ca", "User")\n\n` +
      `Do NOT set NODE_TLS_REJECT_UNAUTHORIZED=0. That disables verification entirely\n` +
      `rather than trusting the CA your machine already trusts.`
  } else if (status === 401) {
    message = `401 Unauthorized - SANITY_WRITE_TOKEN is missing, malformed, or was revoked.`
  } else if (status === 403) {
    message =
      `403 Forbidden - the token authenticated but lacks permission to write.\n` +
      `It must be a PROJECT token with the Editor role. An organization token, or a ` +
      `project token with only Viewer, produces exactly this.`
  } else if (status === 404) {
    message = `404 Not Found - check SANITY_PROJECT_ID and SANITY_DATASET.`
  }

  const clean = new Error(message)
  clean.name = 'SanityRequestError'
  // Deliberately no cause: the original error holds the Authorization header.
  return clean
}

/** Deterministic IDs, so re-running an import updates instead of duplicating. */
export const ids = {
  connector: (slug: string) => `connector.${slug}`,
  logTable: (name: string) => `logTable.${name}`,
  technique: (attackId: string) => `technique.${attackId.replace(/\./g, '-')}`,
  rule: (ruleId: string) => `rule.${ruleId}`,
  control: (authority: string, controlId: string) =>
    `control.${authority}.${controlId.replace(/\./g, '-')}`,
  decision: (slug: string) => `decision.${slug}`,
}

export const ref = (_ref: string) => ({_type: 'reference' as const, _ref})

/**
 * Commit in chunks. The Content Lake accepts large transactions, but a failed
 * 2,000-document transaction tells you nothing about which document broke it.
 */
export async function commitInChunks(
  docs: Record<string, unknown>[],
  label: string,
  size = 50,
) {
  let done = 0
  for (let i = 0; i < docs.length; i += size) {
    const chunk = docs.slice(i, i + size)
    const tx = client.transaction()
    for (const doc of chunk) tx.createOrReplace(doc as never)
    try {
      await tx.commit({visibility: 'async'})
      done += chunk.length
      process.stdout.write(`\r  ${label}: ${done}/${docs.length}`)
    } catch (err) {
      console.error(`\n  ${label}: chunk starting at ${i} failed`)
      console.error(`  first id in chunk: ${(chunk[0] as {_id?: string})?._id}`)
      throw describeSanityError(err)
    }
  }
  process.stdout.write(`\r  ${label}: ${done}/${docs.length} done\n`)
}

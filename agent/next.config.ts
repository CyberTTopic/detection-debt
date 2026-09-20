import type {NextConfig} from 'next'

/**
 * Two deliberate settings.
 *
 * `turbopack.root` pins the workspace root. Without it, Turbopack walks up and
 * finds the repository's own package.json — the Sanity Studio's, with its React
 * and styled-components tree — and infers a monorepo that does not exist. The
 * two package.json files are intentional: the Studio and the agent share
 * nothing but a .env.local, and keeping their dependency trees separate is why
 * `sanity@6` and `next@16` can both be installed without arguing.
 *
 * `outputFileTracingRoot` does the same for the deployed bundle, so the trace
 * stays inside agent/ rather than dragging the Studio in with it.
 */
const config: NextConfig = {
  turbopack: {root: import.meta.dirname},
  outputFileTracingRoot: import.meta.dirname,
}

export default config

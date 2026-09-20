import {defineCliConfig} from 'sanity/cli'

/**
 * CLI configuration. `sanity schema deploy` and `sanity deploy` read this to
 * know which project and dataset they are acting on.
 *
 * `studioHost` is set here rather than typed at the prompt. The interactive
 * prompt validates on every keystroke and rejects the first character before
 * you can finish the word, which is a poor way to name anything.
 *
 * Why a deployed Studio is needed at all: Sanity Context in GROQ mode refuses
 * a dataset source until the project has a deployed Studio application, with
 * the error "Only datasets with deployed Studio applications are supported".
 * The Context documentation reads as though `sanity schema deploy` alone is
 * enough — it lists the two commands as alternatives. It is not enough. The
 * schema deploy succeeds and the endpoint still returns 400.
 */
export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? '6qz0b6rp',
    dataset: process.env.SANITY_STUDIO_DATASET ?? 'production',
  },

  // Subdomains under sanity.studio are global. This one was free.
  studioHost: 'detection-debt',

  // Pinned so re-deploys do not prompt for the application id.
  deployment: {
    appId: 'x1oe9eo6de9pkf2ikj7dik98',
  },
})

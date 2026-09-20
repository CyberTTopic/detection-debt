import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {schemaTypes} from './schemaTypes'

/**
 * Studio configuration.
 *
 * This exists for two reasons, and the second is the one that matters here:
 *
 *   1. It runs the Studio, where a person can browse and edit the graph by hand.
 *   2. `sanity schema deploy` reads it. Sanity Context in GROQ mode reads your
 *      schema from the SERVER, not from disk, so an MCP endpoint with a dataset
 *      source will not serve until the schema has been deployed. No config, no
 *      deploy, no GROQ endpoint.
 *
 * The project ID and dataset are read from the environment so the same file
 * works for anyone who clones the repo with their own .env.local.
 */
export default defineConfig({
  name: 'default',
  title: 'Detection Debt',

  projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? '6qz0b6rp',
  dataset: process.env.SANITY_STUDIO_DATASET ?? 'production',

  plugins: [structureTool()],

  schema: {
    types: schemaTypes,
  },
})

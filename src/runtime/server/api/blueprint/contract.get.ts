import { defineEventHandler, getQuery } from 'h3'
import { useRuntimeConfig } from '#imports'
import { RUNTIME_CONTRACT, runtimeSchema, type RuntimeContract } from '../../../engine/contract'
import { runtimeManifestOf } from '../../../engine/manifest'

/**
 * The runtime manifest (ADR 0009): what this runtime provides, as
 * capabilities. `?format=contract` returns the older two-halves view,
 * `?format=schema` the JSON Schema of the sections and vocabulary it owns.
 * The effective contract (with the scanned component registry and the
 * configured prefix and storage) is resolved at build time by the module
 * and carried in the runtime config.
 */
export default defineEventHandler((event) => {
  const { format } = getQuery(event)
  const config = useRuntimeConfig(event) as unknown as { blueprint?: { contract?: RuntimeContract } }
  const contract = config.blueprint?.contract || RUNTIME_CONTRACT
  if (format === 'schema') return runtimeSchema(contract)
  if (format === 'contract') return contract
  return runtimeManifestOf(contract)
})

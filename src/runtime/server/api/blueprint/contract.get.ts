import { defineEventHandler, getQuery } from 'h3'
import { useRuntimeConfig } from '#imports'
import { RUNTIME_CONTRACT, runtimeSchema, type RuntimeContract } from '../../../engine/contract'

/**
 * The runtime contract: what this runtime offers documents, both halves —
 * the components templates may draw and the storage, actions and request
 * shape handlers may use. `?format=schema` returns the JSON Schema; the
 * default is the capability manifest. The effective contract (with the
 * scanned component registry and the configured prefix and storage) is
 * resolved at build time by the module and carried in the runtime config.
 */
export default defineEventHandler((event) => {
  const { format } = getQuery(event)
  const config = useRuntimeConfig(event) as unknown as { blueprint?: { contract?: RuntimeContract } }
  const contract = config.blueprint?.contract || RUNTIME_CONTRACT
  return format === 'schema' ? runtimeSchema(contract) : contract
})

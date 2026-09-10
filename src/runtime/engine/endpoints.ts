/**
 * Endpoints — HTTP routes written in the document.
 *
 * Framework-free: matching, input validation and running the handler live
 * here so they can be tested without Nitro and reused by another host. The
 * Nitro handler only adapts the h3 event to `EndpointRequest` and back.
 */
import type { BlueprintDocument, BlueprintEndpoint, HttpMethod, JsonSchema, ValidationIssue } from './types'
import { createEvaluator } from './logic'
import { runActions } from './actions'
import { createServerActions, type CollectionStore } from './server-actions'
import { matchRoute } from './template'
import { validateSchema } from './schema'
import { hashDocument } from './hash'
import { BlueprintError } from './errors'
import { deepClone, isPlainObject } from './path'

export interface EndpointRequest {
  method: string
  /** Path relative to the app mount (`/posts/42`). */
  path: string
  query?: Record<string, unknown>
  body?: unknown
}

export interface EndpointResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface ResolvedEndpoint {
  name: string
  endpoint: BlueprintEndpoint
  params: Record<string, string>
}

/** Match a request against the document endpoints (first declared wins). */
export function resolveEndpoint(document: BlueprintDocument, method: string, path: string): ResolvedEndpoint | null {
  const wanted = method.toUpperCase()
  for (const [name, endpoint] of Object.entries(document.content.endpoints || {})) {
    if (endpoint.method.toUpperCase() !== wanted) continue
    const params = matchRoute(endpoint.path, path)
    if (params) return { name, endpoint, params }
  }
  return null
}

/** Does any endpoint answer this path with another method? (→ 405) */
export function allowedMethods(document: BlueprintDocument, path: string): HttpMethod[] {
  const methods = new Set<HttpMethod>()
  for (const endpoint of Object.values(document.content.endpoints || {})) {
    if (matchRoute(endpoint.path, path)) methods.add(endpoint.method)
  }
  return [...methods]
}

/** Build the URL of a named endpoint (`/api/blueprint/<app>/posts/42?limit=10`). */
export function endpointUrl(document: BlueprintDocument, name: string, params: Record<string, unknown> = {}, query: Record<string, unknown> = {}, mount = '/api/blueprint'): { method: HttpMethod, url: string } {
  const endpoint = document.content.endpoints?.[name]
  if (!endpoint) throw new BlueprintError('UNKNOWN_ENDPOINT', `endpoint "${name}" is not declared`)
  const path = endpoint.path.replace(/:(\w+)/g, (_match, key: string) => {
    if (params[key] === undefined) throw new BlueprintError('MISSING_PARAM', `endpoint "${name}" needs param "${key}"`)
    return encodeURIComponent(String(params[key]))
  })
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) search.set(key, String(value))
  const suffix = [...search.keys()].length ? `?${search}` : ''
  return { method: endpoint.method, url: `${mount}/${document.name}${path === '/' ? '' : path}${suffix}` }
}

/**
 * Query strings arrive as strings; when the declared schema says a property
 * is a number or a boolean, convert it first so the document does not have
 * to.
 */
export function coerceQuery(query: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const out = { ...query }
  for (const [key, property] of Object.entries(schema.properties || {})) {
    const value = out[key]
    if (typeof value !== 'string') continue
    const type = Array.isArray(property.type) ? property.type[0] : property.type
    if ((type === 'number' || type === 'integer') && value.trim() !== '' && Number.isFinite(Number(value))) out[key] = Number(value)
    else if (type === 'boolean' && (value === 'true' || value === 'false')) out[key] = value === 'true'
  }
  return out
}

function splitPin(body: unknown): { createdUnder?: { document?: string, version?: string }, body: unknown } {
  if (!isPlainObject(body) || !isPlainObject(body.createdUnder)) return { body }
  const { createdUnder, ...rest } = body
  return { createdUnder: createdUnder as { document?: string, version?: string }, body: rest }
}

export interface RunEndpointOptions {
  store: CollectionStore
  now?: () => string
  /** Precomputed document version (hash) when the host already has it. */
  version?: string
}

/**
 * Run one request through the document: validate inputs, run the handler
 * with server actions, and turn the outcome into a response.
 */
export async function runEndpoint(document: BlueprintDocument, resolved: ResolvedEndpoint, request: EndpointRequest, options: RunEndpointOptions): Promise<EndpointResponse> {
  const { name, endpoint, params } = resolved
  const version = options.version || hashDocument(document)
  const evaluator = createEvaluator(document)
  const query = request.query || {}
  // `createdUnder` is the runtime's envelope (the pin `submit` adds), not
  // part of the payload the document validates.
  const { createdUnder, body } = splitPin(request.body)
  const state: Record<string, unknown> = { body: deepClone(body ?? null), query: deepClone(query), params: { ...params } }
  // One instant per request: `context.now` and every `createdAt` agree.
  const now = (options.now || (() => new Date().toISOString()))()
  const context = {
    createdUnder: createdUnder ?? null,
    app: document.name,
    version,
    method: endpoint.method,
    path: request.path,
    endpoint: name,
    now,
    params: { ...params },
    query: deepClone(query),
  }

  // ---- pinned requests ------------------------------------------------------
  if (endpoint.pinned && createdUnder && createdUnder.version !== version) {
    return { status: 409, body: { statusCode: 409, message: 'The document changed since this payload was built. Reload and try again.', expected: version, received: createdUnder.version } }
  }

  // ---- declared inputs ------------------------------------------------------
  const scope = { state, context, vars: {} }
  const issues: ValidationIssue[] = []
  for (const part of ['params', 'query', 'body'] as const) {
    const schemaName = endpoint.input?.[part]
    if (!schemaName) continue
    const schema = document.content.schemas[schemaName]
    if (!schema) throw new BlueprintError('UNKNOWN_SCHEMA', `endpoint "${name}" input.${part} references unknown schema "${schemaName}"`)
    if (part === 'query') state.query = coerceQuery(state.query as Record<string, unknown>, schema)
    const value = state[part]
    for (const issue of validateSchema(schema, value, { document, evaluator, scope: { ...scope, state: (value as Record<string, unknown>) || {} } })) {
      issues.push({ ...issue, path: [part, issue.path].filter(Boolean).join('.') })
    }
  }
  if (issues.length) return { status: 422, body: { statusCode: 422, message: 'Validation failed', issues } }

  // ---- handler ----------------------------------------------------------------
  const extensions = createServerActions({ document, store: options.store, now: () => now })
  const result = await runActions(endpoint.handler, {
    evaluator,
    state,
    context,
    initialState: deepClone(state),
    effects: { log: value => console.log(`[blueprint:${document.name}:${name}]`, value) },
    extensions,
  })
  if (result.response) return result.response
  if (!result.ok) {
    return { status: 422, body: { statusCode: 422, message: 'Validation failed', issues: result.issues || [] } }
  }
  // The handler ended without `respond`: nothing to say (the validator warns
  // about handlers that never respond).
  return { status: 204, body: null }
}

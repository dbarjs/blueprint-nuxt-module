import { createError, defineEventHandler, getQuery, getRouterParam, readBody, setHeader, setResponseStatus } from 'h3'
import { allowedMethods, resolveEndpoint, runEndpoint } from '../../../../engine/endpoints'
import { loadPublishedDocument } from '../../../utils/document'
import { storeFor } from '../../../utils/storage'

/**
 * Dispatcher for the endpoints a document writes itself:
 * `<method> /api/blueprint/<app>/<path>` → `content.endpoints`.
 *
 * Registered after the built-in records routes, so those keep priority.
 * The document is read at request time: editing an endpoint is live.
 */
export default defineEventHandler(async (event) => {
  const app = getRouterParam(event, 'app') || ''
  const { document, version } = await loadPublishedDocument(event, app)
  const method = (event.method || 'GET').toUpperCase()
  const mount = `/api/blueprint/${app}`
  const pathname = (event.path || '').split('?')[0] || ''
  const path = pathname.startsWith(mount) ? pathname.slice(mount.length) || '/' : '/'

  const resolved = resolveEndpoint(document, method, path)
  if (!resolved) {
    const allowed = allowedMethods(document, path)
    if (allowed.length) {
      setHeader(event, 'Allow', allowed.join(', '))
      throw createError({ statusCode: 405, statusMessage: `${method} is not allowed on ${path}`, data: { allowed } })
    }
    throw createError({ statusCode: 404, statusMessage: `"${app}" has no endpoint for ${method} ${path}` })
  }

  const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(event).catch(() => undefined)
  const response = await runEndpoint(document, resolved, { method, path, query: getQuery(event) as Record<string, unknown>, body }, { store: storeFor(document), version })
  for (const [name, value] of Object.entries(response.headers || {})) setHeader(event, name, value)
  setResponseStatus(event, response.status)
  if (response.status === 204) return null
  return response.body
})

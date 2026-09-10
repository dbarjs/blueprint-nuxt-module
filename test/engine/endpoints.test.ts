import { describe, expect, it } from 'vitest'
import type { BlueprintDocument } from '../../src/runtime/engine/types'
import { createMemoryStore } from '../../src/runtime/engine/server-actions'
import { coerceQuery, endpointUrl, resolveEndpoint, runEndpoint } from '../../src/runtime/engine/endpoints'
import { validateDocument } from '../../src/runtime/engine/validate'

/** A board document reduced to what the endpoints need. */
function board(overrides: Partial<BlueprintDocument['content']> = {}): BlueprintDocument {
  return {
    name: 'board',
    content: {
      meta: { title: 'Board' },
      resources: { limits: { type: 'constant', data: { pageSize: 2 } } },
      schemas: {
        'post': {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 20 },
            nickname: { type: 'string', maxLength: 10 },
          },
        },
        'list-query': { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5 }, nickname: { type: 'string' } } },
      },
      runtime: { storage: 'memory' },
      collections: { posts: { schema: 'post' } },
      endpoints: {
        'list-posts': {
          method: 'GET',
          path: '/posts',
          input: { query: 'list-query' },
          handler: [
            { type: 'find', collection: 'posts', where: { if: [{ state: 'query.nickname' }, { '==': [{ var: 'item.nickname' }, { state: 'query.nickname' }] }, true] }, sort: { createdAt: 'desc' }, limit: { or: [{ state: 'query.limit' }, { resource: ['limits', 'pageSize'] }] }, as: 'posts' },
            { type: 'count', collection: 'posts', as: 'total' },
            { type: 'respond', body: { obj: { items: { var: 'posts' }, total: { var: 'total' } } } },
          ],
        },
        'create-post': {
          method: 'POST',
          path: '/posts',
          input: { body: 'post' },
          handler: [
            { type: 'insert', collection: 'posts', data: { obj: { text: { state: 'body.text' }, nickname: { or: [{ state: 'body.nickname' }, 'anonymous'] } } }, as: 'post' },
            { type: 'respond', status: 201, body: { var: 'post' } },
          ],
        },
        'get-post': {
          method: 'GET',
          path: '/posts/:id',
          handler: [
            { type: 'findOne', collection: 'posts', id: { state: 'params.id' }, as: 'post' },
            { type: 'if', condition: { '!': [{ var: 'post' }] }, then: { type: 'fail', status: 404, message: { cat: ['No post ', { state: 'params.id' }] } } },
            { type: 'respond', body: { var: 'post' } },
          ],
        },
        'rename': {
          method: 'PATCH',
          path: '/posts/:id',
          handler: [
            { type: 'patch', collection: 'posts', id: { state: 'params.id' }, set: { nickname: { state: 'body.nickname' } }, as: 'updated' },
            { type: 'respond', body: { get: [{ var: 'updated' }, 0] } },
          ],
        },
        'purge': {
          method: 'DELETE',
          path: '/posts',
          pinned: true,
          handler: [
            { type: 'delete', collection: 'posts', where: { '==': [{ var: 'item.nickname' }, 'spam'] }, as: 'removed' },
            { type: 'respond', body: { obj: { removed: { var: 'removed' } } } },
          ],
        },
        'silent': { method: 'GET', path: '/silent', handler: { type: 'log', value: 'nothing' } },
      },
      templates: { 'page:index': { route: '/', children: [] } },
      ...overrides,
    },
  }
}

let tick = 0
const clock = () => new Date(Date.UTC(2026, 8, 10, 12, 0, tick++)).toISOString()

async function call(document: BlueprintDocument, store: ReturnType<typeof createMemoryStore>, method: string, path: string, body?: unknown, query?: Record<string, unknown>) {
  const resolved = resolveEndpoint(document, method, path)
  if (!resolved) throw new Error(`no endpoint for ${method} ${path}`)
  return runEndpoint(document, resolved, { method, path, body, query }, { store, now: clock })
}

describe('endpoints written in the document', () => {
  it('matches method and path pattern, first declared wins', () => {
    const document = board()
    expect(resolveEndpoint(document, 'get', '/posts')?.name).toBe('list-posts')
    expect(resolveEndpoint(document, 'GET', '/posts/42')).toMatchObject({ name: 'get-post', params: { id: '42' } })
    expect(resolveEndpoint(document, 'PUT', '/posts')).toBeNull()
    expect(resolveEndpoint(document, 'GET', '/nope')).toBeNull()
  })

  it('builds URLs for named endpoints', () => {
    const document = board()
    expect(endpointUrl(document, 'get-post', { id: 'a b' })).toEqual({ method: 'GET', url: '/api/blueprint/board/posts/a%20b' })
    expect(endpointUrl(document, 'list-posts', {}, { limit: 3, nickname: undefined })).toEqual({ method: 'GET', url: '/api/blueprint/board/posts?limit=3' })
    expect(() => endpointUrl(document, 'get-post')).toThrow(/needs param "id"/)
    expect(() => endpointUrl(document, 'nope')).toThrow(/not declared/)
  })

  it('coerces query strings with the declared schema', () => {
    expect(coerceQuery({ limit: '3', nickname: '7', flag: 'true' }, { properties: { limit: { type: 'integer' }, nickname: { type: 'string' }, flag: { type: 'boolean' } } }))
      .toEqual({ limit: 3, nickname: '7', flag: true })
  })

  it('runs a create → list → get → patch → delete lifecycle on a memory store', async () => {
    const document = board()
    const store = createMemoryStore()

    const created = await call(document, store, 'POST', '/posts', { text: 'hello' })
    expect(created.status).toBe(201)
    const post = created.body as { id: string, text: string, nickname: string, createdAt: string }
    expect(post).toMatchObject({ text: 'hello', nickname: 'anonymous' })
    expect(post.id).toMatch(/\w+/)
    expect(post.createdAt).toBe('2026-09-10T12:00:00.000Z')

    await call(document, store, 'POST', '/posts', { text: 'second', nickname: 'ana' })
    await call(document, store, 'POST', '/posts', { text: 'third', nickname: 'spam' })

    const listed = await call(document, store, 'GET', '/posts')
    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ total: 3 })
    expect((listed.body as { items: Array<{ text: string }> }).items.map(item => item.text)).toEqual(['third', 'second'])

    const filtered = await call(document, store, 'GET', '/posts', undefined, { nickname: 'ana', limit: '5' })
    expect((filtered.body as { items: Array<{ text: string }> }).items.map(item => item.text)).toEqual(['second'])

    const fetched = await call(document, store, 'GET', `/posts/${post.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body).toMatchObject({ id: post.id, text: 'hello' })

    const missing = await call(document, store, 'GET', '/posts/nope')
    expect(missing).toMatchObject({ status: 404, body: { statusCode: 404, message: 'No post nope' } })

    const renamed = await call(document, store, 'PATCH', `/posts/${post.id}`, { nickname: 'edu' })
    expect(renamed.body).toMatchObject({ id: post.id, nickname: 'edu', updatedAt: expect.stringMatching(/2026/) })

    const purged = await call(document, store, 'DELETE', '/posts')
    expect(purged.body).toEqual({ removed: 1 })
    expect((await store.all('posts')).length).toBe(2)
  })

  it('validates declared inputs before the handler runs', async () => {
    const document = board()
    const store = createMemoryStore()
    const invalid = await call(document, store, 'POST', '/posts', { text: '' })
    expect(invalid.status).toBe(422)
    expect((invalid.body as { issues: Array<{ path: string }> }).issues[0]?.path).toBe('body.text')
    expect(await store.all('posts')).toEqual([])
    const badQuery = await call(document, store, 'GET', '/posts', undefined, { limit: '99' })
    expect(badQuery.status).toBe(422)
  })

  it('validates inserted records with the collection schema', async () => {
    const document = board({ endpoints: { raw: { method: 'POST', path: '/raw', handler: [{ type: 'insert', collection: 'posts', data: { state: 'body' } }, { type: 'respond', status: 201 }] } } })
    const store = createMemoryStore()
    const rejected = await call(document, store, 'POST', '/raw', { text: 'x'.repeat(30) })
    expect(rejected.status).toBe(422)
    expect(await store.all('posts')).toEqual([])
    expect((await call(document, store, 'POST', '/raw', { text: 'ok' })).status).toBe(201)
  })

  it('refuses stale pins on pinned endpoints', async () => {
    const document = board()
    const store = createMemoryStore()
    const stale = await call(document, store, 'DELETE', '/posts', { createdUnder: { version: 'old' } })
    expect(stale.status).toBe(409)
  })

  it('answers 204 when a handler never responds', async () => {
    expect(await call(board(), createMemoryStore(), 'GET', '/silent')).toEqual({ status: 204, body: null })
  })
})

describe('validation of runtime sections', () => {
  const codes = (document: BlueprintDocument) => validateDocument(document).issues.map(issue => issue.code)

  it('accepts the board', () => {
    const report = validateDocument(board())
    expect(report.issues.filter(issue => issue.level === 'error')).toEqual([])
    expect(report.issues.map(issue => issue.code)).toContain('NO_RESPONSE')
    expect(report.endpoints.map(endpoint => `${endpoint.method} ${endpoint.path}`)).toContain('GET /posts/:id')
  })

  it('rejects storages the runtime does not provide', () => {
    expect(codes(board({ runtime: { storage: 'postgres' } }))).toContain('UNKNOWN_STORAGE')
    expect(codes(board({ collections: { posts: { schema: 'post', storage: 'redis' } } }))).toContain('UNKNOWN_STORAGE')
  })

  it('rejects unknown collections, schemas and endpoints', () => {
    expect(codes(board({ endpoints: { x: { method: 'GET', path: '/x', handler: [{ type: 'find', collection: 'nope', as: 'r' }, { type: 'respond' }] } } }))).toContain('UNKNOWN_COLLECTION')
    expect(codes(board({ collections: { posts: { schema: 'nope' } } }))).toContain('UNKNOWN_SCHEMA')
    expect(codes(board({ actions: { load: { type: 'fetch', endpoint: 'nope' } }, templates: { 'page:index': { route: '/', enter: 'load', children: [] } } }))).toContain('UNKNOWN_ENDPOINT')
  })

  it('keeps server actions on the server and client actions in the browser', () => {
    expect(codes(board({ endpoints: { x: { method: 'GET', path: '/x', handler: [{ type: 'toast', title: 'hi' }, { type: 'respond' }] } } }))).toContain('CLIENT_ACTION_IN_HANDLER')
    expect(codes(board({ actions: { bad: { type: 'find', collection: 'posts', as: 'r' } }, templates: { 'page:index': { route: '/', enter: 'bad', children: [] } } }))).toContain('SERVER_ACTION_IN_TEMPLATE')
  })

  it('rejects malformed and duplicate endpoints', () => {
    expect(codes(board({ endpoints: { x: { method: 'FETCH' as 'GET', path: 'x', handler: [] } } }))).toEqual(expect.arrayContaining(['INVALID_ENDPOINT']))
    expect(codes(board({ endpoints: {
      a: { method: 'GET', path: '/same', handler: { type: 'respond' } },
      b: { method: 'GET', path: '/same', handler: { type: 'respond' } },
    } }))).toContain('DUPLICATE_ENDPOINT')
  })
})

describe('live state paths', async () => {
  const { livePathsOf, actionTypesOf } = await import('../../src/runtime/engine/refs')

  it('collects fetch/submit result paths from actions, pages and handlers', () => {
    const document = board({
      actions: { load: { type: 'fetch', endpoint: 'list-posts', result: 'board' }, save: { type: 'submit', endpoint: 'create-post', result: 'last', then: { type: 'fetch', endpoint: 'list-posts', result: 'board.again' } } },
      templates: { 'page:index': { route: '/', enter: 'load', children: [{ type: 'component', as: 'Button', on: { click: { type: 'fetch', endpoint: 'get-post', params: { id: 'x' }, result: 'current' } } }] } },
    })
    expect([...livePathsOf(document)].sort()).toEqual(['board', 'board.again', 'current', 'last'])
    expect([...actionTypesOf(document, 'save')].sort()).toEqual(['fetch', 'submit'])
  })
})

describe('prerendering', async () => {
  const { prerenderRoutes } = await import('../../src/build/documents')

  it('skips pages whose enter reads live data', () => {
    const live = board({ actions: { load: { type: 'fetch', endpoint: 'list-posts', result: 'board' } }, templates: {
      'page:index': { route: '/', enter: 'load', children: [] },
      'page:about': { route: '/about', children: [] },
      'page:post': { route: '/posts/:id', children: [] },
    } })
    expect(prerenderRoutes([{ file: 'board.json', stem: 'board', document: live }])).toEqual(['/board/about'])
  })
})

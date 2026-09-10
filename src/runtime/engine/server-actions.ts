/**
 * Server actions — the extension set an endpoint handler runs with.
 *
 * Same action language as the browser, different effects: instead of a
 * router and toasts the handler gets collections (through a `CollectionStore`
 * the runtime provides) and a way to end the request (`respond`, `fail`).
 * Predicates, sorting and paging are evaluated here, in the notation, so a
 * store only has to list, get, put and delete records.
 */
import type { ActionExtension, ActionResult, ExtensionHelpers } from './actions'
import type { BlueprintDocument, Logic, ServerAction, SortSpec, StoredRecord, ValidationIssue } from './types'
import { validateSchema } from './schema'
import { BlueprintError } from './errors'
import { createId } from './hash'
import { deepClone, getPath, isPlainObject, setPath } from './path'

/** Minimal persistence contract a storage backend implements per app. */
export interface CollectionStore {
  all: (collection: string) => Promise<StoredRecord[]>
  get: (collection: string, id: string) => Promise<StoredRecord | null>
  put: (collection: string, record: StoredRecord) => Promise<void>
  delete: (collection: string, id: string) => Promise<void>
}

export interface ServerActionOptions {
  document: BlueprintDocument
  store: CollectionStore
  /** Clock, injectable for tests. */
  now?: () => string
}

type Extension<T extends ServerAction['type']> = (action: Extract<ServerAction, { type: T }>, helpers: ExtensionHelpers) => Promise<ActionResult> | ActionResult

/** Build the extension map (`ActionContext.extensions`) for one request. */
export function createServerActions(options: ServerActionOptions): Record<string, ActionExtension> {
  const { document, store } = options
  const now = options.now || (() => new Date().toISOString())

  const collectionOf = (name: string) => {
    const collection = document.content.collections?.[name]
    if (!collection) throw new BlueprintError('UNKNOWN_COLLECTION', `collection "${name}" is not declared`)
    return collection
  }

  const remember = (helpers: ExtensionHelpers, as: string | undefined, value: unknown) => {
    if (as) helpers.vars[as] = value
  }

  /** Records matching `id` (one) or `where` (many), in stored order. */
  const select = async (collection: string, action: { id?: Logic, where?: Logic }, helpers: ExtensionHelpers): Promise<StoredRecord[]> => {
    if (action.id !== undefined) {
      const id = helpers.evaluate(action.id)
      const record = id === undefined || id === null ? null : await store.get(collection, String(id))
      return record ? [record] : []
    }
    const records = await store.all(collection)
    return records.filter((record, index) => helpers.matches(action.where, record, index))
  }

  const insert: Extension<'insert'> = async (action, helpers) => {
    const collection = collectionOf(action.collection)
    const data = helpers.evaluate(action.data)
    if (!isPlainObject(data)) throw new BlueprintError('INVALID_RECORD', `insert into "${action.collection}": data must be an object`)
    if (collection.schema) {
      const issues = validateRecord(collection.schema, data, document, helpers)
      if (issues.length) return { ok: false, done: true, issues, response: { status: 422, body: { statusCode: 422, message: `Record rejected by schema "${collection.schema}"`, issues } } }
    }
    const record: StoredRecord = { ...deepClone(data) as Record<string, unknown>, id: createId(), createdAt: now() }
    await store.put(action.collection, record)
    remember(helpers, action.as, record)
    return { ok: true }
  }

  const find: Extension<'find'> = async (action, helpers) => {
    collectionOf(action.collection)
    let records = await select(action.collection, action, helpers)
    if (action.sort) records = sortRecords(records, action.sort)
    const offset = action.offset === undefined ? 0 : Math.max(0, Number(helpers.evaluate(action.offset)) || 0)
    const limit = action.limit === undefined ? undefined : Math.max(0, Number(helpers.evaluate(action.limit)) || 0)
    records = records.slice(offset, limit === undefined ? undefined : offset + limit)
    remember(helpers, action.as, records)
    return { ok: true }
  }

  const findOne: Extension<'findOne'> = async (action, helpers) => {
    collectionOf(action.collection)
    const [record] = await select(action.collection, action, helpers)
    remember(helpers, action.as, record ?? null)
    return { ok: true }
  }

  const count: Extension<'count'> = async (action, helpers) => {
    collectionOf(action.collection)
    const records = await select(action.collection, action, helpers)
    remember(helpers, action.as, records.length)
    return { ok: true }
  }

  const patch: Extension<'patch'> = async (action, helpers) => {
    const collection = collectionOf(action.collection)
    const records = await select(action.collection, action, helpers)
    const updated: StoredRecord[] = []
    for (const [index, record] of records.entries()) {
      const next = deepClone(record) as StoredRecord
      const itemScope = { ...helpers.scope, vars: { ...helpers.vars, '': record, 'item': record, index } }
      for (const [key, logic] of Object.entries(action.set)) {
        if (key === 'id' || key === 'createdAt') continue
        setPath(next, key, deepClone(helpers.ctx.evaluator.evaluate(logic, itemScope)))
      }
      next.updatedAt = now()
      if (collection.schema) {
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = next
        const issues = validateRecord(collection.schema, data, document, helpers)
        if (issues.length) return { ok: false, done: true, issues, response: { status: 422, body: { statusCode: 422, message: `Record rejected by schema "${collection.schema}"`, issues } } }
      }
      await store.put(action.collection, next)
      updated.push(next)
    }
    remember(helpers, action.as, updated)
    return { ok: true }
  }

  const remove: Extension<'delete'> = async (action, helpers) => {
    collectionOf(action.collection)
    const records = await select(action.collection, action, helpers)
    for (const record of records) await store.delete(action.collection, record.id)
    remember(helpers, action.as, records.length)
    return { ok: true }
  }

  const respond: Extension<'respond'> = (action, helpers) => ({
    ok: true,
    done: true,
    response: { status: action.status ?? 200, body: action.body === undefined ? null : helpers.evaluate(action.body), headers: action.headers },
  })

  const fail: Extension<'fail'> = (action, helpers) => {
    const status = action.status ?? 400
    const message = action.message === undefined ? 'Request failed' : String(helpers.evaluate(action.message))
    const issues = action.issues === undefined ? undefined : helpers.evaluate(action.issues)
    return { ok: false, done: true, error: message, response: { status, body: { statusCode: status, message, ...(issues === undefined ? {} : { issues }) } } }
  }

  return {
    insert: insert as ActionExtension,
    find: find as ActionExtension,
    findOne: findOne as ActionExtension,
    count: count as ActionExtension,
    patch: patch as ActionExtension,
    delete: remove as ActionExtension,
    respond: respond as ActionExtension,
    fail: fail as ActionExtension,
  }
}

function validateRecord(schemaName: string, data: unknown, document: BlueprintDocument, helpers: ExtensionHelpers): ValidationIssue[] {
  const schema = document.content.schemas[schemaName]
  if (!schema) throw new BlueprintError('UNKNOWN_SCHEMA', `schema "${schemaName}" does not exist`)
  return validateSchema(schema, data, { document, evaluator: helpers.ctx.evaluator, scope: { ...helpers.scope, state: data as Record<string, unknown> } })
}

export function sortRecords<T extends Record<string, unknown>>(records: T[], sort: SortSpec): T[] {
  const keys: Array<[string, 'asc' | 'desc']> = Array.isArray(sort) ? sort : Object.entries(sort)
  return [...records].sort((a, b) => {
    for (const [field, direction] of keys) {
      const left = getPath(a, field)
      const right = getPath(b, field)
      if (left === right) continue
      if (left === undefined || left === null) return 1
      if (right === undefined || right === null) return -1
      const order = left < right ? -1 : 1
      return direction === 'desc' ? -order : order
    }
    // Ties are broken by id (time-prefixed) so pages are stable.
    const [, direction] = keys[0] || ['id', 'asc']
    const order = String(a.id) < String(b.id) ? -1 : 1
    return direction === 'desc' ? -order : order
  })
}

/** In-memory store: the reference implementation, also used by tests. */
export function createMemoryStore(seed: Record<string, StoredRecord[]> = {}): CollectionStore {
  const data = new Map<string, Map<string, StoredRecord>>()
  for (const [collection, records] of Object.entries(seed)) data.set(collection, new Map(records.map(record => [record.id, deepClone(record)])))
  const table = (collection: string) => {
    let map = data.get(collection)
    if (!map) data.set(collection, map = new Map())
    return map
  }
  return {
    all: async collection => [...table(collection).values()].map(record => deepClone(record)),
    get: async (collection, id) => {
      const record = table(collection).get(id)
      return record ? deepClone(record) : null
    },
    put: async (collection, record) => {
      table(collection).set(record.id, deepClone(record))
    },
    delete: async (collection, id) => {
      table(collection).delete(id)
    },
  }
}

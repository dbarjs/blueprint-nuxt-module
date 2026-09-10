/**
 * Storage backends — the runtime side of `collections`.
 *
 * A document names a backend (`runtime.storage`, or per collection); the
 * runtime maps the name to a `CollectionStore`. Every backend implements the
 * same four operations; predicates and ordering run in the engine.
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { useStorage } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import type { BlueprintDocument, StoredRecord } from '../../engine/types'
import type { CollectionStore } from '../../engine/server-actions'
import { createMemoryStore } from '../../engine/server-actions'
import { RUNTIME_CONTRACT } from '../../engine/contract'

export interface StorageConfig {
  /** Runtime-wide default backend (module option `blueprint.storage`). */
  storage: string
  /** Directory for `fs` files and `sqlite` databases. */
  dataDir: string
}

/** Which backend a collection of a document ends up in. */
export function storageOf(document: BlueprintDocument, collection: string, config: Pick<StorageConfig, 'storage'>): string {
  return document.content.collections?.[collection]?.storage || document.content.runtime?.storage || config.storage || RUNTIME_CONTRACT.server.defaultStorage
}

/** A store for one app that routes each collection to its backend. */
export function storeFor(document: BlueprintDocument, config: StorageConfig = runtimeStorageConfig()): CollectionStore {
  const app = document.name
  const backend = (collection: string): CollectionStore => {
    const name = storageOf(document, collection, config)
    switch (name) {
      case 'memory': return memoryStore(app)
      case 'fs': return fsStore(app)
      case 'sqlite': return sqliteStore(app, config.dataDir)
      default: throw new Error(`[blueprint] storage "${name}" is not provided by this runtime`)
    }
  }
  return {
    all: collection => backend(collection).all(collection),
    get: (collection, id) => backend(collection).get(collection, id),
    put: (collection, record) => backend(collection).put(collection, record),
    delete: (collection, id) => backend(collection).delete(collection, id),
  }
}

export function runtimeStorageConfig(): StorageConfig {
  const config = (useRuntimeConfig() as unknown as { blueprint?: Partial<StorageConfig> }).blueprint || {}
  return { storage: config.storage || RUNTIME_CONTRACT.server.defaultStorage, dataDir: config.dataDir || '.data/blueprint' }
}

// ---- memory -------------------------------------------------------------------
const memoryStores = new Map<string, CollectionStore>()
function memoryStore(app: string): CollectionStore {
  let store = memoryStores.get(app)
  if (!store) memoryStores.set(app, store = createMemoryStore())
  return store
}

// ---- fs (Nitro storage, one JSON file per record) --------------------------------
function fsStore(app: string): CollectionStore {
  const storage = useStorage<StoredRecord>('blueprint')
  const key = (collection: string, id: string) => `collections:${app}:${collection}:${id}`
  return {
    all: async (collection) => {
      const keys = await storage.getKeys(`collections:${app}:${collection}:`)
      const records = await Promise.all(keys.map(item => storage.getItem(item)))
      return records.filter((record): record is StoredRecord => record !== null)
    },
    get: async (collection, id) => ((await storage.getItem(key(collection, id))) as StoredRecord | null) ?? null,
    put: async (collection, record) => {
      await storage.setItem(key(collection, record.id), record)
    },
    delete: async (collection, id) => {
      await storage.removeItem(key(collection, id))
    },
  }
}

// ---- sqlite (Node built-in, one database per app) -------------------------------
interface SqliteDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    all: (...params: unknown[]) => Array<Record<string, unknown>>
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    run: (...params: unknown[]) => unknown
  }
}

const sqliteDatabases = new Map<string, SqliteDatabase>()

function openSqlite(app: string, dataDir: string): SqliteDatabase {
  const file = join(dataDir, `${app}.sqlite`)
  let database = sqliteDatabases.get(file)
  if (database) return database
  const sqlite = globalThis.process?.getBuiltinModule?.('node:sqlite') as { DatabaseSync?: new (path: string) => SqliteDatabase } | undefined
  if (!sqlite?.DatabaseSync) throw new Error('[blueprint] storage "sqlite" needs Node 22.5+ (node:sqlite)')
  mkdirSync(dataDir, { recursive: true })
  database = new sqlite.DatabaseSync(file)
  database.exec(`
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS records_created ON records (collection, created_at);
  `)
  sqliteDatabases.set(file, database)
  return database
}

function sqliteStore(app: string, dataDir: string): CollectionStore {
  const database = openSqlite(app, dataDir)
  const parse = (row: Record<string, unknown>) => JSON.parse(String(row.data)) as StoredRecord
  return {
    all: async collection => database.prepare('SELECT data FROM records WHERE collection = ? ORDER BY created_at, id').all(collection).map(parse),
    get: async (collection, id) => {
      const row = database.prepare('SELECT data FROM records WHERE collection = ? AND id = ?').get(collection, id)
      return row ? parse(row) : null
    },
    put: async (collection, record) => {
      database.prepare('INSERT OR REPLACE INTO records (collection, id, created_at, data) VALUES (?, ?, ?, ?)').run(collection, record.id, record.createdAt, JSON.stringify(record))
    },
    delete: async (collection, id) => {
      database.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(collection, id)
    },
  }
}

/**
 * Runtime contract — what this runtime offers to documents.
 *
 * A Blueprint runtime hosts documents, and a document has two halves: the
 * templates the browser draws and the endpoints the server runs. Beyond the
 * notation itself (which is the same everywhere), each runtime provides
 * *capabilities* on both sides — the components a template may draw, the
 * storage backends and server actions a handler may use, where pages and
 * endpoints are mounted. The contract describes those capabilities and
 * doubles as the JSON Schema of the sections the runtime owns, so a document
 * can be validated against the runtime it will be deployed to — in the
 * editor, at build time, and over HTTP.
 *
 * `RUNTIME_CONTRACT` is the static part known to the engine. The module
 * resolves the effective contract (`resolveContract`) with what only the host
 * knows: its page prefix, the default storage it was configured with and the
 * component registry it scanned.
 */
import { ACTION_TYPES, CLIENT_ACTION_TYPES, SERVER_ACTION_TYPES, SHARED_ACTION_TYPES } from './types'
import { BASE_COMPONENT_NAMES } from './registry'

export interface StorageCapability {
  /** Name used by `content.runtime.storage` and `collections.<name>.storage`. */
  name: string
  description: string
  /** Records survive a restart of the runtime. */
  durable: boolean
}

/** Component names a template may draw, by vocabulary layer. */
export interface ComponentLayers {
  /** Portable vocabulary every runtime materializes. */
  base: string[]
  /** Nuxt UI components this runtime exposes. */
  nuxtUi: string[]
  /** Components the host app contributes (opt-in prefix). */
  app: string[]
}

/** The browser half: what templates can draw and read. */
export interface ClientContract {
  /** Where app pages are mounted (`<prefix>/<app>/<route>`; empty = site root). */
  prefix: string
  components: ComponentLayers
  /** Node types the abstract tree may contain. */
  nodeTypes: string[]
  /** What a template or browser action can read as `context`. */
  context: string[]
  /** How `content.state` survives between visits. */
  state: {
    persistence: 'localStorage' | 'none'
    description: string
  }
}

/** The server half: what handlers can store, read and answer. */
export interface ServerContract {
  /** Where document endpoints are mounted (`<mount>/<app>/<path>`). */
  mount: string
  storages: StorageCapability[]
  /** Default storage when neither the document nor the collection says. */
  defaultStorage: string
  /** What a handler can read: `state` is the request, `context` the metadata. */
  request: {
    state: string[]
    context: string[]
  }
  /** Fields the runtime adds to every stored record. */
  recordFields: string[]
  methods: string[]
}

export interface RuntimeContract {
  /** Runtime identifier. */
  runtime: string
  version: string
  /** Actions span both halves: `shared` run anywhere, `client` only in templates, `server` only in handlers. */
  actions: {
    shared: string[]
    client: string[]
    server: string[]
  }
  client: ClientContract
  server: ServerContract
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const NODE_TYPES = ['component', 'html', 'text', 'if', 'for', 'template', 'outlet'] as const

export const RUNTIME_CONTRACT: RuntimeContract = {
  runtime: 'blueprint-nuxt-module',
  version: '1.0.0',
  actions: {
    shared: [...SHARED_ACTION_TYPES],
    client: [...CLIENT_ACTION_TYPES],
    server: [...SERVER_ACTION_TYPES],
  },
  client: {
    prefix: '',
    components: { base: [...BASE_COMPONENT_NAMES], nuxtUi: [], app: [] },
    nodeTypes: [...NODE_TYPES],
    context: ['app', 'version', 'base', 'path', 'params', 'query', 'page', 'busy'],
    state: {
      persistence: 'localStorage',
      description: 'Kept per app in the browser and restored while the document version matches. Live paths (fetch/submit results) are never persisted.',
    },
  },
  server: {
    mount: '/api/blueprint',
    storages: [
      { name: 'memory', description: 'In-process map. Lost on restart; ideal for tests and demos.', durable: false },
      { name: 'fs', description: 'One JSON file per record under the data directory.', durable: true },
      { name: 'sqlite', description: 'One SQLite database per app (Node built-in `node:sqlite`).', durable: true },
    ],
    defaultStorage: 'fs',
    request: {
      state: ['body', 'query', 'params'],
      context: ['app', 'version', 'method', 'path', 'endpoint', 'now', 'params', 'query', 'createdUnder'],
    },
    recordFields: ['id', 'createdAt', 'updatedAt'],
    methods: [...HTTP_METHODS],
  },
}

export interface ContractOverrides {
  prefix?: string
  defaultStorage?: string
  components?: Partial<ComponentLayers>
}

/** The effective contract of a configured host: the static part plus what only the host knows. */
export function resolveContract(base: RuntimeContract = RUNTIME_CONTRACT, overrides: ContractOverrides = {}): RuntimeContract {
  return {
    ...base,
    client: {
      ...base.client,
      prefix: overrides.prefix ?? base.client.prefix,
      components: { ...base.client.components, ...overrides.components },
    },
    server: {
      ...base.server,
      defaultStorage: overrides.defaultStorage ?? base.server.defaultStorage,
    },
  }
}

/** Every component name a template may draw, whatever the layer. */
export function componentNames(contract: RuntimeContract = RUNTIME_CONTRACT): string[] {
  const { base, nuxtUi, app } = contract.client.components
  return [...new Set([...base, ...nuxtUi, ...app])].sort()
}

export function storageNames(contract: RuntimeContract = RUNTIME_CONTRACT): string[] {
  return contract.server.storages.map(storage => storage.name)
}

/**
 * JSON Schema (draft-07) of what the runtime owns: the server sections
 * (`runtime`, `collections`, `endpoints`) and the vocabulary the browser
 * half draws from (`$defs.component`, `$defs.nodeType`). The document schema
 * references it (`runtime.schema.json#/$defs/...`) so a document keeps one
 * `$schema` while the runtime part can be replaced by another runtime.
 */
export function runtimeSchema(contract: RuntimeContract = RUNTIME_CONTRACT): Record<string, unknown> {
  const logic = { $ref: '#/$defs/logic' }
  const storage = { type: 'string', enum: storageNames(contract), description: contract.server.storages.map(entry => `${entry.name}: ${entry.description}`).join('\n') }
  const sort = {
    anyOf: [
      { type: 'object', additionalProperties: { enum: ['asc', 'desc'] } },
      { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2, items: [{ type: 'string' }, { enum: ['asc', 'desc'] }] } },
    ],
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'blueprint-runtime.schema.json',
    title: `${contract.runtime} runtime contract`,
    description: `What the ${contract.runtime} runtime ${contract.version} provides: the server sections a document may declare and the components its templates may draw. Generated from the runtime capabilities.`,
    type: 'object',
    properties: {
      runtime: { $ref: '#/$defs/runtime' },
      collections: { $ref: '#/$defs/collections' },
      endpoints: { $ref: '#/$defs/endpoints' },
    },
    $defs: {
      logic: { description: 'Calculation notation expression.', anyOf: [{ type: 'null' }, { type: 'boolean' }, { type: 'number' }, { type: 'string' }, { type: 'array' }, { type: 'object' }] },
      contract: {
        description: 'Capabilities of the runtime, as data.',
        const: contract,
      },
      component: {
        type: 'string',
        description: `Component a template may draw. Layers: base (${contract.client.components.base.length}, portable), nuxtUi (${contract.client.components.nuxtUi.length}), app (${contract.client.components.app.length}).`,
        enum: componentNames(contract),
      },
      nodeType: { type: 'string', enum: contract.client.nodeTypes },
      runtime: {
        type: 'object',
        description: 'What the document asks of the runtime hosting it.',
        properties: {
          storage: { ...storage, description: `Default storage for collections (runtime default: ${contract.server.defaultStorage}).\n${storage.description}` },
        },
        additionalProperties: false,
      },
      collections: {
        type: 'object',
        description: 'Named record sets persisted by the runtime.',
        propertyNames: { pattern: '^[a-z][a-z0-9-]*$' },
        additionalProperties: {
          type: 'object',
          properties: {
            schema: { type: 'string', description: 'Document schema every inserted record must satisfy.' },
            storage,
            description: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      endpoints: {
        type: 'object',
        description: `HTTP endpoints written in the document, served under ${contract.server.mount}/<app>.`,
        propertyNames: { pattern: '^[a-z][a-z0-9-]*$' },
        additionalProperties: { $ref: '#/$defs/endpoint' },
      },
      endpoint: {
        type: 'object',
        required: ['method', 'path', 'handler'],
        properties: {
          method: { type: 'string', enum: contract.server.methods },
          path: { type: 'string', pattern: '^/', description: 'Route pattern relative to the app: /posts, /posts/:id' },
          description: { type: 'string' },
          input: {
            type: 'object',
            description: 'Document schemas validated before the handler runs (422 on failure).',
            properties: { body: { type: 'string' }, query: { type: 'string' }, params: { type: 'string' } },
            additionalProperties: false,
          },
          pinned: { type: 'boolean', description: 'Refuse requests whose createdUnder.version differs from the published document (409).' },
          handler: { $ref: '#/$defs/handler' },
        },
        additionalProperties: false,
      },
      handler: {
        description: `Server actions. Allowed types: ${[...contract.actions.shared, ...contract.actions.server].join(', ')}. Reads state.${contract.server.request.state.join('|')} and context.${contract.server.request.context.join('|')}.`,
        anyOf: [
          { type: 'string', description: 'Named action from content.actions' },
          { $ref: '#/$defs/serverAction' },
          { type: 'array', items: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/serverAction' }] } },
        ],
      },
      serverAction: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', enum: [...contract.actions.shared, ...contract.actions.server] },
          collection: { type: 'string' },
          data: logic,
          id: logic,
          where: { ...logic, description: 'Item predicate; sees `item` (also bare `var`) and `index`.' },
          sort,
          limit: logic,
          offset: logic,
          set: { type: 'object', additionalProperties: logic },
          as: { type: 'string', description: 'Variable receiving the result, readable by the next steps with { "var": "<as>" }.' },
          status: { type: 'integer', minimum: 100, maximum: 599 },
          body: logic,
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          message: logic,
          issues: logic,
          // shared actions
          path: { type: 'string' },
          value: logic,
          index: logic,
          by: logic,
          min: logic,
          max: logic,
          condition: logic,
          then: { $ref: '#/$defs/handler' },
          else: { $ref: '#/$defs/handler' },
          schema: { type: 'string' },
          name: { type: 'string' },
          with: { type: 'object', additionalProperties: logic },
          steps: { $ref: '#/$defs/handler' },
        },
        allOf: [
          { if: { properties: { type: { enum: ['insert', 'find', 'findOne', 'count', 'patch', 'delete'] } } }, then: { required: ['collection'] } },
          { if: { properties: { type: { const: 'insert' } } }, then: { required: ['data'] } },
          { if: { properties: { type: { const: 'patch' } } }, then: { required: ['set'] } },
        ],
      },
      actionTypes: { enum: [...ACTION_TYPES] },
    },
  }
}

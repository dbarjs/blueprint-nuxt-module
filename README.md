# Blueprint Nuxt Module

Turn every Blueprint document under `content/` into a complete Nuxt application.
One JSON file is one app: resources, schemas, calculated definitions, state,
actions, page templates and the tests that prove them, rendered with Nuxt UI
and served through Nuxt Content.

This repository stresses the Blueprint notation on purpose. The restaurant
example (`content/restaurant-menu-shop.json`) is a full menu → cart → checkout
→ pinned order flow written entirely as a document. Nothing about the
restaurant lives in Vue.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000 lists the apps found in content/
pnpm test           # engine unit tests + every document validated and its embedded tests run
pnpm test:e2e       # boots a Nuxt fixture with the module and hits real routes
pnpm lint && pnpm typecheck
```

Editing a document under `content/` re-validates it, re-runs its tests and hot
reloads the app. Invalid documents fail `nuxt build`.

## What the module does

- **Installs Nuxt UI and Nuxt Content** as module dependencies and registers a
  `blueprints` data collection over the content directory (`blueprint.dir`,
  default `content`, the playground points at `../content`).
- **Routes** `/<document-name>/<page-route>` through one catch-all page. Page
  templates declare their own route pattern (`/product/:id`).
- **Evaluates** definitions and templates with its own pure engine
  (`src/runtime/engine`): a JSON Logic compatible calculation notation, a
  template evaluator that produces a framework-free abstract tree, a JSON
  Schema subset validator, a closed set of actions and a parameter-table
  `lookup` with hit policies. No third-party logic library.
- **Materializes** the abstract tree into Vue through a generated lazy
  registry (`.nuxt/blueprint/registry.mjs`) of the base vocabulary, every Nuxt
  UI component and opt-in app components prefixed `Blueprint`.
- **Validates at build time**: envelope and `spec` version, every static
  reference (`refs()`), definition, action and template cycles, duplicate
  routes, unknown components, raw html or class escape hatches, the shape of
  every test form, projections per audience (a public page may not lean on a
  server-only table), and the document's own tests. It also generates
  `.nuxt/blueprint/schema.json` for editor IntelliSense and
  `.nuxt/blueprint/manifest.json` for agents.
- **Computes compatibility**: what a document *requires* is derived from its
  references as versioned **capabilities** (`web.pages`, `http.endpoints`,
  `storage.collections`, `vocab.base`…) and checked against what the runtime
  *provides*. Critical and absent → the document is refused; optional and
  absent → it degrades and the report says so. Each document gets a **version
  manifest** (section hashes, requirements, portability level and
  `portable / degradable / LOCKED` status) and the runtime publishes its
  **runtime manifest** at `GET /api/blueprint/contract`.
- **Carries four kinds of test in the document**: definition tests
  (state in, values out), tree tests (a template renders these nodes), action
  scenarios (run actions against stubbed capabilities, compare state and the
  effect log) and endpoint scenarios (request in, response out, records
  after). No network and no storage are touched; an unstubbed effect fails
  the test.
- **Pins records**: `POST /api/blueprint/<app>/records` re-validates the
  payload with the same validator against the published document, refuses a
  payload built under a different document version (409) and stores the record
  with `createdUnder: { document, version }`. The version is
  `sha256:` of the canonical (RFC 8785) document.
- **Persists state** per app in `localStorage`; a new document version starts
  from its initial state again. Live data fetched from endpoints is never
  persisted, and pages that fetch on `enter` are not prerendered.
- **Is a Blueprint runtime**: a document declares its storage backend
  (`memory`, `fs`, `sqlite`), its collections and its HTTP endpoints, and
  writes the handlers in the same action language the browser runs — with
  server effects (`insert`, `find`, `patch`, `respond`…) instead of browser
  ones. Every capability call may bind its value (`as`) or write it to state
  (`result`) on either side, failures are values a `catch` can read, and every
  call is appended to an effect log. Components outside the base vocabulary
  may carry a `fallback` so a runtime without them still draws something.
  Endpoints may carry an `access` rule over `context.actor` (the `identity`
  capability, reserved; no provider ships yet). `content/public-board.json` is a complete app — storage, API
  and pages — in one file; `content/health-quote.json` goes further and
  prices a health insurance quote on both sides with the same definitions
  (rating tables as parameter tables, a handler that stages the request as
  browser state, version-pinned quotes). `content/habit-tracker.json` goes the
  other way: no server at all, streaks and a month grid computed from
  `context.now` with calendar arithmetic written in the notation.

## Document shape

```jsonc
{
  "name": "restaurant-menu-shop",            // URL prefix, defaults to the file stem
  "content": {
    "meta": { "title": "…", "layout": "component:shell", "currency": "USD", "theme": { "primary": "orange" } },
    "resources": { "products": { "type": "list", "data": [ … ] } },
    "schemas": { "checkout": { "type": "object", … } },
    "state": { "cart": { "lines": [] } },   // initial mutable state
    "definitions": { "subtotal": { "logic": { "sum": [{ "def": "cartLines" }, "total"] } } },
    "actions": { "add-to-cart": [ … ] },
    "runtime": { "storage": "sqlite" },      // what the document asks of its runtime
    "collections": { "posts": { "schema": "post" } },
    "endpoints": { "list-posts": { "method": "GET", "path": "/posts", "handler": [ … ] } },
    "templates": {
      "component:shell": [ … { "type": "outlet" } … ],
      "page:index": { "route": "/", "children": [ … ] }
    },
    "tests": [ { "name": "…", "state": { … }, "expect": { "total": 5747 } } ]
  }
}
```

See `docs/notation.md` for the full notation: operators, node types, bindings,
`model` paths, actions, parameter tables, page lifecycle, and the runtime
sections (storage, collections, endpoints, server actions, contract).

## Layout of this repository

- `src/module.ts` — module setup, generated artifacts, build-time validation.
- `src/build/` — document loading, reporting, artifact templates.
- `src/runtime/engine/` — the pure engine (no Vue, no Nuxt), shared by build,
  server and client.
- `src/runtime/components/` — base vocabulary components (`Stack`, `Grid`,
  `Text`, `Heading`, `Image`, `Spacer`) and the `BlueprintTree` materializer.
- `src/runtime/composables/` — `useBlueprintDocument`, `useBlueprint`.
- `src/runtime/pages/` — the app catch-all page and the app index.
- `src/runtime/server/` — pinned record endpoints, the dispatcher for
  endpoints written in documents, storage backends, the contract route.
- `content/` — one document per application.
- `docs/` — notation reference, ADRs, initial context and legacy examples.
- `test/` — engine tests, document tests, e2e fixture.

## Module options

```ts
export default defineNuxtConfig({
  modules: ['blueprint-nuxt-module'],
  blueprint: {
    dir: 'content',            // where documents live (relative to rootDir)
    prefix: '',                // URL prefix for every app
    componentPrefix: 'Blueprint', // opt-in prefix for app components exposed to documents
    validate: true,            // fail the build on invalid documents
    tests: true,               // run the tests carried by documents at build time
    api: true,                 // register /api/blueprint/*: records, contract, document endpoints
    storage: 'fs',             // default backend for collections: memory | fs | sqlite
    dataDir: '.data/blueprint', // fs records and sqlite databases (relative to rootDir)
    ui: {},                    // forwarded to @nuxt/ui
    content: {},               // forwarded to @nuxt/content
  },
})
```

List `blueprint-nuxt-module` before `@nuxt/content` if you also configure
Content yourself, or register the collection in your own `content.config.ts`
with `defineBlueprintCollection()` from `blueprint-nuxt-module/content`.

## License

MIT

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
- **Validates at build time**: envelope, every static reference (`refs()`),
  definition and template cycles, duplicate routes, unknown components, raw
  html or class escape hatches (reported as non-portable) and the document's
  own tests. It also generates `.nuxt/blueprint/schema.json` for editor
  IntelliSense and `.nuxt/blueprint/manifest.json` for agents.
- **Pins records**: `POST /api/blueprint/<app>/records` re-validates the
  payload with the same validator against the published document, refuses a
  payload built under a different document version (409) and stores the record
  with `createdUnder: { document, version }`. The version is the FNV-1a hash of
  the canonical document.
- **Persists state** per app in `localStorage`; a new document version starts
  from its initial state again.

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
    "templates": {
      "component:shell": [ … { "type": "outlet" } … ],
      "page:index": { "route": "/", "children": [ … ] }
    },
    "tests": [ { "name": "…", "state": { … }, "expect": { "total": 5747 } } ]
  }
}
```

See `docs/notation.md` for the full notation: operators, node types, bindings,
`model` paths, actions, parameter tables and page lifecycle.

## Layout of this repository

- `src/module.ts` — module setup, generated artifacts, build-time validation.
- `src/build/` — document loading, reporting, artifact templates.
- `src/runtime/engine/` — the pure engine (no Vue, no Nuxt), shared by build,
  server and client.
- `src/runtime/components/` — base vocabulary components (`Stack`, `Grid`,
  `Text`, `Heading`, `Image`, `Spacer`) and the `BlueprintTree` materializer.
- `src/runtime/composables/` — `useBlueprintDocument`, `useBlueprint`.
- `src/runtime/pages/` — the app catch-all page and the app index.
- `src/runtime/server/` — pinned record endpoints.
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
    api: true,                 // register /api/blueprint/* record endpoints
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

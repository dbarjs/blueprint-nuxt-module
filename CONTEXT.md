# Domain context

Ubiquitous language for this repository. Terms come from the Blueprint
handoff documents (`docs/initial-context`) and from decisions taken while
building the restaurant example; ADRs live in `docs/adr/`.

## Glossary

- **Document** — one JSON file under `content/`; one complete application. Its file stem is the app **name** and URL prefix.
- **Section** — a top-level key of `content`: `meta`, `resources`, `schemas`, `definitions`, `state`, `actions`, `templates`, `tests`.
- **Resource** — data authored with the product (menu, zones, promo codes). A **parameter table** is a resource whose rows carry `match` conditions and a hit policy.
- **Definition** — a pure computed value over state and context, memoized per evaluation pass. Never a loop variable.
- **State** — the mutable payload under construction (cart, checkout form, UI flags). Initialized from `content.state`, persisted per app in the browser.
- **Context** — route params, query, app name, document version, busy flag. Read-only input to expressions.
- **Calculation notation** — the JSON Logic compatible expression language (`src/runtime/engine/logic.ts`).
- **Template** — a named tree of nodes: `page:*` (routed), `component:*` (included), `channel:*` (non-web materializations such as a kitchen ticket).
- **Abstract tree** — the normative output of template evaluation: loops expanded, conditions decided, bindings substituted, keys assigned. Framework-free JSON.
- **Materializer** — turns an abstract tree into a target; here `BlueprintTree` produces Vue vnodes.
- **Registry** — the generated map from component names to lazy Vue components, split into **base**, **Nuxt UI** and **app** layers. Documents using only the base layer are **portable**.
- **Action** — one of the closed set of things an event may do (`set`, `push`, `navigate`, `submit`…). **Effects** (navigation, toasts, network) are supplied by the runtime.
- **Enter actions** — actions a page runs when it is entered or its params change.
- **Version** — FNV-1a hash of the canonical document. Records **pin** it as `createdUnder`.
- **Record** — one stored item of a collection: the validated data plus `id`, `createdAt`, `updatedAt`. The built-in records API additionally wraps submissions in an envelope pinned to a version.
- **refs()** — the static reference set of a section; basis for validation, cycle detection and closure.
- **Runtime** — a host that runs documents. A document has two halves, the templates the browser draws and the endpoints the server runs, and a runtime provides the capabilities of both: components and browser effects on the **client** side, storage, server actions and the request shape on the **server** side. This module is one: Nuxt provides the build step, the server and the browser.
- **Contract** — what a runtime offers documents, in two halves that mirror the runtime: `client` (page prefix, component layers, node types, browser context, state persistence) and `server` (mount point, storages, request shape, record fields, methods), with the action types above both. Published as data and as the JSON schema of what the runtime owns. The **effective contract** is the static one resolved with what only the host knows: its prefix, its default storage, its scanned component registry.
- **Collection** — a named set of records declared by the document, validated with one of its schemas, persisted in a storage.
- **Storage** — the backend a collection persists in (`memory`, `fs`, `sqlite`); named by the document, provided by the runtime.
- **Endpoint** — an HTTP route written in the document (method, path, input schemas, handler), served under the runtime's mount point.
- **Handler** — the actions an endpoint runs. Same action language as the browser, with server effects.
- **Server action** — an action that only exists in a handler: collection operations (`insert`, `find`, `findOne`, `count`, `patch`, `delete`) and request termination (`respond`, `fail`).
- **Request** — what a handler reads: `state` is `body`/`query`/`params`; `context` is the metadata (app, version, now, endpoint, pin).
- **Live state** — state paths that receive server data (`fetch`/`submit` results). Never persisted in the browser, never prerendered.

## Avoided terms

- "Widget", "block" — use **node**.
- "Formula" — use **definition** or **expression**.
- "Store" — use **state** (browser) or **storage** (server backend).
- "Database", "table" — use **storage** and **collection**.
- "Route handler", "API route" — use **endpoint** (declared) and **handler** (its actions).

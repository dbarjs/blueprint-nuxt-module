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
- **Version** — hash of the canonical document (FNV-1a today; SHA-256 proposed in ADR 0013). Records **pin** it as `createdUnder`.
- **Record** — one stored item of a collection: the validated data plus `id`, `createdAt`, `updatedAt`. The built-in records API additionally wraps submissions in an envelope pinned to a version.
- **refs()** — the static reference set of a section; basis for validation, cycle detection and closure.
- **Runtime** — a host that runs documents: an engine implementing the kernel plus a set of **capabilities** and **materializers** for one environment (ADR 0005). This module is one: Nuxt provides the build step, the server and the browser. A document has two halves here, the templates the browser draws and the endpoints the server runs.
- **Kernel** — the spec: what every document means independent of any environment (envelope, notation, schemas, abstract tree, actions as data, `refs()`, tests, canonical form). Text plus fixtures, no code (ADR 0005).
- **Distribution** — a runtime specialized for a domain, packaging vocabularies, datasets and capabilities (ADR 0005).
- **Capability** — a versioned interface a runtime provides and a document requires (`web.pages`, `http.endpoints`, `storage.collections`, `vocab.base`…). Documents declare `requires`/`optional` (mostly derived by `refs()`); runtimes declare `provides`. Critical and absent → refuse; optional and absent → degrade (ADR 0007).
- **Surface** — where a materializer or a capability runs: `client`, `server`, `build`, `print`, `email`, `messaging` (ADR 0010). ADR 0004's client and server halves are this runtime's surfaces.
- **Transform / Capability call** — the two kinds of action: pure over state and vars (`set`, `if`, `validate`…) versus a call handed to a capability provider whose result comes back as input (`fetch`, `insert`, `respond`…) (ADR 0008).
- **Effect log** — the ordered list of capability calls and results of one run (`{ step, type, capability, input, result }`); part of the reproduction tuple and replayable as stubs in tests (ADR 0008).
- **Actor** — who is acting, as `context.actor`: `null` when anonymous, otherwise `{ id, kind, roles, claims, via }` produced by an `identity` provider (ADR 0027).
- **Access rule** — `endpoints.<name>.access`: a calculation over the request and the actor, evaluated after input validation and before the handler; falsy → 401 or 403. Distinct from audience: access is who may call, audience is where an entry may travel (ADR 0027).
- **Test form** — one of definition test, tree test, action scenario, endpoint scenario, recognised by the keys a test carries (`expect`, `render`, `run`, `request`) (ADR 0011).
- **Stub** — a scripted answer to a capability call in a scenario (`{ match, result }`); an unstubbed call fails the test (`UNSTUBBED_EFFECT`).
- **Contract** — what this runtime offers documents, in two halves that mirror the runtime: `client` (page prefix, component layers, node types, browser context, state persistence) and `server` (mount point, storages, request shape, record fields, methods), with the action types above both. Published as data and as the JSON schema of what the runtime owns. The **effective contract** is the static one resolved with what only the host knows: its prefix, its default storage, its scanned component registry. ADR 0009 re-expresses it as the **runtime manifest**.
- **Runtime manifest** — what a runtime provides: spec range, engine build, surfaces, capabilities with versions and options, materializers (ADR 0009).
- **Version manifest** — what a published document version requires: section hashes, derived `requires`/`optional`, options, portability level, pages, endpoints, test counts (ADR 0009).
- **Project manifest** — `.nuxt/blueprint/manifest.json`: the documents' version manifests plus the runtime manifest, read by agents.
- **Portability level** — L0 kernel only; L1 plus `vocab.base`; L2 plus the minimum common runtime; L3 runtime-specific (ADR 0009).
- **Minimum common runtime** — the capabilities every runtime must provide; written by subtraction after the second runtime exists (ADR 0005, 0017).
- **Document store** — where versions of documents live: eight operations, no update, no delete; `store-git` (this repository) and `store-fs` (ADR 0014).
- **Record storage** — where collections persist records: the `storage.collections` capability with named backends (`memory`, `fs`, `sqlite`) (ADR 0014).
- **Audience** — which surface may read a section entry (`public`, `client`, `server`, `print`…); projection filters by audience before closing over `refs()` (ADR 0015).
- **Projection / Profile** — a document derived from (version, selection, audience), itself a valid document; a profile is a named selection materialized at publish (ADR 0015).
- **Overlay** — a document whose `extends` names a base version by hash and whose `content` is a merge patch with list identity; resolved at publish into a flat document with provenance (ADR 0016).
- **Pin** — `createdUnder` (what the client evaluated under), `acceptedUnder` (what the server evaluated under), `evaluatedBy` (runtime and engine build) on a record (ADR 0013).
- **Source form / Builder** — a document authored as a tree of files (path is the address, extension is the syntax) and built into one canonical JSON by `blueprint build`; `explode` is the inverse; round trips are tested (ADR 0019).
- **Dialect** — a friendlier syntax defined only by its mapping to the JSON form: infix `.logic`, the Vue-like `.bpt` template dialect, restricted Gherkin `.feature`, Markdown resources (ADR 0018, 0020, 0011, 0021).
- **Deployment document** — a document of `kind: deployment` that binds an app version's required capabilities to providers for one environment; pinned separately so the product hash never changes with hosting (ADR 0022).
- **Provider** — something that satisfies capability interfaces on a platform (Supabase, Cloudflare, this module's built-in backends), described by a provider manifest (ADR 0022).
- **Library** — a document store plus one runtime plus a catalog: many apps sharing a runtime range and vocabularies, isolated in state and records (ADR 0023).
- **Capability request** — the machine-readable artifact `validate --target` emits for what a runtime lacks; filed to the runtime's tracker (existing interface) or the spec's (new interface) (ADR 0024).
- **Locator** — a location plus an expected version hash; the hash is the identity, the URL is where to look; wrong bytes are refused (ADR 0025).
- **Fallback / Adapter** — a base-vocabulary template a non-base component degrades to when its vocabulary is absent (vocabulary-level or node-level); an adapter maps one vocabulary to another as data (ADR 0026).
- **Portable / degradable / LOCKED** — the three words the report prints per document: base-only or minimum-common; degrades through fallbacks; has nodes with no fallback and runs only where their vocabulary exists (ADR 0026).
- **Secret reference** — the only form a secret may take in a document: `{ "type": "secret", "ref": … }` or `{ "secret": "name" }`, resolved on server surfaces; values are never inline (ADR 0021).
- **Spec version** — the `spec` field of the envelope; semantics are frozen per spec version and engines dispatch on it (ADR 0006, 0013).
- **Collection** — a named set of records declared by the document, validated with one of its schemas, persisted in a storage.
- **Storage backend** — the backend a collection persists in (`memory`, `fs`, `sqlite`); named by the document, provided by the runtime's record storage.
- **Endpoint** — an HTTP route written in the document (method, path, input schemas, handler), served under the runtime's mount point.
- **Handler** — the actions an endpoint runs. Same action language as the browser, with server effects.
- **Server action** — an action that only exists in a handler: collection operations (`insert`, `find`, `findOne`, `count`, `patch`, `delete`) and request termination (`respond`, `fail`).
- **Request** — what a handler reads: `state` is `body`/`query`/`params`; `context` is the metadata (app, version, now, endpoint, pin).
- **Live state** — state paths that receive server data (`fetch`/`submit` results). Never persisted in the browser, never prerendered.
- **Staging** — a handler setting the request under the state path the browser uses, so the same definitions price, validate and describe on both sides. The stored result is the server's.
- **Parameter table** — a resource whose rows carry a `match` and an output; read with `lookup`. Hit policy `first`, `unique`, `last` or `collect` (every matching row applies).

## Avoided terms

- "Widget", "block" — use **node**.
- "Formula" — use **definition** or **expression**.
- "Store" — use **state** (browser), **document store** (versions) or **record storage** (collections).
- "Storage" alone — say **document store** or **record storage**; a named backend is a **storage backend**.
- "Database", "table" — use **record storage** and **collection**.
- "Plugin", "extension", "feature flag" — use **capability**.
- "Halves", "client side / server side" as spec terms — use **surface**; the halves are this runtime's two surfaces.
- "Route handler", "API route" — use **endpoint** (declared) and **handler** (its actions).

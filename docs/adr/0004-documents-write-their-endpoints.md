# ADR 0004 — Documents write their own endpoints as server actions; the runtime publishes a contract

Status: accepted (2026-09-10)

## Context

Until now a document could only reach the server through one fixed route,
the pinned records API. The public board needed the opposite: a document
that declares where its data lives and which HTTP endpoints exist, with the
Nuxt module acting as a **runtime** for both halves of the app. Three levels
were possible: pick a storage backend only; declare collections and bind
routes to a closed set of operations (list/create/get…); let the document
write the handler logic itself. The author chose the third.

The apparent risk of the third level — a server language inside JSON — is
smaller than it looks in this engine: the calculation notation is a pure
evaluator, and actions are already a closed set whose effects are injected by
the host (ADR 0002).

## Decision

- A document may declare `runtime` (default storage), `collections` (named
  record sets with a schema and a storage) and `endpoints` (method, path,
  input schemas, handler, pinned).
- A **handler is the existing action language** with server effects. Eight
  action types are server-only: `insert`, `find`, `findOne`, `count`, `patch`,
  `delete`, `respond`, `fail`. `navigate`, `toast`, `fetch`, `submit` are
  browser-only. The validator enforces the placement statically.
- The request is exposed as `state` (`body`, `query`, `params`) and
  `context` (app, version, now, endpoint, pin). Data actions hand their
  result to the next step through a variable (`as`).
- Storage is a **four-operation store** (`all`, `get`, `put`, `delete`) per
  backend; predicates, sorting and paging run in the notation. Backends:
  `memory`, `fs` (Nitro storage), `sqlite` (Node built-in, one file per app).
- Nitro serves every document endpoint through **one catch-all dispatcher**
  (`/api/blueprint/:app/**`) that reads the published document at request
  time, so editing an endpoint is live in development. The built-in records
  routes are registered first and keep priority.
- The runtime publishes a **contract** in two halves, because a runtime
  hosts both halves of a document: `client` (page prefix, component layers,
  node types, browser context, state persistence) and `server` (mount
  point, storages, request shape, record fields, methods), with the action
  types above both. It is published as data (`GET /api/blueprint/contract`,
  `manifest.json#runtime`) and as JSON schema (`.nuxt/blueprint/runtime.schema.json`,
  referenced from the document schema, which takes its component enum from
  it). The engine holds the static part; the module resolves the effective
  contract with the host's prefix, default storage and scanned registry, and
  hands it to Nitro right before the server build, since Nitro clones the
  runtime config when it initializes. Build-time validation checks documents
  against the same object the server publishes.
- `fetch` is added to the browser actions; its `result` paths (and
  `submit`'s) are **live state**: excluded from browser persistence and from
  prerendering of the pages that fetch on `enter`.

## Alternatives considered

- **Closed operations bound to routes** (`{ "op": "list", "collection": "posts" }`).
  Simpler contract, but every non-trivial endpoint (default nickname, mood
  filter, stats) would have needed an escape hatch that is exactly the
  handler we built.
- **Raw key-value effects** (`get`/`set` on storage). Pushes keys, scanning
  and ordering into every document; collections keep those in the runtime.
- **Generating Nitro routes at build time** from the documents. Faster
  matching, but stale on edit and one more generated artifact; the dispatcher
  is one file and can be replaced later.

## Consequences

- `content/public-board.json` is a complete application in one file:
  storage, four endpoints, two pages. The Nitro handler it replaces was longer.
- A second runtime (another framework, an edge worker) implements the same
  four-operation store and the eight server actions, and publishes its own
  contract file; documents do not change.
- Access control is deliberately absent: every endpoint is public. The
  endpoint shape has room for it when a document forces the decision.
- Query evaluation happens in memory over `all()`; fine for a board, wrong
  for a large collection. Pushing `where`/`sort`/`limit` down to SQL is a
  backend optimization behind the same contract.

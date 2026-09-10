# ADR 0007 — Capabilities: documents declare `requires`, runtimes declare `provides`

Status: proposed (2026-09-10). Layer: kernel (the mechanism), runtime (the
instances). The first item on the agenda the continuation document left
for "a cold head".

## Context

The handoff's vocabulary mechanism (URI + version; critical unknown →
refuse; optional unknown → ignore) was written for schemas, operators and
components. The public board and the health quote pushed the same need to a
new place: a document that declares endpoints and collections needs a server
and a storage, a document that navigates needs a router, a document that
toasts needs a screen. ADR 0004 answered with a contract in two halves,
`client` and `server`, listing what this runtime offers.

That contract is right for one runtime and wrong as a spec: a print server
has neither half, a mobile app has a client half with a different router, a
batch evaluator has nothing but the kernel. WebAssembly with WASI is the
precedent that fits: a pure module imports **capabilities** as versioned
interfaces, and the host declares which it provides. Compatibility is a set
comparison done before anything runs.

## Decision

### A capability is a versioned interface

```jsonc
{
  "name": "http.endpoints",             // dotted, lowercase; a URI when published by a third party
  "version": "1.0.0",                   // semver; documents require ranges
  "surface": "server",                  // where it runs: "client" | "server" | "any" | a runtime-defined surface
  "sections": ["endpoints"],            // document sections it owns (ADR 0006)
  "actions": {                          // action types it adds to the closed set (ADR 0008)
    "respond": { "input": { … }, "ends": true },
    "fail":    { "input": { … }, "ends": true }
  },
  "context": ["method", "path", "endpoint", "params", "query", "createdUnder"],   // keys it injects into `context`
  "state": ["body", "query", "params"],  // what it puts into `state` when it starts an evaluation
  "effects": ["network"],               // what leaves the evaluation: none | network | storage | screen | device
  "fixtures": "conformance/http.endpoints/"   // scenarios every provider must pass (ADR 0011)
}
```

An interface is data. A provider (a runtime) implements it in code and
passes its fixtures. A document never names a provider, only the interface.

### The document side: `requires` and `optional`

Written in `content.runtime` (ADR 0006), mostly derived by `validate`:

| Document uses | Derived requirement |
|---|---|
| a `page:*` template | `web.pages` |
| `model` bindings or `state` persistence | `web.state` |
| `navigate`, page `enter`, `context.params` | `web.router` |
| `toast` | `ui.toast` (optional by default) |
| `fetch`, `submit` | `http.client` |
| `endpoints` section, `respond`, `fail` | `http.endpoints` |
| `collections` section, `insert` … `delete` | `storage.collections` |
| `context.now` | `time.now` |
| a base-vocabulary component | `vocab.base@<spec version>` |
| a `U*` component | `vocab.nuxt-ui@<hash>` |
| a `Blueprint*` app component | `vocab.app@<hash>` |
| a `channel:*` template | nothing by itself; the surface that renders it requires a materializer for its vocabulary |

Everything derived is **critical** unless the interface's default says
optional (`ui.toast`) or the author lists it under `optional`. Authored
entries pin versions or change criticality; they cannot remove a derived
requirement.

### The runtime side: `provides`

The runtime manifest (ADR 0009) lists the interfaces it implements, with
version and surface, plus provider-specific options (storage backends,
component lists, mount points). This module today provides, mapped from its
contract:

| Contract field today | Capability |
|---|---|
| `client.prefix`, page catch-all | `web.pages@1` |
| `client.state.persistence` | `web.state@1` (option `persistence: localStorage`) |
| `navigate`, `enter`, `context.params/query/path/page` | `web.router@1` |
| `toast` | `ui.toast@1` |
| `fetch`, `submit`, `context.busy` | `http.client@1` |
| `server.mount`, `endpoints`, `respond`, `fail`, request shape | `http.endpoints@1` |
| `server.storages`, `collections`, `insert` … `delete`, `recordFields` | `storage.collections@1` (option `backends: memory, fs, sqlite`) |
| `context.now` | `time.now@1` |
| `client.components.base` | `vocab.base@0.1` |
| `client.components.nuxtUi` | `vocab.nuxt-ui@<registry hash>` |
| `client.components.app` | `vocab.app@<registry hash>` |
| built-in `POST /records` | `records.pinned@1` (the pre-ADR-0004 API; kept as its own capability) |

### Refuse or degrade

- **Critical and absent → refuse the document** before evaluating anything
  (`CAPABILITY_MISSING`, listing name, required range, provided version if any).
- **Optional and absent → evaluate and mark.** The abstract tree may contain
  `{ "kind": "unavailable", "capability": "ui.toast", "key": … }` nodes where a
  template needed the capability; an action of an absent optional capability
  returns `{ ok: false, error: { code: "CAPABILITY_UNAVAILABLE" } }` and
  runs the handler's `catch`. Nothing is silently skipped; the runtime
  reports every degradation.
- **Version outside range → refuse**, even for optional ones: a wrong
  version is worse than an absence because it runs and differs.

### What a capability may not do

- Change the meaning of a kernel operator, node type or shared action.
- Read configuration the document did not declare (completeness, ADR 0006).
- Escape reproduction: every value a capability returns into an evaluation
  is recorded as input (ADR 0008).

### Two capabilities reserved, not specified

- `identity` — who is acting. Every endpoint is public today and no
  document has forced the decision. The endpoint shape reserves `access`;
  the capability will inject `context.actor`. Reserved so no document
  invents its own.
- `dataset.fetch` — datasets referenced by version and content hash, fetched
  **before** evaluation, refused on hash mismatch (handoff 4.2). Reserved
  because the first document with a CEP-style table will need it, and the
  rule that the fetch happens before evaluation must not be improvised.

## Alternatives considered

- **Keep the two-halves contract and let each runtime define its halves.**
  Fails for surfaces that are neither browser nor HTTP server, and gives
  `validate` nothing to compare between runtimes.
- **Capabilities as free strings with no interface data.** Cheap, but
  compatibility would mean "same name", which is how dialects are born.
- **One big `runtime.profile` name** (`web`, `server`, `print`) instead of a
  set. Profiles are useful as shorthand and can be defined later as named
  sets of capabilities; the unit stays the capability.

## Conditions under which this is wrong

- If the second runtime (ADR 0017) needs capabilities that cannot be
  expressed as "sections + actions + context + effects", the interface shape
  is too narrow and this ADR is revised, not worked around.
- If documents end up requiring ten capabilities each, the granularity is
  wrong and profiles become the primary unit.
- If nobody ever writes a document for two runtimes, the mechanism is
  machinery without a client, exactly what the handoff warned about for
  multi-engine homologation. The second runtime is the test.

## Fixtures required

- `requires` derivation: one document per row of the derivation table,
  expected `requires` set as the fixture output.
- Refusal: critical capability absent; version out of range.
- Degradation: optional capability absent → tree with `unavailable` node;
  action returning `CAPABILITY_UNAVAILABLE` and running `catch`.

## Consequences

- ADR 0004's `client`/`server` halves survive as the two **surfaces** of
  this runtime; the contract is re-expressed as a manifest of capabilities
  (ADR 0009) with the same information.
- `CLIENT_ACTION_TYPES` and `SERVER_ACTION_TYPES` become derived from the
  interfaces' `surface`; the placement errors keep their codes.
- A document that uses only the kernel and `vocab.base` is portable to any
  runtime with a materializer; `validate` prints that in one line.

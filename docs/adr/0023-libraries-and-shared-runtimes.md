# ADR 0023 — Libraries of micro-apps and shared runtimes: one runtime, many documents, provisioning per version manifest

Status: proposed (2026-09-10). Layer: runtime and platform.

## Context

Two of the author's points are the same mechanism at two scales. A
**library** is an owner's collection of hundreds of micro-apps, created
on demand through a chat, tested as ideas, run on many runtimes including
native mobile. A **shared runtime** is a platform (Vercel, or any host of
Next or Nuxt) that runs any Blueprint document for anyone. This module
already does the small version of both: every document under `content/`
is an app on one runtime with one vocabulary, and the module context
called it "the tenant in miniature".

The handoff's condition for the cost model to close is many products or
tenants of the same shape. A library is exactly that. What a library
needs beyond what exists is isolation, a catalog, per-app provisioning and
a review gate that keeps "minutes" from meaning "unreviewed".

## Decision

### A library is a document store plus a runtime plus a catalog

```
library/
  blueprint.library.json      name, runtime range, shared vocabularies, review policy
  catalog/                    the catalog is itself an app document (the demo site, dogfooding)
  apps/<name>/                one source tree per app (ADR 0019), or a store id when the store is a database
  overlays/<name>/            variants (ADR 0016)
  deployments/<env>.json      one deployment document per environment (ADR 0022)
```

Documents in a library share a runtime range and the vocabularies the
library declares; `validate` rejects a document that requires a
vocabulary the library does not carry, so every app in the library runs
on every runtime the library targets.

### Isolation rules

- **State and records are per app** (`web.state` keyed by app and
  version; collections namespaced by app). Nothing in the kernel lets
  one document read another's state or collections.
- **Cross-app calls go through endpoints.** A document may `fetch` an
  endpoint of another app in the same library by `app:<name>/<endpoint>`;
  the call is a capability call like any other and appears in the effect
  log. No shared definitions, no shared resources: sharing is inheritance
  (ADR 0016) or an endpoint.
- **Vocabulary is shared, documents are not.** The library's app
  components (`vocab.app`) are the one place where owner code lives; each
  app's document is independent and pinned alone.

### Provisioning follows the version manifest

A host provisions **per document version** from its manifest (ADR 0009):
a document with no `collections` gets no database; one with no
`endpoints` gets no server function; an L1 document is static files plus
a client runtime. That is what makes hundreds of micro-apps affordable
and what a platform needs to price them. The deployment document
(ADR 0022) binds the library's providers once; each app inherits the
bindings it requires.

### Native runtimes render L1

An Android or iOS runtime is: the engine (the same package, or a
clean-room one), `web.state`'s sibling `app.state`, `app.router`, a
native materializer of `vocab.base`, and whatever device capabilities it
offers (`device.camera`, `print.bluetooth`). Documents at L1 run there
unchanged; L3 nodes follow ADR 0026's fallback rules. The library's
catalog marks each app with the runtimes it is compatible with, computed,
not declared.

### Chat to micro-app, with the gate

The flow the vision describes is the M6 milestone of the module context
with a library around it: the owner describes; the agent creates or
edits a source tree (ADR 0019), runs `validate`, `test`, `render`, opens
a preview; the owner reviews the governance screen (diff with `explain`,
tests, preview) and publishes, which moves the app's `published` pointer.
"Minutes" measures the agent's part; the review is human and is the
product's safety, not its overhead. A library's review policy may make
the gate lighter for L1 apps with no collections (nothing to leak,
nothing to store) and mandatory for anything with endpoints or secrets.

### Shared runtimes on platforms

A platform that wants to host Blueprint documents publishes a runtime
manifest, passes the conformance suite for the capabilities it lists, and
accepts capability requests (ADR 0024). Nothing else is required of it,
and nothing less makes "supports Blueprint" true. A framework-specific
runtime (Next, Nuxt, SvelteKit) is a materializer plus providers; the
kernel is the same package or a conformant one. The first such runtime
is this module; the second web runtime is deliberately not in the
project's own plan (ADR 0017) so that a platform building one is a
second implementer, which is what the spec needs.

## Alternatives considered

- **One document per library with many pages.** One hash for hundreds of
  apps means every edit re-pins everything; documents are the unit of
  pin, so apps are documents.
- **Shared definitions across apps** (a library-level `definitions`
  section). Breaks the completeness invariant (a document would not be
  evaluable alone) and the per-document pin. Inheritance and endpoints
  cover the real cases.
- **Provision everything for every app.** Simple and what kills the
  economics of hundreds of apps.

## Conditions under which this is wrong

- If owners want cross-app data joins more than isolation, the
  endpoint-only rule is too strict and a read-only `library.resources`
  capability is the next candidate.
- If native runtimes need more than L1 to be useful, the base vocabulary
  is too small for mobile and grows by subtraction from two native
  materializers, not by design.

## Fixtures required

- Library validation: a document requiring a vocabulary outside the
  library's list → refused.
- Provisioning plan from a version manifest: four documents → four plans
  (static only; static + endpoints; static + endpoints + collections;
  with secrets).
- Cross-app `fetch` appearing in the effect log.

## Consequences

- The module's `content/` becomes the smallest library; a
  `blueprint.library.json` is optional and defaults to "everything under
  `content/`, this runtime, all vocabularies".
- The demo site as a document (module context, section 11) becomes the
  library catalog.
- The restaurant platform's tenancy model is this ADR plus overlays; no
  new mechanism.

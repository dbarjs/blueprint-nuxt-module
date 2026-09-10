# ADR 0006 — Envelope: spec version, identity, and a registry of sections

Status: proposed (2026-09-10). Layer: kernel.

## Context

The envelope implemented today is `{ $schema?, id?, name, from?, content }`
with eight kernel sections (`meta`, `resources`, `schemas`, `definitions`,
`state`, `actions`, `templates`, `tests`) and three sections that only this
runtime understands (`runtime`, `collections`, `endpoints`, ADR 0004).

Three things are missing for a document to be handed to another runtime:

1. **No spec version.** Revision 1 of the handoff makes it the first field
   of any document ("analogous to `$schema` in JSON Schema"); Revision 2
   keeps one spec per document. Today `$schema` points at a generated editor
   schema, which is a tooling convenience, not a spec pin.
2. **No rule for foreign sections.** `collections` and `endpoints` sit next to
   `resources` as if they were kernel. A runtime without HTTP has no way to
   know whether it may ignore them or must refuse the document.
3. **No completeness boundary written down.** The insurance case validated
   "every product configuration the engine consumes comes from the document"
   by construction; here nothing stops a component from carrying its own
   options. The boundary between document, runtime configuration and
   operational state needs a sentence each.

## Decision

### Envelope fields

```jsonc
{
  "spec": "0.1",                       // NEW, required: the kernel version the document is written in
  "id": "01J…",                        // ULID; identity of the document across versions
  "name": "health-quote",              // slug; URL prefix and app name
  "from": { "blueprintId": "…", "message": "…" },   // provenance of this version (ADR 0013, 0016)
  "$schema": "…/schema.json",          // tooling only; never read by the engine
  "content": { … }
}
```

- `spec` is a string `major.minor`. An engine declares the range it
  implements and **refuses** a document outside it with `UNSUPPORTED_SPEC`.
  Until the first tagged spec, documents without `spec` are treated as
  `0.0` with a warning; every document in `content/` gains `"spec": "0.1"`
  when this ADR is accepted.
- `version` is **never authored**. It is the hash of the canonical document
  (ADR 0013) and is what records pin.
- `id` is the identity across versions; two versions of the same app share
  `id` and differ in `version`. Today `id` is optional; it becomes required
  when a document store exists (ADR 0014).

### Section registry

`content` is a map of sections. Every section key belongs to exactly one
owner:

| Section | Owner | Read by |
|---|---|---|
| `meta`, `resources`, `schemas`, `definitions`, `state`, `actions`, `templates`, `tests` | kernel | every runtime |
| `runtime` | kernel (its shape), runtime (its values) | every runtime: it is the requirements block, see below |
| `collections` | capability `storage.collections` (ADR 0007) | runtimes providing it |
| `endpoints` | capability `http.endpoints` | runtimes providing it |
| any other key | must be declared by a capability the document requires | that capability's runtimes |

A runtime that meets an unknown section it does not provide checks whether
the document marks the owning capability as **critical** (ADR 0007). Critical
and unknown → refuse (`UNKNOWN_SECTION`). Optional and unknown → ignore the
section and report it as degraded. A section that no declared capability
owns is invalid at publish time, never silently kept.

`tests` is kernel even though some test forms exercise capabilities
(ADR 0011); a runtime skips the forms it cannot run and reports them as
skipped, never as passed.

### The `runtime` section is the requirements block

```jsonc
"runtime": {
  "requires": { "http.endpoints": "^1", "storage.collections": "^1" },  // critical
  "optional": { "ui.toast": "^1" },                                     // degrade if absent
  "storage": "sqlite"                                                   // capability options
}
```

Most requirements are **derived**, not authored: `validate` computes them
from `refs()` (a `navigate` action requires `web.router`; a `collections`
section requires `storage.collections`; a `UButton` requires the `nuxt-ui`
vocabulary at the hash the build saw). Authored entries only pin a version
range or promote an optional capability to critical. The derived list is
written into the manifest of the published version (ADR 0009) so that a
thin client can decide compatibility without re-running `refs()`.

This keeps the Revision 1 idea of derived `requires` per section, but the
unit becomes the capability, which is what a runtime actually declares.

### Three kinds of data, three homes **[V][P]**

1. **Product**: everything in `content`. Versioned, immutable, pinned.
2. **Runtime configuration**: what the host knows and the document does not
   (page prefix, mount point, default storage, data directory, theme
   tokens). Lives in the runtime manifest and host config, never in the
   document. `meta.theme` today is Nuxt UI colour aliases and is a leak in
   this direction; it is reclassified as materializer tokens, non-normative.
3. **Operational and transactional state**: records in collections, live
   browser state fetched from endpoints, "item unavailable today". Never
   in the document, never creates a version.

The completeness invariant is testable: a runtime must start an app from
code plus the document plus its manifest, in a clean environment. The
module's build already fails on unknown components and storages, which is
half of that test.

## Alternatives considered

- **Namespaced foreign sections** (`"x-http": {…}`, or `content.capabilities.http.endpoints`).
  Cleaner ownership at the cost of deeper paths in every document; the
  registry gives the same guarantee and keeps `endpoints` where three
  documents already write it. Revisit if two capabilities ever want the same
  section name.
- **`spec` inside `content.meta`.** The spec pins the whole envelope, so it
  belongs outside `content`.
- **Versioning sections independently.** Rejected in Revision 1 because
  sections are interdependent; kept rejected.

## Fixtures required

- Document without `spec`: warning today, error after the first tag.
- Document with `spec` above the engine range: `UNSUPPORTED_SPEC`.
- Document with a section nobody owns: `UNKNOWN_SECTION` at publish.
- Document requiring `http.endpoints` on a runtime without it: refused;
  same document with `http.endpoints` under `optional`: accepted, endpoints
  reported as unavailable.

## Consequences

- The engine gains `spec`, `UNSUPPORTED_SPEC` and `UNKNOWN_SECTION`; the
  validator learns the registry. Small change, large meaning.
- `content.runtime` grows from `{ storage }` to the requirements block. The
  key name is kept because three documents already use it.
- The generated editor schema stays as it is: it is the `$schema` for
  tooling, and it can embed the registry.

# ADR 0016 — Inheritance: overlays as data, resolved at publish, base pinned by version

Status: proposed (2026-09-10). Layer: kernel (overlay format and
resolution), document store (materialization). Not implemented.

## Context

Inheritance is a validated scar: partner variants of an insurance product
were overlays changing a few percentages in resources, and the
multi-tenant restaurant platform will ask for the same (chain → store,
franchise → price). It is also the number one source of complexity in
configuration systems (Kustomize, Helm values, the CSS cascade), so the
handoff fixes rules before a second consumer improvises: overlay as data,
resolved at publish, derived document with its own id and provenance,
engine never resolves at runtime, base referenced by immutable version id.

The `from` field carried over from the insurance example is provenance
only; the module context's promise of a build hook that resolves a base
"declared by hash" has not been built. The open question from the case
(did overlays point at a version or at a moving pointer?) is answered by
the rule below regardless of what happened then.

## Decision

### An overlay is a document whose `extends` names a base version

```jsonc
{
  "spec": "0.1",
  "id": "01J…PARTNER",                                  // the derived document's own identity
  "name": "health-quote-partner",
  "extends": { "id": "01J9HEALTHQUOTE…", "version": "sha256:…" },   // immutable base version; never a pointer
  "content": {                                          // the patch, in JSON Merge Patch form (RFC 7386)
    "meta": { "title": "Health Quote · Partner Bank" },
    "resources": {
      "settings": { "data": { "annualDiscount": 0.12 } },
      "risk-factors": { "data": [ { "id": "smoker", "factor": 1.4 } ] }     // by row identity, see below
    },
    "tests": [ { "name": "partner annual discount", "state": { "applicant": { "age": 30, "billing": "annual" } }, "expect": { "annualDiscount": 28382 } } ]
  }
}
```

- `extends.version` is a content hash. A name or a pointer (`"published"`)
  is rejected at publish (`OVERLAY_BASE_NOT_PINNED`). Rebasing on a newer
  base is an explicit edit of `extends`, reviewed like any change.
- The patch semantics are JSON Merge Patch for objects: a key present
  replaces or merges, `null` deletes.

### Lists merge by identity, never by position

A list whose items carry `id` (parameter table rows, options, products,
plans) is merged by `id`: an overlay row with a known `id` merges into
that row; an unknown `id` appends; `{ "id": "x", "$remove": true }`
removes; `$before`/`$after` reorder, which matters for `first` hit
policies where order is semantics. A list whose items have no `id` is
replaced whole, and `validate` warns (`OVERLAY_POSITIONAL_LIST`) because
positional patches break on the next base edit. `tests` is the exception:
overlay tests are **appended** to base tests, since a variant must still
pass the base's tests unless it explicitly removes one by name.

### Resolution happens at publish, once

`resolveInheritance(base, overlay) → version` (ADR 0014) produces a
**resolved document**: a complete, flat document with the derived `id`,
its own `version`, `from: { version: <overlay version>, base: <base version> }`
and no `extends`. The resolved document is what gets validated, tested,
projected and pinned. The engine never sees `extends`; a runtime that
receives an unresolved overlay refuses it (`UNRESOLVED_OVERLAY`).

Resolution is cached forever by (base version, overlay version), which is
only sound because both are immutable.

### Provenance chain

The resolved document's `from` records both parents, so `listVersions`
of the partner document shows a chain of resolved versions, each naming
the overlay and base it came from. Diffing a resolved version against its
base shows exactly what the partner changed.

## Alternatives considered

- **Runtime resolution** (engine loads base and overlay and merges on the
  fly). Two documents to pin, two to fetch, and a cache that can be stale;
  the handoff forbids it.
- **JSON Patch (RFC 6902) with paths.** Precise but positional for arrays,
  which is the failure mode; Merge Patch plus identity is what analysts can
  read.
- **Multiple inheritance** (`extends: [a, b]`). Not asked for; order of
  application would need a rule nobody has a scar for. One base per
  overlay; overlays can chain.

## Fixtures required

- Object merge, `null` deletion, list merge by `id`, append, `$remove`,
  reorder before a `first` table, positional list replaced with warning,
  tests appended.
- `extends` by pointer → refused; unresolved overlay handed to the engine
  → refused.
- The partner health quote above: resolved document's `annualDiscount`
  test passes, base tests still pass.

## Consequences

- A build hook resolves overlays under `content/` before validation
  (the module context's section 7), writing the resolved document to
  `.nuxt/blueprint/resolved/`; the app prefix is the overlay's `name`.
- The `resolvedBy` chain is visible in the project manifest.
- The restaurant platform's "many tenants, one shape" becomes a directory
  of overlays over one base, the smallest demonstration of the thesis.

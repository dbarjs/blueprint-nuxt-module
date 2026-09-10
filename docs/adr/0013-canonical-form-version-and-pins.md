# ADR 0013 — Canonical form, version id, pins and the engine pin

Status: proposed (2026-09-10). Layer: kernel. Partly implemented
(canonical JSON, hash-as-version, `createdUnder`).

## Context

The version of a document is already the hash of its canonical JSON, and
records pin it (`createdUnder`, the records API's 409 on a stale pin, the
health quote's `quotedUnder` domain rule). What is implemented is enough
for a demo and short of a spec in four places: the hash function is FNV-1a
(fast, not collision-resistant, chosen to avoid BigInt), the canonical form
is "RFC 8785 in spirit", the pin carries the app name rather than the
document id, and nothing records which engine build evaluated a record,
which the handoff lists as the missing element of the reproduction tuple.

## Decision

### Canonical form is RFC 8785 (JCS)

Object keys sorted by UTF-16 code units, no whitespace, numbers serialized
as ECMAScript `Number#toString`, strings escaped as JSON requires, `undefined`
members dropped. The current `canonicalize` matches this; the ADR makes it
a MUST with the JCS test vectors as fixtures, so a Java or Go engine
produces the same bytes (they need a Ryu/Grisu-class shortest-digit
printer, as the handoff notes).

Non-finite numbers are a canonicalization error, which is why ADR 0012
keeps them out of the domain.

### Version id is SHA-256 of the canonical envelope

`version = "sha256:" + hex(sha256(canonical(envelope without $schema)))`.

- `$schema` is tooling and is excluded; `id`, `name`, `from` and `content`
  are included: two documents with the same content and different
  provenance are different versions, as two commits with the same tree are
  different commits.
- FNV-1a stays available as a **cache key** for HMR and in-memory maps; it
  is never a pin. Records written so far under FNV versions are demo data.
- SHA-256 is available synchronously in Node (`node:crypto`) and
  asynchronously in browsers (`crypto.subtle`); the browser only compares
  versions, never computes them.

### Section hashes

The version manifest (ADR 0009) carries `sha256` per section of the
canonical `content`, so a projection (ADR 0015) can be verified against
the pinned version without the whole document.

### Pins on records

```jsonc
"createdUnder":  { "id": "01J…", "version": "sha256:…", "spec": "0.1" },   // what the client evaluated under
"acceptedUnder": { "id": "01J…", "version": "sha256:…", "spec": "0.1" },   // what the server evaluated under, when it differs
"evaluatedBy":   { "runtime": "blueprint-nuxt-module", "version": "1.0.0", "engine": "blueprint-engine", "build": "sha256:…" }
```

- `createdUnder` replaces today's `{ document: <name>, version }`; the name
  is not stable identity, the `id` is.
- `acceptedUnder` is written by the server when it re-evaluates
  (`records.pinned` and `insert` in a `pinned` endpoint). The health quote's
  `quotedUnder` is exactly this field under a domain name; the domain name
  stays in the document, the runtime writes the canonical one too.
- `evaluatedBy` is taken from the runtime manifest. With it, the tuple
  document pin + engine pin + inputs (including the effect log of ADR 0008)
  + outputs is complete and a record can be replayed by a later engine to
  test the engine, never to redefine the record.
- `pinned: true` on an endpoint keeps its meaning: the request's
  `createdUnder.version` must equal the published version, else 409
  (`STALE_VERSION`), and the response carries the current version so the
  client can re-evaluate.

### Provenance

`from` becomes `{ "version": "sha256:…", "message": "…", "author": "…", "at": "…" }`,
pointing at the parent version (the previous version of the same `id`, or
the base of an overlay, ADR 0016). `from.blueprintId` from the insurance
example is accepted as an alias for one spec cycle. Provenance is the
document's commit message; with git as the document store it is redundant
and harmless, with a database store it is the only history.

### The spec version pins semantics, the engine dispatches by it

Semantics are frozen per `spec`. A bug in the spec is fixed by a new spec
version; documents on the old one keep the old behaviour, and an engine
that supports both dispatches on `spec`. Migration in place (rewriting a
published version into a new spec) is forbidden: it changes the hash,
which breaks every pin.

### What a hash does not prove

Binding, not time. A record's pin proves which document it was evaluated
under; it does not prove when. Trusted timestamps (RFC 3161) and
signatures over the version manifest are a **distributed profile**, out of
spec 0.1, and the documentation says so before someone reads "eternal
mark" as a legal guarantee.

## Alternatives considered

- **Keep FNV-1a.** 64 bits of non-cryptographic hash is fine for a cache,
  and a court will ask why the pin can be forged in minutes.
- **ULID per version, hash as a separate field** (the insurance design,
  `id` changing per version). Two identities per version; content-addressed
  ids give deduplication and verification for free (handoff 4.10 lesson).
- **Hash `content` only.** Cheaper diffs, but a version without its
  provenance cannot be told from a copy.

## Fixtures required

- JCS test vectors (from RFC 8785 appendix) → canonical bytes.
- One document → canonical bytes → `sha256:` version; the same document
  with reordered keys → same version; with `$schema` changed → same
  version; with `from.message` changed → different version.
- Records API: stale pin → 409 with `expected`/`received`; matching pin →
  201 with `createdUnder`, `acceptedUnder`, `evaluatedBy`.

## Consequences

- `hash.ts` gains `sha256` (Node and WebCrypto paths) and keeps `fnv1a64`
  for caches; `hashDocument` returns the `sha256:` form.
- `records.post.ts`, the dispatcher and `submit` write and check the new
  pin shape; the four documents' `createdUnder` usage keeps working via
  the runtime injecting the full object.
- `context.version` stays a string (the `sha256:` id) so existing
  definitions such as `quoteIsStale` do not change.

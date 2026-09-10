# ADR 0014 — Two storages that must not be confused: the document store and record storage

Status: proposed (2026-09-10). Layer: kernel (document store semantics),
capability `storage.collections` (record storage).

## Context

The word "storage" now means two different things in this repository. The
handoff's storage RFC (eight operations, immutable versions, pointers with
a log, projection, inheritance) is about **documents**: publishing and
reading versions of blueprints. ADR 0004's `runtime.storage`, `memory`,
`fs`, `sqlite` and the four-operation `CollectionStore` are about
**records**: the transactional data a document's endpoints write. The
handoff's sharpest rule (the document never contains transactional data)
depends on keeping them apart, and the glossary already lists "database"
as an avoided term for both.

Today the document store is git plus Nuxt Content: a version is a commit,
rollback is a revert and a redeploy, there is no pointer and no log. That
is the right store for the experiment and is not the normative one.

## Decision

### Names

- **Document store** — where versions of documents live. Kernel semantics,
  eight operations, deliberately no `update` and no `delete`.
- **Record storage** — where a document's collections persist records.
  A capability (`storage.collections`), provided by runtimes, with named
  backends the document may choose among.

The term "storage" alone is not used in prose; the glossary is updated.

### The document store: eight operations, two implementations

```
publish(document) → version            validates spec, format, refs(), tests; rejects on any failure
getVersion(version) → document          by content hash; immutable forever
getManifest(version) → version manifest
getProjection(version, selection, audience) → document   (ADR 0015)
resolvePointer(name) → version          e.g. "published", "active"; every move logged (who, when, from, to)
movePointer(name, version, actor)
resolveInheritance(base, overlay) → version   materializes a derived document with its own version (ADR 0016)
listVersions(id) → [version manifests]
```

There is no `update` and no `delete`; a store that offers them is not a
document store. Fixtures are written in neutral text ("publish v2, move
`published` to it, `getVersion(v1)` still answers, `delete` is refused").

Two implementations from the start, as the handoff requires so that no
single database becomes the spec:

- **`store-git`**: this repository's mode, formalized. `publish` is a
  commit of the canonical file; `version` is the SHA-256 of the file (not
  the git object hash, so the id is the same in every store); pointers are
  files (`content/.pointers/<name>`) or tags; the log is git history.
  Build-time validation is the publish gate.
- **`store-fs`**: one directory per `id`, one file per version named by
  its hash, a JSON pointer file with an append-only log. Trivial, real, and
  the second point of comparison. Roughly one day of work.

A database-backed store (Mongo, Redis projections) is a third
implementation that arrives with the first consumer that needs online
publishing.

### Record storage: the capability stays as ADR 0004 shaped it

- The document names a backend (`runtime.storage`, per-collection
  `storage`); the runtime maps it; unknown backend refuses the document.
- The provider interface is four operations (`all`, `get`, `put`, `delete`)
  per app and collection; predicates, sorting and paging run in the
  notation. Pushing `where`/`sort`/`limit` down to SQL is a provider
  optimization behind the same interface, with the fixtures of ADR 0011
  proving equivalence.
- Records are flat: the validated data plus the runtime's `recordFields`
  (`id`, `createdAt`, `updatedAt`) and the pins of ADR 0013.
- Records are **never** in the document and **never** create a version.
  A document that wants a snapshot of data authors it as a resource, which
  is product, not transaction.

### One rule that links them

Every record carries the pin of the document version it was created under
(ADR 0013), and the document store guarantees that version stays readable.
That is the whole legal guarantee the insurance case validated, and it is
the only coupling allowed between the two storages.

## Alternatives considered

- **One storage abstraction for both.** Tempting because both are
  "put JSON, get JSON"; wrong because their semantics are opposites
  (immutable, append-only, content-addressed versus mutable, keyed,
  queried).
- **Skip `store-fs`, git is the second implementation.** Git is a document
  store only with conventions bolted on (pointer files, hashes recomputed);
  `store-fs` is the one that proves the eight operations without a VCS.

## Lessons from the insurance case, to confirm item by item

Recorded here so the store RFC separates MUST (with fixture) from
"in one implementation, X caused Y":

- immutability enforced by the database's permissions (insert-only role),
  not by convention;
- version id as content hash, not an `ObjectId`;
- spec migrations never rewrite old versions;
- pointer cache TTL is harmless only because every record pins what it saw;
- pointer moves without a log are a hole in the legal history;
- format validation on `publish`, or the store keeps documents no engine
  reads.

## Fixtures required

- The eight operations, in neutral text, each with a positive case and the
  refusal cases (`delete`, `update`, publish of an invalid document,
  `getVersion` of an unknown hash, pointer move without an actor).
- `store-git` and `store-fs` both passing the same fixtures.

## Consequences

- No engine change; the ADR fixes vocabulary and the shape of what to
  build next.
- The module's content collection remains the read side of `store-git`;
  a `blueprint publish` CLI command is the write side (ADR 0018).
- `CONTEXT.md` gains "document store" and "record storage" and retires
  bare "storage".

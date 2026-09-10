# ADR 0025 — Documents are addressable anywhere: locators, integrity, and running from a link

Status: proposed (2026-09-10). Layer: kernel (locator and integrity
rules), runtime (fetching).

## Context

The author's point: a document can be stored anywhere, so a runtime
should be able to run an app from a link to some storage. The kernel
already makes this cheap: a version is the SHA-256 of its canonical
bytes (ADR 0013), so wherever the bytes come from, the runtime can
verify it has the right document. What is missing is the address form,
the rule that the hash is the identity and the URL is only a location,
and the read side of the document store as a tiny HTTP convention so any
storage can serve documents without being "a Blueprint server".

## Decision

### A locator is a location plus an expected version

```
https://store.example.com/docs/01J9HEALTHQUOTE/sha256:9f3c…        frozen: bytes must hash to this
https://store.example.com/docs/01J9HEALTHQUOTE/published           pointer: resolves to a version, then frozen
https://raw.githubusercontent.com/org/lib/main/content/health-quote.json#sha256:9f3c…
s3://bucket/blueprints/01J9HEALTHQUOTE/sha256:9f3c….json
blueprint:01J9HEALTHQUOTE@sha256:9f3c…                              store-independent; resolved through the runtime's configured stores
```

- The **version hash is the identity**; the URL is where to look. Two
  locators with the same hash are the same document; a locator whose
  bytes do not hash to the expected version is refused
  (`DOCUMENT_INTEGRITY`), never "close enough".
- A locator without a hash (a pointer URL, a bare file URL) is allowed
  for **loading** and forbidden for **pinning**: the runtime resolves it
  to a version, then behaves as if the hash had been given; records pin
  the hash. A pointer is re-resolved by the runtime's policy (on start,
  on interval, on webhook), which is the `published`/`active` model of
  Revision 1 without new machinery.
- `#sha256:` as a URL fragment works with any static host (GitHub raw,
  S3, a CDN, IPFS gateways) because fragments are not sent to the
  server.

### The read side of a document store over HTTP

Any storage that serves these paths is a Blueprint document store for
reading purposes:

```
GET  <base>/<id>/<version>              the canonical document (application/json)
GET  <base>/<id>/<version>/manifest     the version manifest (ADR 0009)
GET  <base>/<id>/<version>/profiles/<p> a materialized projection (ADR 0015)
GET  <base>/<id>/pointers/<name>        → { "version": "sha256:…", "movedAt": …, "actor": … }
GET  <base>/<id>/versions               list of version manifests
```

Immutable paths are cacheable forever (`Cache-Control: immutable`);
pointer paths are not. A static file layout that mirrors these paths
(`docs/<id>/<version>.json`, `docs/<id>/pointers/published.json`) is a
valid store with no server code, which is how a library on a CDN works.
The write side (`publish`, `movePointer`) is ADR 0014's and stays out of
this convention; a static store is published by whatever writes files.

### Running from a link

`blueprint run <locator>` (headless) and `blueprint.apps: [<locator>]` in
this module's options: fetch, verify, read the version manifest, check
compatibility against the runtime manifest (ADR 0009), refuse or degrade
accordingly, cache by hash, run. Datasets referenced by the document are
fetched the same way (ADR 0021). A runtime never needs the source tree
(ADR 0019); it runs canonical JSON only.

### Trust

The hash proves that the bytes are the document the locator named. It
does not prove who published it. Signatures over version manifests and
trusted timestamps are the distributed profile (ADR 0013), and a runtime
that runs documents from arbitrary links should say in its manifest
whether it requires them. A library (ADR 0023) that serves its own
documents does not.

## Alternatives considered

- **A registry as the only source** (npm-style). One more thing to run
  and the opposite of "stored anywhere"; content addressing makes a
  registry an optimization, not a requirement.
- **Locators without hashes everywhere.** Convenient and exactly the
  "pin resolves a moving pointer" failure the handoff's storage lessons
  warn about.

## Fixtures required

- Locator parsing for each form above; frozen vs pointer.
- Bytes with a wrong hash → `DOCUMENT_INTEGRITY`.
- Static store layout served from a directory passes the read-side
  fixtures.

## Consequences

- `useBlueprintDocument` and the server document loader accept locators;
  the Content collection remains the default local store.
- The headless runtime's `store-fs` (ADR 0014) writes the static layout
  above, so its output directory is servable as-is.

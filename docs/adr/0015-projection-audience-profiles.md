# ADR 0015 — Projection: audience per section, closure by `refs()`, profiles as named selections

Status: proposed (2026-09-10). Layer: kernel. Not implemented; the only
trace today is `visibility: "private"` on definitions, which nothing reads.

## Context

Projection with closure is a validated scar: a 15 MB insurance document
served to a single template as 200 KB, computed on the server from the
template's bindings. The handoff turns it into a rule with an order
(filter by audience → close → fail on a dangling reference), a
determinism requirement (same version, selection, audience → same
projection, with its own hash) and the observation that a projection is
itself a valid document.

In this repository every page receives the whole document. The four
documents are small, so nothing hurts yet, but `health-quote` already
contains things the browser should not see if the rating tables were
confidential (they are deliberately public there), and `public-board`
ships six endpoint handlers to a browser that cannot run them. The
per-page closure the module context promised (section 7) is the cheapest
place to make projection real, at build time, with `refs()` already
written.

## Decision

### Audience is declared per section entry

```jsonc
"resources":   { "risk-factors": { "audience": "server", … } },
"definitions": { "riskFactor":   { "audience": "server", … } },
"endpoints":   { "create-quote": { … } }                 // endpoints are server by construction
"templates":   { "page:index":   { … } }                 // pages are client by construction
```

`audience` is a surface name (ADR 0010) or `public` (default). `visibility:
"private"` on definitions is renamed to `audience: "server"` with an alias
kept for one cycle. Audience is data the author writes in the editor; it
never comes from the runtime.

### Projection = selection + closure + audience, in that order

Given a version, a **selection** (a set of section entries, typically one
page or one channel) and an **audience**:

1. **Filter** the document to entries whose audience includes the
   requesting surface.
2. **Close** the selection over `refs()`: template → schemas → resources →
   definitions → other definitions → parameter tables → datasets.
3. **Fail** if the closure needs an entry the filter removed
   (`PROJECTION_DANGLING`). Never pull a private entry "to help", never
   drop it silently.

The validator runs the same check at publish for every page and channel
against its natural audience, so a public page bound to a server resource
is rejected before it can leak.

### A projection is a document

Same envelope, same `id`, same `version` field (it belongs to that
version), a `projection` block naming selection and audience, and a
version manifest whose section hashes are those of the **full** version
for the sections kept whole and marked `partial` for the ones cut. The
engine has no partial mode: it evaluates a projection as any document.
Records pin the full version, never a projection.

### Profiles are persisted selections

```jsonc
"profiles": {
  "pos":     { "select": ["page:index", "page:product", "page:cart"], "audience": "client" },
  "kitchen": { "select": ["channel:kitchen-ticket"],                  "audience": "print" }
}
```

A new kernel section. Profiles are materialized at publish (like
inheritance), served flat, and cached forever by (version, profile). Free
selection stays possible but is never precomputed, the GraphQL persisted
query lesson. Per-page projection in this module is the implicit profile
"one page, client audience", generated for every page.

### Determinism

`project(version, selection, audience)` is a pure function; its output has
its own hash and is cacheable forever. Fixtures compare projections
bit-exactly.

## Alternatives considered

- **Encrypt confidential sections and ship everything.** Rejected by the
  author already: projection on an authenticated server is simpler and
  needs no key distribution; encryption belongs to the untrusted-channel
  profile, if ever.
- **Close first, then filter.** The "gentle" order; it is how a public
  template quietly drags a private resource to the browser.
- **Audience on whole sections only.** Too coarse: the health quote wants
  `plans` public and `risk-factors` private inside `resources`.

## Fixtures required

- The health quote with `risk-factors` and `riskFactor` marked `server`:
  projection of `page:index` for `client` fails with `PROJECTION_DANGLING`
  (the page shows the breakdown); after moving the breakdown behind a
  `fetch`, the projection succeeds and contains no `risk-factors`.
- `public-board` projected for `client`: no `endpoints`, no `collections`,
  all pages, `runtime.requires` reduced accordingly.
- Same inputs twice → same bytes, same hash.

## Consequences

- `refs()` is already the closure engine; projection is a filter and a
  walk over it. Build-time per-page projection is the first
  implementation; a `project` CLI command is the second.
- The version manifest (ADR 0009) gains `profiles` and `partial` markers.
- A thin client (POS, printer) gets a real reason to exist in the demo:
  it loads a profile, not an app.

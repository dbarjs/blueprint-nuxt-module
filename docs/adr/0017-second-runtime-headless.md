# ADR 0017 — The second runtime is headless: CLI, plain HTTP, `store-fs`, a text/ESC-POS materializer

Status: proposed (2026-09-10). Layer: runtime. Sequencing decision; nothing
built yet.

## Context

Every handoff document ends with the same rule: the second implementation
is what proves the spec. One runtime passing its own suite proves the
product. The continuation document names the two cheapest candidates for
a second runtime, a print server or a Nitro-less backend, and leaves the
choice open.

Two different things need proving, and they are not proven by the same
second thing:

- the **runtime layer** (capabilities, manifests, placement, effects as
  data, ADRs 0007–0009) is proven by a second runtime on the same engine;
- the **kernel** (notation, trees, numeric semantics, canonical form) is
  proven by a second engine, ideally in another language, in a clean room.

Conflating them would let the Nuxt module's TypeScript engine become the
kernel by being the only one, the trap the handoff calls the single
implementation.

## Decision

### Build `blueprint-headless` first

A runtime with no browser and no framework:

| Provides | With |
|---|---|
| `core.evaluate`, `core.document` | the same engine package, consumed as a dependency |
| `http.endpoints@1` | `node:http` and a hand-written router (no h3, no Nitro) |
| `storage.collections@1` | backends `memory` and `fs` (`node:fs`); `sqlite` optional |
| `time.now@1` | `Date` |
| `materialize.text@1`, `materialize.escpos@1` | one function over the abstract tree: `Stack` → lines and columns, `Text` tokens → bold/align, `Separator` → a rule, `for` already expanded |
| document store | `store-fs` (ADR 0014) |
| CLI | `validate`, `test`, `render`, `refs`, `project`, `diff`, `serve`, `print` (ADR 0018) |

It does **not** provide `web.pages`, `web.router`, `web.state`, `ui.toast`,
`http.client` or any component vocabulary beyond `vocab.base` for text
targets. Its runtime manifest says so, and the compatibility report on the
four documents must read: `hello-world` degraded (page not served,
definitions and tests run); `restaurant-menu-shop` degraded (pages not
served, kitchen ticket printable); `public-board` and `health-quote`
degraded on pages, **compatible on endpoints**.

### What it must pass to count

1. Every document test of the four documents, all forms of ADR 0011,
   skipping only forms that need `web.*`.
2. Every endpoint scenario of the board and the quote, with `store-fs`
   and `fs` records, giving byte-identical responses to the Nuxt runtime
   (a differential test runs both and compares).
3. The kitchen ticket tree fixture, materialized to text, checked as a
   snapshot in its own repository.
4. The compatibility report above, from its own manifest, with no code
   shared with the Nuxt module beyond the engine package.

### Then a second engine, clean room

After the headless runtime, the kernel is tested by an engine written from
the spec text and the corpus without reading `src/runtime/engine`. Language
is secondary; a compact target that runs everywhere (Go, Rust to WASM, or
Java for the insurance audience) is preferable to a second TypeScript
engine. Every question the implementer asks is a gap in the text and goes
to the spec backlog. If the author writes it, the spec becomes narration of
the code; someone else does.

### Minimum common runtime, by subtraction

With two runtime manifests in hand, the intersection of what both provide
and what the four documents needed is written down as the minimum common
runtime (ADR 0005). Expected content, to be confirmed by the exercise:
`core.*`, `time.now`, `http.endpoints`, `storage.collections` with at
least one durable backend, `vocab.base` for at least one materializer.
`web.*` is expected to stay outside it: a print server does not navigate.

## Alternatives considered

- **Print server only.** Cheapest, and it exercises only trees and one
  materializer: no endpoints, no storage, no placement. Too small to prove
  the runtime layer; it is included inside the headless runtime instead.
- **A second web runtime (React or SvelteKit).** Proves the Vue
  materializer is not the spec, which nobody doubts, at the cost of a
  second component vocabulary. Later, when a consumer wants it.
- **Mobile (Android/iOS).** The most convincing demonstration and the most
  expensive; needs the minimum common runtime to exist first.
- **Kernel compiled to WASM as "the" second engine.** It is the same
  engine in another container; it solves transcendental drift, not
  single-implementation bias.

## Conditions under which this is wrong

- If the headless runtime needs to import anything from the Nuxt module
  other than the engine package, the layering in ADR 0005 is fiction.
- If the differential test on endpoints passes only after copying the
  dispatcher, the `http.endpoints` interface is under-specified; write the
  missing fixtures before continuing.

## Consequences

- A new package (`packages/headless` in a monorepo, or a sibling
  repository) with a small dependency list.
- The engine gets extracted from `src/runtime/engine` into a package both
  runtimes consume; ADR 0005's "engine is shared, runtime is not" becomes
  a build boundary.
- The CLI of ADR 0018 lives in the headless runtime, not in the Nuxt
  module; the module consumes it for build-time validation.

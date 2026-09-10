# ADR 0026 — Portability without lock-in: runtimes differ, documents stay readable

Status: proposed (2026-09-10). Layer: kernel (fallback rules, adapters as
data), runtime (vocabulary manifests), tooling (the report).

## Context

The author's question, as asked: runtimes provide different components
and resources; how is that handled so that a document stays readable by
any runtime and lock-in is prevented?

The honest starting point is the handoff's number: the interpreter is 5%
of a port, the component vocabulary is 95%. Runtimes **will** differ, and
should: a Nuxt UI runtime, a Material runtime, a native iOS runtime and a
thermal printer cannot share components, only meaning. Lock-in is not
"the runtime has extra components"; lock-in is "the document cannot be
moved without rewriting it, and nobody can tell in advance". The answer
is therefore not one mechanism but a stack of five, each of which
already has a draft in this repository, plus one rule that turns them
into a guarantee.

## Decision

### 1. The base vocabulary is the contract; components are the implementation

`vocab.base` (ADR 0010) is spec data: names, token props, slots, events,
model. Every runtime with a UI surface **must** materialize all of it,
and a materializer must honour every token (bold is bold on paper and on
a phone). Documents written against it run everywhere a materializer
exists. Nuxt UI, Material, SwiftUI and ESC/POS are mappings of the same
contract. This is Adaptive Cards' and JSON Forms' model, and it is what
made HTML portable: the element set is the standard, the rendering is
the browser's.

### 2. Every non-base component declares a fallback in base terms

A vocabulary manifest entry for a runtime-specific component carries a
**fallback**: a template in `vocab.base` that receives the same props.

```jsonc
{ "name": "UCarousel", "vocabulary": "vocab.nuxt-ui",
  "props": { … },
  "fallback": [ { "type": "for", "in": { "var": "items" }, "as": "item",
                  "children": [ { "type": "component", "as": "Image", "bind": { "src": { "var": "item.src" }, "alt": { "var": "item.alt" } } } ] } ] }
```

A runtime that lacks the vocabulary evaluates the fallback in place of
the node; the abstract tree marks it (`"via": "fallback"`) so a test and
a reviewer can see it. A document may also write a **node-level
fallback** (`"fallback": [ … ]` on any component node) that wins over the
vocabulary's. A non-base component with neither fallback makes the
document **locked** to that vocabulary, and `validate` says so by name.
Prior art: `<video>` with fallback content, `@supports`, progressive
enhancement, `<noscript>`.

### 3. Capabilities are interfaces, providers are bindings

A document requires `storage.collections`, not Supabase; `secrets`, not
Vault; `http.endpoints`, not Vercel (ADR 0007, 0022). Provider names live
in deployment documents that are pinned separately. Moving a document
between platforms changes bindings, never the product hash. Resource
types beyond the kernel's are owned by capability interfaces
(ADR 0021), so a `dataset` means the same thing on every runtime that
provides `dataset.fetch`.

### 4. Adapters let one vocabulary be served by another

A **vocabulary adapter** is data: a mapping from one vocabulary's
components to another's, published by either side or by a third party.
`vocab.nuxt-ui → vocab.base` is the set of fallbacks of rule 2;
`vocab.nuxt-ui → vocab.material` is an adapter a Material runtime may
ship so that documents written for Nuxt UI run on it without a
fallback's loss of fidelity. Adapters are versioned like vocabularies,
carry tree fixtures (a node in the source vocabulary → nodes in the
target), and appear in the runtime manifest under `adapters`. A document
is compatible with a runtime if every vocabulary it requires is provided
**or adapted** by that runtime; the report says which.

### 5. Portability is measured and printed, never promised

The compatibility report (ADR 0009) already prints a level. This ADR
adds the two words that matter:

```
restaurant-menu-shop   L1  portable   (vocab.base only)
health-quote           L2  portable   (kernel + minimum common runtime)
partner-dashboard      L3  degradable (UCarousel, UCalendar via fallback on runtimes without vocab.nuxt-ui)
kitchen-display        L3  LOCKED     (BlueprintKdsBoard has no fallback; runs only where vocab.app@e5f6a7 exists)
```

`LOCKED` is not an error; it is a fact, printed at every validation, in
the version manifest, in the library catalog, and in the capability
request (ADR 0024). Lock-in that is visible, local to named nodes, and
reversible by re-authoring those nodes is a cost the owner chose; lock-in
that is discovered on the day of migration is the thing to prevent.

### The rule that makes it a guarantee

**A conformant runtime may add anything and may remove nothing.** It must
provide the kernel and `vocab.base`; it may provide vocabularies,
capabilities and adapters beyond them; it must publish a manifest that
lists them; it must pass the conformance suite for everything it lists.
A runtime that redefines a base component, a kernel operator or a shared
action is not a Blueprint runtime, whatever its manifest says, and the
suite is what proves it. Under that rule the worst a runtime can do to a
document is not to have something the document uses, and rules 2 to 5
make that case visible and survivable.

### What remains true, and is said in the documentation

- A document that leans on a rich runtime-specific component with no
  fallback is locked at that node. That is allowed, because the
  alternative is a base vocabulary as large as every design system, which
  would be nobody's.
- Porting cost is proportional to the number of `LOCKED` nodes and
  `degradable` nodes whose fallback is not good enough, and to nothing
  else. Everything below the tree (definitions, tables, schemas, tests,
  actions, endpoints) moves untouched.
- The base vocabulary grows by subtraction from real materializers, so
  a component that three runtimes fall back to in the same way is a
  candidate for base, with its fixtures.

## Alternatives considered

- **Forbid non-base components.** Portable and unusable: no charts, no
  maps, no rich editors, and every runtime would fork the notation to
  get them.
- **A huge base vocabulary.** The XAML lesson: four dialects, because
  nobody could implement all of it identically.
- **Runtime-side "best effort" rendering of unknown components** (render
  children, ignore the wrapper). Silent and different on every runtime;
  the opposite of a spec.

## Fixtures required

- Vocabulary fallback: a `UCarousel` node on a runtime without
  `vocab.nuxt-ui` → the fallback tree with `via: fallback`.
- Node-level fallback wins over vocabulary fallback.
- No fallback → `LOCKED` in the report and the version manifest.
- Adapter: a node in vocabulary A → nodes in vocabulary B, compatibility
  reported as adapted.
- Conformance: a runtime manifest listing `vocab.base` with one token
  unhonoured fails the base tree fixtures.

## Consequences

- Vocabulary manifests (the generated registry of this module) gain
  `fallback` per component; the module ships fallbacks for the Nuxt UI
  components the four documents use, which is a short list, and warns
  for the rest.
- The report and the version manifest gain `portable | degradable | LOCKED`.
- The answer to the author's question, in one sentence for the
  documentation: *runtimes may differ in what they add, never in what
  they mean; every addition either degrades to the base vocabulary or is
  printed as a lock the owner chose.*

# ADR 0005 — Three layers: kernel, runtime, distribution

Status: proposed (2026-09-10). Framing decision for ADRs 0006–0018.

Origin legend (from the handoff documents): **[V]** validated in production
in the insurance case · **[A]** defined by the author · **[P]** proposed
and not contested · **[H]** hypothesis for the second consumer · **[?]** open.

## Context

Everything built so far in this repository is exploration. Four documents
(`hello-world`, `restaurant-menu-shop`, `public-board`, `health-quote`) run on
one runtime (this Nuxt module) with one engine (`src/runtime/engine`). The
handoff documents insist on the same point from the other direction: one
engine and one runtime validate a product, never a spec. A spec is measured
by independent implementations that agree.

The author's late-night idea (continuation document, section 6.5) is the
missing frame: **Blueprint is to a runtime what ECMAScript is to Node, Bun or
Deno.** The spec fixes what a document means. A runtime supplies what the
document needs to run in one environment: a browser, a Nitro server, an
Android app, a thermal printer daemon, a batch evaluator. The same document
evaluates identically everywhere; each runtime materializes the sections it
can and provides the capabilities it has.

This repository already behaves like that without saying so. ADR 0004 made
the module a runtime with a published contract. The engine is pure and shared
by build, server and browser. Templates evaluate to an abstract tree before
anything Vue-specific happens. The vocabulary is layered by portability. What
is missing is the name of each layer, the rule about what may live in each,
and the boundary a second implementer can be handed.

## Decision

Blueprint is specified in three layers. Each has an owner, a versioning unit
and a conformance test.

### Layer 1 — Kernel (the spec) **[A][P]**

What every document means, independent of any environment. It is text plus
fixtures, no code:

| Part | Normative artifact | Exercised today by |
|---|---|---|
| Envelope and sections (ADR 0006) | Format JSON Schema; section registry | every document |
| Calculation notation (ADR 0001, 0012) | Operator semantics; corner cases; numeric model | `logic.test.ts`, document tests |
| Schemas | JSON Schema subset plus `message`, `requiredWhen` | `schema.test.ts`, forms, endpoints |
| Resources and parameter tables | `lookup` with hit policy; match bounds | delivery zones, age bands, risk factors |
| Definitions | Pure, memoized, acyclic | every document |
| Templates → abstract tree (ADR 0010) | The tree, not the pixels | `template.test.ts` |
| Actions as data (ADR 0008) | Action shapes; placement rules; the effect loop | restaurant, board, quote |
| `refs()` and static references | The reference set; `DYNAMIC_REFERENCE` | `validate.ts` |
| Tests carried by the document (ADR 0011) | Fixture forms and comparison rules | 35 tests across 4 documents |
| Canonical form, hash, version, pin (ADR 0013) | Canonicalization; version id; `createdUnder` | records API, `accept-quote` |
| Projection, audience, profiles (ADR 0015) | Order: filter → close → fail | not yet built |
| Inheritance as overlays (ADR 0016) | Overlay format; resolution at publish | not yet built |

The kernel never names a framework, a database, a component library or an
HTTP verb. Where a document needs one of those it asks for a **capability**
(ADR 0007), and the kernel only specifies how the request is written and
how a runtime answers it.

### Layer 2 — Runtime **[A][P]**

An engine implementing the kernel plus a set of **capabilities** and
**materializers** for one environment, published as a **runtime manifest**
(ADR 0009). This module is the first runtime: it provides web pages, browser
state, navigation, toasts, HTTP endpoints, three record storages and the Vue
materializer over Nuxt UI. A runtime is versioned by its own package version
and declares the spec range it implements.

A runtime may add capabilities freely. It may not change kernel semantics:
a document with no capability requirements (a kernel-only document such as
`hello-world`'s definitions and tests) must evaluate bit-identically on every
conformant runtime.

### Layer 3 — Distribution **[A][P]**

A runtime specialized for a domain: an insurance distribution packages an
actuarial operator vocabulary, regulatory datasets pinned by hash, bureau and
billing capabilities and a component vocabulary for brokers. A restaurant
distribution packages printing, payment and a POS vocabulary. Distributions
are named, versioned and declared by documents like any other capability
provider; they are runtimes with a domain, not a fourth kind of thing.

### The minimum common runtime is written by subtraction **[P]**

The kernel defines what every runtime must evaluate, but it does not define
which capabilities every runtime must provide. That list (the analogue of
WinterCG's minimum common API) is written **after** the second runtime
exists (ADR 0017), by keeping what both needed and dropping what only one
did. Writing it now would be abstraction before evidence, the failure mode
the handoff names in section 5.4.

Working hypothesis until then, to be confirmed or cut: every runtime provides
`core.evaluate` (definitions, tests, abstract trees) and `core.document`
(load a pinned version by id). Nothing else is assumed.

### What stays in code, in every layer **[V][P]**

Process. State machines with real-world effects (payment capture, policy
issuance, kitchen dispatch) live in runtime or distribution code. The
document parameterizes them, declares the capability calls it makes, and
carries the tests that prove the parameters. "Whole applications in a
document" means the part of the application that is product, configuration
and presentation.

## Alternatives considered

- **Spec and framework as one thing** (the Revision 1 posture: storage
  framework as vital part of the project). Doubles the investment and makes
  the framework the spec by being the only implementation. The handoff
  already rejected this; this ADR only adds the runtime layer between the two.
- **Two layers only, kernel and runtime, no distributions.** Distributions
  are runtimes; the name exists so that "an insurer builds its own runtime" is
  understood as expected, documented and interoperable, not as a fork.
- **One universal runtime with feature flags.** The JavaScript history says
  the ecosystem will build specialized runtimes anyway; the choice is between
  a spec that anticipates them and fragmentation.

## Conditions under which this is wrong

- If a second runtime cannot be built from the kernel text and fixtures
  without reading this module's source, the kernel is not a spec yet; the
  questions the implementer asks are the backlog.
- If most useful documents end up requiring capabilities that only one
  runtime provides, the layering exists on paper only. `validate` must say so
  (ADR 0009), and the minimum common runtime must grow.
- If kernel-only documents turn out to be useless in practice (every real
  document needs storage and HTTP), the minimum common runtime is the real
  spec and the kernel is its calculator; that is acceptable, but should be
  said.

## Consequences

- Every ADR that follows says which layer it belongs to.
- `docs/notation.md` will be split along this line: kernel notation versus
  what this runtime adds. Not done in this ADR.
- The contract of ADR 0004 becomes the runtime manifest of this runtime
  (ADR 0009); its shape is the first draft of the spec's manifest shape.
- The corpus of fixtures (ADR 0011) belongs to layer 1 and never references
  a Nuxt UI component, a storage name or an HTTP method.

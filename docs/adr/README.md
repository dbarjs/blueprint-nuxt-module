# Architecture decision records

Decisions for the Blueprint notation, its runtimes and this module. ADRs
0001–0004 were written while building the first documents and are
**accepted** (they describe what runs). ADRs 0005–0018 were written on
2026-09-10 from the handoff documents (`docs/initial-context`), the legacy
insurance example (`docs/examples`), the four documents in `content/` and
the pressures recorded in `docs/notation.md`. They are **proposed**: they
turn exploration into decisions with fixtures, and each one names the
conditions under which it is wrong.

Everything up to here is exploration. There is no finished spec. These
records are the draft of one, and the way to a spec is the sequence in
"What to do next", not the records themselves.

## Implemented on 2026-09-10 (second pass)

The cheap parts of the proposed records now run in the engine, with
fixtures in `test/engine/kernel.test.ts` and in the documents' own tests:

| Record | What runs now |
|---|---|
| 0006 | `spec` field, `UNSUPPORTED_SPEC`, `SPEC_MISSING`; `runtime.requires/optional` |
| 0007 | `CAPABILITIES` catalogue; `requirementsOf` derived from `refs()`; `checkCompatibility` with three verdicts; `CAPABILITY_MISSING`, `CAPABILITY_VERSION`, `CAPABILITY_UNAVAILABLE` |
| 0008 | `as`/`result` on every capability call; effect log; failures as values (`CAPABILITY_UNAVAILABLE` instead of a throw); `ACTION_CYCLE`; placement computed from the capability's surface |
| 0009 | runtime manifest (`GET /api/blueprint/contract`, `manifest.json#runtime`); version manifests per document (`manifest.json#documents`); portability levels; the report line |
| 0011 | tree tests (`render` + `tree`/`contains`), action scenarios (`run`/`stubs`/`after`), endpoint scenarios (`request`/`response`/`after.collections`); `UNSTUBBED_EFFECT`; skipped, never passed |
| 0012 | `half-up` away from zero; `half-down`, `trunc`; `scale` operator |
| 0013 | RFC 8785 canonical form; `sha256:` version ids (FNV kept for cache keys) |
| 0015 | `audience` on entries; `projectDocument`; `checkProjections` at build (`PROJECTION_DANGLING`); `profiles` section validated |
| 0026 | node-level `fallback`; `unavailable` nodes; `LOCKED` warning; `portable / degradable / LOCKED` in manifests and the report |
| 0027 | `access` rules and `context.actor` evaluated by `runEndpoint`; `identity` derived and refused where not provided |

Not implemented, still proposed: deferred slots (0010), document store
(0014), overlays (0016), the headless runtime (0017), the CLI and the
source form (0018–0020), datasets and secrets (0021), deployment
documents (0022), libraries (0023), capability requests (0024),
locators (0025), and any `identity` provider (0027).

One record was corrected by the implementation: 0015's alias
`visibility: private → audience: server` was wrong. The restaurant and the
quote mark helper definitions private while their pages read them, so
`visibility` only ever meant "not a public output". It is now
documentation-only and deprecated; `audience` is explicit or `public`.

## Origin legend

Used inside the records, inherited from the handoff:

- **[V]** validated in production in the insurance case
- **[A]** defined by the author
- **[P]** proposed and accepted or not contested
- **[H]** hypothesis for the second consumer (restaurant platform)
- **[?]** open

## Reading order

Start with 0005; it names the three layers every other record refers to.
Then 0006 → 0007 → 0008 → 0009, which together are the runtime model
(the subject the continuation document asked to discuss first, "actions
closed by capabilities" and "the minimum common runtime"). The rest can
be read in any order.

| ADR | Layer | Decision in one line | Origin |
|---|---|---|---|
| [0001](0001-own-evaluator-json-logic-compatible.md) | kernel | Own evaluator, JSON Logic compatible, corner cases decided | [V][P] |
| [0002](0002-behavior-model-state-actions-model.md) | kernel | `state`, closed actions, `model` bindings, page `enter` | [P] |
| [0003](0003-content-collection-through-generated-layer.md) | this runtime | Content collection registered through a generated layer | [P] |
| [0004](0004-documents-write-their-endpoints.md) | this runtime | Documents write endpoints as server actions; runtime publishes a contract | [P] |
| [0005](0005-kernel-runtime-distribution.md) | framing | Three layers: kernel (spec), runtime (capabilities + materializers), distribution (domain runtime); minimum common runtime by subtraction | [A][P] |
| [0006](0006-envelope-spec-version-and-section-registry.md) | kernel | `spec` field, stable `id`, derived `version`; registry of sections with owners; `runtime` is the requirements block; three homes for data | [A][P] |
| [0007](0007-capabilities-requires-provides.md) | kernel | Capabilities as versioned interfaces; `requires` derived by `refs()`; `provides` in the runtime manifest; refuse critical, degrade optional | [A][P] |
| [0008](0008-effects-as-data-action-loop.md) | kernel | Transforms vs capability calls; the event → action → result → input loop; `as` and `result` everywhere; effect log in the reproduction tuple | [P] |
| [0009](0009-runtime-manifest-and-portability-report.md) | kernel / runtime | Runtime manifest (`provides`), version manifest (`requires`, section hashes), project manifest; compatibility verdicts; portability levels L0–L3 | [P] |
| [0010](0010-surfaces-abstract-tree-materializers.md) | kernel / runtime | Abstract tree normative; `vocab.base` as spec data; surfaces and `channel:*`; materializer conformance in two tiers; deferred slots | [A][P] |
| [0011](0011-document-tests-and-conformance-corpus.md) | kernel / tooling | Four test forms (definition, tree, action scenario, endpoint scenario); corpus layout and runner; restricted Gherkin as authoring form | [V][P] |
| [0012](0012-numeric-semantics-v0.md) | kernel | binary64, no non-finite, integer cents, rounding on shortest decimal with `half-up` = away from zero, no transcendentals, `scale`, bit-exact fixtures | [V][P] |
| [0013](0013-canonical-form-version-and-pins.md) | kernel | RFC 8785 canonical form; SHA-256 version id; `createdUnder`/`acceptedUnder`/`evaluatedBy`; provenance; spec dispatch | [V][P] |
| [0014](0014-document-store-and-record-storage.md) | kernel / capability | Document store (eight operations, `store-git` + `store-fs`) vs record storage (`storage.collections`); the pin is the only coupling | [V][P] |
| [0015](0015-projection-audience-profiles.md) | kernel | Audience per entry; filter → close → fail; projection is a document; profiles as persisted selections | [V][P] |
| [0016](0016-inheritance-as-overlays.md) | kernel / store | `extends` by version hash; JSON Merge Patch with list identity; resolved at publish with provenance | [V][P] |
| [0017](0017-second-runtime-headless.md) | runtime | Second runtime is headless (CLI, plain HTTP, `store-fs`, text/ESC-POS); second engine in a clean room afterwards | [P] |
| [0018](0018-authoring-ergonomics-cli-and-agents.md) | tooling | Canonical JSON stored, friendly forms derived; infix and structured edits in the CLI; `description`, stable ids, error `hint`; the editor is the agent | [A][P] |
| [0019](0019-source-form-and-builder.md) | tooling / source profile | A document is authored as a tree of files (path = address, extension = syntax) and built into one canonical JSON; `build`/`explode` round-trip tested | [A][P] |
| [0020](0020-template-dialect.md) | tooling / source profile | A Vue-like `.bpt` dialect defined only by its mapping to template nodes; static name resolution; no scripts, no dynamic names | [A][P] |
| [0021](0021-resource-types-datasets-and-secrets.md) | kernel / capabilities | Resource type registry (`markdown`, `dataset`, `media`, `secret`…); datasets by hash before evaluation; secrets by reference only, never inline; crypto as a capability | [V][A][P] |
| [0022](0022-deployment-document.md) | kernel / platforms | `kind: deployment`: needs stay in the app, provider bindings live in a separately pinned deployment document; provider manifests; provisioning is tooling | [A][P] |
| [0023](0023-libraries-and-shared-runtimes.md) | runtime / platform | Libraries = store + runtime + catalog; isolation per app; provisioning per version manifest; native runtimes render L1; chat-to-app behind the governance gate | [A][P][H] |
| [0024](0024-capability-requests.md) | tooling | `validate --target` emits a machine-readable capability request; runtime tracker for existing interfaces, spec tracker for new ones | [A][P] |
| [0025](0025-run-from-a-link.md) | kernel / runtime | Locators = location + expected hash; the hash is the identity; read-side HTTP convention any storage can serve; run from a link with integrity and compatibility checks | [A][P] |
| [0026](0026-portability-without-lock-in.md) | kernel / runtime / tooling | Base vocabulary as contract; mandatory fallbacks for non-base components; capabilities as interfaces; adapters as data; `portable / degradable / LOCKED` printed; "add anything, remove nothing" | [A][P] |
| [0027](0027-identity-and-access.md) | kernel / runtime / distribution | `context.actor` and endpoint `access` rules in the kernel; `identity` as a capability with providers bound in deployment documents; access never optional; sessions and tokens stay out of the kernel | [A][P][?] |

## Ledger: scar, belief, open

What the four documents in this repository have exercised, beyond the
insurance ledger of the handoff:

| Exercised by real documents here | Still belief | Open, no document has forced it |
|---|---|---|
| One action language on both surfaces (board, quote) | Capabilities as the unit of compatibility (0007), now computed at build | `identity` providers; the kernel side is 0027 |
| Parameter tables with `first` and `collect` policies (restaurant, quote) | Effect log and replay (0008) | Datasets fetched by hash (`dataset.fetch`) |
| Staging a request as browser state to reuse definitions (quote) | Version manifest and portability levels (0009) | Parametrized definitions |
| Version pinning as a domain rule (`quotedUnder`, quote) | Deferred slots (0010) | Multiple inheritance, overlay chains |
| The base vocabulary rendering a print channel (restaurant) | Tree, action and endpoint test forms (0011): 15 written across the four documents, all passing | The minimum common runtime's exact content (a first list is in `manifest.ts`) |
| Integer cents with `percentOf` keeping tests exact (restaurant) | `scale` and `half-down` (0012) | Distributed profile: CDN, signatures, offline |
| Live state derived statically from `fetch.result` (board) | SHA-256 pins and `evaluatedBy` (0013) | Decimal numeric model |
| Build-time validation against the runtime (all) | Per-page projection (0015) | Encryption of sections |
| `context.now` on the client surface and calendar arithmetic without date operators (habit tracker) | Date operators and `context.timeZone` (catalogue ticket 21) | A pin for persisted browser state |

## Open points, mapped

From the continuation document, section 7:

| Open point | Where it is now |
|---|---|
| Behaviour model and actions | 0008 (mechanism), 0002 (current set) |
| Normative base vocabulary | 0010: yes, as spec data, cut by subtraction |
| Where parameter tables live, hit policies | 0001/notation: resource type + `lookup`; four policies exist |
| Numeric model, transcendentals, rounding | 0012 |
| Overlay format, row identity | 0016 |
| Manifest, canonicalization, signature | 0009, 0013; signature out of 0.1 |
| Encryption of sections | out of 0.1 (0015) |
| `evaluatedBy`, archived artifact | 0013; archive open |
| Resource vs dataset | 0007 reserves `dataset.fetch`; open |
| Operational state boundary | 0006 (three homes) |
| Infix authoring grammar | 0018 |
| Structured edit commands, stable ids | 0018 |
| `description` field | 0018 |
| Capability interfaces, versioning, fixtures | 0007 |
| Minimum common runtime | 0005, 0017: after the second runtime |
| Effects-as-data loop and the reproduction tuple | 0008, 0013 |
| Runtime manifest checked at build | 0009 |
| Second runtime | 0017 |
| Restricted Gherkin | 0011 |
| Distributions | 0005 |

## The vision, tested

`docs/vision/README.md` records the author's vision (thirteen points)
and submits each to the scar/belief/fire test, with prior art and the
ADR that decides it. Two corrections worth repeating here: splitting the
document into files improves locality, not safety (validator, tests and
preview do that); and lock-in is prevented by fallbacks and a printed
report, not by forbidding runtime-specific components.

## What to do next

In this order, each step small enough for one session:

1. **Accept or amend 0005–0009** (the runtime model). This is the "cold
   head" discussion the continuation document scheduled. Nothing else
   depends on the rest being accepted first.
2. ~~Implement the cheap kernel changes~~ — done (see "Implemented").
3. ~~Re-express the contract as the runtime manifest~~ — done.
4. ~~Add the three new test forms~~ — done; a tree test for the kitchen
   ticket is still worth writing when the print materializer exists.
5. **Extract the engine into a package**, then build `blueprint-headless`
   with the CLI (0017, 0018). The differential test on endpoints is the
   first proof.
6. **Write the minimum common runtime** from the two manifests (0005).
7. Projection per page (0015), overlays (0016), `store-fs` (0014): each
   with its fixtures, in whichever order the next document demands.
8. **Explode the health quote** into a source tree with the `.bpt`
   dialect, rebuild it byte-identical (0019, 0020). One afternoon; the
   demonstration the vision document names.
9. ~~The `portable / degradable / LOCKED` line~~ — done; fallbacks for
   the Nuxt UI components in use remain to be written per component.
9b. **The first `identity` provider** (0027): a cookie session with a
   fixed user table in the host config, then the health quote's ownership
   rule.
10. The RFC repository skeleton from `docs/rfcs/README.md`, when the
    draft is stable.

## Conventions

- One decision per record; status `proposed` until code and fixtures
  exist, then `accepted`; superseded records stay and point forward.
- Every proposed record lists the fixtures that would make it accepted and
  the conditions under which it is wrong.
- Vocabulary follows `CONTEXT.md`; a term used here and missing there is a
  gap to fix there, not here.

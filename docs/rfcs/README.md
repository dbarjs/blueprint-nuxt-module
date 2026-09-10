# Blueprint RFCs — proposal for the spec repository

Status: proposal (2026-09-10). The RFC repository is the main part of the
Blueprint specification; this document proposes its shape, its process
and the list of RFCs, each with scope, dependencies, the ADRs of this
repository it draws from, and the fixtures it must ship. The RFC bodies
are to be written by the author once the draft stabilizes; nothing here
pre-empts their content.

## 1. What the spec repository is

`blueprint/spec`: text and data only, no code. Two halves that release
together, so that a tag is a spec version and its proof:

```
spec/
  README.md                    the invariant in one page, the four interoperability scenarios, "when not to use"
  rfcs/
    0000-process.md            how RFCs are written, numbered, reviewed, accepted, superseded
    0001-invariant.md          …
    NNNN-<slug>.md
  interfaces/                  capability interfaces as data (ADR 0007), one directory per interface and major version
    http.endpoints/1/interface.json
    http.endpoints/1/fixtures/
  vocabularies/
    base/0.1/vocabulary.json   vocab.base as data (ADR 0010), with tree fixtures
  schemas/
    0.1/envelope.schema.json   the format's JSON Schema per spec version
    0.1/source-profile.json    the source layout table (ADR 0019)
  conformance/<area>/<case>/   doc.json  input.json  expected.json  meta.json   (ADR 0011)
  scenarios/<document>/<case>/ generated from real documents, reviewed by a human
  CHANGELOG.md                 one entry per spec version; semantics are frozen per version
```

Rules inherited from the handoff and the ADRs:

- **Fixtures live with the text.** A PR that changes a MUST without a
  fixture is suspect; a PR that changes a fixture without text is an
  ambiguity or a bug. CI fails a MUST with no fixture and a fixture
  pointing at no clause.
- **Normative is passive.** A clause enters an RFC when a real document
  exercised it and two implementations agree, or when a scar from the
  insurance case demands it. Everything else is `Note` or `Appendix`.
- **Until a second implementer exists, RFCs are ADRs with RFC names.**
  They are worth what they force to be written: motivation, alternatives,
  consequences, fixtures, the conditions under which they are wrong.
- **Origin tags** ([V] [A] [P] [H] [?]) on every clause, so a reader can
  tell scar from belief without asking.
- **Two levels of conformance from day one**: `core` and `numeric`
  (ADR 0012); capability interfaces are conformance units of their own.

## 2. Process (to become `0000-process.md`)

1. **Draft**: a numbered file with the template below; status `draft`;
   may change freely.
2. **Review**: two or three chosen readers (architects who will say no)
   before any public announcement; their questions become clauses or
   open points.
3. **Candidate**: fixtures complete; one implementation passes them; the
   RFC's origin tags are complete.
4. **Accepted**: a second, independent implementation passes the
   fixtures without talking to the author (clean room, ADR 0017). Only
   then is the clause set frozen into a spec version.
5. **Superseded**: never edited in place; a new RFC or a new spec version
   points back. Semantics of a published spec version never change.

Spec versions are `major.minor`; documents carry `spec` (ADR 0006);
engines declare ranges. A minor version adds; a major version may
remove, with a migration RFC that never rewrites published documents.

## 3. Template (`rfcs/0000-template.md`)

See `docs/rfcs/0000-template.md` in this repository. Sections: Summary ·
Motivation (with the scar or the document that forced it) · Terms ·
Specification (MUST/SHOULD/MAY, each clause with an id `R<rfc>.<n>` and
origin tag) · Fixtures (paths under `conformance/`) · Interoperability
notes · Alternatives · Conditions under which this RFC is wrong · Open
points · Prior art · Changelog.

## 4. The RFCs, in dependency order

The order is by dependency and by scar, as the handoff suggests
(envelope → resources → notation → schemas → templates → refs/projection
→ inheritance → storage → distributed). Writing order may differ: storage
has the most documented scars and can be written first. Building order:
the evaluator first, because it is what proves the spec.

| RFC | Title | Scope (what it fixes) | Depends on | From ADRs | Must ship |
|---|---|---|---|---|---|
| 0000 | Process | numbering, statuses, review, versioning, conformance levels, origin tags | — | 0005, README | CI rules |
| 0001 | The invariant | one page: immutable versioned document carrying its tests, pinned by records, interpreted by engines that declare what they support and refuse what they do not; the four interoperability scenarios; when not to use | — | 0005 | nothing normative beyond the page |
| 0002 | Envelope and sections | `spec`, `id`, `name`, `kind`, `from`, `content`; the section registry and owners; the `runtime` requirements block; the three homes of data; error codes `UNSUPPORTED_SPEC`, `UNKNOWN_SECTION` | 0001 | 0006, 0022 | envelope schema; negative fixtures |
| 0003 | Canonical form, hashing and versions | RFC 8785 canonicalization; SHA-256 version ids; section hashes; what the hash excludes; what it does not prove | 0002 | 0013 | JCS vectors; version fixtures |
| 0004 | Resources and resource types | the type registry (`constant`, `list`, `options`, `references`, `parameter-table`, `markdown`); ownership of other types by capabilities; size rules | 0002 | 0021 | schema fixtures per type |
| 0005 | Parameter tables | `match` bounds and semantics (inclusive/exclusive, prefix, sets), hit policies (`first`, `unique`, `last`, `collect`), `default`, no silent null, row identity, order as semantics, chaining as a DAG | 0004, 0006 | notation, 0001 (this repo), 0012 | the age-25 fixture; overlap; no-match; cycle |
| 0006 | Calculation notation | the JSON form (literal, array, one-key operator object); data access operators (`state`, `def`, `resource`, `context`, `var`, `meta`); the kernel operator set with argument shapes; `let`, `obj`, `lookup`; static references and `DYNAMIC_REFERENCE`; error codes | 0002 | 0001 (this repo), notation, 0018 | one fixture per operator, corner cases |
| 0007 | Numeric semantics | binary64; domain; integer cents; rounding representation and modes; order; iteration order; transcendental exclusion; `scale`; `format` for `en-US`; conformance level `numeric` | 0006 | 0012 | bit-exact fixtures as strings |
| 0008 | Schemas | the JSON Schema subset; `$ref` within the document; `message`; `requiredWhen`; formats; validation issue shape | 0006 | notation | positive and negative per keyword |
| 0009 | Definitions, state and tests | definitions as pure memoized functions of state and context, cycles rejected; `state` as initial payload; the four test forms and comparison rules; stubs; effect log in tests | 0006, 0008 | 0002 (this repo), 0008, 0011 | the corpus runner contract |
| 0010 | Templates and the abstract tree | node types; `bind`, `content`, `model`, `on`, `if`, `for`, `slots`, `template`, `outlet`; evaluation to the tree; keys; deferred slots; `unavailable` nodes; escapes | 0006, 0009 | 0002, 0010 | tree fixtures |
| 0011 | Base vocabulary | `vocab.base` as data: components, token props, slots, events, model; materializer obligations (every token honoured); versioning with the spec | 0010 | 0010, 0026 | one tree fixture per component and token |
| 0012 | Actions and effects | transforms vs capability calls; the event → action → result → input loop; `as` and `result`; failure shape; termination; `ACTION_CYCLE`; placement by capability surface | 0009, 0010 | 0002, 0008 | state-before/event/state-after fixtures |
| 0013 | Capabilities | the interface shape; `requires`/`optional`, derivation by `refs()`; `provides`; refuse vs degrade; version ranges; reserved interfaces (`identity`, `dataset.fetch`, `secrets`, `crypto`, `blob`) | 0002, 0012 | 0007 | derivation fixtures; refusal; degradation |
| 0014 | References, projection and profiles | `refs()` as a normative function; the reference graph as a DAG; audience per entry; filter → close → fail; projection as a document; profiles | 0006, 0010 | 0015 | `refs()` sets; projection bytes |
| 0015 | Manifests and compatibility | runtime manifest, version manifest, compatibility verdicts, portability levels and `portable | degradable | LOCKED`; capability request artifact | 0013, 0014 | 0009, 0024, 0026 | verdict fixtures |
| 0016 | Vocabularies, fallbacks and adapters | vocabulary manifests with hash versions; component contracts; fallbacks (vocabulary-level and node-level); adapters as data; the "add anything, remove nothing" rule | 0011, 0015 | 0026, module context 3 | fallback and adapter tree fixtures |
| 0017 | Inheritance | `extends` by version; merge patch with list identity; `$remove`, `$before`/`$after`; tests appended; resolution at publish; provenance | 0003, 0014 | 0016 | merge fixtures; refusals |
| 0018 | Records and pins | `createdUnder`, `acceptedUnder`, `evaluatedBy`, `deployedUnder`; the reproduction tuple; `pinned` endpoints and `STALE_VERSION`; replay is for testing engines, not for redefining records | 0003, 0012 | 0013 | pin fixtures |
| 0019 | Document store | the eight operations; no `update`, no `delete`; pointers with a log; the read-side HTTP convention and static layout; locators and integrity; `store-fs` and `store-git` as reference implementations | 0003, 0014, 0017 | 0014, 0025 | neutral-text fixtures for the eight operations |
| 0020 | Surfaces and channels | surfaces; `page:`/`component:`/`channel:` semantics; materializer conformance in two tiers; non-web materializers as capabilities | 0010, 0011, 0013 | 0010 | channel tree fixtures |
| 0021 | Standard capability interfaces | `web.pages`, `web.state`, `web.router`, `ui.toast`, `http.client`, `http.endpoints`, `storage.collections`, `time.now`, `records.pinned`, `dataset.fetch`, `secrets`, `blob`, `crypto`, `identity` (actor shape, `access` rules, 401/403, never optional) — one appendix each, or one RFC each when they mature | 0013 | 0004, 0007, 0021, 0027 | per-interface fixtures under `interfaces/`; the four identity fixtures of ADR 0027 |
| 0022 | Deployment documents | `kind: deployment`; bindings; provider manifests; validation of a deployment; provisioning as tooling | 0002, 0013, 0015 | 0022 | binding verdict fixtures |
| 0023 | Source profile | the file layout; extension table; the `.logic` grammar; the `.bpt` dialect mapping; `.md`, `.csv`, `.feature`; build determinism and round trips | 0006, 0009, 0010 | 0018, 0019, 0020, 0011 | source tree → canonical fixtures; round-trip properties |
| 0024 | Minimum common runtime | the capability set every runtime provides; written by subtraction after two runtimes | 0013, 0021 | 0005, 0017 | the intersection, as a manifest |
| 0025 | Distributed profile (experimental) | signed manifests, CDN by immutable id, mirrors, `published`/`active`, activation protocol, offline; encryption last or never | 0019, 0003 | handoff 4.11 | marked experimental; fixtures only for what a consumer exercised |

Twenty-four numbered RFCs plus the process. The first eight (0000–0007)
plus 0009 and 0019 are enough for a headless runtime and a clean-room
evaluator; that is the set to stabilize first.

## 5. What the repository is not

- Not the engine: `blueprint/engine` holds the reference TypeScript
  engine, the CLI, `store-fs`, the headless runtime and the demo site
  generated from the corpus.
- Not the module: this repository (or `engine/packages/nuxt`) is the
  first runtime and consumes the spec.
- Not examples: real applications live with their owners; the corpus
  keeps only fixtures, never a Nuxt UI component name.

## 6. Open questions for the author before writing

1. Whether interfaces (section 4, RFC 0021) are one RFC with appendices
   or one RFC each. Proposal: one RFC while there is one runtime; split
   when a second runtime disagrees on any of them.
2. Whether `vocab.base` is normative in 0.1 or "reference". The ADRs
   say normative; the cost is that every runtime must materialize all of
   it. The alternative, only the notation, is honest and smaller.
3. Numbering: this proposal numbers by dependency. If the author prefers
   numbering by writing order, the dependency graph in the table still
   holds and the numbers change.
4. Licence: Apache-2.0 for text, data and engine (handoff 5.6), or CC-BY
   for text; decide before the first public draft.

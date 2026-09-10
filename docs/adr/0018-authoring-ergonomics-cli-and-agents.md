# ADR 0018 — Authoring: canonical JSON is stored, every friendly form is derived; the editor is the agent

Status: proposed (2026-09-10). Layer: tooling (CLI, skill), with three
small kernel decisions (`description`, stable ids, error shape).

## Context

The insurance case validated a human analyst editing rules and resources
inside a structure developers own. The continuation document's step
beyond it is that the editor, the cost iceberg of every metadata-driven
platform, need not be built as a GUI: it is a skill plus a CLI with
structured commands plus a preview, and the person of business describes
while an agent edits. That reframes the pitch (architecture for software
written by agents under human governance) and makes two things mandatory
that were nice-to-have: the validator and the document's tests are the
safety mechanism, and every change ships with the fixture that proves it.

This repository already runs in that mode: four documents were written by
an agent against the validator, the tests and the browser, and the
pressures recorded in `docs/notation.md` are the raw material. What was
felt as friction, in order: nested JSON logic is hard to read and write;
editing a 100 KB file by text replacement is slow and risky; loading a
whole document costs tokens; there is no place for "why"; a wrong
component name is caught but the error does not say what was meant.

## Decision

### The stored form is canonical JSON, and only that

The document store holds canonical JSON (ADR 0013). Every friendlier form
is **derived or translated by tools**, never stored: infix expressions,
restricted Gherkin (ADR 0011), section views, diffs with explanations.
Round-trips must be lossless and are property-tested; unknown fields are
preserved. YAML, JSON5 and a full DSL were considered as storage formats
and rejected: one stored form, one hash, one diff.

### Authoring syntax for expressions, tool-side

```
age >= 26 and age <= 35
subtotal - discount + deliveryFee + tax + tipAmount
if billing == "annual" then annual else monthly
lookup("age-bands", { age: applicant.age }).factor
```

compiles to the JSON Logic form and `explain` prints the JSON back as
infix. The grammar is small (literals, paths, the kernel operators as
functions, `and`/`or`/`not`, comparison, arithmetic, `if … then … else`,
`let … in`). The parser lives in the CLI and the editor; **the engine
never sees infix** and the spec 0.1 defines only the JSON form.

### Structured editing by path and id

```
blueprint get    health-quote resources.age-bands.data[band=26-35]
blueprint set    health-quote resources.settings.data.annualDiscount 0.1
blueprint add    health-quote resources.risk-factors.data '{ "id": "night-shift", "match": { "shift": "night" }, "factor": 1.1 }'
blueprint remove health-quote definitions.unusedThing
blueprint move   health-quote resources.risk-factors.data[id=smoker] --before extreme
```

Commands address entries by name and list items by `id`; the formatter is
canonical and idempotent so a `set` produces a one-line diff. For that,
**rows and list items carry stable `id`s** (also required by overlays,
ADR 0016); `validate` warns on lists without them (`NO_ITEM_ID`).

### `description` everywhere

`description` is legal on every section entry, every parameter table row,
every action and every test, is preserved by canonicalization and shown
by `view` and `explain`. It is data, not a comment: it survives tools
that comments would not, and it is what the agent reads to learn the
"why". The health quote already uses it on tables, definitions and
endpoints.

### Section views and the reading order for agents

`blueprint view health-quote definitions` prints one section, the closure
of its `refs()` and the schema of that section; the skill instructs the
agent to load by section, never the whole file. Reading order: version
manifest → the section being edited → its closure → the tests that name
it.

### Error quality is part of the spec

Every error is `{ code, path, message, hint? }`. `hint` carries the
nearest valid alternative when one exists (`component "USelect" is not
registered; did you mean "Select" (base) or "USelectMenu" (nuxt-ui)?`).
Codes are stable and listed with fixtures; messages are not normative.

### The cycle, and what the browser is for

`validate` → `test` (all four forms) → `render` (abstract tree) → browser
(layout, real behaviour, screenshot) → canonical `diff` with `explain`
for the human. The browser is last because it is expensive and not
deterministic. The runtime exposes state for assertions without pixels:
`window.__blueprint` with `{ version, state, tree, effects }` and
`data-blueprint-key` attributes on materialized nodes, so an agent asserts
"the total shows $57.47" by reading the tree, not by reading pixels.

### The skill may say "this belongs in a component"

The skill authorizes the agent to conclude that a need is **behaviour**
(a registered component, in code) rather than **composition** (a notation
extension, with a fixture), and requires every such conclusion to be
written to the pressures ledger. Without that permission the agent bends
the notation to please the format; with it, the notation grows only where
composition was missing. The ledger moves from sections of
`docs/notation.md` to `docs/PRESSURES.md`, one entry per pressure with
the decision taken.

### The governance screen is the only GUI

Publishing needs one screen, not a builder: the canonical diff with
`explain`, the preview, the test report, approve, publish (move the
pointer, ADR 0014). It exists because a person of business must judge by
preview and fixture, in the analyst's language ("show me the test that
proves it").

## Alternatives considered

- **Build the low-code editor.** The cost iceberg; the case validated the
  analyst inside a structure, not the editor as such. If a consumer needs
  it, it is a materialization of the same commands.
- **Store YAML or JSON5 for readability.** Two forms to hash and diff, and
  the readability gain is smaller than infix expressions and Gherkin,
  which are derived anyway.
- **Let the engine accept infix.** Two parsers in every engine, or one
  engine becoming the reference by owning the parser.

## Fixtures required

- Infix ↔ JSON round-trip property tests; a fixed corpus of expressions
  from the four documents with their infix forms.
- Structured edit commands: before/after canonical documents, each a
  one-entry diff.
- Error catalogue: one negative fixture per code with `path` and, where
  applicable, `hint`.

## Consequences

- A `blueprint` CLI is the next artifact after this ADR set, hosted in the
  headless runtime (ADR 0017); the Nuxt module calls it at build.
- The four documents gain `id`s on list items that lack them and
  `description`s where a reader needed one.
- `docs/PRESSURES.md` starts with the entries currently in
  `docs/notation.md` sections 8, 10 and 11.
- The skill for agents (module context, section 10) is written after the
  CLI exists, not before: without `validate`, `test` and the manifest, the
  agent invents props with confidence.

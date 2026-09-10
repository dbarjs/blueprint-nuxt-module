# ADR 0019 — Source form: a document is authored as a tree of files and built into one canonical JSON

Status: proposed (2026-09-10). Layer: tooling, with a documented mapping
("source profile 0.1") that is versioned with the spec. Extends ADR 0018.

## Context

`content/health-quote.json` is 61 KB and 1,000 lines; the restaurant is
100 KB. Both were written by an agent, and the friction was the same for
the human reviewing them: everything is in one file, in one syntax, and
the syntax (JSON with one-key operator objects) is the worst of the
available ones for every section except `schemas`. ADR 0018 decided that
canonical JSON is the only stored form and every friendlier form is
derived by tools. The author's vision takes that to its end: **the
document is structure, so it can be split into many files, each in the
syntax that reads best for its kind, and a builder assembles the canonical
JSON**, the way Vite assembles a web application from sources.

Two purposes, in order of certainty. Readability and locality for humans
and agents: an agent editing a rating table opens one small file, not a
1,000-line document. Context economy: a section view (ADR 0018) becomes a
directory listing. What the split does **not** do by itself is prevent
invention; validator, tests and preview do that (vision document,
section 2).

## Decision

### Layout: path is the address, extension is the syntax

```
health-quote/
  blueprint.json              spec, id, name, from, meta            (envelope; always JSON)
  runtime.json                requirements block (ADR 0006)
  state.json
  resources/
    settings.json             { "type": "constant", "data": { … } }
    plans.json
    age-bands.table.json      parameter table (rows with match)
    risk-factors.table.csv    parameter table as CSV: match.* columns + output columns
    terms.md                  markdown resource with front matter (ADR 0021)
    postal-codes.dataset.json dataset reference: version + hash, never the data
    products/                 a directory entry: _meta.json + one file per row, ordered by id
  schemas/
    applicant.schema.json
    quote.schema.json
  definitions.logic           infix, one block per definition (ADR 0018)
  actions/
    request-quote.json        actions stay JSON (they are data, and short)
  collections.json
  endpoints/
    create-quote.json
  templates/
    pages/index.bpt           Vue-like dialect (ADR 0020) → page:index
    pages/quotes/[id].bpt     → page:quotes-id, route from the path unless declared
    components/money-row.bpt  → component:money-row
    channels/kitchen-ticket.bpt → channel:kitchen-ticket
  tests/
    pricing.feature           restricted Gherkin (ADR 0011)
    stale-quote.feature
    tree-checks.json          any test form may also be JSON
```

Rules:

- `<section>/<entry>.<syntax>` maps to `content.<section>.<entry>`; a
  section may also be a single `<section>.json` holding the whole map
  (`state.json`, `collections.json`). Mixing both for one section is an
  error (`SOURCE_DUPLICATE_ENTRY`).
- A **directory entry** (`resources/products/`) assembles one entry from
  many files: `_meta.json` carries everything but `data`; the remaining
  files are the rows of `data`, sorted by their `id` (or filename when
  the row has no id, with a warning). This is how "thousands of files"
  stays one resource.
- Extensions select a parser: `.json` (also `.jsonc`, comments dropped),
  `.logic`, `.bpt`, `.md`, `.csv`, `.feature`. Anything else is an error,
  never copied blindly.
- Entry names come from file names and must be slugs; the file name wins
  over any `name` field inside, and a mismatch is an error.
- `description` in a source file may be written as front matter (`.md`,
  `.bpt`, `.feature`) or a leading `//` comment block (`.logic`,
  `.jsonc`), and is stored as the `description` field. Other comments are
  dropped; the builder warns once per file so nothing is lost silently.

### The build is a pure function

`blueprint build <dir> → canonical.json`: parse every file, assemble the
envelope, canonicalize (ADR 0013), validate (ADR 0006–0009), run tests.
Same tree → same bytes, on any machine. The output is what is published,
pinned and served; the source tree is never a pin. A `blueprint.lock`
next to `blueprint.json` records the built version and the builder
version so a reviewer can confirm a tree matches a published hash.

### Explode is the inverse, and round trips are tested

`blueprint explode canonical.json → <dir>` writes the canonical layout:
one file per entry, JSON everywhere unless `--dialect` asks for `.logic`,
`.bpt`, `.feature` or `.csv` where they apply. Properties, tested by
property-based tests over the four documents and generated ones:

- `build(explode(doc)) == doc` byte for byte, for every dialect choice;
- `explode(build(tree)) == tree` for trees already in canonical layout;
  hand-written trees may normalize (whitespace, key order, comments) and
  the builder prints the normalization as a diff the first time.

A construct of any dialect that cannot be represented in JSON does not
exist; a JSON construct that cannot be represented in a dialect falls
back to JSON for that entry, never fails.

### Imports are files, references stay static

There is no `import` statement. A file references other entries the same
way JSON does (`def`, `resource`, `template`, `schema` by name), and the
builder checks them with `refs()`. Splitting changes where things are
written, not how they are referenced, so the static-reference rule
(`DYNAMIC_REFERENCE`) and the closure for projections work unchanged.

### What is normative

The kernel is unchanged. The **source profile** (this layout, the
extension table, the per-syntax mappings of ADRs 0018, 0020, 0021, 0011)
is versioned with the spec (`source: "0.1"` in `blueprint.json`) and has
its own fixtures: source tree → canonical JSON. A second builder that
passes them is conformant; the dialects are not the format.

## Alternatives considered

- **Keep one JSON file and improve the editor.** The editor is the agent,
  and the agent's "editor" is the file system and the CLI; the split
  serves it directly.
- **A single YAML or JSON5 file.** One syntax for everything is the
  problem, not the number of files.
- **A general module system with imports and packages.** Not needed until
  documents share entries; sharing today is inheritance (ADR 0016), which
  works on built documents, not sources.

## Fixtures required

- Source tree → canonical JSON for each of the four documents, checked
  in as `test/fixtures/source/<name>/`.
- Round-trip property tests as above.
- Errors: duplicate entry, name mismatch, unknown extension, directory
  entry with rows lacking ids (warning), comment dropped (warning).

## Consequences

- `content/` may hold either `<name>.json` or `<name>/` directories; the
  module builds directories at build time and in dev on change, and
  validates the result exactly as it validates a JSON document today.
- The CLI (ADR 0017/0018) gains `build`, `explode`, `watch`.
- The four documents are exploded once, with `--dialect`, and kept as
  trees; the JSON in `content/` becomes a build artifact or is deleted.
  This is the demonstration named in the vision document.

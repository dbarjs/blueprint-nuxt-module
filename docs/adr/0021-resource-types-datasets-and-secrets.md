# ADR 0021 — Resource types: a registry owned by kernel and capabilities; datasets by hash; secrets by reference only

Status: proposed (2026-09-10). Layer: kernel (the registry and the kernel
types), capabilities (the others).

## Context

`resources` began the whole architecture (handoff 2.3) and today its
`type` is free text with two exceptions the engine understands
(`constant`, `parameter-table`). The insurance example used a dozen
domain types (`insurance-terms`, `options-parameters`, …) with editor
hints inline (`viewer`, `as`, `disableWhen`). The author's vision wants
Markdown, massive data, cryptographic material "and a lot of things" as
resource types. Three of those have rules the handoff already wrote
(datasets by hash, fetched before evaluation, refused on mismatch) or
that must be written before the first document does it wrong (secrets in
an immutable, hashed, replicated document cannot be rotated away).

## Decision

### The registry

A resource type is declared by its owner with a JSON Schema for the entry
and a note on how the engine reads it:

| Type | Owner | `data` | Read by |
|---|---|---|---|
| `constant` | kernel | any JSON | `resource` |
| `list`, `options`, `references` | kernel | array (`options` items have `value`/`label`; `references` items have `id`) | `resource`, `find`/`findBy`, `for` |
| `parameter-table` | kernel | rows with `match` + outputs; `hitPolicy`, `default` | `lookup` |
| `markdown` | kernel | a Markdown string; front matter becomes sibling fields | `resource`; materializers render it through a `Markdown` base component |
| `dataset` | capability `dataset.fetch` | **absent**; entry carries `source` (URL or store id), `version`, `hash`, `format` (`json`, `csv`, `jsonl`), optional `index` (field to key by) | `resource`, `lookup` after the runtime fetched and verified it |
| `media` | capability `blob` | absent; entry carries `url`, `hash`, `mime`, `width`/`height`/`duration` | `Image`, `Video`, `Audio` base components |
| `secret` | capability `secrets` | **forbidden**; entry carries `ref` (a name in the runtime's secret store) and `surface: "server"` | `{ "secret": "name" }` operator, server surfaces only |
| `<vocab>.<type>` | a capability or distribution | per its schema | its operators and components |

An unknown type is a warning today (`UNKNOWN_RESOURCE_TYPE`) and becomes
a refusal when the declaring capability is critical (ADR 0007). Editor
hints such as the insurance example's `viewer` are not resource fields;
they belong to the editor's own vocabulary and are preserved as unknown
fields, never interpreted by the engine.

### Datasets: the lifecycle rule, made concrete

- Inline when authored with the product and changing with the version;
  referenced when produced elsewhere with its own cycle (handoff 4.2).
  `validate` warns above 256 KB inline (`RESOURCE_LARGE`) and refuses
  above 4 MB (`RESOURCE_TOO_LARGE`): a document must stay editable,
  diffable and hashable in an editor and an agent context.
- A `dataset` entry is `{ "type": "dataset", "source": "…", "version": "2026-08", "hash": "sha256:…", "format": "csv" }`.
  The runtime fetches it **before** evaluation, verifies the hash, and
  refuses to evaluate on mismatch or failure (`DATASET_MISMATCH`,
  `DATASET_UNAVAILABLE`). Never a partial evaluation. Fetching by a
  mutable pointer is not expressible.
- `refs()` includes datasets; a projection lists them without inlining;
  an offline profile pre-fetches them.
- Source form (ADR 0019): `.dataset.json` is the reference; the data
  itself never enters the tree.

### Markdown

`{ "type": "markdown", "data": "# Terms\n…" }`, in source form a `.md`
file whose front matter yields `name`, `description` and any sibling
fields. Rendering is a materializer's job through a `Markdown` base
component (added to `vocab.base` with this ADR): the abstract tree
carries the Markdown string, not HTML, so the tree fixture stays
target-free and no HTML is ever authored in a document.

### Secrets: references, never values

- A document may **name** a secret and may never **contain** one. The
  `secret` type has no `data`; `{ "secret": "stripe-key" }` resolves on
  server surfaces through the `secrets` capability and is an error on
  any other surface (`SECRET_ON_CLIENT`). Projections for non-server
  audiences drop `secret` entries entirely.
- `validate` scans every string in a document with the usual heuristics
  (key prefixes, high-entropy tokens, PEM headers) and refuses on a hit
  (`SECRET_INLINE`); a false positive is silenced per entry with
  `"allowSecretLike": true`, which is itself visible in review.
- Reason, stated in the error text: versions are immutable and
  replicated; a leaked value cannot be rotated out of history.

### Cryptography is a capability, not a resource

Signing, verifying, encrypting and hashing are actions of a `crypto`
capability (`sign`, `verify`, `encrypt`, `decrypt`, `digest`) whose keys
are secret references. Fixtures use published test vectors. Nothing
cryptographic is evaluated by the kernel; `digest` of canonical JSON is
the one exception and is defined in ADR 0013.

## Alternatives considered

- **Free `type` forever.** Fine for humans, useless for a second runtime
  and for the editor's schema; the registry costs one table.
- **Encrypted inline secrets.** Key distribution and rotation problems,
  and the ciphertext still lives in history. References only.
- **Markdown rendered to HTML at build.** Puts HTML in the tree, which
  no non-web materializer can use and which breaks the no-authored-HTML
  rule.

## Fixtures required

- Each kernel type: schema validation positive and negative.
- Dataset: fetch, hash match, hash mismatch → refusal, unavailable →
  refusal, projection listing without inlining.
- Secrets: `secret` entry with `data` → refused; `{ "secret": … }` on a
  client template → refused; inline key-looking string → refused;
  `allowSecretLike` → accepted.
- Markdown resource → tree with the `Markdown` node carrying the string.

## Consequences

- `types.ts` and the validator gain the registry; three new capabilities
  are named (`dataset.fetch`, `blob`, `secrets`, `crypto`) with interfaces
  to write.
- The health quote's `plans` and `statuses` become `references`, `settings`
  stays `constant`; nothing else changes.
- The first document with a CEP table or a terms page has its rules
  before it is written.

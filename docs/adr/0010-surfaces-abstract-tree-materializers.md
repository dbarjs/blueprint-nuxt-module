# ADR 0010 — Surfaces: one abstract tree, one base vocabulary, a materializer per target

Status: proposed (2026-09-10). Layer: kernel (tree, base vocabulary),
runtime (materializers, other vocabularies).

## Context

Template evaluation already produces a framework-free abstract tree, and
the Vue materializer is one recursive function over it. The restaurant's
`channel:kitchen-ticket` is the handoff's suggested first proof of the
mechanism: a ticket that a printer, not a browser, will render. It is
written in the base vocabulary only (`Stack`, `Text`, `Separator`, `for`),
which turns out to be the important observation: **the base vocabulary is
already printable**. A thermal printer materializer needs no new node
types, only a mapping from tokens (`weight: bold`, `align: center`,
`direction: row`, `justify: between`) to ESC/POS.

Two things stop this from being a spec today: the base vocabulary is a
list of names in `registry.ts` without contracts as data, and scoped slots
(tables with custom cells) cannot be expressed because the tree is
evaluated before a slot receives its scope.

## Decision

### The abstract tree is the normative artifact **[P]**, unchanged

```jsonc
{ "kind": "component" | "html" | "text" | "unavailable" | "slot",
  "key": "page:index.0[abc]",
  "as": "Text", "props": { … }, "text": "…",
  "children": [ … ], "slots": { "header": [ … ] },
  "model": { "path": "applicant.name", "prop": "modelValue" },
  "on": { "click": { "actions": …, "vars": { … } } } }
```

Two kinds are added: `unavailable` (ADR 0007, optional capability absent)
and `slot` (below). Keys are stable across re-evaluation with the same
state; loop keys come from `for.key`. Fixtures compare trees bit-exactly
after canonicalization (ADR 0013).

### `vocab.base` is kernel data, versioned with the spec

The base vocabulary becomes a file of the spec, not a constant of this
runtime: for each component, a contract as data:

```jsonc
{ "name": "Text",
  "props": { "type": "object", "properties": {
      "size":   { "enum": ["xs","sm","md","lg","xl","2xl"] },
      "weight": { "enum": ["normal","medium","semibold","bold"] },
      "align":  { "enum": ["start","center","end"] },
      "color":  { "enum": ["default","muted","primary","success","warning","error"] },
      "tabular": { "type": "boolean" } } },
  "content": "text",                      // default slot accepts text
  "slots": [], "events": [], "model": null }
```

Every prop is a token or a scalar; no class names, no CSS, no framework
type. A materializer may render a token any way it likes, but must render
every token (a `Text` with `weight: bold` must be visibly bold on a
printer). The Nuxt UI mapping (`Field` → `UFormField`, `Select` →
`USelectMenu`, …) is this runtime's business.

The set of names today (`Text`, `Heading`, `Stack`, `Grid`, `Image`,
`Spacer`, `Group`, `Container`, `Button`, `Link`, `Badge`, `Chip`, `Icon`,
`Avatar`, `Separator`, `Alert`, `Empty`, `Form`, `Field`, `Input`,
`Textarea`, `NumberInput`, `Select`, `Checkbox`, `CheckboxGroup`,
`RadioGroup`, `Switch`, `Modal`, `Drawer`, `Table`, `Tabs`, `Accordion`,
`Progress`, `Skeleton`, `Kbd`, `Tooltip`, `Header`, `Main`, `Footer`,
`Section`, `Hero`) is the 0.1 draft. It is deliberately larger than
JSON Forms' and smaller than a design system. Names with no use in the
four documents by the second runtime are cut (subtraction rule).

### Surfaces and channels

A **surface** is where a materializer runs: `client` (browser), `server`
(HTTP), `print`, `email`, `messaging`, `build` (prerender). Templates are
named by what they are for:

- `page:*` — routed; needs `web.pages`; materialized on `client` and `build`.
- `component:*` — included by other templates; no surface of its own.
- `channel:*` — evaluated on demand with caller-supplied variables (`with`),
  never routed. The caller is a capability provider: a `print.escpos`
  provider renders `channel:kitchen-ticket` with `{ order }`; an `email`
  provider renders `channel:order-confirmation-email`; a `messaging.whatsapp`
  provider maps the tree onto an approved template with numbered parameters.

Each non-web materializer is itself a capability (`materialize.escpos@1`,
`materialize.email-html@1`), so a document that references a channel and a
runtime that can render it are matched by ADR 0009.

### Materializer conformance is two-tier

- **Tree fixtures** are normative and live in the corpus: template + state
  → tree. They reference only `vocab.base`.
- **Materialized output** (HTML, ESC/POS bytes, e-mail text) is a snapshot
  test in the runtime's own repository, never in the spec: HTML golden files
  are brittle and target-specific.

### Scoped slots: deferred subtrees **[P]**

A slot that receives a scope from its component (a table cell receiving its
row) is evaluated **later, by the same pure function**. The template writes:

```jsonc
{ "type": "component", "as": "Table", "bind": { "rows": { "def": "cartLines" } },
  "slots": { "cell:total": { "scope": "row", "children": [
    { "type": "component", "as": "Text", "bind": { "content": { "format": [{ "var": "row.total" }, "currency"] } } } ] } } }
```

and the tree carries `{ "kind": "slot", "scope": "row", "nodes": <the unevaluated children>, "vars": <captured> }`.
The materializer, when the component hands it a scope value, calls
`evaluateNodes` with `vars.row` set and materializes the result. Evaluation
stays pure and testable (fixture: tree with the deferred slot; second
fixture: the slot evaluated with a given `row`). The restaurant did not
need this; the first table with custom cells will.

### Escape hatches stay visible

`html` nodes and raw `class` props remain legal and remain `NON_PORTABLE`
warnings, counted in the version manifest. A document with escapes is L3
whatever else it does.

## Alternatives considered

- **Separate print notation** (Revision 1: "lines, alignment, bold, QR,
  cut"). The kitchen ticket showed the base vocabulary covers it; a second
  notation would be a dialect. QR and cut become base components (`Barcode`,
  `PageBreak`) if a printer materializer needs them, with tree fixtures.
- **Materializer-time evaluation of everything** (no abstract tree, each
  materializer walks the template). Loses the normative artifact and makes
  dialects inevitable (the XAML lesson in the handoff).
- **Slots as render functions in the document.** Not JSON, not testable,
  not what a business user can review.

## Fixtures required

- Tree fixtures for every base component with every token value once.
- `channel:kitchen-ticket` with the restaurant's sample order → tree.
- Deferred slot: tree with `slot` node; slot evaluated with a scope.
- `unavailable` node for an absent optional vocabulary.

## Consequences

- `registry.ts` is regenerated from the base vocabulary file instead of
  defining it; the `.vue` implementations of `Stack`, `Text`, `Grid` and
  friends stay where they are.
- The first non-web materializer (ESC/POS text, ADR 0017) is small enough
  to be the second runtime's proof that the tree is sufficient.
- `format` output inside trees depends on the numeric and locale rules of
  ADR 0012; tree fixtures with dates are marked locale-dependent there.

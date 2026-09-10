# ADR 0024 — Capability requests: `validate` emits what a runtime lacks, tooling files it as an issue

Status: proposed (2026-09-10). Layer: tooling, with a machine-readable
artifact defined by the spec.

## Context

The author's point: a non-developer edits through an agent, and when the
runtime cannot do what the document needs, the agent opens an issue
against the runtime asking for the feature. Under the capability model
that request is not free text. `validate` already knows, for a document
and a target runtime, exactly which capability is missing, at which
version, used where, and whether it is critical or optional (ADR 0009).
The request is that report with an owner and a title.

The important boundary: an agent may not invent a capability. It may
request an **existing interface** from a runtime that does not provide
it, or propose a **new interface** to the spec, and those are different
issues with different owners.

## Decision

### The capability request artifact

Emitted by `validate --target <runtime manifest>` for every incompatible
or degraded document:

```jsonc
{
  "kind": "capability-request",
  "document": { "id": "01J…", "name": "restaurant-menu-shop", "version": "sha256:…" },
  "runtime": { "name": "blueprint-headless", "version": "0.1.0" },
  "missing": [
    { "name": "web.pages", "range": "^1", "critical": true,
      "usedBy": ["templates.page:index", "templates.page:cart", "…"],
      "interface": "https://blueprint.dev/capabilities/web.pages/1" }
  ],
  "degraded": [
    { "name": "ui.toast", "range": "^1", "critical": false, "usedBy": ["actions.add-to-cart"] }
  ],
  "unknown": [
    { "name": "print.bluetooth", "reason": "no published interface" }
  ],
  "alternatives": [
    { "for": "web.pages", "suggestion": "serve the L1 pages from a web runtime and keep endpoints here (split deployment, ADR 0022)" }
  ]
}
```

- `missing` and `degraded` name published interfaces; the request goes
  to the **runtime's** tracker: "implement `web.pages@1`; fixtures at
  the interface URL".
- `unknown` names something no interface defines; the request goes to
  the **spec's** tracker as an interface proposal, with the document's
  need as the motivating case. A runtime may still implement it first
  as a vendor capability under its own namespace (`vercel.edge-config`),
  which keeps the document L3 until the interface is standardized.
- `alternatives` are computed from the manifests when a split
  deployment or a fallback (ADR 0026) would satisfy the document without
  any change to the runtime; the agent proposes those before filing.

### Filing is tooling, with a template

`blueprint request --file github` renders the artifact as an issue with
a fixed template (title `capability: <name>@<range> for <runtime>`, body
with the JSON in a details block, labels `capability-request`,
`critical`/`optional`), posts it with the user's credentials, and records
the issue URL in the library's `requests.json` so the same need is not
filed twice. Runtimes publish where requests go in their manifest
(`requests: { "url": "https://github.com/…/issues", "template": "…" }`).

### Governance

- A runtime team implements against the interface's fixtures and
  publishes a new manifest; the requesting library re-validates and the
  request closes automatically when the document becomes compatible.
- A spec proposal follows the RFC process: interface data, fixtures, two
  implementations before it leaves draft.
- Requests are data and are aggregated: "most requested missing
  capability across libraries" is how the minimum common runtime
  (ADR 0005) is revised by evidence.

## Alternatives considered

- **Free-text issues written by the agent.** Unverifiable, duplicated,
  and the runtime team has to rediscover which interface is meant.
- **Auto-implementing the capability in the library's app code.** That
  is the escape hatch of ADR 0018 (a registered component or a vendor
  capability) and remains available; the request exists so the escape
  hatch has a path back to portability.

## Fixtures required

- Request artifact for each of the four documents against the headless
  runtime's manifest (the report of ADR 0017 in JSON).
- Deduplication: same document and runtime twice → one request.

## Consequences

- `validate` gains `--target` and `--json`; the request artifact is the
  compatibility report with owners.
- The Blueprint organization needs a public place for interfaces (URLs
  in `interface`) before platforms can be pointed at it; until then
  interfaces live in the `spec` repository and the URL is a path there.

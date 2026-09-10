# ADR 0002 — Behavior model: `state`, closed actions, `model` bindings, page `enter`

Status: accepted (2026-09-10)

## Context

The handoff left the template behavior model open: where mutable state lives,
two-way binding semantics, validation timing, event → action, navigation.
The restaurant document forced a decision on the first day.

## Decision

- **State** is a document section (`content.state`) with the initial payload.
  The runtime holds one reactive copy per app, shared by all pages, persisted
  in the browser and discarded when the document version changes.
- **Two-way binding** is the `model` key on a component node: a state path
  bound to `modelValue` (or a named prop). Paths may interpolate loop
  variables (`lines.{index}.quantity`).
- **Events → actions**: `on: { click: … }` maps to a named action, an inline
  action or a sequence. Handlers capture the loop variables in scope.
- **Actions are a closed set** (`set`, `push`, `remove`, `update`,
  `increment`, `reset`, `navigate`, `toast`, `if`, `validate`, `submit`,
  `action`, `sequence`, `log`). Effects are injected by the host runtime.
- **Validation timing** is a prop of the form node (`validateOn`), executed
  by Nuxt UI's `UForm` through a Standard Schema adapter over the document
  validator. `submit` validates again before calling the endpoint; the server
  validates a third time with the same code.
- **Page lifecycle**: a page may declare `enter` actions, run when the page
  or its params change. This replaced Vue lifecycle hooks for draft
  initialization and route guards.

## Consequences

- A document can express an entire cart/checkout flow with no Vue code.
- The abstract tree stays serializable: handlers are `{ actions, vars }`.
- Process logic (state machines, payments) still belongs in code; the
  document parameterizes it through `submit` and its endpoint.

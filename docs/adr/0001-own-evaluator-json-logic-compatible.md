# ADR 0001 — Own evaluator, JSON Logic compatible, no runtime dependency

Status: accepted (2026-09-10)

## Context

The handoff keeps the JSON Logic based calculation notation that passed
homologation. The `json-logic-js` package is small but unmaintained, loosely
typed, and its corner cases (coercion, missing paths, division by zero) are
exactly the ones the spec must fix. The author asked for the semantics to be
reimplemented here rather than imported.

## Decision

`src/runtime/engine/logic.ts` is a self-contained evaluator. It accepts the
JSON Logic operator set with the same argument shapes (`var` with fallback,
`missing`, `missing_some`, `if`/`?:`, `map`/`filter`/`reduce` with
`current`/`accumulator`, `all`/`some`/`none`, `merge`, `in`, `cat`, `substr`
with negative indexes, `log`) and adds the Blueprint operators (`state`,
`def`, `resource`, `context`, `let`, `obj`, `lookup`, `format`,
`percentOf`, `round` with declared mode…).

Corner cases are decided, not inherited: non-finite numbers and division by
zero throw; `==` is loose only between scalars; rounding happens on the
shortest decimal representation; a bare `var` path falls back to the current
loop item.

## Consequences

- One evaluator runs at build time, on the server and in the browser.
- Compatibility is proven by `test/engine/logic.test.ts`, not assumed.
- Any operator added later is a spec decision with a fixture, not a library update.

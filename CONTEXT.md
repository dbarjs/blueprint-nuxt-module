# Domain context

Ubiquitous language for this repository. Terms come from the Blueprint
handoff documents (`docs/initial-context`) and from decisions taken while
building the restaurant example; ADRs live in `docs/adr/`.

## Glossary

- **Document** — one JSON file under `content/`; one complete application. Its file stem is the app **name** and URL prefix.
- **Section** — a top-level key of `content`: `meta`, `resources`, `schemas`, `definitions`, `state`, `actions`, `templates`, `tests`.
- **Resource** — data authored with the product (menu, zones, promo codes). A **parameter table** is a resource whose rows carry `match` conditions and a hit policy.
- **Definition** — a pure computed value over state and context, memoized per evaluation pass. Never a loop variable.
- **State** — the mutable payload under construction (cart, checkout form, UI flags). Initialized from `content.state`, persisted per app in the browser.
- **Context** — route params, query, app name, document version, busy flag. Read-only input to expressions.
- **Calculation notation** — the JSON Logic compatible expression language (`src/runtime/engine/logic.ts`).
- **Template** — a named tree of nodes: `page:*` (routed), `component:*` (included), `channel:*` (non-web materializations such as a kitchen ticket).
- **Abstract tree** — the normative output of template evaluation: loops expanded, conditions decided, bindings substituted, keys assigned. Framework-free JSON.
- **Materializer** — turns an abstract tree into a target; here `BlueprintTree` produces Vue vnodes.
- **Registry** — the generated map from component names to lazy Vue components, split into **base**, **Nuxt UI** and **app** layers. Documents using only the base layer are **portable**.
- **Action** — one of the closed set of things an event may do (`set`, `push`, `navigate`, `submit`…). **Effects** (navigation, toasts, network) are supplied by the runtime.
- **Enter actions** — actions a page runs when it is entered or its params change.
- **Version** — FNV-1a hash of the canonical document. Records **pin** it as `createdUnder`.
- **Record** — a submission stored by the server (an order), validated with the document's schema and pinned to a version.
- **refs()** — the static reference set of a section; basis for validation, cycle detection and closure.

## Avoided terms

- "Widget", "block" — use **node**.
- "Formula" — use **definition** or **expression**.
- "Store" — use **state**.

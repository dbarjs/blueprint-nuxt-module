# ADR 0003 — Register the Content collection through a generated layer

Status: accepted (2026-09-10)

## Context

Nuxt Content v3 loads collections only from `content.config.*` files found in
each Nuxt layer. The demo should stay shallow: `nuxt.config`, `package.json`,
`content/`. A module cannot register a collection through a public API.

## Decision

The module writes `content.config.mjs` into
`node_modules/.cache/blueprint-nuxt-module/layer/` (outside `.nuxt`, which
the CLI clears after modules run) and pushes that directory onto
`nuxt.options._layers` during setup, removing it on `modules:done`. Content,
installed as a module dependency right after this module, picks the
collection up. The collection is a `data` collection with `content` typed as
a passthrough object so it is stored as JSON.

If Content was installed first, the module warns and the consumer registers
the collection with `defineBlueprintCollection()` from
`blueprint-nuxt-module/content`.

## Consequences

- Consumers write documents only.
- The approach touches a private Nuxt option; it is isolated in one place
  and documented here so it can be replaced when Content exposes a hook.

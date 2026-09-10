# Pressures ledger

Every escape hatch or notation gap met while writing documents, with the
decision taken: **component** (behaviour, lives in code), **notation**
(composition, extended with a fixture), **pattern** (expressible already,
documented), or **open**. The entries below consolidate the sections
"Pressures recorded while writing…" of `docs/notation.md` and add what
surfaced while writing ADRs 0005–0018. New entries go at the top of their
document's list. Rule from ADR 0018: an agent may conclude "this belongs
in a component" and must write it here.

## Found while writing the ADRs (2026-09-10)

| Pressure | Decision | Where |
|---|---|---|
| `round` with `half-up` rounds negative halves toward +∞ (`round(-2.5) = -2`), inherited from `Math.round` | **notation**: `half-up` is away from zero; fixture pins `-2.5 → -3` | ADR 0012 |
| `meta.theme` carries Nuxt UI colour aliases: runtime configuration inside the document | **pattern**: reclassified as materializer tokens, non-normative; a second materializer ignores it | ADR 0006 |
| `visibility: "private"` on definitions is written by documents and read by nothing | **notation**: becomes `audience`, read by projection | ADR 0015 |
| `as` (handlers) versus `result` (browser) for keeping a capability result | **notation**: both legal on every surface with distinct meanings (variable vs state) | ADR 0008 |
| Named actions can call each other in a cycle; only a depth guard stops it | **notation**: `ACTION_CYCLE` at validation, same algorithm as definitions | ADR 0008 |
| No `spec` field in the envelope; `$schema` is doing two jobs | **notation**: `spec` required; `$schema` is tooling only | ADR 0006 |
| `collections` and `endpoints` sit beside kernel sections with no ownership rule | **notation**: section registry; sections owned by capabilities | ADR 0006 |
| `format` with an options object is read as an operator (`{ "decimals": 1 }`) | **notation**: a trailing plain object of scalars is options | ADR 0012 |
| Scoped slots (table cells) cannot be expressed because the tree is evaluated before scope exists | **notation** (proposed): deferred `slot` nodes evaluated later by the same pure function | ADR 0010 |
| The kitchen ticket needed no new vocabulary to be printable | **pattern**: the base vocabulary is the print vocabulary; tokens map to ESC/POS | ADR 0010 |
| `quotedUnder` is a domain name for the server-side pin | **pattern**: runtime also writes `acceptedUnder`; the domain field stays | ADR 0013 |
| Every endpoint is public | **open**: `identity` capability reserved, `access` field reserved | ADR 0007 |
| Version id is FNV-1a: a cache key acting as a legal pin | **notation**: SHA-256 for versions; FNV stays for caches | ADR 0013 |
| Definitions cannot take arguments; the quote staged the request under the browser's state path instead | **open**: parametrized definitions wait for a second document | ADR 0008 |

## Found while implementing the ADRs (2026-09-10, second pass)

| Pressure | Decision |
|---|---|
| `visibility: private` marks helper definitions the pages read; treating it as `audience: server` (ADR 0015's alias) broke every page of the restaurant and the quote at the projection check | **notation**: `visibility` has no semantics and is deprecated; `audience` is explicit or `public`; the field was removed from the documents |
| The effect log recorded the *unevaluated* action for server actions (`data` as an expression), useless for replay | **component**: extensions return `input` with evaluated fields (`data`, `ids`, `status`); the runner records scalar fields by default |
| A scenario needs a clock: `createdAt`, `context.now` and `acceptedAt` must agree and be reproducible | **pattern**: the runner fixes `now` at `2024-01-01T00:00:00.000Z` unless the caller injects one |
| Seeded records in an endpoint scenario are rejected by `patch` when they are not complete records | **pattern**: the runtime is right; fixtures seed complete records, and the schema failure message says which fields are missing |
| Which level is a document that only asks for `web.pages`? ADR 0009's L1 ("vocab.base templates") never occurs for pages | **notation**: L1 is for `component:*`/`channel:*`-only documents (a print-only ticket); every page needs `web.pages`, so pages start at L2. Levels are a summary, not an input |
| `runtime.storage: sqlite` makes a document L3 although it is `portable` | **notation**: level and status are orthogonal and both are printed; an option is runtime-specific by definition (ADR 0009) |
| The playground resolves the module through a jiti stub whose transform cache lives in `node_modules/.cache/jiti`; generated artifacts looked stale after engine changes | **tooling**: clear that cache when `.nuxt/blueprint/*` does not reflect `src/`; a note is in the memory of this repository |
| Two `bindResult` sites (`then` runs after binding) mean a `fetch` with both `as` and `result` is bound before `then` sees `response`; correct, but the order is a rule the spec must state | **open**: RFC 0012 (actions and effects) must fix "bind, then `then`" |

## Habit tracker (`content/habit-tracker.json`)

The first document whose core is calendar arithmetic and the first with no
server at all (L2 portable, `time.now` + `web.*` + `vocab.base`). Written
against `.scratch/blueprint-app-catalogue/issues/01-habit-tracker.md`.

| Pressure | Decision |
|---|---|
| `context.now` was promised by `time.now` on every surface (ADR 0007) but the browser never injected it; only handlers had a clock | **component**: the client runtime injects `now`, refreshed on route change and before every action run; one instant per evaluation pass, no tick between interactions (ticket 32). The contract's client `context` lists it |
| The notation has no date operators: `substr` on the ISO string gives the date, and turning `YYYY-MM-DD` into a day number (and back, for the grid and the streak walk) is Hinnant's civil-date algorithm written in `let`/`floor`/`%`. 1075 of the 1994 definition lines (54%) are that arithmetic; `todayDay` alone is 236 lines, the `calendar` window 525 | **open** → ticket 21: `dateAdd`, `dateDiff`, `dateTrunc`, `datePart`, `dateParse`, `format` with a pattern and a zone. The document is the fixture: rewritten with operators, the same tests must pass |
| Every date-derived value is computed once into a `calendar` window (91 entries) and everything else does `findBy` on it, because a definition cannot take the day as an argument | **pattern** that hides the missing parametrized definitions (ticket 25); a third document after the quote and the clinic will decide |
| Time zones: `now` is UTC, so "today" flips at midnight UTC, not the user's midnight. Unfixable in the document: nothing tells it the viewer's zone | **open** → ticket 21 must give `context.timeZone` and zone-taking operators; until then documents state the limitation in `meta.description` |
| A `validate` action that fails returned `ok: false` with no error code, so an action scenario could not `expect` it (the runner reported `EFFECT_FAILED: undefined`) | **component**: `validate` now fails with `VALIDATION_FAILED` and its issues, like `submit`; the scenario declares `"error": "VALIDATION_FAILED"` |
| Marks are a flat list `{ habitId, date }` instead of a keyed object because `set`/`remove` take literal paths and no action can address a computed key | **pattern**: lists with `push`/`remove where` are the Blueprint way for keyed user data; documented, no operator added |
| Ids for user-created rows: no randomness in the kernel (ticket 30), so ids are `"h" + nextId` with an `increment` | **pattern** for single-user state; a shared collection would use the record `id` the runtime mints |
| Persisted state is dropped whenever the document version changes (`useBlueprint` keeps state only while `saved.version === version`). For a server app that is a safety rule; for a local-first app every edit to the document wipes the user's habits | **open**: state needs its own pin and a migration rule (`state.createdUnder`, keep when the `state` section hash is unchanged); the first document where the rule hurts. Not ticketed on the catalogue map yet |
| SSR renders `now` on the server and the browser hydrates with its own instant; for a date-only display the two agree except at midnight | **pattern**: documented; the runtime could pass the server instant through to hydration, not done |
| The base `Progress` contract says `value`; Nuxt UI's `UProgress` reads `modelValue`, so a bound value never arrived and the bar animated as indeterminate | **component**: the Vue materializer maps `value` → `modelValue` for `Progress`; the contract keeps `value` (a second materializer has no `modelValue`) |
| The month grid needed the week start on or before the first of the month; with `weekStart` a user setting the arithmetic sits in one definition (`monthGridStart`) and the tree test asserts its date | **pattern** |
| A `for` over 42 cells with an `if`/`else` per cell (button or `Spacer`) inside a `Grid` of 7 columns: the grid keeps its shape only because the `else` renders something | **pattern**; a `Grid` that accepts an empty cell would be nicer, not needed |

## Health quote (`content/health-quote.json`)

| Pressure | Decision |
|---|---|
| Rating model expressed entirely as parameter tables (`first` for age bands, `collect` for factors multiplied through `reduce`) | **pattern**: no operator added; tables are data and the `rating` endpoint publishes them |
| The pricing formula wanted to live once: `planQuotes` (a `map` with `let`) and `monthly`/`annual`/`pricing` as projections of it | **pattern**: `let` earned its place |
| Same numbers on both surfaces without duplicating the pricing chain | **pattern**: staging (`set applicant ← body`); see the open point above |
| Version pinning became a business rule (`accept` refuses another version's quote) | **pattern**: the 409 mechanism built for `submit` is a domain rule in disguise |
| `format` options unreachable through `obj` | **notation**: see above |
| A chain of factors may land on a half; documents avoided asserting on such values | **notation**: order fixed left to right, `scale` proposed for exact rates (ADR 0012) |

## Public board (`content/public-board.json`)

| Pressure | Decision |
|---|---|
| One language for both sides: four endpoints shorter than the Nitro handler they replaced; eight new server action types, none a control structure | **notation**: accepted (ADR 0004) |
| `as` versus `result` | **notation**: see above |
| `additionalProperties: false` on a schema shared by input and collection rejects fields the handler adds | **pattern**: keep input and record schemas apart when they differ; the runtime is right to refuse |
| Fetched data in `state` collided with persistence and prerendering | **notation**: live state derived statically from `fetch.result`; no new keyword |
| Query strings are strings | **notation**: coerced with the declared schema |
| No access control | **notation** (proposed): `access` rules and `context.actor`, ADR 0027; refused here until an `identity` provider exists |

## Restaurant (`content/restaurant-menu-shop.json`)

| Pressure | Decision |
|---|---|
| Object literals need `obj` because any object is an operator | **notation**: accepted; the infix authoring form (ADR 0018) removes the cost for authors |
| `let` was necessary (product lookup repeated five times without it) | **notation**: core operator |
| One input per modifier group needed `model` paths with loop indexes (`"ui.draft.selections.{index}.option"`) | **notation**: interpolation accepted as the smallest thing that works; an object form would be safer; open |
| Page `enter` replaced Vue lifecycle hooks (draft initialization, checkout guard) | **notation**: `enter` is the router capability's event (ADR 0008) |
| Scoped slots not expressible | **notation** (proposed): deferred slots (ADR 0010) |
| Layout needed tokens (`gap`, `direction`, `surface`, `sticky`, `responsive`) | **notation**: tokens on `Stack`/`Grid`; no raw class in the whole app |
| Money as integer cents with `percentOf` half-up kept every test exact (`371.025 → 371`) | **pattern**: rule of ADR 0012 |

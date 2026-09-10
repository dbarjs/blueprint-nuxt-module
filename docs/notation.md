# Blueprint notation — as implemented by this module

This is the notation the engine in `src/runtime/engine` understands. It grew
out of the insurance case (see `docs/examples`) but is a fresh design: the
pieces marked **proposed** were introduced by this project to close the open
points of the handoff (behavior model, actions, state, page lifecycle,
parameter tables). Sections 1–8 are exercised by
`content/restaurant-menu-shop.json`; section 9 (the runtime: storage and
endpoints written in the document) by `content/public-board.json`; the
health insurance quotation (`content/health-quote.json`) prices on both
sides with the same definitions (sections 9 and 11).

## 1. Envelope

```jsonc
{
  "$schema": "../playground/.nuxt/blueprint/schema.json", // generated, gives IntelliSense
  "spec": "0.1",            // kernel version the document is written in (ADR 0006)
  "id": "01J…",             // optional ULID-like id
  "name": "my-app",         // URL prefix; defaults to the file stem
  "from": { "blueprintId": "…", "message": "…" }, // optional provenance
  "content": {
    "meta": {}, "resources": {}, "schemas": {},
    "definitions": {}, "state": {}, "actions": {}, "templates": {}, "tests": [],
    "runtime": {}, "collections": {}, "endpoints": {}, "profiles": {}
  }
}
```

`spec` is `major.minor`. The engine implements `>=0.1 <0.2` and refuses a
document outside that range (`UNSUPPORTED_SPEC`); a document without `spec`
is accepted with a warning until the first tagged spec. `version` is never
authored: it is `sha256:<hex>` of the canonical document (RFC 8785 key
order, no whitespace, `$schema` removed) and is what records pin (ADR 0013).

`meta` carries `title`, `description`, `icon`, `layout` (a template name
rendered around every page), `currency` and `locale` (used by `format`),
`theme` (Nuxt UI color aliases, applied with `updateAppConfig`) and `seo`.

## 2. Resources

Any JSON under `data`, with a free `type` for humans and tools. Two types have
engine semantics:

- `constant` — read with `{ "resource": ["settings", "taxRate"] }`.
- `parameter-table` (**proposed**) — rows with a `match` object, consumed by
  the `lookup` operator with a declared `hitPolicy` (`first`, `unique`,
  `collect`, `last`) and an optional `default`. No match and no default is an
  error, never a silent `null`.

```jsonc
"delivery-zones": {
  "type": "parameter-table", "hitPolicy": "first",
  "default": { "deliverable": false, "fee": 0 },
  "data": [
    { "match": { "postalCode": { "prefix": "941" } }, "fee": 399, "minutes": 25, "deliverable": true }
  ]
}
```

Match conditions per field: an exact value, a list of values, or a bound
object with `eq`, `in`, `prefix`, `gte`, `gt`, `lte`, `lt`. Bounds are
explicit so overlapping ranges are visible.

## 3. Calculation notation

JSON Logic compatible: a literal, an array (evaluated element-wise), or an
object with exactly one operator key. Object literals are written with `obj`
because a bare object is always an operator.

Data access:

| Expression | Reads |
|---|---|
| `{ "state": "cart.lines" }` | mutable state path (`value` is accepted as an alias) |
| `{ "def": "subtotal" }` | a definition, memoized per evaluation pass, cycles rejected |
| `{ "resource": "products" }` / `{ "resource": ["settings", "taxRate"] }` | resource data, optionally a path inside it |
| `{ "context": "params.id" }` | route params, query, `app`, `version`, `base`, `path`, `page`, `busy`, `now` (one instant per evaluation pass, refreshed on navigation and before every action run) |
| `{ "var": "item.price" }` | loop or action variable; a bare path falls back to the current item |
| `{ "meta": "description" }` | document meta |

Operators (beyond JSON Logic's `if`, `?:`, `==`, `===`, `!=`, `!==`, `!`,
`!!`, `and`, `or`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, `%`, `min`,
`max`, `map`, `filter`, `reduce`, `all`, `some`, `none`, `merge`, `in`,
`cat`, `substr`, `missing`, `missing_some`, `log`):

- Control: `let` (`[{ name: expr }, body]`, **proposed**), `coalesce`,
  `between`, `isEmpty`.
- Numbers: `round` (decimal-representation rounding, `half-up` default =
  away from zero so `round(-2.5)` is `-3`; also `half-even`, `half-down`,
  `floor`, `ceil`, `trunc`), `scale` (`[value, numerator, denominator, mode?]`
  → integer, so cents × factors never leave the integer domain), `abs`,
  `floor`, `ceil`, `clamp`, `percentOf` (integer cents, half-up). Division by
  zero and non-numeric
  arithmetic throw.
- Strings: `join`, `split`, `upper`, `lower`, `trim`, `startsWith`, `regex`,
  `length`, `plural`, `format` (`currency` on cents, `number`, `integer`,
  `percent`, `minutes`, `date`, `time`, `datetime`).
- Collections: `find`, `findBy`, `filterBy`, `every`, `sum` (with a path or
  expression), `count`, `pluck`, `sort`, `groupBy`, `get`, `first`, `last`,
  `slice`, `unique`, `concat`, `keys`, `values`, `range`, `obj`, `assign`,
  `typeof`.
- Loops accept an optional alias as the third argument
  (`{ "map": [items, body, "product"] }`); the body also sees `index`.
  `reduce` exposes `current` and `accumulator`.
- Tables: `lookup` (`[table, criteria, { policy?, default? }]`).

Every reference is static: `def`, `resource`, `lookup`, `schema` and `state`
must receive a literal name. A computed name fails validation
(`DYNAMIC_REFERENCE`).

## 4. Schemas

A JSON Schema subset: `type`, `properties`, `required`, `items`, `enum`,
`const`, `minimum`/`maximum` (and exclusive), `multipleOf`, `minLength`,
`maxLength`, `pattern`, `format` (`email`, `phone`, `postal-code`, `date`,
`time`, `card-number`, `card-expiry`, `card-cvc`), `minItems`, `maxItems`,
`additionalProperties`, `$ref: "#/schemas/<name>"`. Two extensions
(**proposed**): `message` (human text for any failure of that node) and
`requiredWhen` (a calculation expression; the form field becomes required
only when it is truthy, e.g. address fields when the order is a delivery).

The same validator runs in build-time tests, in the `validate` and `submit`
actions, inside `UForm` through a Standard Schema adapter, and on the server
before a record is stored.

## 5. State, definitions and tests

`state` is the initial payload under construction. Definitions are pure
functions of state and context. Tests fix the contract:

```jsonc
{ "name": "pickup order", "state": { "cart": { "lines": [ … ] } }, "context": { "params": {} },
  "expect": { "subtotal": 4850, "tax": 412, "total": 5747 } }
```

Expected values are compared deeply and exactly. Tests run at build time,
in `pnpm test`, and on every change in dev. This is the **definition test**,
one of four forms; the others (tree, action scenario, endpoint scenario) are
in section 13.

A definition or resource may carry `audience` (`public` by default, or a
surface: `client`, `server`, `print`). It decides where the entry may
travel (section 14). `visibility` is deprecated and has no semantics.

## 6. Templates

Templates are named `page:<slug>`, `component:<slug>` or `channel:<slug>`.
Pages are objects with `route`, `title`, `description`, `layout` (or `false`),
`enter` (**proposed**: actions run when the page or its params change) and
`children`. Components and channels are arrays of nodes.

Node types:

```jsonc
{ "type": "component", "as": "Button", "props": { "size": "sm" },
  "bind": { "label": { "var": "product.name" }, "disabled": { "!": { "def": "canCheckout" } } },
  "content": "static text or an expression",
  "children": [ … ], "slots": { "footer": [ … ] },
  "model": "checkout.customer.name",          // two-way binding, defaults to modelValue
  "on": { "click": "add-to-cart" },            // events → actions
  "if": { "def": "isDelivery" },              // conditional
  "for": { "in": { "resource": "categories" }, "as": "category", "key": "id" } }
{ "type": "text", "content": { "cat": ["Hello ", { "state": "name" }] } }
{ "type": "if", "condition": …, "children": [ … ], "else": [ … ] }
{ "type": "for", "in": …, "as": "line", "index": "i", "key": "id", "children": [ … ], "empty": [ … ] }
{ "type": "template", "name": "component:total-row", "with": { "label": "Tax", "value": { "def": "tax" } } }
{ "type": "outlet" }                          // where the page renders inside a layout
{ "type": "html", "as": "div" }               // escape hatch, reported as non-portable
```

- `bind.content` is the same as `content`, computed.
- `model` paths may interpolate loop variables:
  `"ui.draft.selections.{index}.option"` (**proposed**).
- Event handlers capture the loop variables in scope, so a named action can
  read `{ "var": "line.id" }` without being told which line it runs for.
- `key` on `for` is a path inside the item (`"id"`) or an expression.
- `to` props starting with `/` or `page:` are resolved inside the app prefix.
  `endpoint:<name>` links to a document endpoint; `external: true` leaves
  any other `to` untouched (a host route such as `/api/blueprint/contract`).
- A `Form`/`UForm` whose `schema` is a string gets the document schema as a
  Standard Schema, and whose `state` is a string gets that state subtree.

Evaluation produces an **abstract tree** (plain JSON: kinds, keys, props,
text, slots, model bindings, handlers with captured variables). The Vue
materializer is one recursive function over that tree.

### Vocabulary layers

- **Base** (portable): `Text`, `Heading`, `Stack`, `Grid`, `Image`, `Spacer`,
  `Group`, `Container`, `Button`, `Link`, `Badge`, `Chip`, `Icon`, `Avatar`,
  `Separator`, `Alert`, `Empty`, `Form`, `Field`, `Input`, `Textarea`,
  `NumberInput`, `Select`, `Checkbox`, `CheckboxGroup`, `RadioGroup`,
  `Switch`, `Modal`, `Drawer`, `Table`, `Tabs`, `Accordion`, `Progress`,
  `Skeleton`, `Kbd`, `Tooltip`, `Header`, `Main`, `Footer`, `Section`, `Hero`.
  Layout and typography are tokens (`gap`, `direction`, `surface`, `size`,
  `weight`, `color`…), never classes. See `src/runtime/engine/registry.ts`.
- **Nuxt UI** (Vue + Nuxt UI only): every `U*` component, auto-registered.
- **App**: components prefixed `Blueprint` in the consuming app.

The build report prints which layers a document uses and whether it is
portable. The restaurant document uses only the base layer.

## 7. Actions (**proposed**, closed set)

A handler is a named action, an inline action, or an array (a sequence).

| Type | Fields |
|---|---|
| `set` | `path`, `value` |
| `push` | `path`, `value` |
| `remove` | `path`, `where` (item predicate, sees `item`/`index`) or `index` |
| `update` | `path`, `where`, `set: { field: expr }` |
| `increment` | `path`, `by`, `min`, `max` |
| `reset` | optional `path` (back to the initial state) |
| `navigate` | `to` (`/cart` or `page:cart`), `params`, `query` |
| `toast` | `title`, `description`, `color`, `icon` |
| `if` | `condition`, `then`, `else` |
| `validate` | `schema`, `path`, `then`, `else` (else sees `issues`); a failed validation ends with `VALIDATION_FAILED` so scenarios can expect it |
| `submit` | `schema`, `path` or `body`, `endpoint` (name or URL), `params`, `query`, `as`, `result`, `then` (sees `response`), `catch` (sees `issues`/`error`/`failure`) |
| `fetch` | `endpoint` (name or URL), `params`, `query`, `body`, `as`, `result`, `then` (sees `response`), `catch` (sees `error`/`failure`) |
| `action` | `name`, `with: { var: expr }` (call a named action with arguments) |
| `sequence` | `steps` |
| `log` | `value` |

State machines and effects stay in code: the runtime supplies `navigate`,
`toast`, `submit` and `fetch` implementations; the document only
parameterizes them. `submit` without an endpoint goes to the built-in
`POST /api/blueprint/<app>/records`, which validates again, pins the record
to the document version and refuses stale versions. With the name of an
endpoint declared in the document (section 9) it calls that endpoint with
the declared method and adds `createdUnder` to the payload. `fetch` calls a
named endpoint and writes the response to `result`.

The `result` paths of `fetch`/`submit` are **live state**: the browser
never persists or restores them, and a page whose `enter` fetches is not
prerendered.

### Two kinds of action, one language (ADR 0008)

The first eleven rows are **transforms**: pure over `state` and `vars`,
owned by the kernel, legal on every surface. The rest are **capability
calls**: the runner hands them to a provider (the browser host, a server
action, a test stub) and gets a value or a failure back.

- Every capability call may say where its value goes: `as: "name"` binds
  a variable for the rest of the sequence, `result: "state.path"` writes
  state. Both are legal on every surface (`insert … "result": "created"`
  in a handler, `fetch … "as": "reply"` in the browser).
- Failures are values: `catch` sees `error` (a code), `failure`
  (`{ code, message, issues?, status? }`) and `issues`. A provider the
  runtime does not have answers `CAPABILITY_UNAVAILABLE` instead of
  throwing.
- Every call is appended to the run's **effect log**
  (`{ step, type, capability, input, result }`). Hosts may store it next to
  a record; scenarios (section 13) replay it as stubs and compare it.
- Named actions may not call each other in a cycle (`ACTION_CYCLE` at
  validation); the runtime depth guard of 32 stays as a belt.

## 9. The runtime: storage and endpoints (**proposed**)

A Blueprint **runtime** hosts documents. This module is one: Nuxt gives it a
build step, a server and a browser, so a document can own its whole app,
back end included. Three sections belong to the runtime:

```jsonc
"runtime": { "storage": "sqlite" },          // default backend for collections
"collections": {
  "posts": { "schema": "post", "storage": "sqlite" }   // storage optional
},
"endpoints": {
  "create-post": {
    "method": "POST",
    "path": "/posts",                        // mounted at /api/blueprint/<app>/posts
    "input": { "body": "post" },             // schemas checked first → 422
    "pinned": true,                          // createdUnder.version must match → 409
    "handler": [
      { "type": "insert", "collection": "posts",
        "data": { "obj": { "text": { "trim": [{ "state": "body.text" }] }, "postedUnder": { "context": "version" } } },
        "as": "post" },
      { "type": "respond", "status": 201, "body": { "var": "post" } }
    ]
  }
}
```

A **handler is the same action language** with a different set of injected
effects. `state` is the request (`body`, `query`, `params`); `context`
carries `app`, `version`, `method`, `path`, `endpoint`, `now`, `params`,
`query`, `createdUnder`. Query strings are coerced with the declared schema
(`"10"` → `10` for an `integer` property). Data actions put their result in
a variable (`as`) for the next steps:

| Server action | Fields |
|---|---|
| `insert` | `collection`, `data` (validated with the collection schema), `as` → the record (`id`, `createdAt` added) |
| `find` | `collection`, `where` (item predicate), `sort` (`{ "createdAt": "desc" }`), `limit`, `offset`, `as` → records |
| `findOne` | `collection`, `id` or `where`, `as` → record or `null` |
| `count` | `collection`, `where`, `as` → number |
| `patch` | `collection`, `id` or `where`, `set: { field: expr }` (`updatedAt` added, re-validated), `as` → records |
| `delete` | `collection`, `id` or `where`, `as` → number removed |
| `respond` | `status` (200), `body`, `headers` — ends the handler |
| `fail` | `status` (400), `message`, `issues` — ends the handler with an error |

Shared actions (`set`, `if`, `validate`, `action`, `sequence`, `log`…) work
on both sides; `navigate`, `toast`, `fetch`, `submit` are browser-only and
the validator rejects them in handlers, as it rejects server actions in
templates. A handler that never responds answers `204` (warned at build).

**Records are flat**: the validated data plus `id`, `createdAt` and
`updatedAt`. Predicates, sorting and paging are evaluated in the notation,
so a storage backend only lists, gets, puts and deletes.

### Staging: one set of definitions for both sides

Definitions read `state`, and `state` is different on each side: the payload
under construction in the browser, the request (`body`, `query`, `params`)
in a handler. A handler that needs the same numbers the page showed does
not rewrite them; it **stages** the request under the path the browser
uses and reads the definitions:

```jsonc
"handler": [
  { "type": "set", "path": "applicant", "value": { "state": "body" } },  // same shape as content.state.applicant
  { "type": "if", "condition": { "!": [{ "def": "eligible" }] },
    "then": { "type": "fail", "status": 422, "message": { "def": "eligibilityMessage" } } },
  { "type": "insert", "collection": "quotes",
    "data": { "obj": { "applicant": { "state": "applicant" }, "pricing": { "def": "pricing" }, "quotedUnder": { "context": "version" } } },
    "as": "quote" },
  { "type": "respond", "status": 201, "body": { "var": "quote" } }
]
```

The browser shows the price live, the server prices again before storing
anything, and the stored pricing is the server's word. The test suite
asserts both are equal for the same applicant.

### The contract

A runtime hosts both halves of a document: the templates the browser draws
and the endpoints the server runs. What it offers on each side is published
as a **contract**, one object with two halves. Since ADR 0009 the same
route (`GET /api/blueprint/contract`) answers with the **runtime manifest**
(section 12) by default; `?format=contract` returns this older view and
`?format=schema` the JSON Schema of what the runtime owns:

```jsonc
{
  "runtime": "blueprint-nuxt-module",
  "version": "1.0.0",
  "actions": { "shared": ["set", "..."], "client": ["navigate", "..."], "server": ["insert", "..."] },
  "client": {
    "prefix": "",                              // pages live at <prefix>/<app>/<route>
    "components": { "base": ["Text", "..."], "nuxtUi": ["UButton", "..."], "app": [] },
    "nodeTypes": ["component", "html", "text", "if", "for", "template", "outlet"],
    "context": ["app", "version", "base", "path", "params", "query", "page", "busy"],
    "state": { "persistence": "localStorage", "description": "..." }
  },
  "server": {
    "mount": "/api/blueprint",                 // endpoints live at <mount>/<app>/<path>
    "storages": [{ "name": "sqlite", "durable": true, "description": "..." }],
    "defaultStorage": "fs",
    "request": { "state": ["body", "query", "params"], "context": ["app", "version", "now", "..."] },
    "recordFields": ["id", "createdAt", "updatedAt"],
    "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"]
  }
}
```

The `client` half is what a template may draw and read: the component
layers the host scanned (the base vocabulary, Nuxt UI, and the app's own
components), the node types, the browser context, and how state survives
between visits. The `server` half is what a handler may store, read and
answer. Actions sit above both because they span the two sides.

The engine knows the static part. The module resolves the **effective**
contract of the host it runs in — its page prefix, its configured default
storage, its component registry — and publishes that one:

- `.nuxt/blueprint/runtime.schema.json`, the JSON Schema of the sections the
  runtime owns plus `$defs.component` and `$defs.nodeType`, referenced from
  the document schema so `$schema` keeps working in the editor;
- `GET /api/blueprint/contract` (`?format=schema` for the schema);
- `manifest.json#runtime` for agents.

Build-time validation checks the document against it: unknown component,
unknown storage, unknown collection or endpoint, duplicate `method + path`,
actions on the wrong side, and every static reference. Another runtime
replaces the contract, not the notation.

## 12. Capabilities, manifests and compatibility (**implemented**, ADR 0007, 0009)

A document never names a runtime. `validate` derives what it **requires**
from its references (a `page:*` template → `web.pages`; `navigate` or
`context.params` → `web.router`; `fetch`/`submit` → `http.client`;
`endpoints` → `http.endpoints`; `collections` → `storage.collections`;
`context.now` → `time.now`; a base component → `vocab.base`; a `U*`
component → `vocab.nuxt-ui` pinned to the registry hash; `access` or
`context.actor` → `identity`). `toast` is optional by default. The
document may pin ranges or promote an optional capability in
`content.runtime`:

```jsonc
"runtime": { "requires": { "ui.toast": "^1" }, "optional": { "time.now": "^1" }, "storage": "sqlite" }
```

Authored entries add; they never remove a derived requirement.

The runtime publishes a **runtime manifest** (`GET /api/blueprint/contract`,
`manifest.json#runtime`): `provides: [{ name, version, surface, options }]`,
its spec range and materializers. The build writes one **version manifest**
per document into `manifest.json#documents`: version id, section hashes,
`requires`, `optional`, `options`, portability level and status, pages,
endpoints, test counts. Compatibility is computed: critical absent →
`CAPABILITY_MISSING` (error), wrong version → `CAPABILITY_VERSION` (error,
even for optional ones), optional absent → `CAPABILITY_UNAVAILABLE`
(warning). The report prints one line per document:

```
portability: L2 portable (kernel + minimum common runtime) · requires http.client, vocab.base, web.pages …
spec 0.1 · compatible with this runtime
```

Levels: L0 kernel only, L1 + `vocab.base` templates, L2 + the minimum
common runtime (`web.*`, `http.*`, `storage.collections`, `time.now`,
`records.pinned`), L3 a runtime-specific vocabulary or option (`sqlite`).

## 13. Four test forms (**implemented**, ADR 0011)

A test is recognised by the keys it carries; every form has `name`,
optional `state` (merged over `content.state`), `context` and `error` (the
code a negative test must end with).

```jsonc
// 2. tree test: evaluate a template, compare the abstract tree
{ "name": "the breakdown names every risk row",
  "state": { "applicant": { "age": 40, "smoker": true } },
  "render": { "template": "component:price-breakdown", "with": { "pricing": { "def": "pricing" } } },
  "contains": [{ "as": "Text", "text": "Smoker" }] }      // or "tree": [ … ] for an exact, canonical tree

// 3. action scenario: run actions against stubbed capabilities
{ "name": "publishing clears the draft, toasts and reloads the board",
  "state": { "draft": { "text": "First!", "nickname": "ada" } },
  "run": "publish",
  "stubs": { "http.client": [ { "match": { "type": "submit" }, "result": { "ok": true, "value": { "id": "p1" } } },
                              { "match": { "type": "fetch" }, "result": { "ok": true, "value": { "items": [], "total": 1 } } } ],
             "ui.toast": [ { "result": { "ok": true } } ] },
  "after": { "state": { "draft": { "text": "" } },
             "effects": [ { "capability": "http.client", "type": "submit", "endpoint": "create-post" },
                          { "capability": "ui.toast", "type": "toast", "title": "Pinned to the board" },
                          { "capability": "http.client", "type": "fetch", "endpoint": "list-posts" } ],
             "expect": { "postCount": 1 } } }

// 4. endpoint scenario: a request in, a response out, records after
{ "name": "a stale quote cannot be accepted",
  "stubs": { "storage.collections": { "quotes": [ { "id": "q1", "status": "open", "quotedUnder": "sha256:v0", … } ] } },
  "context": { "version": "sha256:v1" },
  "request": { "endpoint": "accept-quote", "params": { "id": "q1" } },
  "response": { "status": 409 },
  "after": { "collections": { "quotes": [ { "id": "q1", "status": "open" } ] } } }
```

Rules: `expect` and `tree` are exact; `after.state`, `after.collections`,
`contains` and `response.body` are deep subsets (arrays by position and
length). A stub is consumed once (`"repeat": true` keeps it); an unstubbed
capability call fails the test with `UNSTUBBED_EFFECT`, so a scenario is
honest about its effects. `storage.collections` stubs are seeded records
(the runner adds `id` and `createdAt`); the clock is fixed at
`2024-01-01T00:00:00.000Z`. A runtime that lacks the capability a form
needs reports the test as **skipped**, never passed.

## 14. Audience, projection and profiles (**implemented**, ADR 0015)

```jsonc
"resources":   { "risk-factors": { "audience": "server", … } },
"definitions": { "riskFactor":   { "audience": "server", … } },
"profiles":    { "kitchen": { "select": ["channel:kitchen-ticket"], "audience": "print" } }
```

Endpoints and collections are `server` by construction; pages are checked
against `client`, channels against `print`. Projection is selection +
closure + audience, in that order: keep the entries the audience may
receive, close over references, and **fail** (`PROJECTION_DANGLING`) if
the closure needs an entry the audience filter removed. The validator runs
that check for every page, channel and profile at build time, so a public
page bound to a server table is rejected before it can leak. In a client
projection an endpoint keeps its signature and a handler that answers
501. `projectDocument(document, { select, audience })` is pure: same
input, same bytes, its own hash.

## 15. Fallbacks and portability (**implemented**, ADR 0026)

```jsonc
{ "type": "component", "as": "UCalendar", "model": "applicant.birthDate",
  "fallback": [ { "type": "component", "as": "Input", "props": { "type": "date" }, "model": "applicant.birthDate" } ] }
```

A component outside the base vocabulary may carry a `fallback` written in
the base vocabulary. A runtime that cannot draw the component evaluates
the fallback in its place (`"via": "fallback"`, `"of": "UCalendar"` on the
resulting nodes); with no fallback the tree carries an `unavailable` node,
shown, never hidden. A non-base component without a fallback **locks**
the document to that vocabulary; `validate` names each locked node
(`LOCKED` warning) and the report prints `portable`, `degradable` or
`LOCKED`. A fallback that uses a non-base component is an error.

## 16. Access rules (**reserved**, ADR 0027)

```jsonc
"endpoints": { "my-quotes": { "method": "GET", "path": "/mine",
  "access": { "==": [{ "context": "actor.email" }, { "state": "query.email" }] }, "handler": [ … ] } }
```

`access` is a calculation over the request and `context.actor`, evaluated
after input validation and before the handler: falsy → 401 without an
actor, 403 with one. Reading `context.actor` or writing `access` requires
the `identity` capability, which this module does not provide yet, so
such a document is refused here with `CAPABILITY_MISSING`. The engine
already evaluates the rule (`runEndpoint({ actor })`), so a runtime with
an identity provider gets it for free.

## 10. Pressures recorded while writing the public board

- **One language for both sides was the right call.** The board's four
  endpoints took fewer lines than the Nitro handler they replace, and
  `validate`/`if`/`action` already existed. Only eight new action types were
  needed, and none of them is a control structure.
- **`as` versus `result`.** Server steps pass values through variables
  (`as`); browser actions write into state (`result`). Two idioms for "keep
  the answer", justified by the fact that a request has no state to keep,
  but worth a second look.
- **Collection schema strictness bites.** `additionalProperties: false` on
  a schema shared by the input and the collection rejects the fields the
  handler adds (`postedUnder`). The runtime is right to refuse; the pressure
  is on the author to keep input and record schemas apart when they differ.
- **Live state had to be named.** Fetched data in `state` collided with
  browser persistence and with prerendering. Deriving "live paths" from
  `fetch.result` statically solved both without a new keyword.
- **Query strings are strings.** Coercing with the declared schema keeps
  `{ "state": "query.limit" }` numeric without `toNumber` noise in documents.
- **No access control yet.** Every endpoint is public. The contract has a
  natural slot for it (an `access` field per endpoint) but no document has
  forced the decision.

## 11. Pressures recorded while writing the health quote

- **Parameter tables carried the whole rating model.** Age bands are a
  `first` table matched on bounds (`{ "age": { "gte": 26, "lte": 35 } }`),
  behavior factors a `collect` table where every matching row applies and
  the factors multiply through `reduce`. No operator was added; the tables
  are data, and the `rating` endpoint publishes them as such.
- **The formula wanted to live once.** Pricing every plan for the applicant
  (`planQuotes`, a `map` with a `let`) and then picking the chosen one kept
  the arithmetic in one place; `monthly`, `annual` and `pricing` are
  projections of it. `let` earned its place here.
- **Staging closes the two-sides gap.** Setting `applicant` from `body` in
  the handler let the server reuse `eligible`, `pricing` and the messages
  verbatim. The alternative was a copy of the pricing chain in server
  syntax. A parametrized definition (arguments instead of `state`) would
  make the trick unnecessary; not proposed yet, one document is not enough
  pressure.
- **Version pinning became a domain rule.** A quote records `quotedUnder`
  and `accept` refuses one priced under another document version: change a
  factor, and every open quote is stale by construction. The mechanism
  built for `submit` (409 on a stale pin) turned out to be a business rule
  in disguise.
- **`obj` options cannot reach `format`.** `{ "format": [x, "number", { "decimals": 1 }] }`
  reads the third argument as an operator object. Two decimals were fine
  for factors; a document that needs one would have to wrap options in
  `obj`. Worth documenting or fixing in the operator.
- **Half-way rounding is not portable.** `12900 × 0.85 × 0.9` lands on
  `9868.5` in exact arithmetic and on either side of it in floats. The
  document tests avoid asserting on such values; the minimum premium floor
  hides this one, but the pressure is real for money and belongs to the
  handoff's rounding rule.

## 12. Pressures recorded while writing the habit tracker

- **No server, and still a whole app.** `content/habit-tracker.json` is the
  first document that requires only `time.now`, `web.pages`, `web.router`,
  `web.state` and `vocab.base`: L2 portable, everything in browser state.
- **`context.now` reached the browser.** The capability promised it on every
  surface; only handlers had it. Now the client injects one instant per
  evaluation pass, refreshed on navigation and before each action run.
- **Dates by hand.** With no date operators, the date is `substr` of the ISO
  string and the day number comes from the civil-date algorithm written in
  `let`, `floor` and `%`; the reverse conversion builds a 91-day `calendar`
  once and every other definition looks days up in it. 54% of the
  definition lines are that arithmetic. It works, it is exact, and it is the
  argument for date operators (`docs/PRESSURES.md`, ticket 21 on the
  catalogue map).
- **Time zones are unresolved.** `now` is UTC; "today" flips at UTC
  midnight. The document says so in its description because nothing tells
  it the viewer's zone.
- **`validate` failures are named.** A scenario can now expect
  `VALIDATION_FAILED` from a refused form, as it can from `submit`.
- **Persisted state does not survive a document edit.** The runtime keeps
  browser state only while the document version is unchanged. Right for the
  board, wrong for a diary; the state section needs its own pin.

## 8. Pressures recorded while writing the restaurant document

- **Object literals need `obj`** because any object is an operator. Readable
  enough, but every card-building expression pays for it.
- **`let` was necessary.** Without it, the product lookup inside `cartLines`
  repeated five times. Proposed as a core operator.
- **Model paths with loop indexes** were the only way to bind one input per
  modifier group without a component per group. Interpolation is the
  smallest notation that works; a `bind`-like object form would be safer.
- **Page `enter` actions** replaced what would have been a lifecycle hook in
  Vue (initializing the product draft, guarding checkout). Explicit and
  testable, but it is a lifecycle concept the notation did not have.
- **Scoped slots are not expressible**: the abstract tree is evaluated before
  slots receive their scope. Nothing in the restaurant needed them; tables
  with custom cells would.
- **Layout needed tokens.** `Stack`/`Grid` with `gap`, `direction`, `surface`,
  `sticky`, `responsive` cover the whole app without one raw class.
- **Money as integer cents** with `percentOf` rounding half-up kept every
  test exact; the tax on a discounted subtotal was the only place rounding
  mattered (371.025 → 371).

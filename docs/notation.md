# Blueprint notation — as implemented by this module

This is the notation the engine in `src/runtime/engine` understands. It grew
out of the insurance case (see `docs/examples`) but is a fresh design: the
pieces marked **proposed** were introduced by this project to close the open
points of the handoff (behavior model, actions, state, page lifecycle,
parameter tables). Everything here is exercised by
`content/restaurant-menu-shop.json`.

## 1. Envelope

```jsonc
{
  "$schema": "../playground/.nuxt/blueprint/schema.json", // generated, gives IntelliSense
  "id": "01J…",             // optional ULID-like id
  "name": "my-app",         // URL prefix; defaults to the file stem
  "from": { "blueprintId": "…", "message": "…" }, // optional provenance
  "content": {
    "meta": {}, "resources": {}, "schemas": {},
    "definitions": {}, "state": {}, "actions": {}, "templates": {}, "tests": []
  }
}
```

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
| `{ "context": "params.id" }` | route params, query, `app`, `version`, `base`, `path`, `page`, `busy` |
| `{ "var": "item.price" }` | loop or action variable; a bare path falls back to the current item |
| `{ "meta": "description" }` | document meta |

Operators (beyond JSON Logic's `if`, `?:`, `==`, `===`, `!=`, `!==`, `!`,
`!!`, `and`, `or`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, `%`, `min`,
`max`, `map`, `filter`, `reduce`, `all`, `some`, `none`, `merge`, `in`,
`cat`, `substr`, `missing`, `missing_some`, `log`):

- Control: `let` (`[{ name: expr }, body]`, **proposed**), `coalesce`,
  `between`, `isEmpty`.
- Numbers: `round` (decimal-representation rounding, `half-up` default,
  `half-even`, `floor`, `ceil`), `abs`, `floor`, `ceil`, `clamp`,
  `percentOf` (integer cents, half-up). Division by zero and non-numeric
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
in `pnpm test`, and on every change in dev.

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
| `validate` | `schema`, `path`, `then`, `else` (else sees `issues`) |
| `submit` | `schema`, `path` or `body`, `endpoint`, `result`, `then` (sees `response`), `catch` (sees `issues`/`error`) |
| `action` | `name`, `with: { var: expr }` (call a named action with arguments) |
| `sequence` | `steps` |
| `log` | `value` |

State machines and effects stay in code: the runtime supplies `navigate`,
`toast` and `submit` implementations; the document only parameterizes them.
`submit` defaults to `POST /api/blueprint/<app>/records`, which validates
again, pins the record to the document version and refuses stale versions.

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

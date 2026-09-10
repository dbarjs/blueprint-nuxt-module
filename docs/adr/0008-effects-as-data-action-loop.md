# ADR 0008 — Effects as data: actions are capability calls, results come back as input

Status: proposed (2026-09-10). Layer: kernel. Extends ADR 0002 and 0004;
closes the handoff's open point number one (behaviour model and actions)
with a mechanism instead of a list.

## Context

ADR 0002 fixed a closed set of actions with effects injected by the host;
ADR 0004 reused the same action language on the server with a different set
of effects. Both work, and the health quote showed the price: the pieces of
"what happens when" are scattered across the browser runner, the Nitro
dispatcher, `ActionEffects`, `ActionExtension`, `as` for handlers and
`result` for browser actions.

The continuation document proposes the model that ties them together, the
Elm architecture: evaluation is pure; an action is data describing an
effect; the runtime executes it; whatever comes back enters the next
evaluation as input. With capabilities (ADR 0007), "the host" becomes "the
provider of the capability the action names", and the model applies to every
surface, including ones that do not exist yet.

## Decision

### Two kinds of action, one language

Every action type belongs to exactly one of:

| Kind | Types | Owner | Runs |
|---|---|---|---|
| **Transform** | `set`, `push`, `remove`, `update`, `increment`, `reset`, `if`, `validate`, `action`, `sequence`, `log` | kernel | anywhere, pure over `state` and `vars`; no effect leaves the evaluation |
| **Capability call** | `navigate`, `toast`, `fetch`, `submit`, `insert`, `find`, `findOne`, `count`, `patch`, `delete`, `respond`, `fail`, and any type a capability adds | the capability that declares it (ADR 0007) | where that capability's surface is |

The kernel specifies transforms completely, with fixtures. For capability
calls it specifies only the envelope: the action object, `then`/`catch`,
how the result enters the evaluation, and how failures are shaped.

### The loop

1. An **event** arrives with a handler and captured variables (the abstract
   tree already stores `{ actions, vars }` on nodes; the router delivers
   `enter`; `http.endpoints` delivers a request as an event whose handler is
   the endpoint's).
2. The runner executes actions in order. Transforms mutate `state` or
   `vars` in place. A capability call is handed to its provider with its
   evaluated input.
3. The provider returns a **result**: `{ ok: true, value }` or
   `{ ok: false, error: { code, message, issues? } }`. The runner writes the
   value where the action says (below), then runs `then` or `catch`.
4. Any step that is not `ok` or that **ends** the sequence (`respond`,
   `fail`, `navigate` on surfaces where navigation unmounts) stops the run.
5. The next evaluation (definitions, abstract tree) sees the new `state`.

Nothing else exists: no lifecycle hooks, no watchers, no computed side
effects. `enter` on a page is the router's event, not a lifecycle concept.

### Where results go: `result` and `as`, on every surface

The public board recorded the pressure "two idioms for keep the answer".
Resolved by allowing both everywhere, with distinct meanings:

- `as: "<name>"` binds the value to a **variable** visible to the rest of the
  sequence (`{ "var": "quote" }`). Scoped, gone after the run.
- `result: "<state path>"` writes the value into **state**. Persistent for
  the surface's state lifetime; on the browser these paths are *live state*
  (never persisted, never prerendered).

A capability call may declare both. Handlers may use `result` to stage
values under a state path (the health quote's `set applicant ← body`
becomes `{ "type": "findOne", …, "result": "applicant" }` when useful), and
browser actions may use `as` to avoid polluting state with a transient
response.

### Results are inputs of the reproduction tuple

The handoff's tuple is document pin + engine pin + inputs (including
external responses) + outputs. Under this model every capability result is
an external response. The runtime keeps an **effect log** per run:

```jsonc
[
  { "step": "actions.request-quote", "type": "submit", "capability": "http.client",
    "input": { "endpoint": "create-quote", "body": { … } },
    "result": { "ok": true, "value": { "id": "…", "pricing": { … } } } }
]
```

Two uses: a record may store the log next to its snapshot (forensics
without rebuilding a server), and a test may **replay** a log as stubs
(ADR 0011, action scenarios), so a whole checkout flow runs in the corpus
with no network and no storage.

### Failures are values, not exceptions

Every provider error is `{ code, message, issues?, status? }`. Codes are
part of the capability's interface. A handler's `catch` sees `error` (and
`issues` when present). Uncaught failures end the run with the error as its
outcome; the runtime decides how to surface it (toast, 500, log line). The
document never sees a stack trace.

### Termination

The action language has no loops. `action` calls are static references, so
cycles between named actions are rejected at validation (`ACTION_CYCLE`,
same algorithm as `DEFINITION_CYCLE`); the runtime depth guard of 32 stays
as a belt for `with`-parametrized recursion through data.

### Placement is a property of the capability, not of the action

`CLIENT_ACTION_IN_HANDLER` and `SERVER_ACTION_IN_TEMPLATE` keep their codes
but are computed from each action type's capability surface. A runtime
whose `http.endpoints` provider also exposes `ui.toast` (a desktop app
running its own server) makes `toast` legal in a handler without a change to
the kernel.

## Alternatives considered

- **State machines in the document** (XState-like `states`/`transitions`).
  The handoff keeps process in code; no document so far needed a machine
  the actions could not express. Revisit with the first order-status flow.
- **Open action set with arbitrary host functions** (`{ "call": "payments.charge" }`).
  This is what capability calls are, with the difference that the callee is
  a declared, versioned, fixture-backed interface, not a function name.
- **Effects returned by definitions** (Elm's `Cmd` from `update`). Would
  make definitions impure in appearance; keeping effects in actions keeps
  definitions the pure, memoized, testable thing they are.

## Fixtures required

- Every transform: state before, action, state after (already partly in
  `test/engine`; to become corpus fixtures).
- The envelope of a capability call with a stubbed provider: `then` path,
  `catch` path, `as` and `result` written, sequence stopped on failure.
- `ACTION_CYCLE` negative fixture.
- One replayed effect log: the restaurant checkout from empty cart to
  `page:order-confirmed`, with `submit` stubbed.

## Consequences

- The `ActionEffects` and `ActionExtension` interfaces in the engine merge
  into one provider interface keyed by capability; the Nuxt runtime supplies
  the browser and server providers. Behaviour of existing documents does not
  change.
- `as` becomes legal in browser actions and `result` in handlers.
- The effect log is new work: cheap on the server (one array per request),
  needs a decision on the browser about retention (proposal: last run only,
  exposed on `window.__blueprint` for agents, ADR 0018).
- Staging (health quote) remains a pattern, not a feature. Parametrized
  definitions stay open until a second document asks for them.

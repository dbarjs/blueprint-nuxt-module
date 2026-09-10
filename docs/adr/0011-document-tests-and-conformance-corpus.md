# ADR 0011 — Tests carried by the document are the seed of the conformance corpus

Status: proposed (2026-09-10). Layer: kernel (fixture forms and comparison
rules), tooling (authoring forms, corpus layout).

## Context

The insurance case discovered tests inside the document by use, not by
design, and the handoff makes them first-class in v1: "these inputs produce
these outputs" is the contract that survives an engine change. This
repository has 35 such tests over four documents, all of one form: state in,
definition values out, compared exactly. They run at build, in `pnpm test`
and on every edit.

Three things they cannot yet say: what a template renders (the abstract
tree), what an action does (state before, event, state after, effects
requested), and what an endpoint answers. Each of those is decided in
ADRs 0008 and 0010 and needs a fixture form, or the decision is prose.

The handoff also asks for a corpus separate from any engine
(`conformance/` hand-written from the text, `scenarios/` generated and
reviewed), with a uniform runner contract, and the continuation document
proposes a restricted Gherkin as the authoring form business people read.

## Decision

### Four test forms, one `tests` array

A test is recognised by the keys it carries. Every form has `name`,
optional `state` (merged over `content.state`) and optional `context`.

**1. Definition test** (exists, unchanged):

```jsonc
{ "name": "annual billing takes 8% off",
  "state": { "applicant": { "age": 30, "billing": "annual" } },
  "expect": { "monthly": 19710, "annual": 217598, "priceLabel": "$2,175.98 per year" } }
```

**2. Tree test** (new): evaluate a template, compare the tree.

```jsonc
{ "name": "the breakdown lists every risk row",
  "state": { "applicant": { "age": 40, "smoker": true } },
  "render": { "template": "component:price-breakdown", "with": { "pricing": { "def": "pricing" } } },
  "tree": [ … ]                                       // exact, canonical
  // or, for readability inside a document:
  "contains": [ { "as": "Text", "text": "Smoker" }, { "as": "Text", "text": "× 1.50" } ] }
```

`tree` is compared bit-exactly; `contains` lists nodes that must exist
anywhere in the tree with the given `as`, `text` and `props` subset. Corpus
fixtures always use `tree`; documents may use `contains`.

**3. Action scenario** (new): run actions with stubbed capabilities.

```jsonc
{ "name": "placing an order clears the cart and navigates",
  "state": { "cart": { "lines": [ { "id": "l1", "productId": "margherita", "quantity": 2 } ] }, "checkout": { … } },
  "run": [ "place-order" ],                            // named actions, inline actions, or { "event": "click", "key": "page:cart.0[l1].2" }
  "stubs": { "http.client": [ { "match": { "type": "submit" }, "result": { "ok": true, "value": { "id": "ORD1" } } } ] },
  "after": {
    "state": { "cart": { "lines": [] }, "lastOrder": { "id": "ORD1" } },      // deep subset
    "effects": [ { "capability": "web.router", "type": "navigate", "to": "page:order-confirmed", "params": { "id": "ORD1" } } ],
    "expect": { "cartIsEmpty": true } } }
```

Stubs answer capability calls in order of match; an unstubbed capability
call fails the test (`UNSTUBBED_EFFECT`), which keeps scenarios honest
about their effects. `after.effects` is the effect log of ADR 0008 with
results omitted, compared in order.

**4. Endpoint scenario** (new): a request in, a response out.

```jsonc
{ "name": "a stale quote cannot be accepted",
  "stubs": { "storage.collections": { "quotes": [ { "id": "q1", "status": "open", "quotedUnder": "v0", … } ] } },
  "context": { "version": "v1" },
  "request": { "endpoint": "accept-quote", "params": { "id": "q1" } },
  "response": { "status": 409 },
  "after": { "collections": { "quotes": [ { "id": "q1", "status": "open" } ] } } }
```

A runtime that lacks the capability a form needs reports the test as
**skipped**, never passed (ADR 0006).

### Comparison rules

- `expect` and `tree`: exact deep equality after canonicalization; numbers
  compared as canonical strings (ADR 0012).
- `after.state`, `after.collections`, `contains`, `response.body`: deep
  subset (every key in the expectation must be deep-equal in the actual;
  arrays compared by position and length).
- A test that throws is a failure with the error code, so `{ "error": "LOOKUP_NO_MATCH" }`
  is a legal expectation for negative tests.

### The corpus

```
spec/
  conformance/<area>/<case>/     doc.json  input.json  expected.json  meta.json
  scenarios/<document>/<case>/   same four files, generated from a document's tests, reviewed by a human
```

- `input.json` is one test object of the forms above minus `name`;
  `expected.json` is its `expect`/`tree`/`after`/`response`/`error` part;
  `meta.json` carries `section` (the spec clause), `origin`
  (`insurance`, `restaurant`, `board`, `quote`, `hypothetical`), `status`
  (`accepted`, `disputed`) and `capabilities` (which the runner must stub
  or provide).
- Runner contract: given `doc.json` and `input.json`, produce canonical
  JSON; compare with `expected.json`. Any engine can run it without
  importing this one.
- CI traceability: every MUST in the spec text names its fixtures; a MUST
  without a fixture and a fixture pointing at no clause both fail.
- The CLI exports document tests into `scenarios/` (`blueprint test --export`).
  The `contains` form is expanded to a full `tree` on export, so the corpus
  never depends on the subset matcher.

### Restricted Gherkin is an authoring form, never stored

```gherkin
Scenario: annual billing takes 8% off
  Given state applicant.age is 30
  And state applicant.billing is "annual"
  Then monthly is 19710
  And priceLabel is "$2,175.98 per year"

Scenario: a stale quote cannot be accepted
  Given collection quotes has [{ "id": "q1", "status": "open", "quotedUnder": "v0" }]
  And context version is "v1"
  When request accept-quote with params { "id": "q1" }
  Then response status is 409
```

The dialect has a closed step list, each mapping to one fixture field:
`Given state|context <path> is <json>`, `Given collection <name> has <json>`,
`When action <name> runs [with <json>]`, `When event <name> on <key>`,
`When <capability> answers <json>`, `When request <endpoint> [with …]`,
`Then <definition> is <json>`, `Then state <path> is <json>`,
`Then response status|body is <json>`, `Then the tree of <template> contains <json>`,
`Then it fails with <CODE>`. No free text steps, no step definitions in
code. The CLI compiles it to the JSON forms and `explain` prints a fixture
back as Gherkin. The document stores JSON only (ADR 0018).

## Alternatives considered

- **Keep one form and test behaviour in Vitest.** That is what
  `test/engine` does today and it is not portable: another engine cannot
  run it.
- **Full Cucumber with step definitions.** Steps in code are not data and
  do not travel; the handoff's caution about Gherkin being loved and hated
  is exactly this.
- **Snapshot-only trees** (no `contains`). Right for the corpus, unreadable
  inside a 60 KB document; both forms with export expansion.

## Consequences

- `tests.ts` grows from one form to four; the runner takes a stub table
  and an effect log. Stubs reuse the provider interface of ADR 0008.
- Each of the four documents gains at least one action scenario and, for
  the board and the quote, one endpoint scenario; the kitchen ticket gains
  a tree test.
- The corpus directories do not exist in this repository yet; they belong
  to the `spec` repository. Until it exists, `test/fixtures/` holds the
  exported scenarios so the shape is exercised.

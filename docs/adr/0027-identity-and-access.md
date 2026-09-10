# ADR 0027 — Identity and access: `context.actor`, `access` rules, and what stays out of the kernel

Status: proposed (2026-09-10). Layer: kernel (the `access` rule and the
shape of `context.actor`), runtime (the `identity` capability and its
providers), distribution (deployment bindings for providers).

## Context

The author flagged authentication as the next feature and as "a very
difficult point". It is difficult for three reasons that must be kept
apart, because they have different owners:

1. **Who is acting** (identity) is an external fact: a session cookie, a
   bearer token, an mTLS certificate, a kiosk badge, a signed URL. The
   document cannot verify any of them; it can only be told the answer.
2. **What they may do** (access) is a product rule: "an applicant sees
   only their own quotes", "only staff accept a quote", "the kitchen
   channel is visible on the kitchen printer only". That belongs to the
   document, or the document is not the whole product.
3. **How the runtime gets from 1 to 2** (sessions, providers, token
   lifetimes, refresh, logout, rate limits, audit) is engineering that
   changes per platform and per year, and must never be pinned in a
   product hash.

Every endpoint in the four documents is public today. The health quote
has already forced the first case: `find-quotes` filters by e-mail typed
by the user, which is a privacy hole the document could not close. ADR
0007 reserved `identity` so that no document invents its own; this
record fills the reservation without specifying the providers.

Prior art the decision leans on: the principal object of every web
framework (`request.user`, `event.context.auth`), OPA and Cedar (policy
as data evaluated over a principal, an action and a resource), Firebase
security rules (rules travel with the app, tokens do not), and row-level
security in Postgres (the rule is evaluated per record, in the store).

## Decision

### 1. The kernel gets one context key and one endpoint field

- `context.actor` is `null` (anonymous) or an object the identity
  provider produced. The kernel fixes only the outer shape:

  ```jsonc
  { "id": "…", "kind": "user" | "service" | "device", "roles": ["staff"], "claims": { … }, "via": "session" }
  ```

  `claims` is provider-specific and opaque to the kernel; `roles` and
  `kind` are the two things a rule most often needs.
- `endpoints.<name>.access` is a calculation expression evaluated after
  input validation and before the handler, with `state` = the request
  and `context.actor` set. Falsy → `401` when the actor is `null`,
  `403` otherwise. No rule → public, as today, and the validator does
  not warn (a warning would train authors to write `true`).
- Reading `context.actor` anywhere, or writing `access`, derives the
  `identity` requirement (ADR 0007). A runtime without an identity
  provider **refuses** the document (`CAPABILITY_MISSING`). Access is
  never optional: a document that degrades to "open" is worse than one
  that does not run.

This part is implemented in this module: `runEndpoint({ actor })`
evaluates the rule, the requirement is derived, and the runtime manifest
does not list `identity`, so a document with `access` is refused here
until a provider exists. The fixtures are in `test/engine/kernel.test.ts`.

### 2. Rules are data over the actor, the request and the records

`access` uses the calculation notation, nothing new. Three patterns
cover the documents so far:

```jsonc
// role gate
"access": { "in": ["staff", { "context": "actor.roles" }] }
// ownership by input
"access": { "==": [{ "context": "actor.claims.email" }, { "state": "query.email" }] }
// ownership by record: the rule is checked again per record the handler reads
"access": { "==": [{ "context": "actor.id" }, { "var": "record.ownerId" }] }
```

The third form needs the handler to expose the record; the proposal is a
`where` on data actions that the runtime **ands** with the access rule
of the collection (`collections.<name>.access`), the row-level-security
move. That is the next step, not this record: it needs a document that
forces it.

Templates use the same key: `"if": { "context": "actor" }` hides a
button; a page may carry `access` too, and the router answers with the
document's `page:unauthorized` when it exists. Client-side gating is
convenience; the endpoint rule is the guarantee.

### 3. The `identity` capability: interface, providers, bindings

```jsonc
{ "name": "identity", "version": "1.0.0", "surface": "any",
  "context": ["actor"],
  "actions": { "signIn": {}, "signOut": {} },          // browser side; the provider decides the flow
  "options": { "providers": ["session", "bearer", "oidc:…", "anonymous"] } }
```

- The interface says what the document sees (`context.actor`, the two
  actions) and what a provider must pass (the conformance fixtures: an
  anonymous request, a valid principal, an expired token, a wrong role).
- A provider is code in a runtime: cookie sessions in this module, a JWT
  verifier at the edge, an OIDC flow, an API key table. The document
  never names one.
- The **binding** (which provider, which issuer, which cookie name, which
  secret reference) lives in the deployment document (ADR 0022), pinned
  separately. Moving from Auth0 to Cognito changes the binding, not the
  product hash. Secrets follow ADR 0021: references only.

### 4. What stays out of the kernel, on purpose

Sessions, token formats, password storage, MFA, refresh, logout
semantics, rate limiting, audit trails, consent, and "remember me". These
are the identity provider's and the platform's. The kernel's only promise
is: the actor object is what the rule sees, the rule is evaluated where
the handler runs, and a runtime that cannot produce an actor does not run
the document.

### 5. Audience and access are different things

`audience` (ADR 0015) decides **where an entry may travel** (a server
table never reaches the browser). `access` decides **who may call an
endpoint**. A private rating table is protected by audience; a quote is
protected by access. Both are needed and neither replaces the other.

## Alternatives considered

- **Authentication inside the document** (a `users` collection with
  hashed passwords, a `login` endpoint written in the notation). Rejected:
  it makes the document responsible for the one thing it cannot verify,
  and pins a security design into a product hash.
- **A separate policy language** (Rego, Cedar) embedded as a resource.
  Deferred: the calculation notation already expresses the rules the
  documents need; a policy language would be a second notation to teach
  agents and to port. Revisit when a rule needs quantification over
  records.
- **Access as a per-runtime concern with no kernel field.** Rejected: the
  product rule would live in code, the exact thing the third artifact
  exists to prevent, and the health quote's privacy hole would stay
  invisible to `validate`.

## Conditions under which this is wrong

- A real document needs rules that the notation cannot express without
  loops or quantifiers (row-level filters across joins). Then the policy
  language alternative returns.
- Providers turn out to need document-level configuration (custom claim
  mapping per app) that does not fit a deployment binding. Then
  `runtime.options.identity` gains a schema.
- The 401/403 split is wrong for a surface (a printer, a kiosk). Then
  the interface gains a surface-specific failure mapping.

## Fixtures required

- `conformance/identity/anonymous`: `access` rule, `actor: null` → 401,
  handler not run, no effect logged.
- `conformance/identity/forbidden`: actor without the role → 403.
- `conformance/identity/allowed`: actor with the role → handler runs,
  response as written.
- `conformance/identity/derived`: a document with `access` requires
  `identity`; a runtime manifest without it → `CAPABILITY_MISSING`.
- `scenarios/health-quote/find-mine-needs-actor`: the existing e-mail
  filter rewritten as an ownership rule, with the 401 case.

The first four exist today as unit tests; the fifth waits for a provider.

## Consequences

- The health quote can state its privacy rule in the document as soon as
  any runtime provides `identity`; until then `validate` refuses it,
  which is the correct state for a rule nobody enforces.
- The first provider is the smallest that proves the interface: a
  cookie session with a fixed user table in the host config, enough for
  the fixtures and for a demo, never for production.
- Deployment documents (ADR 0022) gain an `identity` binding when the
  first provider ships.

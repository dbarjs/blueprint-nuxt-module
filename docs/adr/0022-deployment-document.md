# ADR 0022 — The deployment document: needs are product, bindings are deployment

Status: proposed (2026-09-10). Layer: kernel (a second document kind),
platforms (providers).

## Context

The author's vision: a document can define its runtime specification as
Terraform does, declaring the external resource types it uses (Firebase,
Supabase, AWS, Cloudflare and so on). ADR 0006 drew three homes for data
and put runtime configuration outside the document, because a provider
name inside the product would change the product's hash when the hosting
changes and would tie the document to one platform. Both are right, and
Terraform itself shows the split: configuration declares resources by
type, provider blocks bind them to accounts and regions, state is kept
apart.

The capability model already gives the app side of it. A document
requires `storage.collections` with durability, `secrets`, `blob`,
`http.endpoints`. What is missing is the artifact that says *which*
provider satisfies each on *this* deployment, and that a platform can
consume to provision.

## Decision

### Two kinds of document

`kind` joins the envelope (ADR 0006), default `app`. A **deployment
document** is:

```jsonc
{
  "spec": "0.1",
  "kind": "deployment",
  "id": "01J…DEPLOY",
  "name": "health-quote-production",
  "app": { "id": "01J9HEALTHQUOTE…", "pointer": "published" },   // or "version": "sha256:…" to freeze
  "runtime": { "name": "blueprint-nuxt-module", "range": "^1.0" },
  "environment": "production",
  "bindings": {
    "storage.collections": { "provider": "supabase", "backend": "postgres", "project": "abcd1234", "region": "sa-east-1" },
    "secrets":             { "provider": "vercel-env" },
    "blob":                { "provider": "cloudflare-r2", "bucket": "health-quote-media" },
    "identity":            { "provider": "supabase-auth" },
    "http.endpoints":      { "provider": "vercel", "regions": ["gru1"] },
    "dataset.fetch":       { "provider": "http", "mirror": "https://datasets.example.com/" }
  },
  "domains": ["quote.example.com"],
  "tests": [ { "name": "storage is durable", "expect": { "bindings.storage.collections.durable": true } } ]
}
```

- The app document keeps **needs**: capability requirements with the
  qualities that are product (`durable: true`, `retention: "7y"`,
  `region: "br"` as a legal constraint). It never names a provider.
  Today's `runtime.storage: "sqlite"` is a runtime-specific *preference*
  and stays L3; a deployment binding overrides it.
- The deployment document holds **bindings**: for each required
  capability, a provider and its options. It references the app by `id`
  plus pointer or frozen version, so one deployment can follow
  `published` while another freezes a version for an audit.
- Secrets appear only as provider references (`vercel-env`, a Vault
  path), never as values (ADR 0021 applies to both kinds).

### Providers publish manifests too

A **provider manifest** says which capability interfaces a provider
satisfies and with which options: Supabase → `storage.collections`
(durable), `identity`, `blob`; Cloudflare → `http.endpoints` (workers),
`blob` (R2), `storage.collections` (D1, durable). It is the same shape as
the `provides` list of a runtime manifest (ADR 0009). A platform's
runtime manifest is the union of its own capabilities and the providers
it can bind.

### Validation of a deployment

`blueprint validate --deploy <deployment>` checks: the app version
resolves; every `requires` of the app's version manifest has a binding
whose provider manifest satisfies the interface and version; every
quality the app demands (`durable`, `region`) is met by the binding;
optional capabilities without bindings are listed as degraded; no
binding names a capability the app does not require (warning,
`UNUSED_BINDING`). The output is the same compatibility report as
ADR 0009 with providers in the columns.

### Provisioning is tooling

A deployment document compiles to whatever a platform wants: Terraform or
Pulumi programs, a Vercel project configuration, a Nitro preset, a
docker-compose file for the headless runtime. The compilers are
platform-owned; the document is not Terraform and does not replace it,
it is the part of Terraform's input that comes from the product.

### Both documents are pinned

A deployment has versions and pointers like any document; a record may
carry `deployedUnder` next to `evaluatedBy` (ADR 0013) when the runtime
knows it, so that "which database held this record in 2027" has an
answer.

## Alternatives considered

- **Bindings inside the app document.** Changes the product hash on a
  hosting change and locks the document to a platform, the opposite of
  the vision's point 5.
- **No deployment document, only platform dashboards.** That is the
  state of the art, and it is where "which region was this in" goes
  unanswered.
- **Full Terraform in the document.** A second language, and a
  provider-specific one, inside a format whose point is to stay
  provider-neutral.

## Fixtures required

- App requiring `storage.collections { durable: true }` with a `memory`
  binding → incompatible; with `supabase` → compatible.
- Missing binding for a critical capability → incompatible; for an
  optional one → degraded.
- Pointer-following versus frozen `version`.

## Consequences

- The envelope gains `kind`; the validator gains `--deploy`; the module
  reads an optional `deployment.json` next to `content/` for local
  bindings (today's `blueprint.storage` and `dataDir` options are the
  first bindings).
- Provider manifests are a new artifact for platforms; two exist first
  (this module's built-in backends, and the headless runtime's), which
  is enough to test the shape.
- ADR 0006's "three homes" gains a fourth name for the second home:
  runtime configuration is now split into the runtime manifest (what the
  runtime is) and the deployment document (how it is bound).

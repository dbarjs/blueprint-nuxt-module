# Blueprint for the AI era — the vision, and the cold test

Written 2026-09-10 from the author's notes, the ones the continuation
document called `visao.md`. Section 1 is the vision as stated, in the
author's terms **[A]**. Section 2 submits every point to the same test as
the rest of the project: scar (validated), belief (reasoned hypothesis) or
fire (a possibility whose size nobody has measured), with prior art, what
it requires, and where it is decided. Section 3 says where the vision is
bigger than the ADRs of last night assumed. Section 4 names the risks.
Section 5 says what changes in the plan, which is less than the vision
suggests and more than nothing.

## 1. The vision **[A]**

1. **A universal architecture for applications in the AI era.** The
   document is structure; structure is what models write well and humans
   can review.
2. **Split sources, one built document.** A document is authored as many
   files, each in the syntax that reads best for its kind (templates like
   Vue or Svelte, logic as expressions, content as Markdown, data as
   tables, tests as scenarios), and a builder, in the role Vite plays for
   web apps, assembles them into the canonical JSON. A single document can
   explode into thousands of files. Purpose: an agent loads only what it
   needs, so context stays small and hallucination has less room.
3. **Non-developers build form-shaped and simple apps.** Blueprint as the
   proposal for people who describe rather than code.
4. **Documents live in a database**, not only in git, so that massive
   automated changes do not fight a version control system built for
   humans.
5. **Shared, universal runtimes.** A platform such as Vercel offers a
   runtime for Next or Nuxt that hosts any Blueprint document. Engineers
   are freed from basic apps and pushed toward harder problems.
6. **The document declares its infrastructure**, as Terraform does:
   external resource types (Firebase, Supabase, AWS, Cloudflare and so on)
   are part of the structure.
7. **Rich resource types.** Markdown, massive datasets, cryptographic
   material and many other things have a place as resource types.
8. **The agent editor files issues.** A non-developer edits through an
   agent; when the runtime lacks something, the agent opens an issue
   against the runtime asking for the capability.
9. **Platforms build editors.** Vercel with v0, Figma with its design
   tools, could ship Blueprint editors; powerful runtimes should start
   now if the idea makes sense for the market.
10. **Blueprint remains an architecture proposal** for platforms such as
    insurers, where the first case was validated.
11. **Libraries of hundreds of micro-apps.** An owner creates micro-apps
    on demand to test ideas, over many runtimes including native Android
    and iOS, through a chat: idea to micro-app in minutes.
12. **Documents stored anywhere, run from a link.** A runtime runs an
    app from a link to some storage.
13. **The lock-in question.** Runtimes provide different components and
    resources; a document must still be readable by any runtime and
    lock-in must be prevented. How?

## 2. The cold test

| # | Point | Verdict | Prior art | What it requires | Decided in |
|---|---|---|---|---|---|
| 1 | Universal architecture for the AI era | **fire** as a claim, **scar** in the mechanism: a validated document + validator + tests is exactly the closed search space an agent needs (continuation 6.3) | HTML and browsers; spreadsheets; the Elm architecture | that the kernel stays small and the validator stays truthful; universality is measured by the second consumer and the second runtime, not declared | ADR 0005, 0017 |
| 2 | Split sources, one built document | **belief**, strong: it is ADR 0018's "canonical JSON stored, friendly forms derived" carried to its end. The claim about hallucination needs one correction: smaller context reduces *mistakes of omission*; only validator, tests and preview catch *mistakes of invention* | Vite, Astro content collections, Terraform module trees, Cargo workspaces, SFC compilers | lossless round trip, deterministic build, stable ids, static imports, one canonical form as the only pinned artifact | **ADR 0019** (source form and builder), **ADR 0020** (template dialect) |
| 3 | Non-developers build simple apps | **scar** for rules and resources inside a developer-owned structure; **belief** for schemas and templates; **fire** for whole apps | Airtable, Glide, Retool; the insurance analysts | the base vocabulary, the governance screen, fixtures as the trust language; the M6 milestone (an agent edits and passes `validate` + `test` unattended) | ADR 0010, 0018 |
| 4 | Documents in a database | **scar** (the insurance store was MongoDB) and already decided: the document store has eight operations and two implementations; a database store is the third | content-addressed stores, OCI registries | the store RFC with fixtures; git stays a valid store for small libraries | ADR 0014 |
| 5 | Universal shared runtimes on platforms | **fire**, and the one the plan already points at: this module *is* a runtime for Nuxt; a Next runtime is the "second web runtime" of ADR 0017. Platforms will only build one against a spec with a conformance suite | Node/Bun/Deno and WinterCG; Vercel's framework adapters; Cloudflare Workers' runtime | runtime manifests, compatibility reports, the minimum common runtime; and the second runtime first, or there is nothing to conform to | ADR 0007, 0009, 0017, **ADR 0023** |
| 6 | The document declares infrastructure | **belief** with a boundary to draw: the *needs* (durable storage, blob, mail, auth) are product and belong to the document as capability requirements; the *bindings* (which Supabase project, which AWS region) are deployment and must not change the product's hash | Terraform (config vs state), Kubernetes manifests, Serverless Framework, Nitro presets | a second document kind, the deployment document, pinned separately and referencing the app version | **ADR 0022** |
| 7 | Rich resource types | **scar** for datasets by hash (insurance); **belief** for Markdown and media; **needs a hard rule** for crypto: keys and secrets are never in a document, references to them are | Nuxt Content, Contentful, SOPS, Vault | resource types declared by capabilities, `dataset.fetch`, a `secrets` capability, size and hashing rules | **ADR 0021** |
| 8 | The agent files issues for missing capabilities | **belief**, cheap and concrete: `validate` already knows exactly which capability is missing and at which version; the issue is that report with a title | Dependabot, Renovate, package "peer dependency" warnings | a machine-readable capability request emitted by `validate`, posted by tooling | **ADR 0024** |
| 9 | Platforms build editors | **fire**; follows from 5 and 8, adds nothing the spec must do except stay open and stable | Builder.io, Plasmic, Storyblok, v0, Figma Make | the interoperability scenarios of the handoff (an editor of one vendor operating documents of another) | handoff 1.3; ADR 0018 |
| 10 | Architecture proposal for insurers and similar | **scar**; unchanged | Guidewire, Duck Creek, Socotra | the case study, written before it becomes memory | handoff 6.1 |
| 11 | Libraries of hundreds of micro-apps, native runtimes, chat to app | **fire** on the numbers, **belief** on the mechanism: the module already hosts a family of apps on one runtime; a library is a document store with a shared runtime and vocabulary; native runtimes are L1 materializers | app stores, Shortcuts, Glide, mini-programs (WeChat), spreadsheets | per-document version manifests so a host provisions only what each app needs; L1 documents so native runtimes have something to render; the governance screen so "minutes" does not mean "unreviewed" | **ADR 0023** |
| 12 | Stored anywhere, run from a link | **scar** in the mechanism (immutable ids, CDN cache of the insurance case) and cheap: the version is a content hash, so any storage that serves bytes is a store; the hash is the identity, the URL is a location | content addressing (git, IPFS, OCI), subresource integrity | locators with an expected hash, a read-side HTTP convention, refusal on mismatch | **ADR 0025** |
| 13 | Different runtimes, no lock-in | **belief**, the best-founded one: five mechanisms already drafted plus one rule; the honest limit is that a node with no fallback is locked at that node and the report says so | HTML's unknown elements, `@supports`, Adaptive Cards host config, JSON Forms renderers | base vocabulary as contract, mandatory fallbacks, capabilities as interfaces, adapters as data, a measured report; "add anything, remove nothing" | **ADR 0026** |

### The one correction that matters

Point 2 says splitting the document into files improves AI context and
prevents hallucination. Half of that is right. A section view keeps an
agent from missing what it did not load; nothing about file size keeps it
from inventing a prop or an operator. What prevents invention is a closed
vocabulary, a validator with good errors, tests in the document and a
preview the agent can read as data (ADR 0018). Split sources and the
builder are worth building for readability and locality; the safety comes
from the other four, which already exist in this repository in draft.

## 3. Where the vision is bigger than the ADRs assumed

Last night's records treated the runtime layer as a way to run one
document on a printer or a phone. Three of the author's points enlarge
it, and the records should say so:

- **Runtimes as a market, not a project artifact** (points 5 and 9). If
  platforms host Blueprint documents the way they host frameworks, the
  runtime manifest is not an internal file: it is the interface a platform
  publishes and competes on, and the conformance suite is what makes
  "supports Blueprint" mean something. ADR 0009's manifest and ADR 0017's
  sequence are the right shape; their audience grows from "the second
  implementer" to "any platform". This is the largest thing in the vision
  and the one whose only prerequisite is discipline: a spec that stays
  open, small and versioned.
- **The document declares what it needs from the world** (point 6). The
  capability model already covers storage, HTTP and UI. Extending
  requirements to durable infrastructure (a queue, a blob store, an
  identity provider, an e-mail sender) with a deployment document that
  binds them to providers is what turns "runs on any runtime" into
  "deploys on any platform". It is Terraform's split of configuration and
  state applied to Blueprint's split of product and process.
- **Libraries of micro-apps** (point 11) are the restaurant platform's
  multi-tenancy generalized: many documents, one runtime, one vocabulary,
  overlays for variants. The spreadsheet analogy of the continuation
  document becomes literal: an owner keeps a workbook of applications.

Nothing in the three changes the invariant (immutable versioned document,
tests inside, pin, engines that refuse what they do not understand). They
change who the readers of the manifests are.

## 4. Risks, named

- **Fragmentation** (points 5, 9). Each platform ships its own
  capabilities and vocabulary; documents run on one platform only. The
  defence is unchanged: open spec, conformance suite, `validate` telling
  the truth about portability, and a minimum common runtime written by
  subtraction.
- **Source-form drift** (point 2). If the Vue-like template dialect grows
  features the JSON form cannot express, the dialect becomes the format
  and the canonical JSON becomes a build artifact nobody reads. Rule:
  every dialect construct is defined as a mapping to JSON, round-trip
  tested; the JSON is what fixtures and pins see.
- **Secrets in documents** (point 7). One key inlined in a resource and
  hashed into a version is a leak that cannot be rotated away, because
  versions are immutable. Hard rule in ADR 0021.
- **Governance collapses under volume** (points 8, 11). Documents that
  cost minutes proliferate; the publish screen and the review of fixtures
  become the bottleneck and the product. That is expected and is the
  "hearth" condition: cheap documents need a gatekeeper.
- **The market may not come.** Points 5 and 9 are outcomes the project
  cannot cause; it can only make them possible. The plan must be worth
  doing if no platform ever ships a runtime, and it is: the insurer case
  and the restaurant platform are enough.

## 5. What changes in the plan

- Nothing in the sequence: second runtime, then minimum common runtime,
  then clean-room engine. The vision raises the stakes of that sequence;
  it does not reorder it.
- Eight new records: source form and builder (0019), template dialect
  (0020), resource types and secrets (0021), deployment document (0022),
  libraries and shared runtimes (0023), capability requests (0024),
  locators and running from a link (0025), portability without lock-in
  (0026).
- A proposal for the RFC repository, `docs/rfcs/README.md`: layout,
  process, template and twenty-four RFCs in dependency order, mapped to
  the ADRs, for the author to write when the draft is stable.
- One demonstration worth adding to the roadmap after the CLI exists:
  `blueprint explode` on the health quote, edit one template in the
  dialect, `blueprint build`, byte-identical canonical JSON. That is point
  2 proven in an afternoon.
- One sentence for the documentation's first page, in the author's
  direction and the cold reading: *Blueprint lets applications be written
  by describing them, verified by their own tests, pinned forever, and run
  by any runtime that declares what it provides.*

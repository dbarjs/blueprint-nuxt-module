# ADR 0020 — A Vue-like template dialect (`.bpt`) that compiles to template nodes

Status: proposed (2026-09-10). Layer: tooling (source profile). The JSON
node form of ADR 0002/0010 stays the only normative one.

## Context

The template sections are the largest and least readable part of every
document: the health quote's `page:index` is 300 lines of nested
`{ "type": "component", "as": …, "props": …, "bind": … }`. The author's
vision asks for templates in a syntax developers and models already know,
Vue or Svelte style. The first runtime is Vue and Nuxt UI, and Vue's
template language is already declarative, attribute-based and free of
statements in its template part, which makes it the closer fit. One
dialect is defined here; a Svelte-flavoured one is legitimate only if it
maps to the same JSON.

The trap is named in the vision document: if the dialect grows constructs
the JSON cannot express, the dialect becomes the format. Every construct
below is defined by its JSON mapping and nothing else.

## Decision

### A file is one template

```html
<!-- templates/pages/quotes/[id].bpt -->
---
title: Your quote
enter: load-quote
description: Shows one quote; refuses to accept it under another version.
---
<Container>
  <Stack gap="lg" paddingY="xl">
    <Stack direction="row" gap="sm" wrap>
      <Button label="New quote" variant="ghost" icon="i-lucide-arrow-left" @click="start-over" />
      <Button label="My quotes" variant="ghost" to="/quotes" />
    </Stack>

    <Group v-if="current">
      <template #header>
        <Heading :level="2">Your quote</Heading>
        <Badge variant="soft" :label="currentStatus.label" :color="currentStatus.color" />
      </template>
      <QuoteSummary :quote="current" />
      <PriceBreakdown :pricing="current.pricing" />
      <Alert v-if="quoteIsStale" color="warning" title="Rates changed"
             description="This quote was priced under a previous version." />
      <Button v-else :disabled="!canAccept" label="Accept" @click="accept" />
    </Group>
    <Empty v-else title="No quote" :description="error" />
  </Stack>
</Container>
```

Front matter carries the page fields (`route`, `title`, `description`,
`layout`, `enter`); the route defaults to the file path (`quotes/[id]` →
`/quotes/:id`). Components and channels have no front matter fields but
`description`.

### Mapping table

| Dialect | JSON node |
|---|---|
| `<Text size="sm">` (PascalCase, a vocabulary name) | `{ "type": "component", "as": "Text", "props": { "size": "sm" } }` |
| `<div class="x">` (lowercase, an HTML tag) | `{ "type": "html", "as": "div", … }`, `NON_PORTABLE` as today |
| `prop="literal"`, `prop` (boolean) | `props` |
| `:prop="expr"` | `bind.prop` with the infix expression compiled (ADR 0018) |
| `{{ expr }}` as the only content | `content` (or `bind.content`) |
| `{{ expr }}` among other text | a `text` node with `cat` |
| `v-if="expr"`, `v-else-if`, `v-else` on a component | `if` on the node; chains become an `if` node with `else` |
| `<template v-if>` … `<template v-else>` | an `if` node with `children` and `else` |
| `v-for="line in cartLines" :key="line.id"` | `for: { in, as: "line", key: "id" }` |
| `v-for="(line, i) in cartLines"` | `for.index: "i"` |
| `<template #empty>` inside a `v-for` element | `for` node's `empty` |
| `v-model="applicant.name"` | `model: "applicant.name"` |
| `v-model:checked="path"` | `model: { path, prop: "checked" }` |
| `v-model` inside `v-for` with `${index}` in the path | `model` interpolation as today |
| `@click="add-to-cart"` | `on.click: "add-to-cart"` |
| `@click="add-to-cart(product.id)"` | `on.click: { type: "action", name, with: { …positional names from the action's declared params } }` (needs ADR 0008's named params; until then `@click="{ set: … }"` JSON inline is allowed) |
| `<template #footer>` | `slots.footer` |
| `<template #cell:total="{ row }">` | a deferred slot with `scope: "row"` (ADR 0010) |
| `<MoneyRow :label="…" />` where `component:money-row` exists and no vocabulary has `MoneyRow` | `{ "type": "template", "name": "component:money-row", "with": { label } }` |
| `<Outlet />` | `{ "type": "outlet" }` |

Name resolution for `<PascalCase>`: vocabularies first (base, then the
runtime's), then the document's `component:*` templates by kebab-case;
a name found in both is an error (`TEMPLATE_NAME_SHADOWS_COMPONENT`),
never a silent preference.

### Expression scope in the dialect

Inside `:prop`, `{{ }}`, `v-if` and `v-for`, a bare identifier resolves
statically, in this order: loop and `with` variables in scope, then
definitions, then top-level `state` keys, then `context` keys. Explicit
prefixes are always available and are what `explain` prints when a name
is ambiguous: `state.x`, `def.x`, `resources.x`, `context.x`, `meta.x`,
`var.x`. Shadowing (a loop variable named like a definition) is an error
(`NAME_SHADOWED`) so that resolution never depends on precedence in
practice.

### What the dialect does not have

No `<script>`, no `<style>`, no JavaScript in expressions (only the infix
grammar), no `<component :is>` or any dynamic name (static references),
no `v-html`, no `v-bind="object"` spread, no custom directives, no
`ref`. The compiler reports each with a code and the JSON alternative when
one exists.

### Round trip

`explode --dialect bpt` prints every template in this dialect; `build`
parses it back. The property tests of ADR 0019 apply. A node with a
construct the dialect cannot print (none known today) is emitted as an
inline JSON island `<json>{ … }</json>`, so the round trip never fails.

## Alternatives considered

- **Svelte-style** (`{#if}`, `{#each}`, `on:click`). Same mapping, a
  second surface syntax; deferred until someone needs it, and then only
  as a second printer of the same JSON.
- **JSX.** Requires expressions to be JavaScript, which reopens the
  language the notation exists to close.
- **Real Vue SFCs compiled by the Vue compiler.** Would allow anything
  Vue allows; the point is to allow less.

## Fixtures required

- Every row of the mapping table: dialect snippet → JSON nodes.
- The four documents' templates printed as `.bpt` and rebuilt to
  identical JSON.
- Errors: shadowing, dynamic name, `<script>`, unknown directive.

## Consequences

- The health quote's `page:index` drops from ~300 lines of JSON to ~120
  lines of dialect, and an agent editing one field opens one file.
- The Vue materializer is untouched: it consumes the abstract tree.
- Nuxt UI components remain usable as `<UButton>` in the dialect and
  remain L3 in the portability report.

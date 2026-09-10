import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { RuntimeContract } from '../src/runtime/engine/contract'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

await setup({
  rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
})

describe('blueprint app (ssr)', () => {
  it('lists the applications on the index page', async () => {
    const html = await $fetch('/')
    expect(html).toContain('Counter')
  })

  it('renders a page template with definitions evaluated on the server', async () => {
    const html = await $fetch('/counter')
    expect(html).toContain('Counter fixture')
    expect(html).toContain('Double: 6')
    expect(html).toContain('Bump')
  })

  it('resolves page routes inside the app prefix', async () => {
    const html = await $fetch('/counter/about')
    expect(html).toContain('About page')
  })

  it('returns 404 for unknown apps and pages', async () => {
    await expect($fetch('/nope')).rejects.toMatchObject({ statusCode: 404 })
    await expect($fetch('/counter/nope')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('stores pinned records through the API and rejects stale versions', async () => {
    const record = await $fetch<{ id: string, createdUnder: { version: string } }>('/api/blueprint/counter/records', {
      method: 'POST',
      body: { data: { count: 1 } },
    })
    expect(record.id).toBeTruthy()
    expect(record.createdUnder.version).toMatch(/^[0-9a-f]{16}$/)
    const fetched = await $fetch<{ id: string }>(`/api/blueprint/counter/records/${record.id}`)
    expect(fetched.id).toBe(record.id)
    await expect($fetch('/api/blueprint/counter/records', {
      method: 'POST',
      body: { data: { count: 1 }, createdUnder: { document: 'counter', version: 'stale' } },
    })).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('endpoints written in a document (nitro)', () => {
  it('publishes the runtime contract, both halves', async () => {
    const contract = await $fetch<RuntimeContract>('/api/blueprint/contract')
    expect(contract.runtime).toBe('blueprint-nuxt-module')
    // server half
    expect(contract.server.storages.map(storage => storage.name)).toEqual(['memory', 'fs', 'sqlite'])
    expect(contract.server.defaultStorage).toBe('fs')
    expect(contract.server.mount).toBe('/api/blueprint')
    // client half: the scanned registry, not the static defaults
    expect(contract.client.prefix).toBe('')
    expect(contract.client.components.base).toContain('Text')
    expect(contract.client.components.nuxtUi).toContain('UButton')
    expect(contract.client.state.persistence).toBe('localStorage')
    expect(contract.actions.client).toContain('navigate')
    const schema = await $fetch<{ $defs: Record<string, { enum?: string[] }> }>('/api/blueprint/contract?format=schema')
    expect(Object.keys(schema.$defs)).toEqual(expect.arrayContaining(['endpoints', 'component', 'nodeType']))
    expect(schema.$defs.component!.enum).toContain('UButton')
  })

  it('serves a create → list → get lifecycle on sqlite storage', async () => {
    // The sqlite file under the fixture survives between runs: count first.
    const before = await $fetch<{ total: number }>('/api/blueprint/board/notes')
    const html0 = await $fetch('/board')
    expect(html0).toContain(`Total: ${before.total}`)

    const text = `note ${Date.now()}`
    const created = await $fetch<{ id: string, text: string, under: string, createdAt: string }>('/api/blueprint/board/notes', { method: 'POST', body: { text: `  ${text} ` } })
    expect(created).toMatchObject({ text })
    expect(created.under).toMatch(/^[0-9a-f]{16}$/)

    const listed = await $fetch<{ items: Array<{ id: string }>, total: number }>('/api/blueprint/board/notes?limit=3')
    expect(listed.total).toBe(before.total + 1)
    expect(listed.items[0]?.id).toBe(created.id)

    const fetched = await $fetch<{ id: string }>(`/api/blueprint/board/notes/${created.id}`)
    expect(fetched.id).toBe(created.id)

    // Page `enter` fetches from the document's own endpoint during SSR.
    const html = await $fetch('/board')
    expect(html).toContain(`Total: ${before.total + 1}`)
    expect(html).toContain(`note: ${text}`)
  })

  it('answers 422, 404, 405 and 409 as the document describes', async () => {
    await expect($fetch('/api/blueprint/board/notes', { method: 'POST', body: { text: '' } })).rejects.toMatchObject({ statusCode: 422 })
    await expect($fetch('/api/blueprint/board/notes?limit=50')).rejects.toMatchObject({ statusCode: 422 })
    await expect($fetch('/api/blueprint/board/notes/nope')).rejects.toMatchObject({ statusCode: 404, data: { message: 'no such note' } })
    await expect($fetch('/api/blueprint/board/nowhere')).rejects.toMatchObject({ statusCode: 404 })
    await expect($fetch('/api/blueprint/board/notes', { method: 'DELETE' })).rejects.toMatchObject({ statusCode: 405 })
    await expect($fetch('/api/blueprint/board/notes', { method: 'POST', body: { text: 'x', createdUnder: { version: 'stale' } } })).rejects.toMatchObject({ statusCode: 409 })
    await expect($fetch('/api/blueprint/counter/notes')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('routes collections to their own storage', async () => {
    const first = await $fetch<{ total: number }>('/api/blueprint/board/scratch', { method: 'POST', body: { text: 'a' } })
    const second = await $fetch<{ total: number }>('/api/blueprint/board/scratch', { method: 'POST', body: { text: 'b' } })
    expect(second.total).toBe(first.total + 1)
    await expect($fetch('/api/blueprint/board/scratch', { method: 'POST', body: { text: '' } })).rejects.toMatchObject({ statusCode: 422 })
  })
})

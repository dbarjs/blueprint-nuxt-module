import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('blueprint app (ssr)', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

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

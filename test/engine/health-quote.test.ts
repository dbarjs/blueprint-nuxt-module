import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BlueprintDocument } from '../../src/runtime/engine/types'
import { createMemoryStore } from '../../src/runtime/engine/server-actions'
import { resolveEndpoint, runEndpoint, type EndpointRequest } from '../../src/runtime/engine/endpoints'
import { createEvaluator } from '../../src/runtime/engine/logic'
import { hashDocument } from '../../src/runtime/engine/hash'
import { deepClone, deepMerge } from '../../src/runtime/engine/path'

/**
 * The quotation app, end to end through the engine: the browser prices a
 * quote with the definitions, the server prices it again with the same
 * definitions inside the handler, and both must agree.
 */
const file = fileURLToPath(new URL('../../content/health-quote.json', import.meta.url))

const applicant = {
  name: 'Ada Lovelace',
  email: 'Ada@example.com',
  age: 50,
  smoker: true,
  alcohol: 'frequent',
  activity: 'extreme',
  sleep: 'normal',
  dependents: 2,
  plan: 'essential',
  billing: 'annual',
}

describe('health-quote through its endpoints', async () => {
  const document = JSON.parse(await readFile(file, 'utf8')) as BlueprintDocument
  const version = hashDocument(document)
  const store = createMemoryStore()
  const call = (method: string, path: string, request: Partial<EndpointRequest> = {}, options: { version?: string } = {}) => {
    const resolved = resolveEndpoint(document, method, path)
    if (!resolved) throw new Error(`no endpoint for ${method} ${path}`)
    return runEndpoint(document, resolved, { method, path, ...request }, { store, now: () => '2026-09-10T12:00:00.000Z', version: options.version ?? version })
  }

  /** What the browser shows before submitting: the same definitions, evaluated on the applicant. */
  const evaluator = createEvaluator(document)
  const browserPricing = evaluator.evaluate({ def: 'pricing' }, {
    state: deepMerge(deepClone(document.content.state!), { applicant }),
    context: { app: document.name, version },
    vars: {},
  }) as Record<string, unknown>

  let quoteId = ''

  it('prices on the server with the definitions the browser used', async () => {
    const response = await call('POST', '/quotes', { body: { ...applicant, createdUnder: { document: document.name, version } } })
    expect(response.status).toBe(201)
    const quote = response.body as { id: string, status: string, quotedUnder: string, pricing: Record<string, unknown>, applicant: typeof applicant }
    quoteId = quote.id
    expect(quote.status).toBe('open')
    expect(quote.quotedUnder).toBe(version)
    expect(quote.applicant.email).toBe('Ada@example.com')
    expect(quote.pricing).toEqual(browserPricing)
    expect(quote.pricing.monthly).toBe(82854)
    expect(quote.pricing.riskFactor).toBe(2.4375)
    expect((quote.pricing.risks as Array<{ id: string }>).map(risk => risk.id)).toEqual(['smoker', 'alcohol-frequent', 'extreme'])
    expect(quote.pricing.annual).toBe(82854 * 12 - Math.round(82854 * 12 * 0.08))
  })

  it('refuses an applicant outside the age bands with the business message', async () => {
    const response = await call('POST', '/quotes', { body: { ...applicant, age: 17 } })
    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ message: 'We can only cover people aged 18 to 75.', issues: [{ path: 'age' }] })
  })

  it('validates the body with the applicant schema before pricing', async () => {
    const response = await call('POST', '/quotes', { body: { ...applicant, email: 'nope', dependents: 9 } })
    expect(response.status).toBe(422)
    const issues = (response.body as { issues: Array<{ path: string }> }).issues.map(issue => issue.path)
    expect(issues).toEqual(['body.email', 'body.dependents'])
  })

  it('refuses a payload pinned to another document version', async () => {
    const response = await call('POST', '/quotes', { body: { ...applicant, createdUnder: { document: document.name, version: 'stale' } } })
    expect(response.status).toBe(409)
  })

  it('finds a quote by id and by email, case-insensitively', async () => {
    const one = await call('GET', `/quotes/${quoteId}`)
    expect(one.status).toBe(200)
    expect((one.body as { id: string }).id).toBe(quoteId)

    const mine = await call('GET', '/quotes', { query: { email: 'ada@EXAMPLE.com' } })
    expect(mine.status).toBe(200)
    expect(mine.body).toMatchObject({ total: 1, email: 'ada@EXAMPLE.com' })

    const nobody = await call('GET', '/quotes', { query: { email: 'someone@example.com' } })
    expect(nobody.body).toMatchObject({ total: 0, items: [] })

    const invalid = await call('GET', '/quotes', { query: { email: 'not-an-email' } })
    expect(invalid.status).toBe(422)

    const missing = await call('GET', '/quotes/nope')
    expect(missing.status).toBe(404)
  })

  it('accepts an open quote once', async () => {
    const accepted = await call('POST', `/quotes/${quoteId}/accept`)
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({ id: quoteId, status: 'accepted', acceptedAt: '2026-09-10T12:00:00.000Z' })

    const again = await call('POST', `/quotes/${quoteId}/accept`)
    expect(again.status).toBe(409)
    expect((again.body as { message: string }).message).toContain('already accepted')
  })

  it('refuses to accept a quote priced under another version', async () => {
    const issued = await call('POST', '/quotes', { body: { ...applicant, age: 30, email: 'grace@example.com' } })
    const id = (issued.body as { id: string }).id
    const response = await call('POST', `/quotes/${id}/accept`, {}, { version: 'v-next' })
    expect(response.status).toBe(409)
    expect((response.body as { message: string }).message).toContain('rates changed')
  })

  it('publishes the rating tables and aggregate stats', async () => {
    const rating = await call('GET', '/rating')
    expect(rating.status).toBe(200)
    expect(rating.body).toMatchObject({ version, settings: { minAge: 18, maxAge: 75 } })
    expect((rating.body as { ageBands: unknown[] }).ageBands).toHaveLength(6)

    const stats = await call('GET', '/stats')
    expect(stats.status).toBe(200)
    expect(stats.body).toMatchObject({ total: 2, accepted: 1, byPlan: { essential: 2, balanced: 0, complete: 0 }, smokers: 2 })
    expect((stats.body as { averageMonthly: number }).averageMonthly).toBeGreaterThan(0)
  })
})

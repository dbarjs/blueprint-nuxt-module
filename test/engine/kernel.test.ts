import { describe, expect, it } from 'vitest'
import type { BlueprintDocument } from '../../src/runtime/engine/types'
import { createEvaluator, roundDecimal, scaleInteger } from '../../src/runtime/engine/logic'
import { canonicalize, hashDocument, hashValue, sha256 } from '../../src/runtime/engine/hash'
import { checkCompatibility, requirementsOf, satisfies } from '../../src/runtime/engine/capabilities'
import { portabilityLine, runtimeManifestOf, versionManifestOf } from '../../src/runtime/engine/manifest'
import { checkProjections, projectDocument } from '../../src/runtime/engine/projection'
import { evaluateTemplate } from '../../src/runtime/engine/template'
import { runActions, type EffectEntry } from '../../src/runtime/engine/actions'
import { createMemoryStore, createServerActions } from '../../src/runtime/engine/server-actions'
import { resolveEndpoint, runEndpoint } from '../../src/runtime/engine/endpoints'
import { validateDocument } from '../../src/runtime/engine/validate'
import { runDocumentTests } from '../../src/runtime/engine/tests'
import { resolveContract, RUNTIME_CONTRACT } from '../../src/runtime/engine/contract'
import { BASE_COMPONENT_NAMES } from '../../src/runtime/engine/registry'

const base = (): BlueprintDocument => ({
  spec: '0.1',
  name: 'kernel',
  content: {
    meta: { title: 'Kernel' },
    resources: {
      'plans': { type: 'list', data: [{ id: 'a', price: 1000 }] },
      'secret-rates': { type: 'parameter-table', audience: 'server', data: [{ match: {}, factor: 2 }] },
    },
    schemas: {},
    definitions: {
      total: { logic: { '*': [{ resource: ['plans', '0.price'] }, 2] } },
      hidden: { audience: 'server', logic: { lookup: ['secret-rates', {}] } },
    },
    state: { count: 1 },
    actions: {},
    templates: {
      'page:index': { children: [{ type: 'component', as: 'Text', bind: { content: { def: 'total' } } }] },
    },
  },
})

describe('numeric semantics (ADR 0012)', () => {
  it('rounds half-up away from zero, on the shortest decimal representation', () => {
    expect(roundDecimal(2.5)).toBe(3)
    expect(roundDecimal(-2.5)).toBe(-3)
    expect(roundDecimal(1.005, 2)).toBe(1.01)
    expect(roundDecimal(-1.005, 2)).toBe(-1.01)
    expect(roundDecimal(2.5, 0, 'half-even')).toBe(2)
    expect(roundDecimal(-2.5, 0, 'half-even')).toBe(-2)
    expect(roundDecimal(2.5, 0, 'half-down')).toBe(2)
    expect(roundDecimal(-2.7, 0, 'trunc')).toBe(-2)
  })

  it('scales integers by a ratio without leaving the integer domain', () => {
    expect(scaleInteger(12900, 85, 100)).toBe(10965)
    expect(scaleInteger(9868.5, 1, 1)).toBe(9869)
    expect(scaleInteger(-9868.5, 1, 1)).toBe(-9869)
    expect(() => scaleInteger(1, 1, 0)).toThrow(/DIVISION_BY_ZERO/)
    const ev = createEvaluator(base())
    expect(ev.evaluate({ scale: [12900, 85, 100] }, { state: {}, context: {}, vars: {} })).toBe(10965)
    expect(ev.evaluate({ round: [-2.5] }, { state: {}, context: {}, vars: {} })).toBe(-3)
  })
})

describe('canonical form and pins (ADR 0013)', () => {
  it('sorts keys by code units and hashes with SHA-256', () => {
    expect(canonicalize({ b: 1, a: [1, { d: null, c: 'x' }] })).toBe('{"a":[1,{"c":"x","d":null}],"b":1}')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashValue({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('ignores $schema and version in the document hash, and nothing else', () => {
    const a = base()
    const b = { ...base(), $schema: './x.json' }
    expect(hashDocument(a)).toBe(hashDocument(b))
    const c = base()
    c.content.state = { count: 2 }
    expect(hashDocument(a)).not.toBe(hashDocument(c))
  })
})

describe('capabilities (ADR 0007, 0009)', () => {
  it('understands the semver ranges documents and runtimes use', () => {
    expect(satisfies('1.4.2', '^1')).toBe(true)
    expect(satisfies('2.0.0', '^1')).toBe(false)
    expect(satisfies('0.1.3', '^0.1')).toBe(true)
    expect(satisfies('0.2.0', '^0.1')).toBe(false)
    expect(satisfies('0.1.5', '>=0.1 <0.2')).toBe(true)
    expect(satisfies('0.2.0', '>=0.1 <0.2')).toBe(false)
    expect(satisfies('1.2.3', '1.2')).toBe(true)
    expect(satisfies('0.0.0+abc', '=0.0.0+abc')).toBe(true)
    expect(satisfies('0.0.0+def', '=0.0.0+abc')).toBe(false)
    expect(satisfies('1.0.0', '*')).toBe(true)
  })

  it('derives requirements from references, and authored entries only add', () => {
    const doc = base()
    doc.content.actions = { go: { type: 'navigate', to: 'page:index' }, say: { type: 'toast', title: 'hi' } }
    doc.content.templates['page:index'] = { children: [{ type: 'component', as: 'Button', on: { click: ['go', 'say'] }, bind: { label: { context: 'now' } } }] }
    doc.content.runtime = { optional: { 'time.now': '^1' }, requires: { 'ui.toast': '^1' } }
    const requirements = requirementsOf(doc)
    expect(Object.keys(requirements.requires).sort()).toEqual(['time.now', 'ui.toast', 'vocab.base', 'web.pages', 'web.router', 'web.state'])
    expect(requirements.optional).toEqual({})
    expect(requirements.reasons['web.router']).toEqual(['actions.go'])
  })

  it('answers compatible, degraded or incompatible', () => {
    const runtime = runtimeManifestOf(RUNTIME_CONTRACT)
    expect(runtime.provides.map(entry => entry.name)).toContain('storage.collections')
    expect(checkCompatibility({ spec: '0.1', requires: { 'web.pages': '^1' }, optional: {} }, runtime).verdict).toBe('compatible')
    expect(checkCompatibility({ spec: '0.1', requires: {}, optional: { 'dataset.fetch': '^1' } }, runtime).verdict).toBe('degraded')
    const bad = checkCompatibility({ spec: '0.1', requires: { 'identity': '^1', 'web.pages': '^9' }, optional: {} }, runtime)
    expect(bad.verdict).toBe('incompatible')
    expect(bad.missing.map(entry => entry.code)).toEqual(['CAPABILITY_MISSING', 'CAPABILITY_VERSION'])
    expect(checkCompatibility({ spec: '0.2', requires: {}, optional: {} }, runtime).verdict).toBe('incompatible')
  })

  it('refuses a document whose critical capability is absent, and warns for an optional one', () => {
    const doc = base()
    doc.content.endpoints = { secret: { method: 'GET', path: '/secret', access: { '!!': [{ context: 'actor' }] }, handler: { type: 'respond', body: 'ok' } } }
    const report = validateDocument(doc, { registry: { base: BASE_COMPONENT_NAMES } })
    expect(report.issues.map(issue => issue.code)).toContain('CAPABILITY_MISSING')
    expect(report.compatibility).toBe('incompatible')
    const optional = base()
    optional.content.actions = { say: { type: 'toast', title: 'hi' } }
    optional.content.templates['page:index'] = { children: [{ type: 'component', as: 'Button', on: { click: 'say' } }] }
    const contract = resolveContract(RUNTIME_CONTRACT)
    const noToast = validateDocument(optional, { registry: { base: BASE_COMPONENT_NAMES }, contract: { ...contract, actions: { ...contract.actions, client: contract.actions.client.filter(type => type !== 'toast') } } })
    expect(noToast.compatibility).toBe('compatible')
    expect(noToast.requirements?.optional).toEqual({ 'ui.toast': '^1' })
  })
})

describe('manifests and portability (ADR 0009, 0026)', () => {
  it('writes a version manifest with section hashes, requirements and a level', () => {
    const manifest = versionManifestOf(base())
    expect(manifest.version).toMatch(/^sha256:/)
    expect(Object.keys(manifest.sections)).toContain('definitions')
    expect(manifest.requires['vocab.base']).toBe('^0.1')
    expect(manifest.portability).toMatchObject({ level: 'L2', status: 'portable', locked: [] })
    expect(manifest.pages).toEqual(['/'])
    expect(portabilityLine(manifest)).toBe('kernel  L2  portable  (kernel + minimum common runtime)')
  })

  it('names the locked nodes and pins runtime vocabularies to the build', () => {
    const doc = base()
    doc.content.templates['page:index'] = { children: [
      { type: 'component', as: 'UCarousel', props: { items: [] } },
      { type: 'component', as: 'UCalendar', fallback: [{ type: 'component', as: 'Input', props: { type: 'date' } }] },
    ] }
    const provides = runtimeManifestOf(resolveContract(RUNTIME_CONTRACT, { components: { nuxtUi: ['UCarousel', 'UCalendar'] } })).provides
    const manifest = versionManifestOf(doc, { registry: { base: BASE_COMPONENT_NAMES, nuxtUi: ['UCarousel', 'UCalendar'] }, provides })
    expect(manifest.portability.status).toBe('LOCKED')
    expect(manifest.portability.level).toBe('L3')
    expect(manifest.portability.locked).toEqual([{ component: 'UCarousel', where: 'templates.page:index[0]' }])
    expect(manifest.portability.degradable).toEqual(['UCalendar'])
    expect(manifest.requires['vocab.nuxt-ui']).toMatch(/^=0\.0\.0\+[0-9a-f]{12}$/)
    expect(portabilityLine(manifest)).toContain('LOCKED  (UCarousel without fallback)')
    const report = validateDocument(doc, { registry: { base: BASE_COMPONENT_NAMES, nuxtUi: ['UCarousel', 'UCalendar'] } })
    expect(report.issues.filter(issue => issue.code === 'LOCKED')).toHaveLength(1)
    expect(report.portable?.status).toBe('LOCKED')
  })

  it('rejects fallbacks written outside the base vocabulary', () => {
    const doc = base()
    doc.content.templates['page:index'] = { children: [{ type: 'component', as: 'UCalendar', fallback: [{ type: 'component', as: 'UDatePicker' }] }] }
    const report = validateDocument(doc)
    expect(report.issues.some(issue => issue.code === 'DYNAMIC_REFERENCE' && issue.message.includes('UDatePicker'))).toBe(true)
  })
})

describe('fallbacks in the abstract tree (ADR 0026)', () => {
  it('draws the fallback where the vocabulary is absent, and marks it', () => {
    const doc = base()
    doc.content.templates['component:pick'] = [{ type: 'component', as: 'UCalendar', fallback: [{ type: 'component', as: 'Input', bind: { placeholder: { cat: ['pick ', { var: 'label' }] } } }] }]
    const ev = createEvaluator(doc)
    const scope = { state: {}, context: {}, vars: { label: 'a date' } }
    const rich = evaluateTemplate(ev, 'component:pick', scope, { available: () => true })
    expect(rich[0]).toMatchObject({ kind: 'component', as: 'UCalendar' })
    const poor = evaluateTemplate(ev, 'component:pick', scope, { available: name => BASE_COMPONENT_NAMES.includes(name) })
    expect(poor[0]).toMatchObject({ kind: 'component', as: 'Input', via: 'fallback', of: 'UCalendar', props: { placeholder: 'pick a date' } })
  })

  it('never hides a component it cannot draw', () => {
    const doc = base()
    doc.content.templates['component:x'] = [{ type: 'component', as: 'UCarousel' }]
    const nodes = evaluateTemplate(createEvaluator(doc), 'component:x', { state: {}, context: {}, vars: {} }, { available: () => false })
    expect(nodes[0]).toMatchObject({ kind: 'unavailable', as: 'UCarousel', capability: 'vocab.nuxt-ui' })
  })
})

describe('projection (ADR 0015)', () => {
  it('rejects a public page that leans on a server entry', () => {
    const doc = base()
    doc.content.templates['page:index'] = { children: [{ type: 'component', as: 'Text', bind: { content: { def: 'hidden' } } }] }
    const issues = checkProjections(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('definitions.hidden')
    expect(validateDocument(doc).issues.map(issue => issue.code)).toContain('PROJECTION_DANGLING')
  })

  it('projects a page for the client without the server entries, and endpoints as signatures', () => {
    const doc = base()
    doc.content.endpoints = { price: { method: 'GET', path: '/price', handler: [{ type: 'respond', body: { def: 'hidden' } }] } }
    doc.content.actions = { load: { type: 'fetch', endpoint: 'price', result: 'price' } }
    doc.content.templates['page:index'] = { enter: 'load', children: [{ type: 'component', as: 'Text', bind: { content: { def: 'total' } } }] }
    const { document, kept, partial } = projectDocument(doc, { select: ['page:index'], audience: 'client' })
    expect(kept).toEqual(['actions.load', 'definitions.total', 'endpoints.price', 'resources.plans', 'templates.page:index'])
    expect(partial).toEqual(['resources', 'definitions'])
    expect(document.content.definitions).not.toHaveProperty('hidden')
    expect(document.content.resources).not.toHaveProperty('secret-rates')
    expect(document.content.endpoints?.price?.handler).toMatchObject({ type: 'fail', status: 501 })
    expect(document.projection).toMatchObject({ of: hashDocument(doc), audience: 'client' })
    // Same input, same bytes.
    expect(hashDocument(projectDocument(doc, { select: ['page:index'], audience: 'client' }).document)).toBe(hashDocument(document))
    // The server projection keeps the handler and its private inputs.
    const server = projectDocument(doc, { select: ['endpoints.price'], audience: 'server' })
    expect(server.document.content.definitions).toHaveProperty('hidden')
    expect(server.document.content.resources).toHaveProperty('secret-rates')
  })
})

describe('effects as data (ADR 0008)', () => {
  it('binds results with `as` and `result` on every surface and logs every capability call', async () => {
    const doc = base()
    doc.content.collections = { items: {} }
    const store = createMemoryStore()
    const log: EffectEntry[] = []
    const state: Record<string, unknown> = { count: 1 }
    const ctx = {
      evaluator: createEvaluator(doc),
      state,
      context: {},
      initialState: { count: 1 },
      effects: { fetch: async () => ({ answer: 42 }) },
      extensions: createServerActions({ document: doc, store, now: () => '2024-01-01T00:00:00.000Z' }),
      log,
      step: 'test',
    }
    const result = await runActions([
      { type: 'insert', collection: 'items', data: { obj: { n: 1 } }, as: 'created', result: 'last' },
      { type: 'fetch', endpoint: '/x', as: 'reply', result: 'remote' },
      { type: 'set', path: 'copy', value: { var: 'created.n' } },
      { type: 'set', path: 'copy2', value: { var: 'reply.answer' } },
    ], ctx)
    expect(result.ok).toBe(true)
    expect(state.copy).toBe(1)
    expect(state.copy2).toBe(42)
    expect((state.last as { n: number }).n).toBe(1)
    expect(state.remote).toEqual({ answer: 42 })
    expect(log.map(entry => [entry.capability, entry.type, entry.result.ok])).toEqual([['storage.collections', 'insert', true], ['http.client', 'fetch', true]])
    expect(log[0]!.input).toMatchObject({ collection: 'items', data: { n: 1 } })
  })

  it('turns a missing provider into a failure value the handler can catch', async () => {
    const doc = base()
    const state: Record<string, unknown> = {}
    const log: EffectEntry[] = []
    const result = await runActions({ type: 'fetch', endpoint: '/x', catch: { type: 'set', path: 'why', value: { var: 'failure.code' } } }, {
      evaluator: createEvaluator(doc), state, context: {}, initialState: {}, effects: {}, log,
    })
    expect(result.ok).toBe(false)
    expect(state.why).toBe('CAPABILITY_UNAVAILABLE')
    expect(log[0]!.result).toMatchObject({ ok: false, error: { code: 'CAPABILITY_UNAVAILABLE' } })
  })

  it('rejects cycles between named actions at validation', () => {
    const doc = base()
    doc.content.actions = { a: 'b', b: { type: 'if', condition: true, then: 'a' } }
    expect(validateDocument(doc).issues.map(issue => issue.code)).toContain('ACTION_CYCLE')
  })
})

describe('access rules (ADR 0027)', () => {
  const doc = (): BlueprintDocument => {
    const d = base()
    d.content.endpoints = {
      mine: { method: 'GET', path: '/mine', access: { '==': [{ context: 'actor.role' }, 'owner'] }, handler: { type: 'respond', body: { context: 'actor.name' } } },
    }
    return d
  }
  const call = (actor?: unknown) => runEndpoint(doc(), resolveEndpoint(doc(), 'GET', '/mine')!, { method: 'GET', path: '/mine' }, { store: createMemoryStore(), actor })

  it('answers 401 without an actor, 403 with the wrong one, and runs for the right one', async () => {
    expect((await call()).status).toBe(401)
    expect((await call({ name: 'ada', role: 'guest' })).status).toBe(403)
    const ok = await call({ name: 'ada', role: 'owner' })
    expect(ok).toMatchObject({ status: 200, body: 'ada' })
  })

  it('requires the identity capability', () => {
    expect(requirementsOf(doc()).requires).toHaveProperty('identity')
  })
})

describe('the four test forms (ADR 0011)', () => {
  it('reports unstubbed effects instead of letting them out', async () => {
    const doc = base()
    doc.content.actions = { go: { type: 'navigate', to: 'page:index' } }
    doc.content.tests = [{ name: 'leaks', run: 'go' }]
    const [outcome] = await runDocumentTests(doc)
    expect(outcome!.passed).toBe(false)
    expect(JSON.stringify(outcome!.failures)).toContain('UNSTUBBED_EFFECT')
  })

  it('compares an exact tree, and skips endpoint scenarios where http.endpoints is absent', async () => {
    const doc = base()
    doc.content.endpoints = { ping: { method: 'GET', path: '/ping', handler: { type: 'respond', body: 'pong' } } }
    doc.content.tests = [
      { name: 'tree', render: 'page:index', tree: [{ kind: 'component', key: 'page:index.0', as: 'Text', props: {}, children: [{ kind: 'text', key: 'page:index.0.content', text: '2000' }] }] },
      { name: 'ping', request: { endpoint: 'ping' }, response: { status: 200, body: 'pong' } },
    ]
    const all = await runDocumentTests(doc)
    expect(all.map(outcome => [outcome.form, outcome.passed])).toEqual([['tree', true], ['endpoint', true]])
    const headless = await runDocumentTests(doc, { provides: [{ name: 'vocab.base' }] })
    expect(headless[1]).toMatchObject({ passed: false, skipped: 'http.endpoints is not provided by this runtime' })
  })
})

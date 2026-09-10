/**
 * Tests carried by the document (ADR 0011). Four forms, one array:
 *
 * 1. definition test — state in, definition values out (exact);
 * 2. tree test — evaluate a template, compare the abstract tree;
 * 3. action scenario — run actions against stubbed capabilities and check
 *    state, the effect log and definitions afterwards;
 * 4. endpoint scenario — a request in, a response out, records after.
 *
 * A document that carries its own tests is self-validating and portable
 * between engines: the contract becomes "these inputs produce these
 * outputs", not the semantics of the arithmetic.
 */
import type { ActionScenario, BlueprintDocument, BlueprintTest, DefinitionTest, EffectStub, EndpointScenario, StoredRecord, TreeTest } from './types'
import { createEvaluator, type Evaluator } from './logic'
import { deepClone, deepEqual, deepMerge, isPlainObject } from './path'
import { evaluateTemplate, type AbstractNode } from './template'
import { runActions, type ActionContext, type ActionEffects, type ActionResult, type EffectEntry } from './actions'
import { createMemoryStore, createServerActions, type CollectionStore } from './server-actions'
import { resolveEndpoint, runEndpoint } from './endpoints'
import { BlueprintError, toFailure } from './errors'
import { testFormOf, type TestForm } from './test-forms'
import { canonicalize } from './hash'

export interface TestFailure {
  /** What was compared: a definition name, a state path, `response.status`, `effects[2]`... */
  definition: string
  expected: unknown
  actual: unknown
}

export interface TestOutcome {
  name: string
  form: TestForm
  passed: boolean
  /** The runtime lacks what the form needs: reported, never counted as passed. */
  skipped?: string
  failures: TestFailure[]
  error?: string
  /** Effect log of a scenario, for reports and corpus export. */
  effects?: EffectEntry[]
}

export interface RunTestsOptions {
  /** Capabilities the runtime provides; forms needing an absent one are skipped. */
  provides?: Array<{ name: string }>
  /** Which components the runtime can draw (tree tests). Absent → all. */
  available?: (component: string) => boolean
  /** Clock for scenarios; defaults to a fixed instant so runs are reproducible. */
  now?: () => string
  /** Run only these forms. */
  forms?: TestForm[]
}

const FIXED_NOW = '2024-01-01T00:00:00.000Z'

export async function runDocumentTests(document: BlueprintDocument, options: RunTestsOptions = {}): Promise<TestOutcome[]> {
  const evaluator = createEvaluator(document)
  const outcomes: TestOutcome[] = []
  for (const test of (document.content.tests || []) as BlueprintTest[]) {
    const form = testFormOf(test)
    if (options.forms && !options.forms.includes(form)) continue
    const outcome: TestOutcome = { name: test.name, form, passed: true, failures: [] }
    try {
      switch (form) {
        case 'definition':
          runDefinitionTest(document, evaluator, test as DefinitionTest, outcome)
          break
        case 'tree':
          runTreeTest(document, evaluator, test as TreeTest, outcome, options)
          break
        case 'scenario':
          await runActionScenario(document, evaluator, test as ActionScenario, outcome, options)
          break
        case 'endpoint':
          await runEndpointScenario(document, test as EndpointScenario, outcome, options)
          break
        default:
          outcome.passed = false
          outcome.error = 'INVALID_TEST: a test needs one of expect, render, run or request'
      }
    }
    catch (caught) {
      const expectedError = (test as { error?: string }).error
      const failure = toFailure(caught)
      if (expectedError && failure.code === expectedError) break
      outcome.passed = false
      outcome.error = caught instanceof BlueprintError ? `${failure.code}: ${failure.message}` : (caught as Error).message
    }
    outcomes.push(outcome)
  }
  return outcomes
}

/** Synchronous runner of the definition form only (build reports, quick checks). */
export function runDefinitionTests(document: BlueprintDocument): TestOutcome[] {
  const evaluator = createEvaluator(document)
  return ((document.content.tests || []) as BlueprintTest[]).filter(test => testFormOf(test) === 'definition').map((test) => {
    const outcome: TestOutcome = { name: test.name, form: 'definition', passed: true, failures: [] }
    try {
      runDefinitionTest(document, evaluator, test as DefinitionTest, outcome)
    }
    catch (caught) {
      const failure = toFailure(caught)
      if ((test as DefinitionTest).error === failure.code) return outcome
      outcome.passed = false
      outcome.error = (caught as Error).message
    }
    return outcome
  })
}

function scopeOf(document: BlueprintDocument, test: { state?: Record<string, unknown>, context?: Record<string, unknown> }, extra: Record<string, unknown> = {}) {
  const state = deepMerge(deepClone(document.content.state || {}), test.state)
  const context = { params: {}, query: {}, app: document.name, now: FIXED_NOW, ...extra, ...(test.context || {}) }
  return { state, context, vars: {} as Record<string, unknown> }
}

function runDefinitionTest(document: BlueprintDocument, evaluator: Evaluator, test: DefinitionTest, outcome: TestOutcome): void {
  const scope = scopeOf(document, test)
  evaluator.batch((evaluate) => {
    for (const [definition, expected] of Object.entries(test.expect || {})) {
      const actual = evaluate({ def: definition }, scope)
      if (!deepEqual(actual, expected)) {
        outcome.passed = false
        outcome.failures.push({ definition, expected, actual })
      }
    }
  })
  if (test.error) {
    // The run was expected to fail and did not.
    outcome.passed = false
    outcome.failures.push({ definition: 'error', expected: test.error, actual: null })
  }
}

// ---- tree tests -------------------------------------------------------------------

function runTreeTest(document: BlueprintDocument, evaluator: Evaluator, test: TreeTest, outcome: TestOutcome, options: RunTestsOptions): void {
  const render = typeof test.render === 'string' ? { template: test.render } : test.render
  if (!document.content.templates?.[render.template]) throw new BlueprintError('UNKNOWN_TEMPLATE', `test "${test.name}" renders unknown template "${render.template}"`)
  const scope = scopeOf(document, test, { params: render.params || {}, page: render.template })
  for (const [name, logic] of Object.entries(render.with || {})) scope.vars[name] = evaluator.evaluate(logic, scope)
  const tree = evaluateTemplate(evaluator, render.template, scope, { available: options.available })
  if (test.tree !== undefined) {
    const actual = JSON.parse(canonicalize(tree))
    const expected = JSON.parse(canonicalize(test.tree))
    if (!deepEqual(actual, expected)) {
      outcome.passed = false
      outcome.failures.push({ definition: 'tree', expected, actual })
    }
  }
  for (const [index, wanted] of (test.contains || []).entries()) {
    if (!treeContains(tree, wanted)) {
      outcome.passed = false
      outcome.failures.push({ definition: `contains[${index}]`, expected: wanted, actual: summarize(tree) })
    }
  }
}

/** Text of a node: its own text, or the text of its direct text children. */
export function textOf(node: AbstractNode): string {
  if (node.kind === 'text') return node.text || ''
  return (node.children || []).filter(child => child.kind === 'text').map(child => child.text || '').join('')
}

export function treeContains(nodes: AbstractNode[], wanted: { as?: string, kind?: string, text?: string, props?: Record<string, unknown> }): boolean {
  for (const node of nodes) {
    const matches = (wanted.as === undefined || node.as === wanted.as)
      && (wanted.kind === undefined || node.kind === wanted.kind)
      && (wanted.text === undefined || textOf(node) === wanted.text)
      && (wanted.props === undefined || deepSubset(wanted.props, node.props || {}))
    if (matches) return true
    const inside = [...(node.children || []), ...Object.values(node.slots || {}).flat()]
    if (inside.length && treeContains(inside, wanted)) return true
  }
  return false
}

function summarize(nodes: AbstractNode[]): unknown[] {
  return nodes.map(node => ({ as: node.as, kind: node.kind, text: textOf(node) || undefined, ...(node.children ? { children: summarize(node.children) } : {}) }))
}

// ---- deep subset ---------------------------------------------------------------------

/** Every key of `expected` deep-equal in `actual`; arrays by position and length. */
export function deepSubset(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false
    return expected.every((item, index) => deepSubset(item, actual[index]))
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false
    return Object.entries(expected).every(([key, value]) => deepSubset(value, actual[key]))
  }
  return deepEqual(expected, actual)
}

function checkSubset(where: string, expected: unknown, actual: unknown, outcome: TestOutcome): void {
  if (!deepSubset(expected, actual)) {
    outcome.passed = false
    outcome.failures.push({ definition: where, expected, actual })
  }
}

// ---- stubs -----------------------------------------------------------------------------

interface StubBook {
  answer: (capability: string, call: Record<string, unknown>) => unknown
  seeds: Record<string, unknown[]>
}

function stubBookOf(stubs: Record<string, EffectStub[] | Record<string, unknown[]>> = {}): StubBook {
  const lists = new Map<string, Array<EffectStub & { used?: boolean }>>()
  const seeds: Record<string, unknown[]> = {}
  for (const [capability, entry] of Object.entries(stubs)) {
    if (Array.isArray(entry)) lists.set(capability, entry.map(stub => ({ ...stub })))
    else Object.assign(seeds, entry)
  }
  return {
    seeds,
    answer(capability, call) {
      const list = lists.get(capability) || []
      const stub = list.find(candidate => !candidate.used && (candidate.match === undefined || deepSubset(candidate.match, call)))
        || list.find(candidate => (candidate as { repeat?: boolean }).repeat && (candidate.match === undefined || deepSubset(candidate.match, call)))
      if (!stub) throw new BlueprintError('UNSTUBBED_EFFECT', `${capability} call ${JSON.stringify(call)} has no stub`)
      stub.used = true
      if (stub.result.ok) return stub.result.value
      throw new BlueprintError(stub.result.error.code as 'UNKNOWN_ACTION', stub.result.error.message || stub.result.error.code, { issues: stub.result.error.issues, status: stub.result.error.status })
    },
  }
}

/** Records seeded by a scenario get the fields the runtime would have added. */
function seededStore(seeds: Record<string, unknown[]>, now: string): CollectionStore {
  const records: Record<string, StoredRecord[]> = {}
  for (const [collection, items] of Object.entries(seeds)) {
    records[collection] = items.map((item, index) => ({ id: `${collection}-${index + 1}`, createdAt: now, ...(item as Record<string, unknown>) }))
  }
  return createMemoryStore(records)
}

// ---- action scenarios ----------------------------------------------------------------

async function runActionScenario(document: BlueprintDocument, evaluator: Evaluator, test: ActionScenario, outcome: TestOutcome, options: RunTestsOptions): Promise<void> {
  const now = options.now || (() => FIXED_NOW)
  const book = stubBookOf(test.stubs)
  const scope = scopeOf(document, test, { now: now() })
  const log: EffectEntry[] = []
  const effects: ActionEffects = {
    navigate: (to, params, query) => { book.answer('web.router', { type: 'navigate', to, params, query }) },
    toast: (toast) => { book.answer('ui.toast', { type: 'toast', ...toast }) },
    submit: async input => book.answer('http.client', { type: 'submit', ...input }),
    fetch: async input => book.answer('http.client', { type: 'fetch', ...input }),
    log: () => {},
  }
  const store = seededStore(book.seeds, now())
  const ctx: ActionContext = {
    evaluator,
    state: scope.state,
    context: scope.context,
    initialState: deepClone(document.content.state || {}),
    effects,
    extensions: createServerActions({ document, store, now }),
    log,
    step: typeof test.run === 'string' ? `actions.${test.run}` : `tests.${test.name}`,
  }
  let result: ActionResult
  try {
    result = await runActions(test.run, ctx)
  }
  catch (caught) {
    result = { ok: false, error: toFailure(caught) }
  }
  outcome.effects = log
  await checkAfter(document, evaluator, test, result, { state: scope.state, context: scope.context, log, store }, outcome)
}

async function checkAfter(
  document: BlueprintDocument,
  evaluator: Evaluator,
  test: ActionScenario | EndpointScenario,
  result: ActionResult | null,
  run: { state: Record<string, unknown>, context: Record<string, unknown>, log: EffectEntry[], store: CollectionStore },
  outcome: TestOutcome,
): Promise<void> {
  if (test.error !== undefined && result) {
    const code = result.ok ? null : toFailure(result.error).code
    if (code !== test.error) {
      outcome.passed = false
      outcome.failures.push({ definition: 'error', expected: test.error, actual: code })
    }
  }
  else if (result && !result.ok && !('response' in test)) {
    outcome.passed = false
    outcome.failures.push({ definition: 'error', expected: null, actual: toFailure(result.error) })
  }
  const after = test.after
  if (!after) return
  if (after.state) checkSubset('after.state', after.state, run.state, outcome)
  if (after.effects) {
    const actual = run.log.map(entry => ({ capability: entry.capability, type: entry.type, ...entry.input }))
    if (actual.length !== after.effects.length) checkSubset('after.effects', after.effects, actual, outcome)
    else after.effects.forEach((expected, index) => checkSubset(`after.effects[${index}]`, expected, actual[index], outcome))
  }
  if (after.expect) {
    const scope = { state: run.state, context: run.context, vars: {} }
    evaluator.batch((evaluate) => {
      for (const [definition, expected] of Object.entries(after.expect || {})) {
        const actual = evaluate({ def: definition }, scope)
        if (!deepEqual(actual, expected)) {
          outcome.passed = false
          outcome.failures.push({ definition: `after.expect.${definition}`, expected, actual })
        }
      }
    })
  }
  for (const [collection, expected] of Object.entries(after.collections || {})) {
    const records = await run.store.all(collection)
    checkSubset(`after.collections.${collection}`, expected, records, outcome)
  }
}

// ---- endpoint scenarios ------------------------------------------------------------

async function runEndpointScenario(document: BlueprintDocument, test: EndpointScenario, outcome: TestOutcome, options: RunTestsOptions): Promise<void> {
  if (options.provides && !options.provides.some(entry => entry.name === 'http.endpoints')) {
    outcome.skipped = 'http.endpoints is not provided by this runtime'
    outcome.passed = false
    return
  }
  const now = options.now || (() => FIXED_NOW)
  const book = stubBookOf(test.stubs)
  const store = seededStore(book.seeds, now())
  const request = test.request
  let method = request.method
  let path = request.path
  if (request.endpoint) {
    const endpoint = document.content.endpoints?.[request.endpoint]
    if (!endpoint) throw new BlueprintError('UNKNOWN_ENDPOINT', `test "${test.name}" requests unknown endpoint "${request.endpoint}"`)
    method = endpoint.method
    path = endpoint.path.replace(/:(\w+)/g, (_match, key: string) => {
      const value = request.params?.[key]
      if (value === undefined) throw new BlueprintError('MISSING_PARAM', `test "${test.name}" needs param "${key}"`)
      return encodeURIComponent(String(value))
    })
  }
  if (!method || !path) throw new BlueprintError('INVALID_TEST', `test "${test.name}" needs request.endpoint or request.method + request.path`)
  const resolved = resolveEndpoint(document, method, path)
  const log: EffectEntry[] = []
  const context = test.context || {}
  const response = resolved
    ? await runEndpoint(document, resolved, { method, path, query: request.query, body: request.body }, { store, now, log, version: typeof context.version === 'string' ? context.version : undefined, context })
    : { status: 404, body: { statusCode: 404, message: `no endpoint answers ${method} ${path}` } }
  outcome.effects = log
  if (test.response?.status !== undefined && response.status !== test.response.status) {
    outcome.passed = false
    outcome.failures.push({ definition: 'response.status', expected: test.response.status, actual: `${response.status} ${JSON.stringify(response.body)}` })
  }
  if (test.response?.body !== undefined) checkSubset('response.body', test.response.body, response.body, outcome)
  await checkAfter(document, createEvaluator(document), test, null, { state: {}, context, log, store }, outcome)
}

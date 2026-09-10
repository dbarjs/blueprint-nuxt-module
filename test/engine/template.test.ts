import { describe, expect, it } from 'vitest'
import { createEvaluator } from '../../src/runtime/engine/logic'
import { evaluateTemplate, matchRoute, resolvePage } from '../../src/runtime/engine/template'
import { refsOfDocument, closure } from '../../src/runtime/engine/refs'
import { validateDocument } from '../../src/runtime/engine/validate'
import { runActions } from '../../src/runtime/engine/actions'
import type { BlueprintDocument } from '../../src/runtime/engine/types'

const document: BlueprintDocument = {
  name: 'shop',
  content: {
    meta: { title: 'Shop', layout: 'component:shell' },
    resources: { products: { type: 'list', data: [{ id: 'a', name: 'Apple', price: 100 }, { id: 'b', name: 'Bread', price: 250 }] } },
    schemas: { customer: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2 } } } },
    state: { lines: [], customer: { name: '' } },
    definitions: {
      count: { logic: { sum: [{ state: 'lines' }, 'quantity'] } },
    },
    actions: {
      add: [
        { type: 'push', path: 'lines', value: { obj: { productId: { var: 'product.id' }, quantity: 1 } } },
        { type: 'toast', title: { cat: ['Added ', { var: 'product.name' }] } },
      ],
    },
    templates: {
      'component:shell': [
        { type: 'component', as: 'Stack', children: [{ type: 'outlet' }], bind: { count: { def: 'count' } } },
      ],
      'component:row': [
        { type: 'text', content: { cat: [{ var: 'label' }, ': ', { var: 'value' }] } },
      ],
      'page:index': {
        route: '/',
        children: [
          { type: 'for', in: { resource: 'products' }, as: 'product', key: 'id', children: [
            { type: 'component', as: 'Button', bind: { label: { var: 'product.name' } }, on: { click: 'add' } },
          ] },
          { type: 'if', condition: { '>': [{ def: 'count' }, 0] }, children: [{ type: 'text', content: 'has items' }], else: [{ type: 'text', content: 'empty' }] },
          { type: 'template', name: 'component:row', with: { label: 'Count', value: { def: 'count' } } },
          { type: 'component', as: 'Input', model: 'customer.name', if: false },
          { type: 'component', as: 'Input', for: { in: { state: 'lines' }, as: 'line' }, model: 'lines.{index}.quantity' },
        ],
      },
      'page:product': { route: '/product/:id', children: [{ type: 'text', content: { context: 'params.id' } }] },
    },
  },
}

const ev = createEvaluator(document)

describe('template evaluation', () => {
  it('expands loops, decides conditions, substitutes bindings and assigns keys', () => {
    const tree = evaluateTemplate(ev, 'page:index', { state: { lines: [], customer: { name: '' } }, context: {}, vars: {} })
    expect(tree.map(node => node.kind)).toEqual(['component', 'component', 'text', 'text'])
    expect(tree[0]!.key).toBe('page:index.0[a].0')
    expect(tree[0]!.props).toEqual({ label: 'Apple' })
    expect(tree[0]!.on!.click!.vars.product).toEqual({ id: 'a', name: 'Apple', price: 100 })
    expect(tree[2]!.text).toBe('empty')
    expect(tree[3]!.text).toBe('Count: 0')
  })

  it('interpolates loop variables in model paths and re-evaluates with state', () => {
    const tree = evaluateTemplate(ev, 'page:index', { state: { lines: [{ quantity: 2 }], customer: { name: '' } }, context: {}, vars: {} })
    const input = tree.find(node => node.as === 'Input')!
    expect(input.model).toEqual({ path: 'lines.0.quantity', prop: 'modelValue' })
    expect(tree.find(node => node.text === 'has items')).toBeTruthy()
  })

  it('wraps the page in the layout through the outlet', () => {
    const scope = { state: { lines: [], customer: { name: '' } }, context: {}, vars: {} }
    const page = evaluateTemplate(ev, 'page:index', scope)
    const tree = evaluateTemplate(ev, 'component:shell', scope, { outlet: page })
    expect(tree[0]!.as).toBe('Stack')
    expect(tree[0]!.children!.length).toBe(page.length)
  })

  it('matches routes with params and prefers static routes', () => {
    expect(matchRoute('/product/:id', '/product/42')).toEqual({ id: '42' })
    expect(matchRoute('/product/:id', '/cart')).toBeNull()
    expect(resolvePage(document, '/')!.name).toBe('page:index')
    expect(resolvePage(document, '/product/b')).toMatchObject({ name: 'page:product', params: { id: 'b' } })
    expect(resolvePage(document, '/nope')).toBeNull()
  })
})

describe('refs() and validation', () => {
  it('collects static references per section', () => {
    const refs = refsOfDocument(document)
    expect([...refs['templates.page:index']!.actions]).toEqual(['add'])
    expect([...refs['templates.page:index']!.resources]).toEqual(['products'])
    expect([...refs['templates.page:index']!.templates]).toEqual(['component:row'])
    expect([...refs['actions.add']!.statePaths]).toEqual(['lines'])
    expect([...closure(document, ['templates.page:index'])]).toContain('definitions.count')
  })

  it('rejects dynamic references', () => {
    const broken = structuredClone(document)
    broken.content.definitions!.dynamic = { logic: { def: { cat: ['co', 'unt'] } } }
    const report = validateDocument(broken)
    expect(report.issues.some(issue => issue.code === 'DYNAMIC_REFERENCE')).toBe(true)
  })

  it('reports unknown references, cycles and duplicate routes', () => {
    const broken = structuredClone(document)
    broken.content.templates['page:other'] = { route: '/', children: [{ type: 'template', name: 'component:missing' }] }
    broken.content.definitions!.a = { logic: { def: 'b' } }
    broken.content.definitions!.b = { logic: { def: 'a' } }
    const codes = validateDocument(broken).issues.map(issue => issue.code)
    expect(codes).toContain('DUPLICATE_ROUTE')
    expect(codes).toContain('UNKNOWN_TEMPLATE')
    expect(codes).toContain('DEFINITION_CYCLE')
  })

  it('reports the vocabulary layers', () => {
    const report = validateDocument(document, { registry: { base: ['Stack', 'Button', 'Input'], nuxtUi: ['UButton'], app: [] } })
    expect(report.issues.filter(issue => issue.level === 'error')).toEqual([])
    expect(report.portability.base).toEqual(['Button', 'Input', 'Stack'])
  })
})

describe('actions', () => {
  it('mutates state and delegates effects', async () => {
    const state: Record<string, unknown> = { lines: [], customer: { name: '' } }
    const toasts: unknown[] = []
    const result = await runActions('add', {
      evaluator: ev,
      state,
      context: {},
      initialState: { lines: [] },
      effects: { toast: toast => toasts.push(toast) },
    }, { product: { id: 'a', name: 'Apple' } })
    expect(result.ok).toBe(true)
    expect(state.lines).toEqual([{ productId: 'a', quantity: 1 }])
    expect(toasts).toEqual([{ title: 'Added Apple', description: undefined, color: undefined, icon: undefined }])
  })

  it('validates before submitting and reports issues', async () => {
    const state: Record<string, unknown> = { lines: [], customer: { name: 'A' } }
    const submitted: unknown[] = []
    const result = await runActions({ type: 'submit', schema: 'customer', path: 'customer' }, {
      evaluator: ev,
      state,
      context: {},
      initialState: {},
      effects: { submit: async input => submitted.push(input) },
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ path: 'name', message: 'must have at least 2 characters' }])
    expect(submitted).toEqual([])
  })

  it('increments within bounds, removes by predicate and resets', async () => {
    const state: Record<string, unknown> = { lines: [{ id: 1, quantity: 1 }, { id: 2, quantity: 3 }], n: 0 }
    const ctx = { evaluator: ev, state, context: {}, initialState: { lines: [], n: 0 }, effects: {} }
    await runActions({ type: 'increment', path: 'n', by: 5, max: 3 }, ctx)
    expect(state.n).toBe(3)
    await runActions({ type: 'remove', path: 'lines', where: { '==': [{ var: 'item.id' }, 1] } }, ctx)
    expect(state.lines).toEqual([{ id: 2, quantity: 3 }])
    await runActions({ type: 'reset' }, ctx)
    expect(state).toEqual({ lines: [], n: 0 })
  })
})

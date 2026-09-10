import { describe, expect, it } from 'vitest'
import { createEvaluator, roundDecimal } from '../../src/runtime/engine/logic'
import { BlueprintError } from '../../src/runtime/engine/errors'
import type { BlueprintDocument } from '../../src/runtime/engine/types'

const document: BlueprintDocument = {
  name: 'fixture',
  content: {
    meta: { title: 'Fixture', currency: 'USD', locale: 'en-US' },
    resources: {
      rates: { type: 'constant', data: { tax: 8.5 } },
      items: { type: 'list', data: [{ id: 'a', price: 100 }, { id: 'b', price: 250 }] },
      zones: {
        type: 'parameter-table',
        hitPolicy: 'first',
        default: { fee: null },
        data: [
          { match: { code: { prefix: '94' }, weight: { gte: 0, lt: 5 } }, fee: 1 },
          { match: { code: { prefix: '94' }, weight: { gte: 5 } }, fee: 2 },
        ],
      },
      overlap: {
        type: 'parameter-table',
        hitPolicy: 'unique',
        data: [
          { match: { age: { gte: 18, lte: 25 } }, factor: 1 },
          { match: { age: { gte: 25, lte: 35 } }, factor: 2 },
        ],
      },
    },
    schemas: {},
    definitions: {
      subtotal: { logic: { sum: [{ state: 'lines' }, 'total'] } },
      tax: { logic: { percentOf: [{ def: 'subtotal' }, { resource: ['rates', 'tax'] }] } },
      total: { logic: { '+': [{ def: 'subtotal' }, { def: 'tax' }] } },
      loopA: { logic: { def: 'loopB' } },
      loopB: { logic: { def: 'loopA' } },
    },
    templates: {},
  },
}

const ev = createEvaluator(document)
const scope = (state: Record<string, unknown> = {}, vars: Record<string, unknown> = {}) => ({ state, context: {}, vars })

describe('calculation notation', () => {
  it('evaluates literals and arrays element-wise', () => {
    expect(ev.evaluate(1, scope())).toBe(1)
    expect(ev.evaluate([1, { '+': [1, 1] }], scope())).toEqual([1, 2])
  })

  it('reads state, resources and definitions', () => {
    const state = { lines: [{ total: 1000 }, { total: 250 }] }
    expect(ev.evaluate({ def: 'subtotal' }, scope(state))).toBe(1250)
    expect(ev.evaluate({ def: 'tax' }, scope(state))).toBe(106)
    expect(ev.evaluate({ def: 'total' }, scope(state))).toBe(1356)
    expect(ev.evaluate({ resource: ['rates', 'tax'] }, scope())).toBe(8.5)
  })

  it('reads context by dotted path or path segments', () => {
    const withContext = { state: {}, context: { params: { id: '42' }, app: 'x' }, vars: {} }
    expect(ev.evaluate({ context: 'params.id' }, withContext)).toBe('42')
    expect(ev.evaluate({ context: ['params', 'id'] }, withContext)).toBe('42')
    expect(ev.evaluate({ context: 'app' }, withContext)).toBe('x')
  })

  it('memoizes definitions within a pass and detects cycles', () => {
    expect(() => ev.evaluate({ def: 'loopA' }, scope())).toThrowError(/DEFINITION_CYCLE/)
  })

  it('supports let, obj, map with alias, filter, find and findBy', () => {
    const result = ev.evaluate({
      let: [
        { items: { resource: 'items' } },
        { obj: {
          ids: { map: [{ var: 'items' }, { var: 'item.id' }, 'item'] },
          expensive: { filter: [{ var: 'items' }, { '>': [{ var: 'price' }, 200] }] },
          b: { findBy: [{ var: 'items' }, 'id', 'b'] },
        } },
      ],
    }, scope())
    expect(result).toEqual({ ids: ['a', 'b'], expensive: [{ id: 'b', price: 250 }], b: { id: 'b', price: 250 } })
  })

  it('rounds on the decimal representation, half-up', () => {
    expect(roundDecimal(1.005, 2)).toBe(1.01)
    expect(roundDecimal(2.5, 0)).toBe(3)
    expect(roundDecimal(2.5, 0, 'half-even')).toBe(2)
    expect(ev.evaluate({ round: [0.1 + 0.2, 2] }, scope())).toBe(0.3)
    expect(ev.evaluate({ percentOf: [4365, 8.5] }, scope())).toBe(371)
  })

  it('refuses division by zero and non-numeric arithmetic', () => {
    expect(() => ev.evaluate({ '/': [1, 0] }, scope())).toThrowError(BlueprintError)
    expect(() => ev.evaluate({ '*': ['abc', 2] }, scope())).toThrowError(/NOT_A_NUMBER/)
  })

  it('formats money stored as cents', () => {
    expect(ev.evaluate({ format: [1234, 'currency'] }, scope())).toBe('$12.34')
    expect(ev.evaluate({ format: [90, 'minutes'] }, scope())).toBe('1 h 30 min')
  })

  it('looks up parameter tables with prefix and range matching', () => {
    expect(ev.evaluate({ lookup: ['zones', { obj: { code: '94110', weight: 2 } }] }, scope())).toEqual({ fee: 1 })
    expect(ev.evaluate({ lookup: ['zones', { obj: { code: '94110', weight: 5 } }] }, scope())).toEqual({ fee: 2 })
    expect(ev.evaluate({ lookup: ['zones', { obj: { code: '10001', weight: 5 } }] }, scope())).toEqual({ fee: null })
  })

  it('rejects ambiguous matches under the unique hit policy', () => {
    expect(ev.evaluate({ lookup: ['overlap', { obj: { age: 20 } }] }, scope())).toEqual({ factor: 1 })
    expect(() => ev.evaluate({ lookup: ['overlap', { obj: { age: 25 } }] }, scope())).toThrowError(/LOOKUP_AMBIGUOUS/)
    expect(() => ev.evaluate({ lookup: ['overlap', { obj: { age: 40 } }] }, scope())).toThrowError(/LOOKUP_NO_MATCH/)
  })

  it('short-circuits and/or and supports if chains', () => {
    expect(ev.evaluate({ and: [true, 0, { '/': [1, 0] }] }, scope())).toBe(0)
    expect(ev.evaluate({ or: [0, 'x', { '/': [1, 0] }] }, scope())).toBe('x')
    expect(ev.evaluate({ if: [false, 'a', false, 'b', 'c'] }, scope())).toBe('c')
  })

  it('compares loosely with == and deeply with ===', () => {
    expect(ev.evaluate({ '==': ['1', 1] }, scope())).toBe(true)
    expect(ev.evaluate({ '===': [[{ obj: { a: 1 } }], [{ obj: { a: 1 } }]] }, scope())).toBe(true)
    expect(ev.evaluate({ '===': ['1', 1] }, scope())).toBe(false)
  })

  it('rejects unknown operators and malformed expressions', () => {
    expect(() => ev.evaluate({ nope: [1] }, scope())).toThrowError(/UNKNOWN_OPERATOR/)
    expect(() => ev.evaluate({ a: 1, b: 2 } as never, scope())).toThrowError(/exactly one operator/)
  })
})

describe('JSON Logic compatibility', () => {
  it('supports the standard operator names', () => {
    const state = { a: 1, b: '', c: null }
    expect(ev.evaluate({ missing: ['a', 'b', 'c', 'd'] }, scope(state))).toEqual(['b', 'c', 'd'])
    expect(ev.evaluate({ missing_some: [1, ['a', 'b']] }, scope(state))).toEqual([])
    expect(ev.evaluate({ missing_some: [2, ['a', 'b']] }, scope(state))).toEqual(['b'])
    expect(ev.evaluate({ '?:': [true, 'yes', 'no'] }, scope())).toBe('yes')
    expect(ev.evaluate({ all: [[1, 2], { '>': [{ var: '' }, 0] }] }, scope())).toBe(true)
    expect(ev.evaluate({ all: [[], { '>': [{ var: '' }, 0] }] }, scope())).toBe(false)
    expect(ev.evaluate({ none: [[1, 2], { '>': [{ var: '' }, 5] }] }, scope())).toBe(true)
    expect(ev.evaluate({ substr: ['jsonlogic', 4] }, scope())).toBe('logic')
    expect(ev.evaluate({ substr: ['jsonlogic', -5] }, scope())).toBe('logic')
    expect(ev.evaluate({ substr: ['jsonlogic', 1, 3] }, scope())).toBe('son')
    expect(ev.evaluate({ substr: ['jsonlogic', 4, -2] }, scope())).toBe('log')
    expect(ev.evaluate({ cat: ['I love ', { var: 'filling' }, ' pie'] }, scope({}, { filling: 'apple' }))).toBe('I love apple pie')
    expect(ev.evaluate({ in: ['Ringo', ['John', 'Paul', 'George', 'Ringo']] }, scope())).toBe(true)
    expect(ev.evaluate({ merge: [[1, 2], [3, 4]] }, scope())).toEqual([1, 2, 3, 4])
    expect(ev.evaluate({ map: [[1, 2, 3], { '*': [{ var: '' }, 2] }] }, scope())).toEqual([2, 4, 6])
    expect(ev.evaluate({ reduce: [[1, 2, 3], { '+': [{ var: 'current' }, { var: 'accumulator' }] }, 0] }, scope())).toBe(6)
  })
})

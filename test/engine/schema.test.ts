import { describe, expect, it } from 'vitest'
import { toStandardSchema, validateSchema } from '../../src/runtime/engine/schema'
import { canonicalize, hashDocument } from '../../src/runtime/engine/hash'

const schema = {
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name: { type: 'string', minLength: 2, message: 'Tell us your name' },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 18 },
    tags: { type: 'array', minItems: 1, items: { type: 'string' } },
    address: { type: 'object', properties: { zip: { type: 'string', pattern: '^\\d{5}$' } } },
  },
}

describe('schema validator', () => {
  it('reports required, format, range and nested issues with paths', () => {
    const issues = validateSchema(schema, { name: '', email: 'nope', age: 12, tags: [1], address: { zip: 'abc' } })
    expect(issues).toEqual([
      { path: 'name', message: 'Tell us your name' },
      { path: 'email', message: 'is not a valid email' },
      { path: 'age', message: 'must be at least 18' },
      { path: 'tags.0', message: 'must be string' },
      { path: 'address.zip', message: 'has an invalid format' },
    ])
  })

  it('treats blank optional values as absent and blank required values as missing', () => {
    expect(validateSchema(schema, { name: 'Ana', email: 'ana@example.com', tags: [] })).toEqual([])
    expect(validateSchema({ ...schema, required: ['tags'] }, { name: 'Ana', email: 'ana@example.com', tags: [] })).toEqual([
      { path: 'tags', message: 'is required' },
    ])
  })

  it('passes valid values and skips blank optionals', () => {
    expect(validateSchema(schema, { name: 'Ana', email: 'ana@example.com' })).toEqual([])
  })

  it('exposes a Standard Schema for UForm', () => {
    const standard = toStandardSchema(schema)['~standard']
    expect(standard.validate({ name: 'Ana', email: 'ana@example.com' })).toEqual({ value: { name: 'Ana', email: 'ana@example.com' } })
    expect(standard.validate({ name: 'A', email: 'x' })).toEqual({
      issues: [
        { message: 'Tell us your name', path: ['name'] },
        { message: 'is not a valid email', path: ['email'] },
      ],
    })
  })
})

describe('canonical hash', () => {
  it('is independent of key order and whitespace', () => {
    expect(canonicalize({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}')
    expect(hashDocument({ b: 1, a: 2 })).toBe(hashDocument({ a: 2, b: 1 }))
    expect(hashDocument({ a: 1 })).not.toBe(hashDocument({ a: 2 }))
  })
})

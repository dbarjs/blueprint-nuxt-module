/**
 * JSON Schema subset validator.
 *
 * One source of truth: the same validator runs in the build (document tests),
 * in the `validate`/`submit` actions and inside `UForm` through the Standard
 * Schema adapter (`toStandardSchema`).
 */
import type { BlueprintDocument, EvalScope, JsonSchema, Logic, ValidationIssue } from './types'
import { BlueprintError } from './errors'
import { isPlainObject } from './path'
import type { Evaluator } from './logic'
import { truthy } from './logic'

export interface ValidateOptions {
  document?: BlueprintDocument
  /** Needed to evaluate `requiredWhen` expressions. */
  evaluator?: Evaluator
  scope?: EvalScope
}

const FORMATS: Record<string, RegExp> = {
  'email': /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/,
  'phone': /^\+?[\d\s().-]{7,20}$/,
  'postal-code': /^[A-Z0-9][A-Z0-9 -]{2,9}$/i,
  'date': /^\d{4}-\d{2}-\d{2}$/,
  'time': /^\d{2}:\d{2}$/,
  'card-number': /^\d{13,19}$/,
  'card-expiry': /^(0[1-9]|1[0-2])\/\d{2}$/,
  'card-cvc': /^\d{3,4}$/,
}

function resolveRef(schema: JsonSchema, options: ValidateOptions): JsonSchema {
  if (!schema.$ref) return schema
  const match = /^#\/schemas\/([^/]+)$/.exec(schema.$ref)
  const target = match && options.document?.content.schemas?.[match[1]!]
  if (!target) throw new BlueprintError('UNKNOWN_SCHEMA', `cannot resolve ${schema.$ref}`)
  return { ...target, ...schema, $ref: undefined }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

function typeMatches(expected: string, value: unknown): boolean {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  return expected === actual
}

const isBlank = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

export function validateSchema(schema: JsonSchema, value: unknown, options: ValidateOptions = {}, path = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const node = resolveRef(schema, options)
  const fail = (message: string) => {
    issues.push({ path, message: node.message || message })
  }

  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type]
    if (value !== undefined && !types.some(type => typeMatches(type, value))) {
      fail(`must be ${types.join(' or ')}`)
      return issues
    }
  }
  if (value === undefined) return issues

  if (node.enum && !node.enum.includes(value)) fail(`must be one of ${node.enum.map(String).join(', ')}`)
  if (node.const !== undefined && node.const !== value) fail(`must be ${String(node.const)}`)

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.trim().length < node.minLength) fail(node.minLength === 1 ? 'is required' : `must have at least ${node.minLength} characters`)
    if (node.maxLength !== undefined && value.length > node.maxLength) fail(`must have at most ${node.maxLength} characters`)
    if (node.pattern && !new RegExp(node.pattern).test(value)) fail('has an invalid format')
    if (node.format && value !== '' && FORMATS[node.format] && !FORMATS[node.format]!.test(value)) fail(`is not a valid ${node.format.replace('-', ' ')}`)
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) fail(`must be at least ${node.minimum}`)
    if (node.maximum !== undefined && value > node.maximum) fail(`must be at most ${node.maximum}`)
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) fail(`must be greater than ${node.exclusiveMinimum}`)
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) fail(`must be less than ${node.exclusiveMaximum}`)
    if (node.multipleOf !== undefined && Math.abs(value / node.multipleOf - Math.round(value / node.multipleOf)) > 1e-9) fail(`must be a multiple of ${node.multipleOf}`)
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) fail(node.minItems === 1 ? 'must not be empty' : `must have at least ${node.minItems} items`)
    if (node.maxItems !== undefined && value.length > node.maxItems) fail(`must have at most ${node.maxItems} items`)
    if (node.items) value.forEach((item, index) => issues.push(...validateSchema(node.items!, item, options, join(path, String(index)))))
  }

  if (isPlainObject(value) && node.properties) {
    const required = new Set(node.required || [])
    for (const [key, child] of Object.entries(node.properties)) {
      const childPath = join(path, key)
      const childValue = value[key]
      const childNode = resolveRef(child, options)
      let isRequired = required.has(key)
      if (childNode.requiredWhen !== undefined && options.evaluator && options.scope) {
        isRequired = truthy(options.evaluator.evaluate(childNode.requiredWhen as Logic, {
          ...options.scope,
          vars: { ...options.scope.vars, '': value, 'self': value },
        }))
      }
      if (isRequired && isBlank(childValue)) {
        issues.push({ path: childPath, message: childNode.message || 'is required' })
        continue
      }
      if (isBlank(childValue)) continue
      issues.push(...validateSchema(child, childValue, options, childPath))
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in node.properties)) issues.push({ path: join(path, key), message: 'is not allowed' })
      }
    }
  }

  return issues
}

function join(base: string, key: string) {
  return base ? `${base}.${key}` : key
}

/** Standard Schema V1 wrapper so `UForm` validates with the engine. */
export interface StandardSchemaLike<T = unknown> {
  '~standard': {
    version: 1
    vendor: string
    validate: (value: unknown) => { value: T } | { issues: Array<{ message: string, path: string[] }> }
  }
}

export function toStandardSchema<T = unknown>(schema: JsonSchema, options: ValidateOptions = {}): StandardSchemaLike<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'blueprint',
      validate: (value: unknown) => {
        const issues = validateSchema(schema, value, options)
        if (issues.length === 0) return { value: value as T }
        return { issues: issues.map(issue => ({ message: issue.message, path: issue.path.split('.').filter(Boolean) })) }
      },
    },
  }
}

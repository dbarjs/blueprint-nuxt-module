/**
 * Calculation notation evaluator (JSON Logic-like).
 *
 * An expression is either a literal (null, boolean, number, string), an
 * array (each element evaluated), or an object with exactly one key: the
 * operator. Arguments are evaluated before the operator runs, except for
 * the lazy operators (`if`, `and`, `or`, `map`, `filter`, `reduce`, ...).
 *
 * Data access operators:
 *   { "state": "cart.lines" }            mutable state (payload) path
 *   { "def": "subtotal" }                definition (memoized per pass)
 *   { "resource": "products" }           resource data
 *   { "resource": ["settings", "tax"] }  path inside resource data
 *   { "context": "params.id" }           route params, query, now, app
 *   { "var": "item.price" }              loop / action variable
 *
 * The evaluator is pure: same document + scope → same result.
 */
import type { BlueprintDocument, EvalScope, Logic } from './types'
import { BlueprintError } from './errors'
import { getPath, deepEqual, isPlainObject } from './path'
import { formatValue, type FormatKind } from './format'

export interface EvaluatorOptions {
  /** Custom operators, namespaced by the solution (`ns:name`). */
  operators?: Record<string, OperatorFn>
}

export type OperatorFn = (args: unknown[], scope: EvalScope, ev: Evaluator, raw: unknown) => unknown

interface Pass {
  cache: Map<string, unknown>
  resolving: Set<string>
}

export class Evaluator {
  readonly document: BlueprintDocument
  private operators: Record<string, OperatorFn>
  private pass: Pass | null = null

  constructor(document: BlueprintDocument, options: EvaluatorOptions = {}) {
    this.document = document
    this.operators = { ...builtinOperators, ...(options.operators || {}) }
  }

  /** Evaluate with a fresh definition cache. */
  evaluate(logic: Logic, scope: EvalScope): unknown {
    const previous = this.pass
    this.pass = previous ?? { cache: new Map(), resolving: new Set() }
    try {
      return this.eval(logic, scope)
    }
    finally {
      this.pass = previous
    }
  }

  /** Evaluate several expressions sharing one definition cache. */
  batch<T>(fn: (evaluate: (logic: Logic, scope: EvalScope) => unknown) => T): T {
    const previous = this.pass
    this.pass = { cache: new Map(), resolving: new Set() }
    try {
      return fn((logic, scope) => this.eval(logic, scope))
    }
    finally {
      this.pass = previous
    }
  }

  /** Resolve a definition by name (memoized inside a pass). */
  definition(name: string, scope: EvalScope): unknown {
    const definitions = this.document.content.definitions || {}
    const definition = definitions[name]
    if (!definition) throw new BlueprintError('UNKNOWN_DEFINITION', `definition "${name}" does not exist`)
    const pass = this.pass!
    // Definitions only depend on state and context, never on loop variables,
    // so the memo key is the name alone.
    if (pass.cache.has(name)) return pass.cache.get(name)
    if (pass.resolving.has(name)) {
      throw new BlueprintError('DEFINITION_CYCLE', `definition "${name}" references itself (${[...pass.resolving].join(' → ')} → ${name})`)
    }
    pass.resolving.add(name)
    try {
      const value = this.eval(definition.logic, { state: scope.state, context: scope.context, vars: {} })
      pass.cache.set(name, value)
      return value
    }
    finally {
      pass.resolving.delete(name)
    }
  }

  /** Evaluate every public (or all) definitions. */
  definitions(scope: EvalScope, includePrivate = true): Record<string, unknown> {
    return this.batch(() => {
      const out: Record<string, unknown> = {}
      for (const [name, definition] of Object.entries(this.document.content.definitions || {})) {
        if (!includePrivate && definition.visibility === 'private') continue
        out[name] = this.definition(name, scope)
      }
      return out
    })
  }

  resource(name: string, path?: string): unknown {
    const resource = this.document.content.resources?.[name]
    if (!resource) throw new BlueprintError('UNKNOWN_RESOURCE', `resource "${name}" does not exist`)
    return path ? getPath(resource.data, path) : resource.data
  }

  eval(logic: Logic, scope: EvalScope): unknown {
    if (logic === null || typeof logic !== 'object') return logic
    if (Array.isArray(logic)) return logic.map(item => this.eval(item as Logic, scope))
    const keys = Object.keys(logic)
    if (keys.length !== 1) {
      throw new BlueprintError('INVALID_ARGUMENTS', `an expression object must have exactly one operator key, got ${JSON.stringify(keys)}`)
    }
    const operator = keys[0]!
    const fn = this.operators[operator]
    if (!fn) throw new BlueprintError('UNKNOWN_OPERATOR', `unknown operator "${operator}"`)
    const rawArgs = (logic as Record<string, unknown>)[operator]
    if (LAZY.has(operator)) return fn(Array.isArray(rawArgs) ? rawArgs : [rawArgs], scope, this, rawArgs)
    const argList = Array.isArray(rawArgs) ? rawArgs : [rawArgs]
    const args = argList.map(arg => this.eval(arg as Logic, scope))
    return fn(args, scope, this, rawArgs)
  }
}

/** Operators that receive unevaluated arguments. */
const LAZY = new Set(['if', '?:', 'and', 'or', 'map', 'filter', 'reduce', 'some', 'every', 'all', 'none', 'find', 'obj', 'sort', 'var', 'coalesce', 'sum', 'pluck', 'groupBy', 'count', 'let'])

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return Boolean(value)
}

function num(value: unknown, operator: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BlueprintError('NOT_A_NUMBER', `${operator}: non-finite number`)
    return value
  }
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'boolean') return value ? 1 : 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new BlueprintError('NOT_A_NUMBER', `${operator}: "${String(value)}" is not a number`)
  return parsed
}

function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function arr(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  if (isPlainObject(value)) return Object.values(value)
  return [value]
}

function iterate(args: unknown[], scope: EvalScope, ev: Evaluator, operator: string) {
  const [source, body] = args
  const items = arr(ev.eval(source as Logic, scope))
  const asName = typeof args[2] === 'string' ? args[2] : 'item'
  const run = (item: unknown, index: number) => ev.eval(body as Logic, {
    ...scope,
    vars: { ...scope.vars, '': item, [asName]: item, 'index': index },
  })
  return { items, run, operator }
}

/**
 * Round on the shortest decimal representation (ADR 0012): `1.005` rounded
 * to 2 places is `1.01`, matching what an analyst expects. `half-up` means
 * away from zero, so `round(-2.5)` is `-3`, not the `-2` of `Math.round`.
 */
export type RoundingMode = 'half-up' | 'half-even' | 'half-down' | 'floor' | 'ceil' | 'trunc'

export function roundDecimal(value: number, decimals = 0, mode: RoundingMode = 'half-up'): number {
  const factor = 10 ** decimals
  const shifted = Number(`${value}e${decimals}`)
  const rounded = roundInteger(shifted, mode)
  return Number(`${rounded}e-${decimals}`) || rounded / factor
}

function roundInteger(shifted: number, mode: RoundingMode): number {
  const sign = shifted < 0 ? -1 : 1
  const magnitude = Math.abs(shifted)
  const floor = Math.floor(magnitude)
  const fraction = magnitude - floor
  const isHalf = Math.abs(fraction - 0.5) < 1e-9
  switch (mode) {
    case 'floor': return Math.floor(shifted)
    case 'ceil': return Math.ceil(shifted)
    case 'trunc': return sign * floor
    case 'half-even': return sign * (isHalf ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(magnitude))
    case 'half-down': return sign * (isHalf ? floor : Math.round(magnitude))
    default: return sign * (isHalf ? floor + 1 : Math.round(magnitude))
  }
}

/**
 * `scale(value, numerator, denominator, mode)`: multiply by a ratio and
 * round to an integer in one step, so cents × factors never leave the
 * integer domain (ADR 0012). `scale(12900, 85, 100)` is `10965`.
 */
export function scaleInteger(value: number, numerator: number, denominator: number, mode: RoundingMode = 'half-up'): number {
  if (denominator === 0) throw new BlueprintError('DIVISION_BY_ZERO', 'scale: denominator is zero')
  return roundInteger(value * numerator / denominator, mode)
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return str(a).localeCompare(str(b))
}

const builtinOperators: Record<string, OperatorFn> = {
  // ---- data access -------------------------------------------------------
  'var': (args, scope, ev) => {
    const [pathArg, fallback] = args
    const path = str(ev.eval(pathArg as Logic, scope))
    let value = path === '' ? scope.vars[''] : getPath(scope.vars, path)
    // JSON Logic semantics: inside a loop, a bare path reads the current item.
    if (value === undefined && path !== '' && scope.vars[''] !== undefined) value = getPath(scope.vars[''], path)
    if (value === undefined && fallback !== undefined) return ev.eval(fallback as Logic, scope)
    return value
  },
  'state': (args, scope) => {
    const path = str(args[0])
    return path === '' ? scope.state : getPath(scope.state, path)
  },
  // Alias kept for compatibility with earlier documents.
  'value': (args, scope) => getPath(scope.state, str(args[0])),
  'context': (args, scope) => {
    // `{ "context": "params.id" }` or `{ "context": ["params", "id"] }`
    const path = args.filter(arg => arg !== undefined && arg !== null).map(str).join('.')
    return path === '' ? scope.context : getPath(scope.context, path)
  },
  'def': (args, scope, ev) => ev.definition(str(args[0]), scope),
  'resource': (args, _scope, ev) => ev.resource(str(args[0]), args[1] === undefined ? undefined : str(args[1])),
  'schema': (args, _scope, ev) => {
    const schema = ev.document.content.schemas?.[str(args[0])]
    if (!schema) throw new BlueprintError('UNKNOWN_SCHEMA', `schema "${str(args[0])}" does not exist`)
    return schema
  },
  'meta': (args, _scope, ev) => getPath(ev.document.content.meta, str(args[0])),

  // ---- control flow ------------------------------------------------------
  'if': (args, scope, ev) => {
    for (let index = 0; index < args.length - 1; index += 2) {
      if (truthy(ev.eval(args[index] as Logic, scope))) return ev.eval(args[index + 1] as Logic, scope)
    }
    return args.length % 2 === 1 ? ev.eval(args[args.length - 1] as Logic, scope) : null
  },
  '?:': (args, scope, ev) => truthy(ev.eval(args[0] as Logic, scope)) ? ev.eval(args[1] as Logic, scope) : ev.eval(args[2] as Logic, scope),
  'and': (args, scope, ev) => {
    let last: unknown = true
    for (const arg of args) {
      last = ev.eval(arg as Logic, scope)
      if (!truthy(last)) return last
    }
    return last
  },
  'or': (args, scope, ev) => {
    let last: unknown = false
    for (const arg of args) {
      last = ev.eval(arg as Logic, scope)
      if (truthy(last)) return last
    }
    return last
  },
  /**
   * let: [{ name: expr, ... }, body] — bind variables for the body.
   * Bindings are evaluated in order and may reference earlier ones.
   */
  'let': (args, scope, ev) => {
    const [bindings, body] = args
    if (!isPlainObject(bindings)) throw new BlueprintError('INVALID_ARGUMENTS', 'let expects [{ name: expression }, body]')
    const vars = { ...scope.vars }
    for (const [name, logic] of Object.entries(bindings)) vars[name] = ev.eval(logic as Logic, { ...scope, vars })
    return ev.eval(body as Logic, { ...scope, vars })
  },
  'coalesce': (args, scope, ev) => {
    for (const arg of args) {
      const value = ev.eval(arg as Logic, scope)
      if (value !== null && value !== undefined && value !== '') return value
    }
    return null
  },
  '!': args => !truthy(args[0]),
  '!!': args => truthy(args[0]),

  // ---- comparison --------------------------------------------------------
  '==': args => looseEquals(args[0], args[1]),
  '!=': args => !looseEquals(args[0], args[1]),
  '===': args => deepEqual(args[0], args[1]),
  '!==': args => !deepEqual(args[0], args[1]),
  '>': args => num(args[0], '>') > num(args[1], '>'),
  '>=': args => num(args[0], '>=') >= num(args[1], '>='),
  '<': args => chain(args, (a, b) => a < b),
  '<=': args => chain(args, (a, b) => a <= b),
  'between': (args) => {
    const value = num(args[0], 'between')
    return value >= num(args[1], 'between') && value <= num(args[2], 'between')
  },
  'in': (args) => {
    const [needle, haystack] = args
    if (typeof haystack === 'string') return haystack.includes(str(needle))
    return arr(haystack).some(item => deepEqual(item, needle))
  },
  'isEmpty': args => !truthy(args[0]) || (typeof args[0] === 'string' && args[0].trim() === ''),
  /** JSON Logic `missing`: state paths that are absent or blank. */
  'missing': (args, scope) => missingPaths(args.flat() as string[], scope),
  /** JSON Logic `missing_some`: [minimum, paths] → [] when at least `minimum` paths are present. */
  'missing_some': (args, scope) => {
    const minimum = num(args[0], 'missing_some')
    const keys = arr(args[1]) as string[]
    const missing = missingPaths(keys, scope)
    return keys.length - missing.length >= minimum ? [] : missing
  },

  // ---- arithmetic --------------------------------------------------------
  '+': args => args.reduce<number>((acc, item) => acc + num(item, '+'), 0),
  '-': args => args.length === 1 ? -num(args[0], '-') : args.slice(1).reduce<number>((acc, item) => acc - num(item, '-'), num(args[0], '-')),
  '*': args => args.reduce<number>((acc, item) => acc * num(item, '*'), 1),
  '/': (args) => {
    const divisor = num(args[1], '/')
    if (divisor === 0) throw new BlueprintError('DIVISION_BY_ZERO', 'division by zero')
    return num(args[0], '/') / divisor
  },
  '%': (args) => {
    const divisor = num(args[1], '%')
    if (divisor === 0) throw new BlueprintError('DIVISION_BY_ZERO', 'modulo by zero')
    return num(args[0], '%') % divisor
  },
  'min': args => Math.min(...args.flat().map(item => num(item, 'min'))),
  'max': args => Math.max(...args.flat().map(item => num(item, 'max'))),
  'abs': args => Math.abs(num(args[0], 'abs')),
  'floor': args => Math.floor(num(args[0], 'floor')),
  'ceil': args => Math.ceil(num(args[0], 'ceil')),
  'round': args => roundDecimal(num(args[0], 'round'), args[1] === undefined ? 0 : num(args[1], 'round'), (args[2] as RoundingMode) || 'half-up'),
  /** `scale(value, numerator, denominator, mode?)`: integer result of value × num ÷ den. */
  'scale': args => scaleInteger(num(args[0], 'scale'), num(args[1], 'scale'), args[2] === undefined ? 1 : num(args[2], 'scale'), (args[3] as RoundingMode) || 'half-up'),
  'clamp': args => Math.min(Math.max(num(args[0], 'clamp'), num(args[1], 'clamp')), num(args[2], 'clamp')),
  /** Percentage of a value in cents, rounded to an integer cent (half-up). */
  'percentOf': args => roundDecimal(num(args[0], 'percentOf') * num(args[1], 'percentOf') / 100, 0),

  // ---- strings -----------------------------------------------------------
  'cat': args => args.map(str).join(''),
  'join': args => arr(args[0]).map(str).join(args[1] === undefined ? ', ' : str(args[1])),
  'upper': args => str(args[0]).toUpperCase(),
  'lower': args => str(args[0]).toLowerCase(),
  'trim': args => str(args[0]).trim(),
  /** JSON Logic `substr`: negative start counts from the end, negative length trims the end. */
  'substr': (args) => {
    const source = str(args[0])
    const start = num(args[1], 'substr')
    const from = start < 0 ? Math.max(0, source.length + start) : start
    if (args[2] === undefined) return source.slice(from)
    const length = num(args[2], 'substr')
    return length < 0 ? source.slice(from, source.length + length) : source.slice(from, from + length)
  },
  'split': args => str(args[0]).split(args[1] === undefined ? ',' : str(args[1])).filter(part => part !== ''),
  'startsWith': args => str(args[0]).startsWith(str(args[1])),
  'regex': args => new RegExp(str(args[1]), args[2] === undefined ? undefined : str(args[2])).test(str(args[0])),
  'length': args => typeof args[0] === 'string' ? args[0].length : arr(args[0]).length,
  'plural': (args) => {
    const count = num(args[0], 'plural')
    return count === 1 ? str(args[1]) : (args[2] === undefined ? `${str(args[1])}s` : str(args[2]))
  },
  'format': (args, _scope, ev) => {
    const meta = ev.document.content.meta
    const options = isPlainObject(args[2]) ? args[2] : {}
    return formatValue(args[0], str(args[1] || 'number') as FormatKind, {
      currency: meta.currency,
      locale: meta.locale,
      ...options,
    })
  },

  // ---- collections -------------------------------------------------------
  'map': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'map')
    return items.map(run)
  },
  'filter': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'filter')
    return items.filter((item, index) => truthy(run(item, index)))
  },
  'find': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'find')
    return items.find((item, index) => truthy(run(item, index))) ?? null
  },
  'some': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'some')
    return items.some((item, index) => truthy(run(item, index)))
  },
  'every': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'every')
    return items.every((item, index) => truthy(run(item, index)))
  },
  /** JSON Logic `all`: like `every` but false for an empty collection. */
  'all': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'all')
    return items.length > 0 && items.every((item, index) => truthy(run(item, index)))
  },
  'none': (args, scope, ev) => {
    const { items, run } = iterate(args, scope, ev, 'none')
    return !items.some((item, index) => truthy(run(item, index)))
  },
  'reduce': (args, scope, ev) => {
    const [source, body, initial] = args
    const items = arr(ev.eval(source as Logic, scope))
    let accumulator = ev.eval(initial as Logic, scope)
    items.forEach((current, index) => {
      accumulator = ev.eval(body as Logic, {
        ...scope,
        vars: { ...scope.vars, current, accumulator, index },
      })
    })
    return accumulator
  },
  'sum': (args, scope, ev) => {
    const items = arr(ev.eval(args[0] as Logic, scope))
    if (args[1] === undefined) return items.reduce<number>((acc, item) => acc + num(item, 'sum'), 0)
    const { run } = iterate([args[0], typeof args[1] === 'string' ? { var: args[1] } : args[1], args[2]], scope, ev, 'sum')
    return items.reduce<number>((acc, item, index) => acc + num(run(item, index), 'sum'), 0)
  },
  'count': (args, scope, ev) => {
    const items = arr(ev.eval(args[0] as Logic, scope))
    if (args[1] === undefined) return items.length
    const { run } = iterate(args, scope, ev, 'count')
    return items.filter((item, index) => truthy(run(item, index))).length
  },
  'pluck': (args, scope, ev) => {
    const items = arr(ev.eval(args[0] as Logic, scope))
    const path = str(ev.eval(args[1] as Logic, scope))
    return items.map(item => getPath(item, path))
  },
  'sort': (args, scope, ev) => {
    const items = [...arr(ev.eval(args[0] as Logic, scope))]
    const path = args[1] === undefined ? '' : str(ev.eval(args[1] as Logic, scope))
    const direction = args[2] === undefined ? 'asc' : str(ev.eval(args[2] as Logic, scope))
    items.sort((a, b) => compareValues(path ? getPath(a, path) : a, path ? getPath(b, path) : b) * (direction === 'desc' ? -1 : 1))
    return items
  },
  'groupBy': (args, scope, ev) => {
    const items = arr(ev.eval(args[0] as Logic, scope))
    const path = str(ev.eval(args[1] as Logic, scope))
    const groups: Record<string, unknown[]> = {}
    for (const item of items) {
      const key = str(getPath(item, path))
      ;(groups[key] ||= []).push(item)
    }
    return Object.entries(groups).map(([key, values]) => ({ key, items: values }))
  },
  'get': args => getPath(args[0], str(args[1])),
  'getItemValue': args => getPath(args[0], str(args[1])),
  'findBy': (args) => {
    const [items, field, value] = args
    return arr(items).find(item => looseEquals(getPath(item, str(field)), value)) ?? null
  },
  'filterBy': (args) => {
    const [items, field, value] = args
    return arr(items).filter(item => looseEquals(getPath(item, str(field)), value))
  },
  'first': args => arr(args[0])[0] ?? null,
  'last': (args) => {
    const items = arr(args[0])
    return items[items.length - 1] ?? null
  },
  'slice': args => arr(args[0]).slice(num(args[1], 'slice'), args[2] === undefined ? undefined : num(args[2], 'slice')),
  'unique': (args) => {
    const out: unknown[] = []
    for (const item of arr(args[0])) if (!out.some(existing => deepEqual(existing, item))) out.push(item)
    return out
  },
  'merge': args => args.flatMap(item => arr(item)),
  'concat': args => args.flatMap(item => arr(item)),
  'keys': args => isPlainObject(args[0]) ? Object.keys(args[0]) : [],
  'values': args => isPlainObject(args[0]) ? Object.values(args[0]) : arr(args[0]),
  'range': args => Array.from({ length: Math.max(0, num(args[0], 'range')) }, (_, index) => index + (args[1] === undefined ? 0 : num(args[1], 'range'))),
  'obj': (args, scope, ev, raw) => {
    if (!isPlainObject(raw)) throw new BlueprintError('INVALID_ARGUMENTS', 'obj expects an object of expressions')
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) out[key] = ev.eval(value as Logic, scope)
    return out
  },
  'assign': args => Object.assign({}, ...args.filter(isPlainObject)),
  /** JSON Logic `log`: pass-through that prints its argument. */
  'log': (args) => {
    console.log('[blueprint:log]', args[0])
    return args[0]
  },
  'typeof': args => Array.isArray(args[0]) ? 'array' : args[0] === null ? 'null' : typeof args[0],

  // ---- parameter tables --------------------------------------------------
  /**
   * lookup: [resourceName, criteria, options?]
   * Rows carry a `match` object; each field is an exact value, a list, or a
   * bound object ({ gte, gt, lte, lt, in, prefix }). Hit policy comes from
   * the resource (`hitPolicy`) or the options. No match → resource `default`,
   * option `default`, or a LOOKUP_NO_MATCH error. Never a silent null.
   */
  'lookup': (args, _scope, ev) => {
    const name = str(args[0])
    const resource = ev.document.content.resources?.[name]
    if (!resource) throw new BlueprintError('UNKNOWN_RESOURCE', `resource "${name}" does not exist`)
    const criteria = isPlainObject(args[1]) ? args[1] : {}
    const options = isPlainObject(args[2]) ? args[2] : {}
    const policy = (options.policy as string) || resource.hitPolicy || 'first'
    const rows = arr(resource.data).filter(isPlainObject)
    const matches = rows.filter(row => rowMatches(row, criteria))
    const output = (row: Record<string, unknown>) => {
      if (row.output !== undefined) return row.output
      const { match: _match, ...rest } = row
      return rest
    }
    if (matches.length === 0) {
      if (options.default !== undefined) return options.default
      if (resource.default !== undefined) return resource.default
      throw new BlueprintError('LOOKUP_NO_MATCH', `no row of "${name}" matches ${JSON.stringify(criteria)}`)
    }
    switch (policy) {
      case 'collect': return matches.map(output)
      case 'last': return output(matches[matches.length - 1]!)
      case 'unique':
        if (matches.length > 1) throw new BlueprintError('LOOKUP_AMBIGUOUS', `${matches.length} rows of "${name}" match ${JSON.stringify(criteria)}`)
        return output(matches[0]!)
      default: return output(matches[0]!)
    }
  },
}

function missingPaths(keys: string[], scope: EvalScope): string[] {
  return keys.filter((key) => {
    const value = getPath(scope.state, key)
    return value === undefined || value === null || value === ''
  })
}

function chain(args: unknown[], compare: (a: number, b: number) => boolean): boolean {
  for (let index = 0; index < args.length - 1; index++) {
    if (!compare(num(args[index], '<'), num(args[index + 1], '<'))) return false
  }
  return true
}

/** `==` compares numbers and numeric strings loosely, everything else deeply. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') return deepEqual(a, b)
  if (a === null || a === undefined) return b === null || b === undefined || b === ''
  if (b === null || b === undefined) return a === ''

  return a == b
}

function rowMatches(row: Record<string, unknown>, criteria: Record<string, unknown>): boolean {
  const match = isPlainObject(row.match) ? row.match : {}
  return Object.entries(match).every(([field, condition]) => {
    const value = criteria[field]
    if (Array.isArray(condition)) return condition.some(option => looseEquals(option, value))
    if (isPlainObject(condition)) {
      if (condition.eq !== undefined && !looseEquals(condition.eq, value)) return false
      if (condition.in !== undefined && !arr(condition.in).some(option => looseEquals(option, value))) return false
      if (condition.prefix !== undefined && !str(value).toUpperCase().startsWith(str(condition.prefix).toUpperCase())) return false
      if (condition.gte !== undefined && !(num(value, 'lookup') >= num(condition.gte, 'lookup'))) return false
      if (condition.gt !== undefined && !(num(value, 'lookup') > num(condition.gt, 'lookup'))) return false
      if (condition.lte !== undefined && !(num(value, 'lookup') <= num(condition.lte, 'lookup'))) return false
      if (condition.lt !== undefined && !(num(value, 'lookup') < num(condition.lt, 'lookup'))) return false
      if (condition.any === true) return true
      return true
    }
    if (condition === '*') return true
    return looseEquals(condition, value)
  })
}

export function createEvaluator(document: BlueprintDocument, options?: EvaluatorOptions): Evaluator {
  return new Evaluator(document, options)
}

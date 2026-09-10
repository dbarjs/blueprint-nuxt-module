/**
 * Actions: the closed set of things an event can do (Adaptive Cards style).
 *
 * Two kinds, one language (ADR 0008): **transforms** (`set`, `push`, `if`...)
 * are pure over `state` and `vars` and owned by the kernel; **capability
 * calls** (`navigate`, `fetch`, `insert`...) are handed to a provider — the
 * host's `ActionEffects`, a server-action extension, or a test stub — and
 * their results come back as values. Every capability call may bind its
 * value to a variable (`as`) or write it to a state path (`result`), and is
 * appended to the run's effect log so a record can keep it and a test can
 * replay it.
 */
import type { BlueprintAction, BlueprintActions, EvalScope, Logic, ValidationIssue } from './types'
import type { Evaluator } from './logic'
import { truthy } from './logic'
import { BlueprintError, toFailure, type ActionFailure } from './errors'
import { validateSchema } from './schema'
import { deepClone, getPath, setPath, splitPath } from './path'
import { capabilityOfAction } from './capabilities'

export interface EndpointCall {
  /** Endpoint name from `content.endpoints`, or a raw path (`/api/...`). */
  endpoint?: string
  params: Record<string, unknown>
  query: Record<string, unknown>
  body?: unknown
}

export interface ActionEffects {
  navigate?: (to: string, params: Record<string, unknown>, query: Record<string, unknown>) => void | Promise<void>
  toast?: (toast: { title: string, description?: string, color?: string, icon?: string }) => void
  /** `submit`: POST a validated payload (records API or a document endpoint). */
  submit?: (input: EndpointCall & { schema?: string }) => Promise<unknown>
  /** `fetch`: call a document endpoint with its declared method. */
  fetch?: (input: EndpointCall) => Promise<unknown>
  log?: (value: unknown) => void
  /** Called after every state mutation (persistence, HMR, devtools...). */
  onMutate?: (path: string) => void
}

/**
 * An action type supplied by the host (server actions live in
 * `server-actions.ts`). Receives the evaluated helpers of the runner.
 */
export type ActionExtension = (action: BlueprintAction & Record<string, unknown>, helpers: ExtensionHelpers) => Promise<ActionResult> | ActionResult

export interface ExtensionHelpers {
  ctx: ActionContext
  scope: EvalScope
  vars: Record<string, unknown>
  evaluate: (logic: Logic | undefined) => unknown
  /** Evaluate an item predicate (`where`) the way `remove`/`update` do. */
  matches: (where: Logic | undefined, item: unknown, index: number) => boolean
  run: (actions: BlueprintActions | undefined, vars?: Record<string, unknown>) => Promise<ActionResult>
}

/** One capability call of a run (ADR 0008): input, provider and outcome. */
export interface EffectEntry {
  step: string
  type: string
  capability: string
  input: Record<string, unknown>
  result: { ok: true, value?: unknown } | { ok: false, error: ActionFailure }
}

export interface ActionContext {
  evaluator: Evaluator
  /** Reactive or plain mutable state object. Mutated in place. */
  state: Record<string, unknown>
  context: Record<string, unknown>
  /** Initial state used by `reset`. */
  initialState: Record<string, unknown>
  effects: ActionEffects
  /** Extra action types (server actions). Consulted before failing on an unknown type. */
  extensions?: Record<string, ActionExtension>
  /** When present, every capability call is appended here. */
  log?: EffectEntry[]
  /** Name of the handler being run, for the effect log (`actions.place-order`, `endpoints.create`). */
  step?: string
}

export interface ActionResult {
  ok: boolean
  issues?: ValidationIssue[]
  /** The failure, as a value. Providers return `{ code, message }`; older hosts may throw. */
  error?: unknown
  /** Value a capability call produced; the runner writes it where `as`/`result` say. */
  value?: unknown
  /** What an extension wants logged as its evaluated input (ADR 0008); defaults to the action's scalar fields. */
  input?: Record<string, unknown>
  /** The sequence ended early (`respond`/`fail`): stop running further steps. */
  done?: boolean
  /** Response produced by `respond`/`fail`. */
  response?: { status: number, body: unknown, headers?: Record<string, string> }
}

export async function runActions(
  actions: BlueprintActions | undefined,
  ctx: ActionContext,
  vars: Record<string, unknown> = {},
  depth = 0,
): Promise<ActionResult> {
  if (!actions) return { ok: true }
  if (depth > 32) throw new BlueprintError('ACTION_CYCLE', 'action recursion deeper than 32')
  const list = Array.isArray(actions) ? actions : [actions]
  let result: ActionResult = { ok: true }
  for (const entry of list) {
    result = await runAction(entry, ctx, vars, depth)
    if (typeof entry !== 'string') bindResult(entry, result, ctx, vars)
    if (!result.ok || result.done) return result
  }
  return result
}

/** `as` binds a variable for the rest of the sequence; `result` writes a state path (ADR 0008). */
function bindResult(action: BlueprintAction, result: ActionResult, ctx: ActionContext, vars: Record<string, unknown>): void {
  if (!result.ok || !('value' in result)) return
  const target = action as { as?: string, result?: string }
  if (target.as) vars[target.as] = result.value
  if (target.result) {
    setPath(ctx.state, target.result, deepClone(result.value))
    ctx.effects.onMutate?.(target.result)
  }
}

/** Run a capability call through its provider, log it, and shape its outcome. */
async function call(
  action: BlueprintAction,
  input: Record<string, unknown>,
  provider: () => Promise<unknown> | unknown,
  ctx: ActionContext,
): Promise<ActionResult> {
  const capability = capabilityOfAction(action.type)?.name || 'runtime'
  const entry: EffectEntry = { step: ctx.step || 'actions', type: action.type, capability, input, result: { ok: true } }
  try {
    const value = await provider()
    entry.result = value === undefined ? { ok: true } : { ok: true, value }
    ctx.log?.push(entry)
    return value === undefined ? { ok: true } : { ok: true, value }
  }
  catch (caught) {
    const error = toFailure(caught)
    entry.result = { ok: false, error }
    ctx.log?.push(entry)
    return { ok: false, error, ...(error.issues !== undefined ? { issues: error.issues as ValidationIssue[] } : {}) }
  }
}

function scopeOf(ctx: ActionContext, vars: Record<string, unknown>): EvalScope {
  return { state: ctx.state, context: ctx.context, vars }
}

async function runAction(
  entry: string | BlueprintAction,
  ctx: ActionContext,
  vars: Record<string, unknown>,
  depth: number,
): Promise<ActionResult> {
  if (typeof entry === 'string') return callNamed(entry, {}, ctx, vars, depth)
  const action = entry
  const ev = ctx.evaluator
  const scope = scopeOf(ctx, vars)
  const evaluate = (logic: Logic | undefined) => logic === undefined ? undefined : ev.evaluate(logic, scope)

  switch (action.type) {
    case 'set': {
      setPath(ctx.state, action.path, deepClone(evaluate(action.value)))
      ctx.effects.onMutate?.(action.path)
      return { ok: true }
    }
    case 'push': {
      const current = getPath(ctx.state, action.path)
      const list = Array.isArray(current) ? current : []
      if (!Array.isArray(current)) setPath(ctx.state, action.path, list)
      list.push(deepClone(evaluate(action.value)))
      ctx.effects.onMutate?.(action.path)
      return { ok: true }
    }
    case 'remove': {
      const current = getPath(ctx.state, action.path)
      if (!Array.isArray(current)) return { ok: true }
      if (action.index !== undefined) {
        current.splice(Number(evaluate(action.index)), 1)
      }
      else if (action.where !== undefined) {
        for (let index = current.length - 1; index >= 0; index--) {
          const item = current[index]
          if (truthy(ev.evaluate(action.where, { ...scope, vars: { ...vars, '': item, item, index } }))) current.splice(index, 1)
        }
      }
      ctx.effects.onMutate?.(action.path)
      return { ok: true }
    }
    case 'update': {
      const current = getPath(ctx.state, action.path)
      if (!Array.isArray(current)) return { ok: true }
      current.forEach((item, index) => {
        const itemScope = { ...scope, vars: { ...vars, '': item, item, index } }
        if (!truthy(ev.evaluate(action.where, itemScope))) return
        for (const [key, logic] of Object.entries(action.set)) {
          setPath(item as Record<string, unknown>, key, deepClone(ev.evaluate(logic, itemScope)))
        }
      })
      ctx.effects.onMutate?.(action.path)
      return { ok: true }
    }
    case 'increment': {
      const current = Number(getPath(ctx.state, action.path) ?? 0)
      let next = current + Number(evaluate(action.by) ?? 1)
      if (action.min !== undefined) next = Math.max(next, Number(evaluate(action.min)))
      if (action.max !== undefined) next = Math.min(next, Number(evaluate(action.max)))
      setPath(ctx.state, action.path, next)
      ctx.effects.onMutate?.(action.path)
      return { ok: true }
    }
    case 'reset': {
      if (action.path) {
        setPath(ctx.state, action.path, deepClone(getPath(ctx.initialState, action.path) ?? null))
      }
      else {
        for (const key of Object.keys(ctx.state)) Reflect.deleteProperty(ctx.state, key)
        Object.assign(ctx.state, deepClone(ctx.initialState))
      }
      ctx.effects.onMutate?.(action.path || '')
      return { ok: true }
    }
    case 'navigate': {
      const params = evaluateMap(action.params, evaluate)
      const query = evaluateMap(action.query, evaluate)
      return call(action, { to: action.to, params, query }, () => {
        if (!ctx.effects.navigate) throw unavailable('navigate')
        return ctx.effects.navigate(action.to, params, query)
      }, ctx)
    }
    case 'toast': {
      const toast = {
        title: String(evaluate(action.title) ?? ''),
        description: action.description === undefined ? undefined : String(evaluate(action.description) ?? ''),
        color: action.color,
        icon: action.icon,
      }
      return call(action, { ...toast }, () => {
        if (!ctx.effects.toast) throw unavailable('toast')
        return ctx.effects.toast(toast)
      }, ctx)
    }
    case 'log': {
      ctx.effects.log?.(evaluate(action.value))
      return { ok: true }
    }
    case 'if': {
      const branch = truthy(evaluate(action.condition)) ? action.then : action.else
      return runActions(branch, ctx, vars, depth + 1)
    }
    case 'validate': {
      const issues = validateAgainst(action.schema, action.path, ctx, vars)
      if (issues.length === 0) return runActions(action.then, ctx, vars, depth + 1)
      const failed = await runActions(action.else, ctx, { ...vars, issues }, depth + 1)
      // Named like `submit`'s refusal so a scenario can expect it (ADR 0011).
      const failure: ActionFailure = { code: 'VALIDATION_FAILED', message: `state rejected by schema "${action.schema}"`, issues }
      return { ...failed, ok: false, issues, error: failure }
    }
    case 'submit': {
      const body = action.body !== undefined ? evaluate(action.body) : deepClone(action.path ? getPath(ctx.state, action.path) : ctx.state)
      if (action.schema) {
        const issues = validateSchema(ev.document.content.schemas[action.schema]!, body, { document: ev.document, evaluator: ev, scope })
        if (issues.length) {
          const failure: ActionFailure = { code: 'VALIDATION_FAILED', message: `payload rejected by schema "${action.schema}"`, issues }
          await runActions(action.catch, ctx, { ...vars, issues, error: 'VALIDATION_FAILED', failure }, depth + 1)
          return { ok: false, issues, error: failure }
        }
      }
      const input = { endpoint: action.endpoint, body, schema: action.schema, params: evaluateMap(action.params, evaluate), query: evaluateMap(action.query, evaluate) }
      const outcome = await call(action, input, () => {
        if (!ctx.effects.submit) throw unavailable('submit')
        return ctx.effects.submit(input)
      }, ctx)
      return settle(action, outcome, ctx, vars, depth)
    }
    case 'fetch': {
      const body = action.body === undefined ? undefined : evaluate(action.body)
      const input = { endpoint: action.endpoint, body, params: evaluateMap(action.params, evaluate), query: evaluateMap(action.query, evaluate) }
      const outcome = await call(action, input, () => {
        if (!ctx.effects.fetch) throw unavailable('fetch')
        return ctx.effects.fetch(input)
      }, ctx)
      return settle(action, outcome, ctx, vars, depth)
    }
    case 'sequence':
      return runActions(action.steps, ctx, vars, depth + 1)
    case 'action': {
      const withVars: Record<string, unknown> = {}
      for (const [key, logic] of Object.entries(action.with || {})) withVars[key] = evaluate(logic)
      return callNamed(action.name, withVars, ctx, vars, depth)
    }
    default: {
      const type = String((action as { type: string }).type)
      const extension = ctx.extensions?.[type]
      const record = action as BlueprintAction & Record<string, unknown>
      if (!extension) {
        const capability = capabilityOfAction(type)
        if (!capability) throw new BlueprintError('UNKNOWN_ACTION', `unknown action type "${type}"`)
        // A capability call whose provider is absent on this surface: a failure as a value, logged.
        return call(record, {}, () => {
          throw unavailable(type)
        }, ctx)
      }
      const capability = capabilityOfAction(type)?.name || 'runtime'
      const entry: EffectEntry = { step: ctx.step || 'actions', type, capability, input: scalarFields(record), result: { ok: true } }
      const outcome = await extension(record, {
        ctx,
        scope,
        vars,
        evaluate,
        matches: (where, item, index) => where === undefined ? true : truthy(ev.evaluate(where, { ...scope, vars: { ...vars, '': item, item, index } })),
        run: (actions, extra = {}) => runActions(actions, ctx, { ...vars, ...extra }, depth + 1),
      })
      if (outcome.input) entry.input = { ...entry.input, ...outcome.input }
      entry.result = outcome.ok ? (outcome.value === undefined ? { ok: true } : { ok: true, value: outcome.value }) : { ok: false, error: toFailure(outcome.error ?? outcome.response?.body ?? { code: 'EFFECT_FAILED', message: 'failed' }) }
      ctx.log?.push(entry)
      return outcome
    }
  }
}

/** The static, already-literal fields of an action: what the log records before an extension adds evaluated ones. */
function scalarFields(action: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(action)) {
    if (['type', 'then', 'catch', 'as', 'result'].includes(key)) continue
    if (value === null || typeof value !== 'object') out[key] = value
  }
  return out
}

function unavailable(type: string): BlueprintError {
  const capability = capabilityOfAction(type)?.name || 'runtime'
  return new BlueprintError('CAPABILITY_UNAVAILABLE', `"${type}" needs ${capability}, which this runtime does not provide`)
}

/** After a capability call: bind the value, then run `then` or `catch`. */
async function settle(action: BlueprintAction & { then?: BlueprintActions, catch?: BlueprintActions }, outcome: ActionResult, ctx: ActionContext, vars: Record<string, unknown>, depth: number): Promise<ActionResult> {
  if (outcome.ok) {
    bindResult(action, outcome, ctx, vars)
    const next = await runActions(action.then, ctx, { ...vars, response: outcome.value }, depth + 1)
    return { ...next, value: outcome.value }
  }
  const failure = outcome.error as ActionFailure
  await runActions(action.catch, ctx, { ...vars, error: failure.code === 'EFFECT_FAILED' ? failure.message : failure.code, failure, issues: failure.issues }, depth + 1)
  return { ok: false, error: failure, issues: outcome.issues }
}

function evaluateMap(map: Record<string, Logic> | undefined, evaluate: (logic: Logic | undefined) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, logic] of Object.entries(map || {})) out[key] = evaluate(logic)
  return out
}

async function callNamed(name: string, withVars: Record<string, unknown>, ctx: ActionContext, vars: Record<string, unknown>, depth: number): Promise<ActionResult> {
  const named = ctx.evaluator.document.content.actions?.[name]
  if (!named) throw new BlueprintError('UNKNOWN_ACTION', `action "${name}" does not exist`)
  return runActions(named, ctx, { ...vars, ...withVars }, depth + 1)
}

function validateAgainst(schemaName: string, path: string | undefined, ctx: ActionContext, vars: Record<string, unknown>): ValidationIssue[] {
  const schema = ctx.evaluator.document.content.schemas[schemaName]
  if (!schema) throw new BlueprintError('UNKNOWN_SCHEMA', `schema "${schemaName}" does not exist`)
  const value = path ? getPath(ctx.state, path) : ctx.state
  const scope = scopeOf(ctx, vars)
  return validateSchema(schema, value, { document: ctx.evaluator.document, evaluator: ctx.evaluator, scope })
    .map(issue => ({ ...issue, path: path ? [path, issue.path].filter(Boolean).join('.') : issue.path }))
}

export { splitPath }

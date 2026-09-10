/**
 * Actions: the closed set of things an event can do (Adaptive Cards style).
 *
 * The document defines product, configuration and presentation; effects
 * (navigation, network, toasts) are delegated to an `ActionEffects`
 * implementation supplied by the host (the Nuxt runtime, or a test double).
 */
import type { BlueprintAction, BlueprintActions, EvalScope, Logic, ValidationIssue } from './types'
import type { Evaluator } from './logic'
import { truthy } from './logic'
import { BlueprintError } from './errors'
import { validateSchema } from './schema'
import { deepClone, getPath, setPath, splitPath } from './path'

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
}

export interface ActionResult {
  ok: boolean
  issues?: ValidationIssue[]
  error?: unknown
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
  if (depth > 32) throw new BlueprintError('INVALID_DOCUMENT', 'action recursion deeper than 32')
  const list = Array.isArray(actions) ? actions : [actions]
  let result: ActionResult = { ok: true }
  for (const entry of list) {
    result = await runAction(entry, ctx, vars, depth)
    if (!result.ok || result.done) return result
  }
  return result
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
      const params: Record<string, unknown> = {}
      for (const [key, logic] of Object.entries(action.params || {})) params[key] = evaluate(logic)
      const query: Record<string, unknown> = {}
      for (const [key, logic] of Object.entries(action.query || {})) query[key] = evaluate(logic)
      await ctx.effects.navigate?.(action.to, params, query)
      return { ok: true }
    }
    case 'toast': {
      ctx.effects.toast?.({
        title: String(evaluate(action.title) ?? ''),
        description: action.description === undefined ? undefined : String(evaluate(action.description) ?? ''),
        color: action.color,
        icon: action.icon,
      })
      return { ok: true }
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
      return { ...failed, ok: false, issues }
    }
    case 'submit': {
      const body = action.body !== undefined ? evaluate(action.body) : deepClone(action.path ? getPath(ctx.state, action.path) : ctx.state)
      if (action.schema) {
        const issues = validateSchema(ev.document.content.schemas[action.schema]!, body, { document: ev.document, evaluator: ev, scope })
        if (issues.length) {
          await runActions(action.catch, ctx, { ...vars, issues, error: 'VALIDATION_FAILED' }, depth + 1)
          return { ok: false, issues }
        }
      }
      try {
        const response = ctx.effects.submit
          ? await ctx.effects.submit({ endpoint: action.endpoint, body, schema: action.schema, params: evaluateMap(action.params, evaluate), query: evaluateMap(action.query, evaluate) })
          : body
        if (action.result) {
          setPath(ctx.state, action.result, deepClone(response))
          ctx.effects.onMutate?.(action.result)
        }
        return runActions(action.then, ctx, { ...vars, response }, depth + 1)
      }
      catch (error) {
        await runActions(action.catch, ctx, { ...vars, error: String((error as Error)?.message || error) }, depth + 1)
        return { ok: false, error }
      }
    }
    case 'fetch': {
      const body = action.body === undefined ? undefined : evaluate(action.body)
      try {
        if (!ctx.effects.fetch) throw new BlueprintError('UNSUPPORTED_ACTION', 'this runtime cannot "fetch"')
        const response = await ctx.effects.fetch({ endpoint: action.endpoint, body, params: evaluateMap(action.params, evaluate), query: evaluateMap(action.query, evaluate) })
        if (action.result) {
          setPath(ctx.state, action.result, deepClone(response))
          ctx.effects.onMutate?.(action.result)
        }
        return runActions(action.then, ctx, { ...vars, response }, depth + 1)
      }
      catch (error) {
        await runActions(action.catch, ctx, { ...vars, error: String((error as Error)?.message || error) }, depth + 1)
        return { ok: false, error }
      }
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
      if (!extension) throw new BlueprintError('UNKNOWN_ACTION', `unknown action type "${type}"`)
      return extension(action as BlueprintAction & Record<string, unknown>, {
        ctx,
        scope,
        vars,
        evaluate,
        matches: (where, item, index) => where === undefined ? true : truthy(ev.evaluate(where, { ...scope, vars: { ...vars, '': item, item, index } })),
        run: (actions, extra = {}) => runActions(actions, ctx, { ...vars, ...extra }, depth + 1),
      })
    }
  }
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

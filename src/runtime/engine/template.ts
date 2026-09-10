/**
 * Template evaluation: template + document + state → abstract tree.
 *
 * The abstract tree is the normative artifact: loops expanded, conditions
 * decided, bindings substituted, keys assigned. It is plain JSON and never
 * references a UI framework. Materializers (Vue, e-mail, ESC/POS...) turn
 * it into their target.
 */
import type {
  BlueprintActions,
  BlueprintDocument,
  BlueprintTemplate,
  EvalScope,
  Logic,
  PageTemplate,
  TemplateNode,
} from './types'
import type { Evaluator } from './logic'
import { truthy } from './logic'
import { BlueprintError } from './errors'
import { getPath, isPlainObject } from './path'
import { vocabularyOf } from './registry'

export interface AbstractEventHandler {
  actions: BlueprintActions
  /** Loop and template variables captured when the node was evaluated. */
  vars: Record<string, unknown>
}

export interface AbstractNode {
  /** `unavailable`: a component this runtime cannot draw and that has no fallback (ADR 0026). */
  kind: 'component' | 'html' | 'text' | 'unavailable'
  key: string
  as?: string
  props?: Record<string, unknown>
  text?: string
  children?: AbstractNode[]
  slots?: Record<string, AbstractNode[]>
  model?: { path: string, prop: string }
  on?: Record<string, AbstractEventHandler>
  /** Set on nodes produced by a `fallback` in place of `of`. */
  via?: 'fallback'
  /** The component the fallback (or the unavailable node) stands for. */
  of?: string
  /** The vocabulary capability an unavailable node needed. */
  capability?: string
}

export interface EvaluateTemplateOptions {
  /** Nodes rendered where an `outlet` node appears. */
  outlet?: AbstractNode[]
  /** Guard against runaway template recursion. */
  depth?: number
  /**
   * Can this runtime draw the component? When it cannot, the node's
   * `fallback` is evaluated in its place (`via: "fallback"`), or the tree
   * carries an `unavailable` node. Absent → everything is drawable.
   */
  available?: (component: string) => boolean
}

const MAX_DEPTH = 32

export function templateNodes(template: BlueprintTemplate | undefined): TemplateNode[] {
  if (!template) return []
  return Array.isArray(template) ? template : (template.children || [])
}

export function isPageTemplate(template: BlueprintTemplate | undefined): template is PageTemplate {
  return !!template && !Array.isArray(template)
}

export function evaluateTemplate(
  evaluator: Evaluator,
  templateName: string,
  scope: EvalScope,
  options: EvaluateTemplateOptions = {},
): AbstractNode[] {
  const template = evaluator.document.content.templates?.[templateName]
  if (!template) throw new BlueprintError('UNKNOWN_TEMPLATE', `template "${templateName}" does not exist`)
  return evaluator.batch(() => evaluateNodes(evaluator, templateNodes(template), scope, templateName, options))
}

export function evaluateNodes(
  evaluator: Evaluator,
  nodes: TemplateNode[],
  scope: EvalScope,
  keyPrefix: string,
  options: EvaluateTemplateOptions,
): AbstractNode[] {
  const out: AbstractNode[] = []
  nodes.forEach((node, index) => {
    out.push(...evaluateNode(evaluator, node, scope, `${keyPrefix}.${index}`, options))
  })
  return out
}

function evaluateNode(
  evaluator: Evaluator,
  node: TemplateNode,
  scope: EvalScope,
  key: string,
  options: EvaluateTemplateOptions,
): AbstractNode[] {
  if ((options.depth || 0) > MAX_DEPTH) {
    throw new BlueprintError('INVALID_DOCUMENT', `template nesting deeper than ${MAX_DEPTH} at ${key}`)
  }
  if (node.if !== undefined && !truthy(evaluator.eval(node.if, scope))) return []

  if (node.for) {
    const items = toArray(evaluator.eval(node.for.in, scope))
    const asName = node.for.as || 'item'
    const indexName = node.for.index || 'index'
    const { for: _loop, ...rest } = node
    return items.flatMap((item, index) => {
      const itemScope: EvalScope = { ...scope, vars: { ...scope.vars, '': item, [asName]: item, [indexName]: index } }
      const itemKey = node.for!.key ? keyFrom(evaluator, node.for!.key, item, itemScope) : String(index)
      return evaluateNode(evaluator, rest as TemplateNode, itemScope, `${key}[${itemKey}]`, options)
    })
  }

  switch (node.type) {
    case 'text':
      return [{ kind: 'text', key, text: toText(evaluator.eval(node.content, scope)) }]

    case 'if': {
      const branch = truthy(evaluator.eval(node.condition, scope)) ? node.children : node.else
      return evaluateNodes(evaluator, branch || [], scope, key, options)
    }

    case 'for': {
      const items = toArray(evaluator.eval(node.in, scope))
      if (items.length === 0) return evaluateNodes(evaluator, node.empty || [], scope, `${key}.empty`, options)
      const asName = node.as || 'item'
      const indexName = node.index || 'index'
      return items.flatMap((item, index) => {
        const itemScope: EvalScope = { ...scope, vars: { ...scope.vars, '': item, [asName]: item, [indexName]: index } }
        const itemKey = node.key ? keyFrom(evaluator, node.key, item, itemScope) : String(index)
        return evaluateNodes(evaluator, node.children || [], itemScope, `${key}[${itemKey}]`, options)
      })
    }

    case 'template': {
      const template = evaluator.document.content.templates?.[node.name]
      if (!template) throw new BlueprintError('UNKNOWN_TEMPLATE', `template "${node.name}" does not exist (included at ${key})`)
      const vars = { ...scope.vars }
      for (const [name, logic] of Object.entries(node.with || {})) vars[name] = evaluator.eval(logic, scope)
      return evaluateNodes(evaluator, templateNodes(template), { ...scope, vars }, `${key}<${node.name}>`, { ...options, depth: (options.depth || 0) + 1 })
    }

    case 'outlet':
      return options.outlet || []

    case 'component':
    case 'html': {
      if (node.type === 'component' && options.available && !options.available(node.as)) {
        if (node.fallback) {
          return evaluateNodes(evaluator, node.fallback, scope, `${key}~`, { ...options, depth: (options.depth || 0) + 1 })
            .map(child => ({ ...child, via: 'fallback' as const, of: node.as }))
        }
        return [{ kind: 'unavailable', key, as: node.as, of: node.as, capability: vocabularyOf(node.as) }]
      }
      const props: Record<string, unknown> = { ...(node.props || {}) }
      const { content: boundContent, ...bindings } = node.bind || {}
      for (const [prop, logic] of Object.entries(bindings)) props[prop] = evaluator.eval(logic, scope)
      const abstract: AbstractNode = { kind: node.type, key, as: node.as, props }
      const children: AbstractNode[] = []
      // `content` is the default-slot text; it may be static or bound.
      const content = boundContent !== undefined ? boundContent : node.content
      if (content !== undefined) {
        const text = evaluator.eval(content, scope)
        if (text !== null && text !== undefined && text !== false) children.push({ kind: 'text', key: `${key}.content`, text: toText(text) })
      }
      if (node.children) children.push(...evaluateNodes(evaluator, node.children, scope, key, { ...options, depth: (options.depth || 0) + 1 }))
      if (children.length) abstract.children = children
      if (node.type === 'component' && node.slots) {
        abstract.slots = {}
        for (const [slot, nodes] of Object.entries(node.slots)) {
          abstract.slots[slot] = evaluateNodes(evaluator, nodes, scope, `${key}#${slot}`, { ...options, depth: (options.depth || 0) + 1 })
        }
      }
      if (node.type === 'component' && node.model) {
        const raw = typeof node.model === 'string' ? { path: node.model, prop: 'modelValue' } : { path: node.model.path, prop: node.model.prop || 'modelValue' }
        abstract.model = { ...raw, path: interpolatePath(raw.path, scope) }
      }
      if (node.on) {
        abstract.on = {}
        for (const [event, actions] of Object.entries(node.on)) {
          abstract.on[event] = { actions, vars: serializableVars(scope.vars) }
        }
      }
      return [abstract]
    }

    default:
      throw new BlueprintError('INVALID_DOCUMENT', `unknown template node type "${(node as { type: string }).type}" at ${key}`)
  }
}

/** `cart.lines.{index}.quantity` → `cart.lines.2.quantity` using scope vars. */
export function interpolatePath(path: string, scope: EvalScope): string {
  return path.replace(/\{([\w.]+)\}/g, (_match, name: string) => {
    const value = getPath(scope.vars, name)
    if (value === undefined || value === null) throw new BlueprintError('INVALID_DOCUMENT', `model path "${path}": variable "${name}" is not in scope`)
    return String(value)
  })
}

function keyFrom(evaluator: Evaluator, key: string, item: unknown, scope: EvalScope): string {
  // A plain identifier is a path in the item; anything else is an expression.
  if (/^[\w.]+$/.test(key)) {
    const value = getPath(item, key)
    return value === undefined ? String(scope.vars.index) : String(value)
  }
  return String(evaluator.eval(key as Logic, scope))
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  if (isPlainObject(value)) return Object.entries(value).map(([key, item]) => ({ key, ...(isPlainObject(item) ? item : { value: item }) }))
  return [value]
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function serializableVars(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(vars)) {
    if (name === '') continue
    if (typeof value === 'function') continue
    out[name] = value
  }
  return out
}

/** Route pattern matching for `page:*` templates (`/product/:id`, `/orders/*`). */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const normalize = (value: string) => '/' + value.split('/').filter(Boolean).join('/')
  const patternSegments = normalize(pattern).split('/').filter(Boolean)
  const pathSegments = normalize(path).split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let index = 0; index < patternSegments.length; index++) {
    const segment = patternSegments[index]!
    if (segment === '*' || segment === '**') {
      params.rest = pathSegments.slice(index).join('/')
      return params
    }
    const current = pathSegments[index]
    if (current === undefined) return null
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(current)
    else if (segment !== current) return null
  }
  return patternSegments.length === pathSegments.length ? params : null
}

export interface ResolvedPage {
  name: string
  template: PageTemplate
  params: Record<string, string>
}

/** Find the page template whose route matches the slug. Static routes win. */
export function resolvePage(document: BlueprintDocument, slug: string): ResolvedPage | null {
  const pages = Object.entries(document.content.templates || {})
    .filter(([name, template]) => name.startsWith('page:') && isPageTemplate(template))
    .map(([name, template]) => ({ name, template: template as PageTemplate, route: routeOf(name, template as PageTemplate) }))
    .sort((a, b) => specificity(b.route) - specificity(a.route))
  for (const page of pages) {
    const params = matchRoute(page.route, slug)
    if (params) return { name: page.name, template: page.template, params }
  }
  return null
}

export function routeOf(name: string, template: PageTemplate): string {
  if (template.route) return template.route
  const slug = name.replace(/^page:/, '')
  return slug === 'index' ? '/' : `/${slug}`
}

function specificity(route: string): number {
  return route.split('/').filter(Boolean).reduce((score, segment) => {
    if (segment === '*' || segment === '**') return score
    return score + (segment.startsWith(':') ? 1 : 2)
  }, 0)
}
